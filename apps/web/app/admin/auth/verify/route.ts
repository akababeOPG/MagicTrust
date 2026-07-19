import { NextResponse } from "next/server";

import {
  adminSessionCookieName,
  adminSessionCookieOptions,
  createAdminAuthDependencies,
  createAdminAuthService,
} from "../../../../lib/admin-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token")?.trim();

  if (!token) {
    return safeError();
  }

  const dependencies = createAdminAuthDependencies();
  const service = createAdminAuthService(dependencies);
  const result = await service.verifyLoginToken(token);

  if (!result) {
    return safeError();
  }

  const response = NextResponse.redirect(new URL("/admin", request.url));
  response.cookies.set(
    adminSessionCookieName,
    result.sessionToken,
    adminSessionCookieOptions(dependencies.appEnv),
  );

  return response;
}

function safeError() {
  return new Response(
    "<!doctype html><title>MagicTrust</title><main><h1>MagicTrust Internal</h1><p>This login link is invalid or expired.</p></main>",
    {
      status: 401,
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}
