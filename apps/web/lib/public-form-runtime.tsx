import React from "react";

import type { PublishedFormRuntime } from "@magictrust/database";

const publicFormDocumentCspDirectives = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data: blob:",
  "font-src data:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "navigate-to 'none'",
];

export const publicFormRuntimeCsp = [
  "sandbox allow-scripts allow-forms",
  "frame-ancestors 'self'",
  ...publicFormDocumentCspDirectives,
].join("; ");

const publicFormDocumentCsp = publicFormDocumentCspDirectives.join("; ");

export function PublicFormFrame({ slug }: { slug: string }) {
  return (
    <main className="public-form-runtime-page">
      <iframe
        className="public-form-runtime-frame"
        title="Public form"
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        src={`/forms/${encodeURIComponent(slug)}/runtime`}
      />
    </main>
  );
}

export function buildPublicFormRuntimeDocument(source: PublishedFormRuntime) {
  const css = source.css.replace(/<\/style/gi, "<\\/style");
  const javascript = source.javascript.replace(/<\/script/gi, "<\\/script");
  const runtimeGuard = `
(function () {
  function showMessage(id, message) {
    if (document.getElementById(id)) return;
    var notice = document.createElement("p");
    notice.id = id;
    notice.setAttribute("role", "alert");
    notice.textContent = message;
    (document.body || document.documentElement).appendChild(notice);
  }
  window.addEventListener("error", function () {
    showMessage("magictrust-runtime-error", "This form could not finish loading.");
  });
  window.addEventListener("unhandledrejection", function () {
    showMessage("magictrust-runtime-error", "This form could not finish loading.");
  });
  document.addEventListener("submit", function (event) {
    event.preventDefault();
    showMessage("magictrust-submission-unavailable", "Form submission is not available yet.");
  }, true);
})();`;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${publicFormDocumentCsp}">
<style>${css}</style>
<script>${runtimeGuard}</script>
</head>
<body>
${source.html}
<script>${javascript}</script>
</body>
</html>`;
}
