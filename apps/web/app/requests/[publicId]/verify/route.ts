import { verifyPublicRequestIdentity } from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";

export async function GET(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const token = new URL(request.url).searchParams.get("token");
  const verified = await verifyPublicRequestIdentity(
    getPublicRequestApiDependencies(),
    publicId,
    token,
  );

  return verified ? successResponse() : errorResponse();
}

function successResponse(): Response {
  return htmlResponse(
    "Request verified",
    "Your email address has been verified for this MagicTrust request.",
  );
}

function errorResponse(): Response {
  return htmlResponse(
    "Verification unavailable",
    "This verification link is invalid, expired, or already used.",
  );
}

function htmlResponse(title: string, message: string): Response {
  return new Response(
    [
      "<!doctype html>",
      '<html lang="en">',
      "<head>",
      '<meta charset="utf-8" />',
      `<title>${title}</title>`,
      "</head>",
      "<body>",
      "<main>",
      `<h1>${title}</h1>`,
      `<p>${message}</p>`,
      "</main>",
      "</body>",
      "</html>",
    ].join(""),
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
      },
    },
  );
}
