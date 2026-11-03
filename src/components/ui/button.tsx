import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from '@radix-ui/react-slot';

/**
 * 14 §2-4 / DESIGN.md: pill is the only button shape. Variants are
 * primary | ink | outline | ghost | whatsapp — there is no square/destructive/secondary/link variant.
 */
const buttonVariants = cva(
  "focus-visible:border-ring focus-visible:ring-ring/50 inline-flex shrink-0 items-center justify-center gap-2 rounded-full text-sm font-medium whitespace-nowrap transition-all outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:bg-soft disabled:text-ink-4 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary hover:bg-primary-press',
        ink: 'bg-ink text-on-dark hover:bg-ink/90',
        outline:
          'border border-ink text-ink hover:bg-soft dark:border-on-dark dark:text-on-dark dark:hover:bg-night-3',
        ghost: 'text-ink-2 hover:bg-soft dark:text-on-dark-2 dark:hover:bg-night-3',
        whatsapp: 'bg-whatsapp text-ink hover:bg-whatsapp/90',
      },
      size: {
        lg: 'h-12 px-6 has-[>svg]:px-5',
        md: 'h-11 px-5 has-[>svg]:px-4',
        sm: 'h-9 px-4 text-xs has-[>svg]:px-3',
        icon: 'size-11',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  },
);

function Button({
  className,
  variant = 'primary',
  size = 'md',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
