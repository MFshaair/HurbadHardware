import { expect, it } from 'vitest';
import { signupProfileSchema } from '@/features/auth/schemas';
const draft = { name: 'Amina', country: 'SO', locale: 'so', whatsappOptIn: true };
it('does not accept role or verification claims from a signup draft', () => {
  expect(signupProfileSchema.safeParse({ ...draft, role: 'ADMIN' }).success).toBe(false);
  expect(signupProfileSchema.safeParse({ ...draft, emailVerified: new Date() }).success).toBe(false);
});
it('normalizes email and restricts country', () => {
  expect(signupProfileSchema.parse({ ...draft, email: ' HELLO@example.test ' }).email).toBe(
    'hello@example.test',
  );
  expect(signupProfileSchema.safeParse({ ...draft, country: 'US' }).success).toBe(false);
});
