import { NextResponse } from "next/server";

import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminAuthDependencies,
  createAdminAuthService,
  normalizeAdminReturnTo,
} from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  const formData = await readFormData(request);
  const returnTo = normalizeAdminReturnTo(formData?.get("returnTo"));

  if (!formData || !isSameOriginRequest(request)) {
    return invalidCredentialsRedirect(request, returnTo);
  }

  const dependencies = createAdminAuthDependencies();
  const service = createAdminAuthService(dependencies);
  const result = await service.authenticateWithPassword({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok) {
    return invalidCredentialsRedirect(request, returnTo);
  }

  const response = NextResponse.redirect(new URL(returnTo, request.url), 303);
  response.cookies.set(
    adminSessionCookieName,
    result.sessionToken,
    adminSessionCookieOptions(dependencies.appEnv),
  );

  return response;
}

async function readFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");

  return origin === null || origin === new URL(request.url).origin;
}

function invalidCredentialsRedirect(request: Request, returnTo: string) {
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("error", "invalid_credentials");
  loginUrl.searchParams.set("returnTo", returnTo);

  return NextResponse.redirect(loginUrl, 303);
}
