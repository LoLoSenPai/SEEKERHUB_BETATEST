import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function proxy(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);

  if (!sessionCookie && (request.nextUrl.pathname.startsWith("/builder") || request.nextUrl.pathname.startsWith("/admin"))) {
    const signInUrl = new URL("/sign-in", request.url);
    signInUrl.searchParams.set("intent", "builder");
    signInUrl.searchParams.set("returnTo", `${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(signInUrl);
  }

  const requestHeaders = new Headers(request.headers);
  // Always overwrite the client value: this is only a safe navigation hint.
  requestHeaders.set("x-seekerhub-return-to", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/builder/:path*", "/admin/:path*"],
};
