'use client';

import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';

export interface OtpInputProps {
  label: string;
  length?: number;
  onComplete: (code: string) => void;
  onChange?: (code: string) => void;
  error?: string;
  disabled?: boolean;
}
export function OtpInput({ label, length = 6, onComplete, onChange, error, disabled }: OtpInputProps) {
  const id = useId();
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ''));
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const commit = (next: string[]) => {
    setDigits(next);
    const code = next.join('');
    onChange?.(code);
    if (code.length === length && !next.includes('')) onComplete(code);
  };
  const setAt = (index: number, value: string) => {
    const next = [...digits];
    next[index] = value;
    commit(next);
  };
  const fill = (raw: string, index = 0) => {
    const incoming = raw.replace(/\D/g, '').slice(0, length - index);
    if (!incoming) return;
    const next = [...digits];
    for (let i = 0; i < incoming.length; i++) next[index + i] = incoming.charAt(i);
    commit(next);
    refs.current[Math.min(index + incoming.length, length - 1)]?.focus();
  };
  const keyDown = (index: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) setAt(index, '');
      else if (index > 0) {
        setAt(index - 1, '');
        refs.current[index - 1]?.focus();
      }
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      refs.current[index + (event.key === 'ArrowLeft' ? -1 : 1)]?.focus();
    } else if (/^\d$/.test(event.key)) {
      event.preventDefault();
      setAt(index, event.key);
      refs.current[Math.min(index + 1, length - 1)]?.focus();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) event.preventDefault();
  };
  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const code = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!code) return;
    const next = Array.from({ length }, (_, i) => code.charAt(i));
    commit(next);
    refs.current[code.length - 1]?.focus();
  };
  return (
    <fieldset className="min-w-0 space-y-3" aria-describedby={error ? `${id}-error` : undefined}>
      <legend className="text-sm font-medium">{label}</legend>
      <div aria-label={label} className="grid max-w-[362px] grid-cols-6 gap-2">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={(element) => {
              refs.current[index] = element;
            }}
            aria-label={`${label} ${index + 1}`}
            aria-invalid={Boolean(error)}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={index === 0 ? length : 1}
            disabled={disabled}
            className="h-15 w-full min-w-0 rounded-md border border-input bg-card text-center font-display text-2xl outline-none focus:border-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 aria-invalid:border-danger"
            value={digit}
            onKeyDown={keyDown(index)}
            onPaste={paste}
            onChange={(event) => {
              if (!event.target.value) setAt(index, '');
              else fill(event.target.value, index);
            }}
          />
        ))}
      </div>
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          aria-live="polite"
          className="rounded-md bg-danger-soft p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
    </fieldset>
  );
}
