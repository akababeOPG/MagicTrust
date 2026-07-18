import type { PublishedFormRuntime } from "@magictrust/database";

import { publicFormResizeBounds } from "./public-form-resize";

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
  "frame-ancestors *",
  ...publicFormDocumentCspDirectives,
].join("; ");

const publicFormDocumentCsp = publicFormDocumentCspDirectives.join("; ");

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

  var lastHeight = 0;
  function sendHeight() {
    var body = document.body;
    var root = document.documentElement;
    var measured = Math.ceil(Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    ));
    var height = Math.min(${publicFormResizeBounds.maximum}, Math.max(${publicFormResizeBounds.minimum}, measured));
    if (height === lastHeight) return;
    lastHeight = height;
    window.parent.postMessage({ type: "magictrust:runtime-resize", height: height }, "*");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", sendHeight, { once: true });
  } else {
    window.setTimeout(sendHeight, 0);
  }
  window.addEventListener("load", sendHeight, { once: true });
  if (typeof ResizeObserver === "function") {
    var resizeObserver = new ResizeObserver(sendHeight);
    resizeObserver.observe(document.documentElement);
  } else {
    window.setTimeout(sendHeight, 250);
  }
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
