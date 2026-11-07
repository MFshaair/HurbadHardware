// loading.tsx
import { ProductGridSkeleton } from '@/components/catalog/product-grid';
import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-6">
        <Skeleton className="size-20 shrink-0" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="flex gap-8">
        <Skeleton className="hidden h-96 w-64 lg:block" />
        <div className="flex-1">
          <ProductGridSkeleton count={8} />
        </div>
      </div>
    </div>
  );
}
