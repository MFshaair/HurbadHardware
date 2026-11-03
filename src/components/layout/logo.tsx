import { cn } from '@/lib/utils';

export interface LogoProps {
  variant?: 'lockup' | 'mark';
  onDark?: boolean;
  mono?: boolean;
  height?: number;
  className?: string;
}

/** Brand wordmark is deliberately not translated (14 §4). Mark geometry: design/brand/mark.svg. */
export function Logo({
  variant = 'lockup',
  onDark = false,
  mono = false,
  height = 32,
  className,
}: LogoProps) {
  return (
    <span
      aria-hidden="true"
      className={cn('inline-flex shrink-0 items-center gap-2.5 whitespace-nowrap', className)}
      style={{ height }}
    >
      <svg viewBox="0 0 330 330" className="h-full w-auto shrink-0" focusable="false">
        <rect width="330" height="330" rx="30" className={mono ? 'fill-on-dark' : 'fill-primary'} />
        <g className={mono ? 'fill-primary' : 'fill-light'}>
          <rect x="66" y="50" width="44" height="230" rx="4" />
          <rect x="220" y="50" width="44" height="230" rx="4" />
          <rect x="110" y="141" width="110" height="48" />
        </g>
      </svg>
      {variant === 'lockup' && (
        <span className="flex items-baseline gap-1 leading-none">
          <span
            className={cn(
              'text-xs font-bold tracking-[0.6px] sm:text-sm',
              mono ? 'text-on-dark' : 'text-primary',
            )}
          >
            {'HURBAD '}
          </span>
          <span
            className={cn(
              'text-xs font-light tracking-[2.6px] sm:text-sm',
              onDark || mono ? 'text-on-dark' : 'text-foreground dark:text-on-dark',
            )}
          >
            {'HARDWARE'}
          </span>
        </span>
      )}
    </span>
  );
}
