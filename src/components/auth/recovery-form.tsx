'use client';
import type { CountryCode } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PhoneOtpForm } from '@/components/auth/phone-otp-form';
import { EmailForm } from '@/components/auth/email-form';
export function RecoveryForm({ country, next }: { country: CountryCode; next: string }) {
  const t = useTranslations('auth');
  const [method, setMethod] = useState<'WHATSAPP' | 'SMS' | 'EMAIL'>('WHATSAPP');
  return (
    <div className="grid gap-6">
      <fieldset className="grid gap-2">
        <legend className="mb-3 text-sm font-medium">{t('recoveryMethod')}</legend>
        {(['WHATSAPP', 'SMS', 'EMAIL'] as const).map((value) => (
          <label
            key={value}
            className="flex min-h-12 items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm"
          >
            <input
              type="radio"
              name="recoveryMethod"
              checked={method === value}
              onChange={() => {
                setMethod(value);
              }}
              className="accent-primary"
            />
            {value === 'EMAIL' ? t('tabEmail') : value === 'SMS' ? t('channelSms') : t('channelWhatsapp')}
          </label>
        ))}
      </fieldset>
      {method === 'EMAIL' ? (
        <EmailForm next={next} recovery />
      ) : (
        <PhoneOtpForm
          key={method}
          defaultCountry={country}
          next={next}
          defaultChannel={method}
          showChannelChoice={false}
        />
      )}
    </div>
  );
}
