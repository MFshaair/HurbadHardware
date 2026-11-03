import type { Locale, Role } from '@prisma/client';
import type { DefaultSession } from 'next-auth';

// next-auth v5's `next-auth`/`next-auth/jwt` modules only re-export these interfaces
// (`export type { Session } from '@auth/core/types'` and `export * from '@auth/core/jwt'`),
// so declaration merging targets both the re-exporting module and their real home in `@auth/core`.
declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: Role;
      amr: string[];
      locale: Locale;
      phone: string | null;
    };
  }
}

declare module '@auth/core/types' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string;
      role: Role;
      amr: string[];
      locale: Locale;
      phone: string | null;
    };
  }
}

// Optional: unset only until the `jwt` callback's first run populates them (brand-new token).
declare module 'next-auth/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    amr?: string[];
    locale?: Locale;
    phone?: string | null;
    /** User.sessionVersion (11 §1) */
    sv?: number;
    /** epoch ms of the last sv re-read */
    svCheckedAt?: number;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    uid?: string;
    role?: Role;
    amr?: string[];
    locale?: Locale;
    phone?: string | null;
    /** User.sessionVersion (11 §1) */
    sv?: number;
    /** epoch ms of the last sv re-read */
    svCheckedAt?: number;
  }
}
