import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * UX-only redirect layer for `/profile/*`. This checks cookie *presence*
 * only (Edge-safe, no DB round trip) — it does NOT validate the session.
 * Real validation happens in each protected page via
 * `auth.api.getSession()` (see src/app/profile/page.tsx); that page-level
 * check is the actual security boundary, not this middleware.
 */
export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie) {
    return NextResponse.redirect(new URL("/auth/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/profile/:path*"],
};
