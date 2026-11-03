'use client';

import { XIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'hh_announcement_dismissed';
const CHANGE_EVENT = 'hh-announcement-change';
function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
function dismissedMessage() {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function AnnouncementBar({ message }: { message: string }) {
  const t = useTranslations('common');
  const dismissed = useSyncExternalStore(subscribe, dismissedMessage, () => '');
  if (!message || dismissed === message) return null;
  return (
    <aside className="bg-ink text-on-dark">
      <div className="relative mx-auto flex min-h-9 max-w-[1280px] items-center justify-center px-12 py-2 text-center text-xs font-medium sm:text-sm">
        <p>{message}</p>
        <button
          type="button"
          aria-label={t('announcementDismiss')}
          className="absolute right-1 inline-flex size-9 items-center justify-center rounded-full hover:bg-on-dark/10 sm:right-4"
          onClick={() => {
            try {
              localStorage.setItem(STORAGE_KEY, message);
            } catch {
              return;
            }
            window.dispatchEvent(new Event(CHANGE_EVENT));
          }}
        >
          <XIcon className="size-4" aria-hidden="true" />
        </button>
      </div>
    </aside>
  );
}
