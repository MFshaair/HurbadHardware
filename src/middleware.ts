import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * UX-only redirect layer for `/profile/*`, `/dashboard/*`, and `/admin/*`.
 * This checks cookie *presence* only (Edge-safe, no DB round trip) — it
 * does NOT validate the session, and (for `/admin/*`) performs NO role
 * check and NO DB access at all (Edge runtime, no Prisma). Real
 * validation happens in each protected page: `auth.api.getSession()` for
 * `/profile`/`/dashboard/*` (see src/app/profile/page.tsx and
 * src/app/dashboard/orders/{page,[orderId]/page}.tsx, M5-1b), and
 * `src/lib/adminAuth.ts`'s `requireAdminRole()`/`requireAdmin()` for
 * `/admin/*` (role + 2FA + idle-timeout, M5-2a) — those page/layout-level
 * checks are the actual security boundary, not this middleware. A
 * forged/stale cookie under the right cookie name still passes this
 * check — only the real gate rejects it.
 *
 * `/admin/2fa/setup` is correctly covered by this matcher: an enrolling
 * admin is signed in and holds a real session cookie. `/auth/2fa` is
 * deliberately NOT covered — it is reached with a two-factor cookie, not
 * a session cookie, and matching it here would make getSessionCookie()
 * find nothing and redirect, breaking 2FA sign-in entirely (ADR M5-2a
 * Decision 9/10).
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/dashboard/:path*", "/admin/:path*"],
};
