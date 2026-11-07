import { ProductGridSkeleton } from '@/components/catalog/product-grid';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8">
      <Skeleton className="h-8 w-56" />
      <ProductGridSkeleton count={8} />
    </div>
  );
}
