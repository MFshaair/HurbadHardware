import { getTranslations } from 'next-intl/server';
import type { SpecGroupDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export async function SpecTable({
  groups,
  highlightKeys = [],
}: {
  groups: SpecGroupDTO[];
  highlightKeys?: string[];
}) {
  const t = await getTranslations('catalog');
  if (groups.length === 0) return null;
  return (
    <div className="flex flex-col gap-6">
      {groups.map((group) => (
        <section key={group.group} className="flex flex-col gap-2">
          <h3 className="font-display text-base font-semibold text-foreground">{group.group}</h3>
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">{t('specifications')}</caption>
            <tbody>
              {group.rows.map((row) => (
                <tr
                  key={row.key}
                  className={cn(
                    'border-b border-hairline dark:border-hairline-dark',
                    highlightKeys.includes(row.key) && 'bg-soft dark:bg-night-3',
                  )}
                >
                  <th
                    scope="row"
                    className="w-1/2 py-2 pe-3 text-start font-normal text-ink-2 dark:text-on-dark-2"
                  >
                    {row.label}
                  </th>
                  <td className="py-2 text-foreground">{row.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
