"use client";

import React, { useEffect, useRef, useState } from "react";

import { publicFormResizeBounds } from "./public-form-resize";

export function PublicFormFrame({ slug }: { slug: string }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const pageRef = useRef<HTMLElement>(null);
  const [runtimeHeight, setRuntimeHeight] = useState<number | null>(null);

  useEffect(() => {
    function receiveRuntimeResize(event: MessageEvent) {
      const frame = frameRef.current;
      if (
        !frame ||
        event.source !== frame.contentWindow ||
        event.origin !== "null" ||
        !isResizeMessage(event.data, "magictrust:runtime-resize")
      ) {
        return;
      }
      const height = Math.ceil(event.data.height);
      setRuntimeHeight(height);
      if (window.parent !== window) {
        window.parent.postMessage(
          { type: "magictrust:resize", slug, height },
          "*",
        );
      }
    }

    window.addEventListener("message", receiveRuntimeResize);
    return () => window.removeEventListener("message", receiveRuntimeResize);
  }, [slug]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || window.parent === window) return;
    const observedPage = page;
    let lastHeight = 0;
    let animationFrame = 0;

    function sendResize() {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = window.requestAnimationFrame(() => {
        const measured = Math.ceil(
          Math.max(
            observedPage.scrollHeight,
            observedPage.offsetHeight,
            document.documentElement.scrollHeight,
            document.body.scrollHeight,
          ),
        );
        const height = clampResizeHeight(measured);
        if (height === lastHeight) return;
        lastHeight = height;
        window.parent.postMessage(
          { type: "magictrust:resize", slug, height },
          "*",
        );
      });
    }

    sendResize();
    window.addEventListener("load", sendResize, { once: true });
    window.addEventListener("resize", sendResize);
    const observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver(sendResize)
        : null;
    observer?.observe(observedPage);
    if (!observer) window.setTimeout(sendResize, 250);

    return () => {
      observer?.disconnect();
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", sendResize);
    };
  }, [slug]);

  return (
    <main className="public-form-runtime-page" ref={pageRef}>
      <iframe
        ref={frameRef}
        className="public-form-runtime-frame"
        title="Public form"
        sandbox="allow-scripts allow-forms"
        referrerPolicy="no-referrer"
        src={`/forms/${encodeURIComponent(slug)}/runtime`}
        style={runtimeHeight ? { height: `${runtimeHeight}px` } : undefined}
      />
    </main>
  );
}

export function isResizeMessage(
  value: unknown,
  type = "magictrust:resize",
): value is { type: string; height: number } {
  if (!value || typeof value !== "object") return false;
  const message = value as { type?: unknown; height?: unknown };
  return (
    message.type === type &&
    typeof message.height === "number" &&
    Number.isFinite(message.height) &&
    message.height >= publicFormResizeBounds.minimum &&
    message.height <= publicFormResizeBounds.maximum
  );
}

function clampResizeHeight(value: number) {
  return Math.min(
    publicFormResizeBounds.maximum,
    Math.max(publicFormResizeBounds.minimum, value),
  );
}
