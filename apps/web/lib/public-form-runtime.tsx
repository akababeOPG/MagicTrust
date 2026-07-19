import type { PublishedFormRuntime } from "@magictrust/database";

import {
  buildFormRuntimeBootstrap,
  formRuntimeFeedbackCss,
} from "./form-runtime-bootstrap";

function publicFormDocumentCspDirectives(origin: string) {
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    "script-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    `connect-src ${origin}`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "navigate-to 'none'",
  ];
}

export function buildPublicFormRuntimeCsp(origin: string) {
  return [
    "sandbox allow-scripts allow-forms",
    "frame-ancestors *",
    ...publicFormDocumentCspDirectives(origin),
  ].join("; ");
}

export function buildPublicFormRuntimeDocument(
  source: PublishedFormRuntime,
  input: { slug: string; origin: string },
) {
  const css = source.css.replace(/<\/style/gi, "<\\/style");
  const javascript = source.javascript.replace(/<\/script/gi, "<\\/script");
  const runtimeBootstrap = buildFormRuntimeBootstrap({
    mode: "published",
    slug: input.slug,
    resizeMessageType: "magictrust:runtime-resize",
  }).replace(/<\/script/gi, "<\\/script");
  const publicFormDocumentCsp = publicFormDocumentCspDirectives(
    input.origin,
  ).join("; ");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${publicFormDocumentCsp}">
<style>${formRuntimeFeedbackCss}\n${css}</style>
<script>${runtimeBootstrap}</script>
</head>
<body>
${source.html}
<script>${javascript}</script>
</body>
</html>`;
}
