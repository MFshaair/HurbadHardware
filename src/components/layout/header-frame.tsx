'use client';

import type { ReactNode } from 'react';
import { usePathname } from '@/lib/i18n/navigation';
import { cn } from '@/lib/utils';

export function HeaderFrame({ children }: { children: ReactNode }) {
  const isHome = usePathname() === '/';
  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border bg-background text-foreground',
        isHome && 'dark bg-night',
      )}
    >
      {children}
    </header>
  );
}
