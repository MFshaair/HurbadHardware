# WhatsApp Templates (submit via Twilio Content API **or** directly in Meta WhatsApp Manager, category UTILITY unless noted)

Meta template names (when `WHATSAPP_PROVIDER=meta`): `otp`, `order_confirmed`, `payment_received`, `payment_failed`, `order_shipped`, `order_out_for_delivery`, `order_delivered`, `order_cancelled`, `refund_issued`, `back_in_stock`, `cart_abandoned`, `review_request` — languages `en` and `so`. Bodies and `{{n}}` numbering are identical for both providers.

Variables are positional `{{1}}`, `{{2}}`… matching `TEMPLATES[key].whatsapp.variableOrder` in `src/features/notifications/templates.ts`.

| Key | Lang | Body |
|---|---|---|
| OTP (AUTHENTICATION, with copy-code button) | en | `{{1}} is your Hurbad Hardware verification code. It expires in 10 minutes. Do not share it.` |
| OTP | so | `{{1}} waa koodhkaaga xaqiijinta Hurbad Hardware. Wuxuu dhacayaa 10 daqiiqo gudahood. Cidna ha la wadaagin.` |
| ORDER_CONFIRMED | en | `Thank you {{2}}! Your Hurbad Hardware order {{1}} is confirmed. Total: {{3}}. Track it here: {{4}}` |
| ORDER_CONFIRMED | so | `Mahadsanid {{2}}! Dalabkaaga Hurbad Hardware {{1}} waa la xaqiijiyay. Wadarta: {{3}}. Halkan ka raac: {{4}}` |
| PAYMENT_RECEIVED | en | `We received your payment of {{2}} for order {{1}} via {{3}}. Reference: {{4}}.` |
| PAYMENT_RECEIVED | so | `Waxaan helnay lacagtaada {{2}} ee dalabka {{1}} iyadoo la adeegsanayo {{3}}. Tixraac: {{4}}.` |
| PAYMENT_FAILED | en | `Payment for order {{1}} was not completed. You can try again here: {{2}}` |
| PAYMENT_FAILED | so | `Lacag bixinta dalabka {{1}} lama dhammaystirin. Halkan ka isku day mar kale: {{2}}` |
| ORDER_SHIPPED | en | `Good news! Order {{1}} has shipped with {{2}} (tracking {{3}}). Follow it here: {{4}}` |
| ORDER_SHIPPED | so | `War wanaagsan! Dalabka {{1}} waa la diray iyadoo la adeegsanayo {{2}} (raadraac {{3}}). Halkan ka raac: {{4}}` |
| ORDER_OUT_FOR_DELIVERY | en | `Your order {{1}} is out for delivery today. Questions? Message us on WhatsApp: {{2}}` |
| ORDER_OUT_FOR_DELIVERY | so | `Dalabkaaga {{1}} maanta waa la keenayaa. Su'aal ma qabtaa? WhatsApp nagala soo xiriir: {{2}}` |
| ORDER_DELIVERED | en | `Order {{1}} was delivered. Enjoy! We'd love your review: {{2}}` |
| ORDER_DELIVERED | so | `Dalabka {{1}} waa la gaarsiiyay. Ku raaxayso! Waxaan jeclaan lahayn faallo: {{2}}` |
| ORDER_CANCELLED | en | `Order {{1}} has been cancelled. Reason: {{2}}. Any payment will be refunded.` |
| ORDER_CANCELLED | so | `Dalabka {{1}} waa la joojiyay. Sababta: {{2}}. Lacag kasta oo la bixiyay waa la soo celin doonaa.` |
| REFUND_ISSUED | en | `A refund of {{2}} for order {{1}} has been issued via {{3}}. Allow 1–5 business days.` |
| REFUND_ISSUED | so | `Lacag celin dhan {{2}} oo dalabka {{1}} ah ayaa la bixiyay iyadoo la adeegsanayo {{3}}. Sug 1–5 maalmood shaqo.` |
| BACK_IN_STOCK | en | `{{1}} is back in stock at Hurbad Hardware. Get it before it sells out: {{2}}` |
| BACK_IN_STOCK | so | `{{1}} ayaa dib u yimid Hurbad Hardware. Hel ka hor intaanu dhammaan: {{2}}` |
| CART_ABANDONED (MARKETING) | en | `Hi {{1}}, you left {{2}} item(s) in your Hurbad Hardware cart. Finish your order: {{3}}` |
| CART_ABANDONED (MARKETING) | so | `Salaan {{1}}, waxaad kaga tagtay {{2}} shay gaadhigaaga Hurbad Hardware. Dhammee dalabkaaga: {{3}}` |
| REVIEW_REQUEST (MARKETING) | en | `How was your order {{1}}? Share a quick review and help other shoppers: {{2}}` |
| REVIEW_REQUEST (MARKETING) | so | `Sidee ahaa dalabkaaga {{1}}? Faallo kooban nala wadaag oo caawi dadka kale: {{2}}` |

Rules: `CART_ABANDONED` and `REVIEW_REQUEST` are MARKETING category and require `whatsappOptIn`; the dispatcher never sends them via SMS unless `smsOptIn` and never more than once per entity.
