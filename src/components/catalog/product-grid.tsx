import { ProductCard } from './product-card';
import { Skeleton } from '@/components/ui/skeleton';
import type { ProductCardDTO } from '@/features/catalog/dto';

export function ProductGrid({
  products,
  priorityCount = 4,
}: {
  products: ProductCardDTO[];
  priorityCount?: number;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4">
      {products.map((product, i) => (
        <li key={product.id} className="h-full">
          <ProductCard product={product} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-lg border border-hairline bg-card p-3 dark:border-hairline-dark"
        >
          <Skeleton className="aspect-square w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </div>
  );
}
