import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * UX-only redirect layer for `/profile/*` and `/dashboard/*`. This checks
 * cookie *presence* only (Edge-safe, no DB round trip) — it does NOT
 * validate the session. Real validation happens in each protected page
 * via `auth.api.getSession()` (see src/app/profile/page.tsx and
 * src/app/dashboard/orders/{page,[orderId]/page}.tsx, M5-1b); that
 * page-level check is the actual security boundary, not this middleware.
 * A forged/stale cookie under the right cookie name still passes this
 * check — only the page's own getSession() call rejects it.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*", "/dashboard/:path*"],
};
