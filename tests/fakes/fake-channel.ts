import type { NotificationChannel } from '@prisma/client';
import type { MessageChannel, OutboundMessage, SendResult } from '@/features/notifications/ports';

export interface RecordedMessage extends OutboundMessage {
  sentAt: string;
  providerMessageId: string;
}

const fakeGlobal = globalThis as unknown as {
  hurbadFakeChannelState?: { messages: RecordedMessage[]; failOnce: Set<NotificationChannel>; seq: number };
};
const state = (fakeGlobal.hurbadFakeChannelState ??= {
  messages: [],
  failOnce: new Set<NotificationChannel>(),
  seq: 0,
});
const { messages, failOnce } = state;

export function fakeMessages(): readonly RecordedMessage[] {
  return messages;
}

export function resetFakeMessages(): void {
  messages.length = 0;
  failOnce.clear();
  state.seq = 0;
}

/** Makes the next send on this channel fail, to exercise the fallback chain. */
export function failNextSend(channel: NotificationChannel): void {
  failOnce.add(channel);
}

export class FakeChannel implements MessageChannel {
  constructor(readonly channel: NotificationChannel) {}

  async send(msg: OutboundMessage): Promise<SendResult> {
    if (failOnce.has(this.channel)) {
      failOnce.delete(this.channel);
      return { status: 'FAILED', error: 'fake failure', retryable: false };
    }
    const providerMessageId = `fake-${this.channel.toLowerCase()}-${++state.seq}`;
    messages.push({ ...msg, sentAt: new Date().toISOString(), providerMessageId });
    return { status: 'SENT', providerMessageId };
  }
}

const instances = new Map<NotificationChannel, FakeChannel>();

export function getFakeChannel(channel: NotificationChannel): FakeChannel {
  let hit = instances.get(channel);
  if (!hit) {
    hit = new FakeChannel(channel);
    instances.set(channel, hit);
  }
  return hit;
}
