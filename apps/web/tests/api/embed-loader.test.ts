import { beforeEach, describe, expect, test, vi } from "vitest";

import nextConfig from "../../next.config";
import { embedLoaderSource } from "../../lib/embed-loader";

describe("MagicTrust embed loader", () => {
  beforeEach(() => vi.restoreAllMocks());

  test("/embed.js is public JavaScript with no authentication dependency", async () => {
    const { GET } = await import("../../app/embed.js/route");
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/javascript; charset=utf-8",
    );
    expect(await response.text()).toBe(embedLoaderSource);
    expect(embedLoaderSource).not.toContain("x-api-key");
  });

  test("initializes multiple targets from the embed script origin exactly once", () => {
    const environment = createEmbedEnvironment([
      "privacy-request",
      "contact-us",
    ]);

    executeLoader(environment);
    executeLoader(environment);

    expect(environment.targets[0]?.frames).toHaveLength(1);
    expect(environment.targets[1]?.frames).toHaveLength(1);
    expect(environment.targets[0]?.frames[0]).toMatchObject({
      src: "https://forms.magictrust.test/forms/privacy-request",
      loading: "lazy",
      referrerPolicy: "no-referrer",
      style: {
        width: "100%",
        height: "500px",
        minHeight: "500px",
        border: "0",
        display: "block",
      },
    });
    expect(environment.targets[1]?.frames[0]?.src).toBe(
      "https://forms.magictrust.test/forms/contact-us",
    );
    expect(
      environment.targets[0]?.getAttribute("data-magictrust-initialized"),
    ).toBe("true");
    expect(environment.windowListeners.message).toHaveLength(1);
    expect(environment.targets[0]?.frames[0]?.attributes.has("sandbox")).toBe(
      false,
    );
    expect(embedLoaderSource).not.toContain("allow-same-origin");
  });

  test("empty and invalid slugs fail safely without creating iframes", () => {
    const environment = createEmbedEnvironment([
      "",
      "Not Valid",
      "a".repeat(121),
    ]);

    expect(() => executeLoader(environment)).not.toThrow();
    expect(
      environment.targets.every((target) => target.frames.length === 0),
    ).toBe(true);
  });

  test("resize validates origin, source, payload, and height bounds", () => {
    const environment = createEmbedEnvironment([
      "privacy-request",
      "contact-us",
    ]);
    executeLoader(environment);
    const firstFrame = environment.targets[0]!.frames[0]!;
    const secondFrame = environment.targets[1]!.frames[0]!;
    const receiveMessage = environment.windowListeners.message[0]!;
    const validData = {
      type: "magictrust:resize",
      slug: "privacy-request",
      height: 640.2,
    };

    receiveMessage({
      origin: "https://wrong.test",
      source: firstFrame.contentWindow,
      data: validData,
    });
    receiveMessage({
      origin: "https://forms.magictrust.test",
      source: secondFrame.contentWindow,
      data: validData,
    });
    receiveMessage({
      origin: "https://forms.magictrust.test",
      source: firstFrame.contentWindow,
      data: { ...validData, height: "640" },
    });
    receiveMessage({
      origin: "https://forms.magictrust.test",
      source: firstFrame.contentWindow,
      data: { ...validData, height: 199 },
    });
    receiveMessage({
      origin: "https://forms.magictrust.test",
      source: firstFrame.contentWindow,
      data: { ...validData, height: 4001 },
    });
    expect(firstFrame.style.height).toBe("500px");
    expect(secondFrame.style.height).toBe("500px");

    receiveMessage({
      origin: "https://forms.magictrust.test",
      source: firstFrame.contentWindow,
      data: validData,
    });
    expect(firstFrame.style.height).toBe("641px");
    expect(secondFrame.style.height).toBe("500px");
  });

  test("framing is opened only for public forms and denied for admin routes", async () => {
    const headers = await nextConfig.headers?.();
    const admin = headers?.find((entry) => entry.source === "/admin/:path*");
    const publicForm = headers?.find(
      (entry) => entry.source === "/forms/:slug",
    );

    expect(admin?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
    expect(publicForm?.headers).toContainEqual({
      key: "Content-Security-Policy",
      value: "frame-ancestors *",
    });
  });
});

type MessageEventInput = {
  origin: string;
  source: object;
  data: unknown;
};

type MessageListener = (event: MessageEventInput) => void;

type FakeFrame = {
  src: string;
  title: string;
  loading: string;
  referrerPolicy: string;
  style: Record<string, string>;
  attributes: Map<string, string>;
  contentWindow: object;
  setAttribute(name: string, value: string): void;
};

type FakeTarget = {
  frames: FakeFrame[];
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  appendChild(frame: FakeFrame): void;
  querySelector(selector: string): FakeFrame | null;
};

function createEmbedEnvironment(slugs: string[]) {
  const windowListeners: { message: MessageListener[] } = { message: [] };
  const targets = slugs.map(createTarget);
  const rootAttributes = new Map<string, string>();
  const document = {
    baseURI: "https://customer.test/privacy",
    currentScript: { src: "https://forms.magictrust.test/embed.js" },
    readyState: "complete",
    documentElement: {
      getAttribute(name: string) {
        return rootAttributes.get(name) ?? null;
      },
      setAttribute(name: string, value: string) {
        rootAttributes.set(name, value);
      },
    },
    querySelectorAll() {
      return targets;
    },
    getElementsByTagName() {
      return [this.currentScript];
    },
    createElement() {
      return createFrame();
    },
    addEventListener() {},
  };
  const window = {
    addEventListener(type: string, listener: MessageListener) {
      if (type === "message") windowListeners.message.push(listener);
    },
  };
  return { document, targets, window, windowListeners };
}

function createTarget(slug: string): FakeTarget {
  const attributes = new Map<string, string>([["data-magictrust-form", slug]]);
  const frames: FakeFrame[] = [];
  return {
    frames,
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    appendChild(frame) {
      frames.push(frame);
    },
    querySelector(selector) {
      return selector === "iframe[data-magictrust-embed-frame]"
        ? (frames[0] ?? null)
        : null;
    },
  };
}

function createFrame(): FakeFrame {
  const attributes = new Map<string, string>();
  return {
    src: "",
    title: "",
    loading: "",
    referrerPolicy: "",
    style: {},
    attributes,
    contentWindow: {},
    setAttribute(name, value) {
      attributes.set(name, value);
    },
  };
}

function executeLoader(environment: ReturnType<typeof createEmbedEnvironment>) {
  const run = new Function("window", "document", embedLoaderSource);
  run(environment.window, environment.document);
}
