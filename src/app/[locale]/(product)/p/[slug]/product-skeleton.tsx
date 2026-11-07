import { Skeleton } from '@/components/ui/skeleton';
export default function Loading() {
  return (
    <div className="mx-auto grid max-w-7xl gap-8 p-6 lg:grid-cols-2">
      <Skeleton className="aspect-square w-full" />
      <div className="space-y-4">
        <Skeleton className="h-10 w-3/4" />
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-24 w-full" />
      </div>
    </div>
  );
}
