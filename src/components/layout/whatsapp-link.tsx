'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

export function WhatsAppLink({
  phone,
  floating = false,
  className,
}: {
  phone: string;
  floating?: boolean;
  className?: string;
}) {
  const t = useTranslations('common');
  const pathname = usePathname();
  if (floating && (pathname === '/checkout' || pathname.startsWith('/checkout/'))) return null;
  return (
    <a
      href={`https://wa.me/${phone.replace(/\D/g, '')}`}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('whatsappHelp')}
      className={cn(
        'inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-whatsapp text-ink transition-colors hover:bg-whatsapp/90 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-whatsapp',
        floating
          ? 'fixed right-4 bottom-4 z-40 size-14 shadow-2 sm:right-6 sm:bottom-6'
          : 'min-h-11 px-4 py-2 text-sm font-medium',
        className,
      )}
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="size-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        <path d="M21 12a9 9 0 0 1-13.5 7.8L3 21l1.2-4.5A9 9 0 1 1 21 12Z" />
        <path d="M8 7.5c-.5 3.5 2.5 6.5 6 8l2-2-2-1-1 1c-2-1-3-2-4-4l1-1-1-2Z" />
      </svg>
      {!floating && <span>{t('whatsappHelp')}</span>}
    </a>
  );
}
