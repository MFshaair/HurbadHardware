'use client';

import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useSyncExternalStore } from 'react';

const subscribe = () => () => undefined;
export function ThemeToggle() {
  const t = useTranslations('common');
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const current = mounted ? (theme ?? 'system') : 'system';
  const next = current === 'system' ? 'light' : current === 'light' ? 'dark' : 'system';
  const label =
    current === 'light' ? t('themeLight') : current === 'dark' ? t('themeDark') : t('themeSystem');
  const Icon = current === 'light' ? SunIcon : current === 'dark' ? MoonIcon : MonitorIcon;
  return (
    <button
      type="button"
      disabled={!mounted}
      aria-label={`${t('theme')}: ${label}`}
      className="inline-flex h-11 items-center gap-2 rounded-full border border-input px-3 text-sm"
      onClick={() => {
        setTheme(next);
      }}
    >
      <Icon aria-hidden="true" className="size-4" />
      <span>{label}</span>
    </button>
  );
}
