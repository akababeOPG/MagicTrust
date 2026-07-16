import {
  consumerAccessSessionCookieName,
  consumerAccessSessionTtlSeconds,
  exchangeConsumerAccessTokenForSession,
} from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";
import { NextResponse } from "next/server";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  const session = await exchangeConsumerAccessTokenForSession(
    getPublicRequestApiDependencies(),
    publicId,
    token,
  );

  if (!session) {
    return safeAccessErrorResponse();
  }

  const response = NextResponse.redirect(
    new URL(`/requests/${encodeURIComponent(publicId)}/secure`, request.url),
  );

  response.cookies.set({
    name: consumerAccessSessionCookieName,
    value: session.sessionToken,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: `/requests/${publicId}`,
    maxAge: consumerAccessSessionTtlSeconds,
    expires: session.expiresAt,
  });

  return response;
}

function safeAccessErrorResponse(): Response {
  return new Response(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8" />',
      "<title>Secure access unavailable</title>",
      "</head>",
      "<body>",
      "<main>",
      "<h1>Secure access unavailable</h1>",
      "<p>This secure access link is invalid, expired, or already used.</p>",
      "</main>",
      "</body>",
      "</html>",
    ].join(""),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
      status: 200,
    },
  );
}
