// Generic email transport (M5-1a, HRH-52). Framework-free (no Next.js/React
// import) — same "pure data-layer function" pattern as
// paymentWebhookService.ts/mpesaCallbackService.ts.
//
// Binding design: docs/agents/arch-decisions/M5-1a-order-confirmation-email.md
// ("the ADR" below). Every "Decision N" comment refers to that document's
// numbered decision — do not improvise a different mechanism for any of
// them.
//
// Decision 3: `IEmailService` is a generic `send(...)` TRANSPORT, not a
// per-message-type interface (`sendOrderConfirmation`, etc.) — that surface
// lives one layer up, in orderNotificationService.ts. Do not add
// message-type-specific methods here; HRH-63's future templates and
// HRH-62's SES provider swap both depend on this staying orthogonal.
//
// No new npm dependency: SendGridEmailService POSTs to SendGrid's HTTP API
// directly via an injected `fetchImpl` seam, identical to mpesa.ts's
// established pattern. Never log a recipient address (PII) or any card/
// credential data from this module.

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string; // required — plaintext alternative, not optional
}

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Provider-agnostic correlation tag, not an idempotency key (Decision
   * 4.3 — the OrderEvent claim is the sole idempotency mechanism). */
  tags?: Record<string, string>;
}

export interface SendEmailResult {
  providerMessageId: string | null;
}

export interface IEmailService {
  /** Resolves on accepted-for-delivery. Throws EmailSendError otherwise. */
  send(input: SendEmailInput, opts?: { signal?: AbortSignal }): Promise<SendEmailResult>;
}

/**
 * Decision 5's retry-classification error. `retryable: false` for a
 * permanent (400/401/403/413) rejection; `true` for a network error,
 * timeout, 429, or 5xx. `status` is `null` for a network-level failure
 * (fetch itself threw — no HTTP response was ever received).
 */
export class EmailSendError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status: number | null,
  ) {
    super(message);
    this.name = "EmailSendError";
  }
}

const SENDGRID_ENDPOINT = "https://api.sendgrid.com/v3/mail/send";

// Decision 5 — permanent (non-retryable) HTTP statuses.
const PERMANENT_STATUSES = new Set([400, 401, 403, 413]);

/**
 * Decision 7 — ships with real code behind the `fetchImpl` seam. No new
 * npm dependency (`@sendgrid/mail` is explicitly out of scope).
 */
export class SendGridEmailService implements IEmailService {
  constructor(
    private readonly apiKey: string,
    private readonly fromEmail: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(input: SendEmailInput, opts?: { signal?: AbortSignal }): Promise<SendEmailResult> {
    const body = {
      personalizations: [
        {
          to: [{ email: input.to }],
          // Correlation only, per Decision 4.3 — no semantic weight.
          custom_args: input.tags,
        },
      ],
      from: { email: this.fromEmail },
      subject: input.subject,
      content: [
        { type: "text/plain", value: input.text },
        { type: "text/html", value: input.html },
      ],
    };

    let response: Response;
    try {
      response = await this.fetchImpl(SENDGRID_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });
    } catch (err) {
      // Network error / AbortError-from-timeout — retryable (Decision 5).
      throw new EmailSendError(
        `SendGrid request failed: ${err instanceof Error ? err.message : "unknown error"}`,
        true,
        null,
      );
    }

    if (response.ok) {
      // Decision 5: treat ANY 2xx as success regardless of body — SendGrid
      // returns 202 with an empty body; never parse-then-throw.
      const providerMessageId = response.headers.get("x-message-id");
      return { providerMessageId: providerMessageId ?? null };
    }

    const retryable = !PERMANENT_STATUSES.has(response.status);
    throw new EmailSendError(
      `SendGrid rejected the send: HTTP ${response.status}`,
      retryable,
      response.status,
    );
  }
}

/**
 * Decision 7 — dev/test fallback. Never a silent fake success on the
 * production path: this is used ONLY when SendGrid is not configured
 * outside production (getEmailService's resolution table). Logs `subject`
 * + `text` to stdout, never the recipient address (PII).
 */
export class ConsoleEmailService implements IEmailService {
  async send(input: SendEmailInput): Promise<SendEmailResult> {
    console.log(
      `[console-email] subject=${JSON.stringify(input.subject)}\n${input.text}`,
    );
    return { providerMessageId: "console" };
  }
}

function isPlaceholder(value: string | undefined): boolean {
  if (!value) return true;
  return value === "REPLACE_ME" || value === "SG.REPLACE_ME";
}

/**
 * Decision 7's resolution table:
 *
 * | SENDGRID_API_KEY            | NODE_ENV=production | else                |
 * |------------------------------|----------------------|---------------------|
 * | set and not a placeholder   | SendGridEmailService | SendGridEmailService|
 * | unset or placeholder        | null (no send)       | ConsoleEmailService |
 *
 * Returns `null` ONLY in the "unconfigured in production" cell — callers
 * (orderNotificationService.ts) must treat a `null` return as
 * `reason: "not_configured"`, never attempt a send, and log one
 * `console.error`.
 */
export function getEmailService(): IEmailService | null {
  const apiKey = process.env.SENDGRID_API_KEY;
  const fromEmail = process.env.SENDGRID_FROM_EMAIL || "orders@hurbadhardware.com";
  const isProduction = process.env.NODE_ENV === "production";

  if (!isPlaceholder(apiKey)) {
    return new SendGridEmailService(apiKey as string, fromEmail);
  }

  if (isProduction) {
    console.error(
      "[email-service] SENDGRID_API_KEY is unset or a placeholder in production — no email will be sent",
    );
    return null;
  }

  return new ConsoleEmailService();
}

// ---------------------------------------------------------------------------
// Decision 1.1 — the `after()` injection seam.

export type AfterResponse = (task: () => Promise<void>) => void;

/** Default when no scheduler is injected (vitest, scripts, seed): run
 * inline and await. Deterministic, never throws on its own (the task's own
 * try/catch, per Decision 6, is what guarantees that). */
export const inlineAfterResponse: AfterResponse = (task) => {
  void task();
};
