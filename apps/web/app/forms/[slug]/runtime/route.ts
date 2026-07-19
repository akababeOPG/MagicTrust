import { unstable_noStore as noStore } from "next/cache";

import {
  buildPublicFormRuntimeDocument,
  buildPublicFormRuntimeCsp,
} from "../../../../lib/public-form-runtime";
import {
  createPublicFormRenderingDependencies,
  getPublicFormRuntime,
} from "../../../../lib/public-form-rendering";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  noStore();
  const { slug } = await context.params;
  const runtime = await getPublicFormRuntime(
    slug,
    createPublicFormRenderingDependencies(),
  );
  if (!runtime) {
    const origin = new URL(request.url).origin;
    return new Response(publicFormUnavailableDocument(), {
      status: 404,
      headers: runtimeHeaders(origin),
    });
  }
  const origin = new URL(request.url).origin;
  return new Response(
    buildPublicFormRuntimeDocument(runtime, { slug, origin }),
    {
      status: 200,
      headers: runtimeHeaders(origin, slug),
    },
  );
}

function runtimeHeaders(origin: string, slug?: string) {
  return {
    "cache-control": "no-store, max-age=0",
    "content-security-policy": buildPublicFormRuntimeCsp(origin, slug),
    "content-type": "text/html; charset=utf-8",
    "cross-origin-resource-policy": "same-origin",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
  };
}

function publicFormUnavailableDocument() {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Form unavailable</title></head>
<body><main><h1>Form unavailable</h1><p>This form is not available.</p></main></body>
</html>`;
}
