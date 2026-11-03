import type { Locale, NotificationChannel, NotificationTemplateKey } from '@prisma/client';

export interface OutboundMessage {
  channel: NotificationChannel;
  templateKey: NotificationTemplateKey;
  /** E.164 phone for WHATSAPP/SMS, email address for EMAIL */
  to: string;
  locale: Locale;
  vars: Record<string, string | number>;
  dedupeKey?: string;
}

export interface SendResult {
  status: 'SENT' | 'FAILED';
  providerMessageId?: string;
  error?: string;
  /** false when the provider says the recipient is unreachable — the chain falls through (06 §4). */
  retryable?: boolean;
}

export interface MessageChannel {
  readonly channel: NotificationChannel;
  send(msg: OutboundMessage): Promise<SendResult>;
}
