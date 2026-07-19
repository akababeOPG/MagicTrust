import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { adminSessionCookieName } from "./lib/admin-auth-constants";

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    pathname === "/admin/login" ||
    pathname.startsWith("/admin/auth/") ||
    request.cookies.has(adminSessionCookieName)
  ) {
    return NextResponse.next();
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("returnTo", `${pathname}${search}`);

  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*"],
};
