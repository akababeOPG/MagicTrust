import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getPublicFormRuntime: vi.fn(),
  noStore: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("../../lib/public-form-rendering", () => ({
  createPublicFormRenderingDependencies: vi.fn(() => ({ kind: "deps" })),
  getPublicFormRuntime: mocks.getPublicFormRuntime,
}));

import {
  buildPublicFormRuntimeDocument,
  publicFormRuntimeCsp,
} from "../../lib/public-form-runtime";
import { isResizeMessage } from "../../lib/public-form-frame";

const publishedSource = {
  html: '<form action="https://example.com"><button>Send</button></form>',
  css: "button { color: green; }",
  javascript: "window.__PUBLIC_FORM_VERSION__ = 2;",
};

describe("public form rendering", () => {
  beforeEach(() => vi.clearAllMocks());

  test("active published form renders only an isolated runtime iframe", async () => {
    mocks.getPublicFormRuntime.mockResolvedValueOnce(publishedSource);
    const { default: PublicFormPage } =
      await import("../../app/forms/[slug]/page");
    const html = renderToStaticMarkup(
      await PublicFormPage({ params: Promise.resolve({ slug: "contact-us" }) }),
    );

    expect(html).toContain('src="/forms/contact-us/runtime"');
    expect(html).toContain('sandbox="allow-scripts allow-forms"');
    expect(html).not.toContain("allow-same-origin");
    expect(html).not.toContain("__PUBLIC_FORM_VERSION__");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("versionNumber");
    expect(html).not.toContain("admin");
    expect(mocks.noStore).toHaveBeenCalled();
  });

  test("unknown or unavailable form returns the safe not-found state", async () => {
    mocks.getPublicFormRuntime.mockResolvedValueOnce(null);
    const { default: PublicFormPage } =
      await import("../../app/forms/[slug]/page");

    await expect(
      PublicFormPage({ params: Promise.resolve({ slug: "unknown" }) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalled();
  });

  test("runtime response contains published source with independent sandboxing", async () => {
    mocks.getPublicFormRuntime.mockResolvedValueOnce(publishedSource);
    const { GET } = await import("../../app/forms/[slug]/runtime/route");
    const response = await GET(
      new Request("https://magictrust.test/forms/contact-us/runtime"),
      { params: Promise.resolve({ slug: "contact-us" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("content-security-policy")).toContain(
      "sandbox allow-scripts allow-forms",
    );
    expect(response.headers.get("content-security-policy")).not.toContain(
      "allow-same-origin",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "form-action 'none'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors *",
    );
    expect(body).toContain(publishedSource.html);
    expect(body).toContain(publishedSource.css);
    expect(body).toContain(publishedSource.javascript);
    expect(body).toContain("Form submission is not available yet.");
    expect(body).toContain("magictrust:runtime-resize");
    expect(body).toContain("ResizeObserver");
    expect(body).not.toContain("stack");
  });

  test("runtime route returns a generic 404 without leaking form state", async () => {
    mocks.getPublicFormRuntime.mockResolvedValueOnce(null);
    const { GET } = await import("../../app/forms/[slug]/runtime/route");
    const response = await GET(
      new Request("https://magictrust.test/forms/unknown/runtime"),
      { params: Promise.resolve({ slug: "unknown" }) },
    );
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("Form unavailable");
    expect(body).not.toContain("draft");
    expect(body).not.toContain("published");
  });

  test("runtime document blocks network access and safely closes source blocks", () => {
    const document = buildPublicFormRuntimeDocument({
      html: "<main>Safe runtime</main>",
      css: "body::after { content: '</style>'; }",
      javascript: "document.body.dataset.value = '</script>';",
    });

    expect(publicFormRuntimeCsp).toContain("connect-src 'none'");
    expect(publicFormRuntimeCsp).toContain("navigate-to 'none'");
    expect(publicFormRuntimeCsp).toContain("default-src 'none'");
    expect(document).toContain("<\\/style");
    expect(document).toContain("<\\/script");
  });

  test("public resize messages enforce numeric height bounds", () => {
    expect(isResizeMessage({ type: "magictrust:resize", height: 200 })).toBe(
      true,
    );
    expect(isResizeMessage({ type: "magictrust:resize", height: 4000 })).toBe(
      true,
    );
    expect(isResizeMessage({ type: "magictrust:resize", height: 199 })).toBe(
      false,
    );
    expect(isResizeMessage({ type: "magictrust:resize", height: 4001 })).toBe(
      false,
    );
    expect(isResizeMessage({ type: "magictrust:resize", height: "640" })).toBe(
      false,
    );
  });
});
