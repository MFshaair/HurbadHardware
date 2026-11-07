import { ArrowRight } from 'lucide-react';
import { Link } from '@/lib/i18n/navigation';
import { ProductCard } from './product-card';
import type { ProductCardDTO } from '@/features/catalog/dto';

/** Horizontal scroll rail used by home collections, related, FBT and recently viewed (10 §2). */
export function ProductRail({
  title,
  href,
  products,
  actionLabel,
}: {
  title: string;
  href?: string;
  products: ProductCardDTO[];
  actionLabel?: string;
}) {
  if (products.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-4">
        <h2 className="font-display text-xl font-semibold text-foreground">{title}</h2>
        {href === undefined || actionLabel === undefined ? null : (
          <Link
            href={href}
            className="flex items-center gap-1 text-sm text-primary-deep hover:underline dark:text-primary"
          >
            {actionLabel}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </div>
      <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
        {products.map((product) => (
          <li key={product.id} className="w-[46%] shrink-0 snap-start sm:w-[31%] lg:w-[23%]">
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
    </section>
  );
}
