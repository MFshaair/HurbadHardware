'use client';

import type { CountryCode, CurrencyCode, Locale } from '@prisma/client';
import { createContext, useContext, type ReactNode } from 'react';

export interface StoreValue {
  locale: Locale;
  currency: CurrencyCode;
  country: CountryCode;
  userId: string | null;
  supportWhatsapp?: string;
}

const StoreContext = createContext<StoreValue | null>(null);

export function StoreProvider({ value, children }: { value: StoreValue; children: ReactNode }) {
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): StoreValue {
  const value = useContext(StoreContext);
  if (!value) throw new Error('useStore must be used inside <StoreProvider>');
  return value;
}
