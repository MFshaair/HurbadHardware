'use client';

import type { CountryCode } from '@prisma/client';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { EmailForm } from '@/components/auth/email-form';
import { GoogleButton } from '@/components/auth/google-button';
import { PhoneOtpForm } from '@/components/auth/phone-otp-form';
import { Link } from '@/lib/i18n/navigation';

export function SignInTabs({
  defaultCountry,
  next,
  signup = false,
  googleEnabled = true,
  initialTab = 'phone',
}: {
  defaultCountry: CountryCode;
  next: string;
  signup?: boolean;
  googleEnabled?: boolean;
  initialTab?: 'phone' | 'email';
}) {
  const t = useTranslations('auth');
  const [tab, setTab] = useState(initialTab);
  const [codeStep, setCodeStep] = useState(false);
  return (
    <div className="grid gap-6">
      <header className="mb-2">
        <h1 className="font-display text-3xl font-semibold tracking-tight">
          {codeStep ? t('verifyTitle') : signup ? t('signupTitle') : t('title')}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {codeStep ? t('verifySubtitle') : signup ? t('signupSubtitle') : t('subtitle')}
        </p>
      </header>
      {!signup && !codeStep && (
        <div role="tablist" aria-label={t('methods')} className="flex gap-7 border-b border-border">
          {(['phone', 'email'] as const).map((value) => (
            <button
              type="button"
              key={value}
              role="tab"
              aria-selected={tab === value}
              aria-controls={`auth-panel-${value}`}
              id={`auth-tab-${value}`}
              tabIndex={tab === value ? 0 : -1}
              onClick={() => {
                setTab(value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  const nextTab = value === 'phone' ? 'email' : 'phone';
                  setTab(nextTab);
                  document.getElementById(`auth-tab-${nextTab}`)?.focus();
                }
              }}
              className={`min-h-11 border-b-2 text-sm font-semibold ${tab === value ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground'}`}
            >
              {value === 'phone' ? t('tabPhone') : t('tabEmail')}
            </button>
          ))}
        </div>
      )}
      <div
        role={signup || codeStep ? undefined : 'tabpanel'}
        id={`auth-panel-${tab}`}
        aria-labelledby={signup || codeStep ? undefined : `auth-tab-${tab}`}
      >
        {tab === 'phone' || signup ? (
          <PhoneOtpForm
            defaultCountry={defaultCountry}
            next={next}
            signup={signup}
            onStepChange={setCodeStep}
          />
        ) : (
          <EmailForm next={next} />
        )}
      </div>
      {!codeStep && (
        <>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {t('or')}
            <span className="h-px flex-1 bg-border" />
          </div>
          <GoogleButton next={next} enabled={googleEnabled} />
          <div className="grid gap-3 border-t border-border pt-5 text-sm">
            <p>
              {signup ? t('alreadyAccount') : t('newToHurbad')}{' '}
              <Link
                href={
                  signup
                    ? `/sign-in?next=${encodeURIComponent(next)}`
                    : `/sign-in?mode=signup&next=${encodeURIComponent(next)}`
                }
                className="font-semibold underline underline-offset-4"
              >
                {signup ? t('signInLink') : t('createAccount')}
              </Link>
            </p>
            <Link
              href={`/sign-in/recover?next=${encodeURIComponent(next)}`}
              className="font-semibold underline underline-offset-4"
            >
              {t('recoverLink')}
            </Link>
          </div>
          <p className="text-xs text-muted-foreground">{t('staffNote')}</p>
        </>
      )}
    </div>
  );
}
