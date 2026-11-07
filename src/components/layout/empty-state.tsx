import type { ReactNode } from 'react';
import { PackageOpen } from 'lucide-react';

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-hairline bg-card px-6 py-16 text-center">
      <span className="text-ink-3" aria-hidden>
        {icon ?? <PackageOpen className="size-10" />}
      </span>
      <h2 className="font-display text-xl font-semibold text-foreground tabular-nums">{title}</h2>
      {description === undefined ? null : <p className="max-w-md text-sm text-ink-2">{description}</p>}
      {action}
    </div>
  );
}
