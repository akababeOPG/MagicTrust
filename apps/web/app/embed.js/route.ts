import { embedLoaderSource } from "../../lib/embed-loader";

export async function GET() {
  return new Response(embedLoaderSource, {
    status: 200,
    headers: {
      "cache-control": "public, max-age=300",
      "content-type": "application/javascript; charset=utf-8",
      "cross-origin-resource-policy": "cross-origin",
      "x-content-type-options": "nosniff",
    },
  });
}
