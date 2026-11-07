import { z } from 'zod';

export const recordProductViewSchema = z.object({
  productId: z.string().min(1).max(40),
});

export const getProductCardsSchema = z.object({
  productIds: z.array(z.string().min(1).max(40)).max(12),
});
