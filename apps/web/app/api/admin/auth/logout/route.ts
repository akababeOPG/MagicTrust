import { NextResponse } from "next/server";

import {
  adminSessionCookieName,
  clearAdminSessionCookieOptions,
  createAdminAuthDependencies,
  createAdminAuthService,
  requireAdminSession,
} from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  const session = await requireAdminSession({ response: "json" });

  if (session instanceof Response) {
    return session;
  }

  const dependencies = createAdminAuthDependencies();
  const service = createAdminAuthService(dependencies);
  const sessionToken = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${adminSessionCookieName}=`))
    ?.split("=")[1];

  if (sessionToken) {
    await service.revokeSessionToken(decodeURIComponent(sessionToken));
  }

  const response = NextResponse.redirect(new URL("/admin/login", request.url));
  response.cookies.set(
    adminSessionCookieName,
    "",
    clearAdminSessionCookieOptions(dependencies.appEnv),
  );

  return response;
}
