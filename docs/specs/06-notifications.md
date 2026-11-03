# 06 — Notifications (WhatsApp, SMS, Email)

## 1. Architecture

```
domain service ──emit──▶ inngest.send('notification/requested', { templateKey, recipient: {userId?|phone?|email?}, locale, vars, dedupeKey })
                                          │
                                          ▼  notify/dispatch (Inngest)
                    resolve recipient prefs ─▶ pick channel chain ─▶ render template ─▶ channel.send ─▶ NotificationLog
                                                                                          │ fail
                                                                                          ▼ next channel in chain
```

Domain code never calls Twilio/Resend directly. `src/features/notifications/service.ts` exposes:

```ts
requestNotification(input: { templateKey: NotificationTemplateKey; userId?: string; phone?: string; email?: string; locale: Locale; vars: Record<string, string | number>; dedupeKey: string; channelOverride?: NotificationChannel }): Promise<void>  // emits event
dispatch(input): Promise<void>       // used by the Inngest function
```

OTP is the one exception: `auth/otp.ts` calls `dispatch()` synchronously (not via Inngest) with `channelOverride` so the code arrives immediately; on WhatsApp failure it falls back to SMS in-process.

## 2. Channel chain

Given recipient `User` (or bare phone/email for guests):

1. If `channelOverride` → only that channel (OTP).
2. Else order = `[user.preferredChannel, WHATSAPP, SMS, EMAIL]` de-duplicated, filtered by: WhatsApp requires `whatsappOptIn && phone`; SMS requires `smsOptIn && phone`; Email requires `emailOptIn && email`. Guests: WhatsApp if they ticked the opt-in at checkout, then SMS, then email.
3. Try in order; first `SENT` stops. If all fail → `NotificationLog.status = FAILED` for the last attempt and Sentry warning.
4. `dedupeKey` unique on `NotificationLog` guarantees at-most-once per (template, entity) across retries. Format: `<TEMPLATE_KEY>:<entityId>[:<suffix>]`.

Templates that are **email-only**: `MAGIC_LINK`. Templates that **skip email**: `OTP`.

## 3. Template registry (`src/features/notifications/templates.ts`)

```ts
export const TEMPLATES: Record<NotificationTemplateKey, {
  vars: readonly string[];
  whatsapp: { contentSidEnv: string; variableOrder: readonly string[] } | null;   // Twilio Content Template SID from env
  sms: (vars, locale) => string;                                                    // ≤ 2 segments (306 GSM chars)
  email: { subject: (vars, locale) => string; component: React.ComponentType<any> } | null;
}>;
```

| Key | Vars | WhatsApp env | Email component |
|---|---|---|---|
| OTP | `code` | `TWILIO_TPL_OTP` (authentication template) | — |
| ORDER_CONFIRMED | `orderNumber, name, total, trackUrl` | `TWILIO_TPL_ORDER_CONFIRMED` | `emails/order-confirmed.tsx` (includes items table) |
| PAYMENT_RECEIVED | `orderNumber, amount, method, reference` | `TWILIO_TPL_PAYMENT_RECEIVED` | `emails/payment-received.tsx` |
| PAYMENT_FAILED | `orderNumber, retryUrl` | `TWILIO_TPL_PAYMENT_FAILED` | `emails/payment-failed.tsx` |
| ORDER_SHIPPED | `orderNumber, carrier, trackingNumber, trackUrl` | `TWILIO_TPL_ORDER_SHIPPED` | `emails/order-shipped.tsx` |
| ORDER_OUT_FOR_DELIVERY | `orderNumber, supportWhatsapp` | `TWILIO_TPL_ORDER_OFD` | `emails/order-out-for-delivery.tsx` |
| ORDER_DELIVERED | `orderNumber, reviewUrl` | `TWILIO_TPL_ORDER_DELIVERED` | `emails/order-delivered.tsx` |
| ORDER_CANCELLED | `orderNumber, reason` | `TWILIO_TPL_ORDER_CANCELLED` | `emails/order-cancelled.tsx` |
| REFUND_ISSUED | `orderNumber, amount, method` | `TWILIO_TPL_REFUND_ISSUED` | `emails/refund-issued.tsx` |
| BACK_IN_STOCK | `productName, productUrl` | `TWILIO_TPL_BACK_IN_STOCK` | `emails/back-in-stock.tsx` |
| CART_ABANDONED | `name, itemCount, cartUrl` | `TWILIO_TPL_CART_ABANDONED` | `emails/cart-abandoned.tsx` |
| REVIEW_REQUEST | `orderNumber, reviewUrl` | `TWILIO_TPL_REVIEW_REQUEST` | `emails/review-request.tsx` |
| MAGIC_LINK | `url` | — | `emails/magic-link.tsx` |
| ACCOUNT_DELETION_SCHEDULED | `date` | — | `emails/account-deletion.tsx` |

Each WhatsApp template exists in both `en` and `so`; the env var holds a JSON `{ "en": "HX…", "so": "HX…" }`. Template bodies to submit to Meta (exact copy) are in `docs/flows/whatsapp-templates.md`.

SMS bodies (en/so) live in `messages/en.json` / `messages/so.json` under `sms.<KEY>` with ICU placeholders.

## 4. Channel adapters

### WhatsApp — two interchangeable implementations, selected by `WHATSAPP_PROVIDER=twilio|meta` (default `twilio`)

Both implement `MessageChannel` with `channel = 'WHATSAPP'`; `src/features/notifications/channels/whatsapp.ts` exports `createWhatsAppChannel(env)` which returns `TwilioWhatsAppChannel` or `MetaWhatsAppChannel`. Domain code never knows which one is active. Templates are addressed by **logical key** (`NotificationTemplateKey`) and the registry holds provider-specific identifiers for both:

```ts
whatsapp: {
  twilio: { contentSidEnv: 'TWILIO_TPL_ORDER_CONFIRMED' },          // JSON {"en":"HX…","so":"HX…"}
  meta:   { templateName: 'order_confirmed', languageCodes: { en: 'en', so: 'so' } },
  variableOrder: ['orderNumber', 'name', 'total', 'trackUrl'],
}
```

**Twilio (`channels/whatsapp-twilio.ts`)** — `client.messages.create({ from: 'whatsapp:' + TWILIO_WHATSAPP_FROM, to: 'whatsapp:' + phone, contentSid, contentVariables: JSON.stringify({1: ..., 2: ...}), statusCallback: `${APP_URL}/api/webhooks/twilio` })`. Errors 63003/21211 (invalid/unreachable) → `{status:'FAILED', retryable:false}` so the chain falls through.

**Meta WhatsApp Cloud API (`channels/whatsapp-meta.ts`)** — `POST https://graph.facebook.com/v21.0/${META_WA_PHONE_NUMBER_ID}/messages` with `Authorization: Bearer ${META_WA_ACCESS_TOKEN}` and body:

```json
{ "messaging_product": "whatsapp", "to": "<E.164 without +>", "type": "template",
  "template": { "name": "order_confirmed", "language": { "code": "so" },
    "components": [ { "type": "body", "parameters": [ { "type": "text", "text": "HH-260913-K7Q2M" }, … ] },
                    { "type": "button", "sub_type": "url", "index": "0", "parameters": [ { "type": "text", "text": "<trackUrl path>" } ] } ] } }
```

Response `messages[0].id` is stored as `providerMessageId`. Error mapping: HTTP 4xx with `error.code` 131026 (not a WhatsApp user) / 131047 (re-engagement window; cannot occur for templates) / 132000 (template param mismatch — log as bug) → `FAILED, retryable:false`; 130429 (rate limit) and 5xx → `FAILED, retryable:true` (Inngest retries). Access token is a **System User permanent token**; never the temporary 24-h token.

Status webhook `POST /api/webhooks/meta-whatsapp`: verify `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(rawBody, `META_WA_APP_SECRET`); `GET` handles the verification handshake (`hub.mode=subscribe`, `hub.verify_token === META_WA_VERIFY_TOKEN` → echo `hub.challenge`). Payload `entry[].changes[].value.statuses[]` with `id`, `status` (`sent|delivered|read|failed`), `errors[]` → update `NotificationLog` by `providerMessageId`; `failed` with error 131026/131049 within 10 min of send → SMS fallback once (same rule as Twilio). Inbound `messages[]` are acknowledged and ignored in MVP.

Templates: the same bodies in `docs/flows/whatsapp-templates.md` are submitted to Meta through WhatsApp Manager with the names in the registry (`otp`, `order_confirmed`, `payment_received`, `payment_failed`, `order_shipped`, `order_out_for_delivery`, `order_delivered`, `order_cancelled`, `refund_issued`, `back_in_stock`, `cart_abandoned`, `review_request`), languages `en` and `so`; OTP uses Meta's **authentication** template category with the copy-code button. `{{n}}` numbering is identical between the two providers, so `variableOrder` is shared.

Choosing: Twilio is simpler to provision (one account for SMS + WhatsApp, template approval through Twilio); Meta Cloud API has no per-message Twilio markup and lower latency but needs a Meta Business verification, its own WABA, phone number and app. The fake channel covers both in tests; an integration test per implementation runs against recorded fixtures in `tests/fixtures/whatsapp/{twilio,meta}-*.json`.

### SMS (`channels/sms.ts`) — Twilio
`client.messages.create({ messagingServiceSid: TWILIO_MESSAGING_SERVICE_SID, to: phone, body, statusCallback })`. Body from `TEMPLATES[key].sms`.

### Email (`channels/email.ts`) — Resend
`resend.emails.send({ from: EMAIL_FROM, to, subject, react: <Component {...vars} locale/>, headers: { 'X-Entity-Ref-ID': dedupeKey } })`. Attach invoice PDF for `ORDER_CONFIRMED` when order is paid (fetch from `/api/invoices` internally via service, not HTTP).

### Fake (`tests/fakes/fake-channel.ts`)
Stores messages in a module-level array exposed via test-only route `GET /__fake/messages` (only when `PROVIDER_MODE=fake`), used by Playwright to read OTP codes.

## 5. Delivery status webhooks

- Twilio: `POST /api/webhooks/twilio` form-encoded `MessageSid`, `MessageStatus` in `queued|sent|delivered|undelivered|failed`, `ErrorCode`. Validate `X-Twilio-Signature` with `twilio.validateRequest(authToken, signature, url, params)`. Update `NotificationLog` where `providerMessageId = MessageSid`. If WhatsApp `failed/undelivered` with error 63024/63016 within 10 min of send → re-dispatch via SMS (one retry, `dedupeKey + ':sms-fallback'`).
- Meta: `POST /api/webhooks/meta-whatsapp` (HMAC `X-Hub-Signature-256`) and `GET` handshake — see §4.
- Resend: `POST /api/webhooks/resend` (Svix headers). Events `email.delivered`, `email.bounced`, `email.complained` → update log; on `bounced` set `user.emailOptIn=false`.

## 6. Consent

- Checkout contact step has a checkbox "Send me order updates on WhatsApp" (default checked). For signed-in users it updates `User.whatsappOptIn`. For every order it is snapshotted to `Order.whatsappOptIn` (column exists in `prisma/schema.prisma`) so guest orders can be notified on WhatsApp without a user record. The dispatcher treats a guest recipient as opted-in when `Order.whatsappOptIn` is true.
- Account page lets users change channel preferences; every SMS includes "Reply STOP to opt out" only for marketing (V2), not transactional.

## 7. WhatsApp deep links (no API)

`buildWhatsAppLink({ product?, order? , locale })` → `https://wa.me/<SUPPORT_WHATSAPP_E164 digits>?text=<urlencoded>`; text en: `Hi Hurbad Hardware, I have a question about <product name> (<url>)`; so: `Salaan Hurbad Hardware, su'aal ayaan ka qabaa <name> (<url>)`. Floating WhatsApp button on storefront (bottom-right, hidden during checkout).

## 8. Timing SLAs

Transactional notifications must be **sent** (provider accepted) within 60 s of the triggering event. Inngest function has `retries: 3` with backoff; the `dedupeKey` prevents duplicates.
