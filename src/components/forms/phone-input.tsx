'use client';

import type { CountryCode } from '@prisma/client';
import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js/min';
import { useTranslations } from 'next-intl';
import { useId, useState } from 'react';
import { COUNTRIES } from '@/lib/geo';

const PREFIX: Record<CountryCode, string> = { SO: '+252', KE: '+254', ET: '+251', DJ: '+253', UG: '+256' };
export interface PhoneInputProps {
  label: string;
  defaultCountry: CountryCode;
  onChange: (value: { e164: string | null; valid: boolean }) => void;
  hint?: string;
  error?: string;
  name?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}
export function PhoneInput({
  label,
  defaultCountry,
  onChange,
  hint,
  error,
  name = 'phone',
  autoFocus,
  disabled,
}: PhoneInputProps) {
  const t = useTranslations('common');
  const id = useId();
  const [country, setCountry] = useState(defaultCountry);
  const [display, setDisplay] = useState('');
  const emit = (raw: string, selected: CountryCode) => {
    const parsed = parsePhoneNumberFromString(raw, selected);
    const valid = Boolean(
      parsed?.isValid() && parsed.country && COUNTRIES.includes(parsed.country as CountryCode),
    );
    onChange({ e164: valid ? (parsed?.number ?? null) : null, valid });
  };
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex h-12 min-w-0 items-center rounded-md border border-input bg-card focus-within:ring-2 focus-within:ring-primary focus-within:ring-offset-2">
        <select
          aria-label={t('country')}
          disabled={disabled}
          value={country}
          className="h-full max-w-32 shrink-0 rounded-l-md border-r border-input bg-transparent px-2 text-sm outline-none"
          onChange={(event) => {
            const next = event.target.value as CountryCode;
            setCountry(next);
            emit(display, next);
          }}
        >
          {COUNTRIES.map((code) => (
            <option key={code} value={code}>{`${code} ${PREFIX[code]}`}</option>
          ))}
        </select>
        <input
          id={id}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          autoFocus={autoFocus}
          disabled={disabled}
          value={display}
          maxLength={30}
          className="h-full w-full min-w-0 rounded-r-md bg-transparent px-3 text-base outline-none"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          onChange={(event) => {
            const value = new AsYouType(country).input(event.target.value);
            setDisplay(value);
            emit(value, country);
          }}
        />
      </div>
      {hint && !error && (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
