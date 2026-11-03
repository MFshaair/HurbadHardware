import { WhatsAppLink } from '@/components/layout/whatsapp-link';

export function WhatsAppFab({ phone }: { phone: string }) {
  return <WhatsAppLink phone={phone} floating />;
}
