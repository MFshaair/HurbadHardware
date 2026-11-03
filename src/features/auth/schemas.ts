import { z } from 'zod';

export const requestOtpSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  channel: z.enum(['WHATSAPP', 'SMS']),
});
export type RequestOtpInputDTO = z.infer<typeof requestOtpSchema>;

export const verifyOtpSchema = z.object({
  phone: z.string().trim().min(6).max(20),
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/),
});

export const magicLinkSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export const signupProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z.string().trim().toLowerCase().email().max(254).optional(),
    country: z.enum(['SO', 'KE', 'ET', 'DJ', 'UG']),
    locale: z.enum(['en', 'so']),
    whatsappOptIn: z.boolean(),
  })
  .strict();
export type SignupProfile = z.infer<typeof signupProfileSchema>;

export const requestMagicLinkSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  next: z.string().max(2048),
  locale: z.enum(['en', 'so']),
  recovery: z.boolean().default(false),
});
