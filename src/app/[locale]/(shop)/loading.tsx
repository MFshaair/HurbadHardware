import { Skeleton } from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div aria-busy="true" className="mx-auto max-w-[1280px] px-4 py-12 sm:px-6 lg:px-8">
      <Skeleton className="mb-5 h-12 w-3/4" />
      <Skeleton className="h-6 w-full max-w-xl" />
      <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
    </div>
  );
}
