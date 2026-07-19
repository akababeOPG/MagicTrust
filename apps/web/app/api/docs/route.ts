import { randomBytes } from "node:crypto";

const swaggerUiVersion = "5.32.9";

export function GET(): Response {
  const nonce = randomBytes(16).toString("base64url");
  const assetBase = `https://cdn.jsdelivr.net/npm/swagger-ui-dist@${swaggerUiVersion}`;

  return new Response(swaggerDocument(assetBase, nonce), {
    headers: {
      "cache-control": "public, max-age=300",
      "content-security-policy": [
        "default-src 'none'",
        `script-src 'nonce-${nonce}' ${assetBase}/`,
        `style-src 'unsafe-inline' ${assetBase}/`,
        "img-src data:",
        "connect-src 'self'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'self'",
      ].join("; "),
      "content-type": "text/html; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}

function swaggerDocument(assetBase: string, nonce: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>MagicTrust Internal API</title>
    <link rel="stylesheet" href="${assetBase}/swagger-ui.css">
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${assetBase}/swagger-ui-bundle.js"></script>
    <script nonce="${nonce}">
      SwaggerUIBundle({
        url: "/api/openapi.json",
        dom_id: "#swagger-ui",
        deepLinking: true,
        displayRequestDuration: true,
        persistAuthorization: false
      });
    </script>
  </body>
</html>`;
}
