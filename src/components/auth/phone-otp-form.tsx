'use client';

import { MessageCircle, Smartphone } from 'lucide-react';
import type { CountryCode } from '@prisma/client';
import { signIn } from 'next-auth/react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PhoneInput } from '@/components/forms/phone-input';
import { OtpInput } from '@/components/forms/otp-input';
import { Button } from '@/components/ui/button';
import { requestOtpAction } from '@/features/auth/client';
import { signupProfileSchema } from '@/features/auth/schemas';
import { COUNTRIES } from '@/lib/geo';
import { safeAuthRedirect } from '@/lib/auth-redirect';
import { Link } from '@/lib/i18n/navigation';

export function PhoneOtpForm({
  defaultCountry,
  next,
  signup = false,
  defaultChannel = 'WHATSAPP',
  onStepChange,
  showChannelChoice = true,
}: {
  defaultCountry: CountryCode;
  next: string;
  signup?: boolean;
  defaultChannel?: 'WHATSAPP' | 'SMS';
  onStepChange?: (isCode: boolean) => void;
  showChannelChoice?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState<string | null>(null);
  const [channel, setChannel] = useState(defaultChannel);
  const [code, setCode] = useState('');
  const [challenge, setChallenge] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [deadline, setDeadline] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [country, setCountry] = useState<CountryCode>(defaultCountry);
  const [language, setLanguage] = useState<'en' | 'so'>(locale === 'so' ? 'so' : 'en');
  const [whatsappOptIn, setWhatsappOptIn] = useState(true);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => {
      setSeconds(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
    };
  }, [deadline]);
  const send = async () => {
    if (!phone || pending) return;
    if (
      signup &&
      !signupProfileSchema.safeParse({
        name,
        ...(email ? { email } : {}),
        country,
        locale: language,
        whatsappOptIn,
      }).success
    ) {
      setError(t('errors.VALIDATION_ERROR'));
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await requestOtpAction({ phone, channel });
      if (!result.ok) {
        setError(t(`errors.${result.error.code}`));
        const retry = result.error.meta?.retryAfterSeconds;
        if (typeof retry === 'number') {
          setSeconds(retry);
          setDeadline(Date.now() + retry * 1000);
        }
        return;
      }
      setChannel(result.data.channelUsed === 'WHATSAPP' ? 'WHATSAPP' : 'SMS');
      setSeconds(result.data.resendAfterSeconds);
      setDeadline(Date.now() + result.data.resendAfterSeconds * 1000);
      setCode('');
      setLocked(false);
      setChallenge((value) => value + 1);
      setStep('code');
      onStepChange?.(true);
    } catch {
      setError(t('errors.INTERNAL'));
    } finally {
      setPending(false);
    }
  };
  const verify = async () => {
    if (!phone || code.length !== 6 || pending || locked) return;
    setPending(true);
    setError(null);
    try {
      const result = await signIn('phone-otp', {
        phone,
        code,
        locale,
        redirectTo: safeAuthRedirect(next, locale),
        redirect: false,
        ...(signup
          ? {
              profile: JSON.stringify({
                name,
                ...(email ? { email } : {}),
                country,
                locale: language,
                whatsappOptIn,
              }),
            }
          : {}),
      });
      if (result.error) {
        const recognized = [
          'OTP_INVALID',
          'OTP_EXPIRED',
          'OTP_LOCKED',
          'RATE_LIMITED',
          'BOT_CHECK_FAILED',
          'FORBIDDEN',
          'EMAIL_ALREADY_USED',
          'VALIDATION_ERROR',
        ];
        const mapped = result.code && recognized.includes(result.code) ? result.code : 'OTP_INVALID';
        setError(t(`errors.${mapped}`));
        if (mapped === 'OTP_LOCKED') {
          setLocked(true);
          setSeconds(600);
          setDeadline(Date.now() + 600000);
        }
        return;
      }
      router.push(safeAuthRedirect(next, locale));
      router.refresh();
    } catch {
      setError(t('errors.INTERNAL'));
    } finally {
      setPending(false);
    }
  };
  if (step === 'code')
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
        className="grid gap-6"
      >
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-sm">
          <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-primary-soft font-semibold text-primary-deep">
            {channel === 'SMS' ? (
              <Smartphone className="size-5" aria-hidden="true" />
            ) : (
              <MessageCircle className="size-5" aria-hidden="true" />
            )}
          </span>
          <p role="status" className="leading-relaxed text-muted-foreground">
            {channel === 'WHATSAPP'
              ? t('auth.codeSentWhatsapp', { phone: phone ?? '' })
              : t('auth.codeSentSms', { phone: phone ?? '' })}
          </p>
        </div>
        <OtpInput
          key={challenge}
          label={t('auth.codeLabel')}
          onComplete={setCode}
          onChange={setCode}
          error={error ?? undefined}
          disabled={pending || locked}
        />
        <Button type="submit" size="lg" className="w-full" disabled={code.length !== 6 || pending || locked}>
          {pending ? t('common.loading') : t('auth.verify')}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            disabled={pending}
            className="min-h-11 font-medium underline underline-offset-4"
            onClick={() => {
              setStep('phone');
              onStepChange?.(false);
              setError(null);
              setCode('');
            }}
          >
            {t('auth.changeNumber')}
          </button>
          <button
            type="button"
            disabled={pending || seconds > 0}
            className="min-h-11 font-medium underline underline-offset-4 disabled:text-muted-foreground disabled:no-underline"
            onClick={() => {
              void send();
            }}
          >
            {seconds > 0 ? t('auth.resendIn', { seconds }) : t('auth.resend')}
          </button>
        </div>
        <Link href="/sign-in/recover" className="text-sm font-medium underline underline-offset-4">
          {t('auth.recoverLink')}
        </Link>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('auth.singleUse')}</p>
      </form>
    );
  return (
    <form
      className="grid gap-5"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      {signup && (
        <label className="grid gap-2 text-sm font-medium">
          {t('auth.fullName')}
          <input
            name="name"
            autoComplete="name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="h-12 rounded-md border border-input bg-card px-3 text-base outline-primary"
            disabled={pending}
          />
        </label>
      )}
      <PhoneInput
        label={t('auth.phoneLabel')}
        hint={t('auth.phoneHint')}
        defaultCountry={country}
        onChange={({ e164 }) => {
          setPhone(e164);
        }}
        disabled={pending}
      />
      {signup && (
        <>
          <label className="grid gap-2 text-sm font-medium">
            {t('auth.optionalEmail')}
            <input
              type="email"
              name="email"
              autoComplete="email"
              maxLength={254}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
              }}
              className="h-12 rounded-md border border-input bg-card px-3 text-base outline-primary"
              disabled={pending}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="grid gap-2 text-sm font-medium">
              {t('common.country')}
              <select
                value={country}
                onChange={(event) => {
                  setCountry(event.target.value as CountryCode);
                }}
                className="h-12 min-w-0 rounded-md border border-input bg-card px-3"
                disabled={pending}
              >
                {COUNTRIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm font-medium">
              {t('auth.preferredLanguage')}
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value === 'so' ? 'so' : 'en');
                }}
                className="h-12 min-w-0 rounded-md border border-input bg-card px-3"
                disabled={pending}
              >
                <option value="en">{t('auth.languageEnglish')}</option>
                <option value="so">{t('auth.languageSomali')}</option>
              </select>
            </label>
          </div>
          <label className="flex items-start gap-3 rounded-lg border border-border bg-card p-4 text-sm">
            <input
              type="checkbox"
              checked={whatsappOptIn}
              onChange={(event) => {
                setWhatsappOptIn(event.target.checked);
              }}
              className="mt-1 size-5 shrink-0 accent-primary"
              disabled={pending}
            />
            <span>
              <span className="font-semibold">{t('auth.whatsappOptIn')}</span>
              <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                {t('auth.whatsappOptInHint')}
              </span>
            </span>
          </label>
        </>
      )}
      {showChannelChoice && (
        <fieldset className="grid gap-3">
          <legend className="mb-3 text-sm font-medium">{t('auth.channelLabel')}</legend>
          <div className="grid grid-cols-2 gap-2">
            {(['WHATSAPP', 'SMS'] as const).map((value) => (
              <label
                key={value}
                className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-full border px-4 text-sm font-semibold ${channel === value ? 'border-primary bg-primary-tint text-primary-deep' : 'border-input bg-card text-muted-foreground'}`}
              >
                <input
                  type="radio"
                  name="channel"
                  value={value}
                  checked={channel === value}
                  onChange={() => {
                    setChannel(value);
                  }}
                  disabled={pending}
                  className="accent-primary"
                />
                {value === 'WHATSAPP' ? t('auth.channelWhatsapp') : t('auth.channelSms')}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {error && (
        <p role="alert" className="rounded-md bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {signup && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          {t('auth.termsIntro')}{' '}
          <Link href="/pages/terms" className="underline">
            {t('nav.terms')}
          </Link>{' '}
          {t('auth.and')}{' '}
          <Link href="/pages/privacy" className="underline">
            {t('nav.privacy')}
          </Link>
          {'.'}
        </p>
      )}
      <Button
        type="submit"
        size="lg"
        disabled={!phone || pending || (signup && !name.trim())}
        className="w-full"
      >
        {pending ? t('common.loading') : signup ? t('auth.createAccount') : t('auth.sendCode')}
      </Button>
      <p className="text-center text-xs leading-relaxed text-muted-foreground">{t('auth.codeExpiry')}</p>
      <p className="text-center text-xs text-muted-foreground">{t('auth.securityNote')}</p>
    </form>
  );
}
