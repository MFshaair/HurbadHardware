'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import type { ImageDTO } from '@/features/catalog/dto';
import { cn } from '@/lib/utils';

export function ProductGallery({ images, productName }: { images: ImageDTO[]; productName: string }) {
  const t = useTranslations('catalog');
  const [index, setIndex] = useState(0);
  // Variant changes swap the image set; always fall back to the first image.
  useEffect(() => {
    setIndex(0);
  }, [images]);
  const main = images[index];

  if (main === undefined) {
    return <div className="aspect-square w-full rounded-lg bg-soft dark:bg-night-3" aria-hidden />;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative aspect-square overflow-hidden rounded-lg bg-soft dark:bg-night-3">
        <Image
          src={main.url}
          alt={main.alt.length > 0 ? main.alt : productName}
          fill
          priority
          sizes="(max-width:1024px) 100vw, 50vw"
          className="object-contain p-4"
          {...(main.blurDataUrl === null
            ? {}
            : { placeholder: 'blur' as const, blurDataURL: main.blurDataUrl })}
        />
      </div>
      {images.length < 2 ? null : (
        <ul className="flex gap-2 overflow-x-auto" aria-label={t('galleryThumbnails')}>
          {images.map((image, i) => (
            <li key={image.url}>
              <button
                type="button"
                aria-label={t('galleryImage', { index: i + 1, total: images.length })}
                aria-current={i === index}
                onClick={() => {
                  setIndex(i);
                }}
                className={cn(
                  'relative size-16 overflow-hidden rounded-md border bg-soft dark:bg-night-3',
                  i === index ? 'border-primary' : 'border-hairline dark:border-hairline-dark',
                )}
              >
                <Image src={image.url} alt="" fill sizes="64px" className="object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
