export const embedLoaderSource = `(function () {
  "use strict";

  try {
    var script = document.currentScript;
    if (!script || !script.src) {
      var scripts = document.getElementsByTagName("script");
      for (var index = scripts.length - 1; index >= 0; index -= 1) {
        try {
          var candidate = new URL(scripts[index].src, document.baseURI);
          if (candidate.pathname === "/embed.js") {
            script = scripts[index];
            break;
          }
        } catch (_) {}
      }
    }
    if (!script || !script.src) return;

    var magicTrustOrigin = new URL(script.src, document.baseURI).origin;
    var slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    var minimumHeight = 200;
    var maximumHeight = 4000;

    function initializeTargets() {
      var targets = document.querySelectorAll("[data-magictrust-form]");
      for (var index = 0; index < targets.length; index += 1) {
        var target = targets[index];
        if (target.getAttribute("data-magictrust-initialized") === "true") continue;
        var slug = (target.getAttribute("data-magictrust-form") || "").trim();
        if (!slug || slug.length > 120 || !slugPattern.test(slug)) continue;

        try {
          var iframe = document.createElement("iframe");
          iframe.src = magicTrustOrigin + "/forms/" + encodeURIComponent(slug);
          iframe.title = "MagicTrust form";
          iframe.loading = "lazy";
          iframe.referrerPolicy = "no-referrer";
          iframe.style.width = "100%";
          iframe.style.height = "500px";
          iframe.style.minHeight = "500px";
          iframe.style.border = "0";
          iframe.style.display = "block";
          iframe.setAttribute("data-magictrust-embed-frame", "true");
          target.appendChild(iframe);
          target.setAttribute("data-magictrust-initialized", "true");
        } catch (_) {}
      }
    }

    function installResizeListener() {
      var marker = "data-magictrust-embed-resize-listener";
      if (document.documentElement.getAttribute(marker) === "true") return;
      document.documentElement.setAttribute(marker, "true");
      window.addEventListener("message", function (event) {
        try {
          var data = event.data;
          if (
            event.origin !== magicTrustOrigin ||
            !data ||
            data.type !== "magictrust:resize" ||
            typeof data.slug !== "string" ||
            typeof data.height !== "number" ||
            !Number.isFinite(data.height) ||
            data.height < minimumHeight ||
            data.height > maximumHeight
          ) {
            return;
          }

          var targets = document.querySelectorAll("[data-magictrust-form]");
          for (var index = 0; index < targets.length; index += 1) {
            var target = targets[index];
            if (target.getAttribute("data-magictrust-form") !== data.slug) continue;
            var iframe = target.querySelector("iframe[data-magictrust-embed-frame]");
            if (!iframe || event.source !== iframe.contentWindow) continue;
            iframe.style.height = Math.ceil(data.height) + "px";
            return;
          }
        } catch (_) {}
      });
    }

    installResizeListener();
    initializeTargets();
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initializeTargets, { once: true });
    }
  } catch (_) {}
})();`;
