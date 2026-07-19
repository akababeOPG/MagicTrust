import { describe, expect, test, vi } from "vitest";

import {
  buildFormRuntimeBootstrap,
  installMagicTrustFormRuntime,
} from "../../lib/form-runtime-bootstrap";

describe("form runtime submission", () => {
  test("intercepts native submit and serializes successful controls", async () => {
    const deferred = deferredResponse();
    const harness = createRuntimeHarness({
      fetch: vi.fn(() => deferred.promise),
      controls: [
        control("firstName", "John"),
        control("email", "john@example.com", "email"),
        control("phone", "+13055551234", "tel"),
        control("quantity", "2", "number"),
        control("requestedAt", "2026-07-18", "date"),
        control("message", "Please help", "textarea"),
        control("region", "US", "select"),
        control("topics", "privacy", "checkbox", { checked: true }),
        control("topics", "marketing", "checkbox", { checked: true }),
        control("topics", "ignored", "checkbox", { checked: false }),
        control("contact", "email", "radio", { checked: true }),
        control("contact", "phone", "radio", { checked: false }),
        control("disabled", "ignored", "text", { disabled: true }),
        control("", "ignored"),
        control("requestType", "DATA_DELETION", "hidden"),
        control("source", "runtime", "hidden"),
        control("submit", "Send", "submit"),
      ],
    });

    const event = harness.submit();
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.form.submitControl.disabled).toBe(true);
    expect(harness.form.getAttribute("aria-busy")).toBe("true");
    expect(harness.feedback()?.textContent).toBe("Submitting your request…");

    const [endpoint, init] = harness.fetch.mock.calls[0]!;
    expect(endpoint).toBe(
      "https://magictrust.test/api/public/forms/contact-us/submissions",
    );
    expect(endpoint).not.toContain("embedding.example");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "Idempotency-Key": "runtime-idempotency-key",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      requestType: "DATA_DELETION",
      data: {
        firstName: "John",
        email: "john@example.com",
        phone: "+13055551234",
        quantity: "2",
        requestedAt: "2026-07-18",
        message: "Please help",
        region: "US",
        topics: ["privacy", "marketing"],
        contact: "email",
        source: "runtime",
      },
    });

    deferred.resolve(Response.json({ publicId: "req_runtime_test" }));
    await flushRuntime();

    expect(harness.form.hidden).toBe(true);
    expect(harness.feedback()?.textContent).toContain(
      "Your request has been submitted.",
    );
    expect(harness.feedback()?.textContent).toContain(
      "Reference: req_runtime_test",
    );
    expect(harness.feedback()?.getAttribute("aria-live")).toBe("polite");
    expect(harness.feedback()?.focused).toBe(true);

    harness.submit();
    expect(harness.fetch).toHaveBeenCalledOnce();
  });

  test("error preserves values, re-enables submit, and reuses the retry key", async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network unavailable"))
      .mockResolvedValueOnce(Response.json({ publicId: "req_retry_test" }));
    const harness = createRuntimeHarness({
      fetch,
      controls: [
        control("email", "john@example.com", "email"),
        control("message", "Keep this value", "textarea"),
        control("submit", "Send", "submit"),
      ],
    });

    harness.submit();
    await flushRuntime();

    expect(harness.form.hidden).toBe(false);
    expect(harness.form.submitControl.disabled).toBe(false);
    expect(harness.form.controls[1]?.value).toBe("Keep this value");
    expect(harness.feedback()?.textContent).toBe(
      "We couldn't submit your request. Please try again.",
    );
    expect(harness.feedback()?.getAttribute("role")).toBe("alert");

    harness.submit();
    await flushRuntime();

    expect(fetch).toHaveBeenCalledTimes(2);
    const firstHeaders = fetch.mock.calls[0]?.[1]?.headers;
    const retryHeaders = fetch.mock.calls[1]?.[1]?.headers;
    expect(retryHeaders).toEqual(firstHeaders);
    expect(harness.feedback()?.textContent).toContain("req_retry_test");
  });

  test("binds receiver-sensitive browser APIs before sending the submission", async () => {
    const harness = createRuntimeHarness({
      receiverSensitiveApis: true,
      fetch: vi.fn(() =>
        Promise.resolve(Response.json({ publicId: "req_receiver_test" })),
      ),
      controls: [
        control("email", "john@example.com", "email"),
        control("submit", "Send", "submit"),
      ],
    });

    harness.submit();
    await flushRuntime();

    expect(harness.fetch).toHaveBeenCalledOnce();
    expect(harness.fetch.mock.calls[0]?.[0]).toBe(
      "https://magictrust.test/api/public/forms/contact-us/submissions",
    );
    expect(harness.feedback()?.textContent).toContain("req_receiver_test");
  });

  test("safe validation messages are shown and resize emits after errors", async () => {
    const harness = createRuntimeHarness({
      fetch: vi.fn(() =>
        Promise.resolve(
          Response.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "A valid email address is required.",
              },
            },
            { status: 400 },
          ),
        ),
      ),
      controls: [
        control("email", "invalid", "email"),
        control("submit", "Send", "submit"),
      ],
    });
    const resizeCount = harness.postMessage.mock.calls.length;

    harness.submit();
    await flushRuntime();

    expect(harness.feedback()?.textContent).toBe(
      "A valid email address is required.",
    );
    expect(harness.postMessage.mock.calls.length).toBeGreaterThan(resizeCount);
    expect(harness.postMessage).toHaveBeenLastCalledWith(
      { type: "magictrust:runtime-resize", height: 320 },
      "*",
    );
  });

  test("preview mode intercepts submission without making a request", async () => {
    const harness = createRuntimeHarness({
      mode: "preview",
      controls: [
        control("email", "john@example.com", "email"),
        control("submit", "Send", "submit"),
      ],
    });

    const event = harness.submit();
    await flushRuntime();

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(harness.fetch).not.toHaveBeenCalled();
    expect(harness.form.hidden).toBe(false);
    expect(harness.form.controls[0]?.value).toBe("john@example.com");
    expect(harness.feedback()?.textContent).toBe(
      "Preview mode: submission was not sent.",
    );
  });

  test("generated bootstrap is self-contained and contains no credentials", () => {
    const bootstrap = buildFormRuntimeBootstrap({
      mode: "published",
      slug: "contact-us",
      resizeMessageType: "magictrust:runtime-resize",
    });

    expect(() => new Function(bootstrap)).not.toThrow();
    expect(bootstrap).toContain("contact-us");
    expect(bootstrap).not.toContain("x-api-key");
    expect(bootstrap).not.toContain("INTERNAL_API_KEY");
    expect(bootstrap).not.toContain("admin_session");
  });
});

type FakeControl = {
  name: string;
  value: string;
  type: string;
  disabled: boolean;
  checked: boolean;
};

function control(
  name: string,
  value: string,
  type = "text",
  input: Partial<Pick<FakeControl, "disabled" | "checked">> = {},
): FakeControl {
  return {
    name,
    value,
    type,
    disabled: input.disabled ?? false,
    checked: input.checked ?? true,
  };
}

class FakeElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string> = {};
  readonly children: FakeElement[] = [];
  className = "";
  hidden = false;
  tabIndex = 0;
  textContent = "";
  focused = false;
  scrollHeight = 320;
  offsetHeight = 320;

  constructor(tagName: string) {
    this.tagName = tagName.toUpperCase();
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  appendChild(child: FakeElement) {
    this.children.push(child);
    return child;
  }

  focus() {
    this.focused = true;
  }
}

class FakeForm extends FakeElement {
  readonly controls: FakeControl[];
  readonly submitControl: FakeControl;
  feedback: FakeElement | null = null;

  constructor(controls: FakeControl[]) {
    super("form");
    this.controls = controls;
    this.submitControl =
      controls.find((item) => item.type === "submit") ??
      control("submit", "Send", "submit");
  }

  insertAdjacentElement(_position: string, element: FakeElement) {
    this.feedback = element;
    return element;
  }

  querySelectorAll() {
    return this.controls.filter(
      (item) => item.type === "submit" || item.type === "image",
    );
  }
}

class FakeFormData {
  readonly values: Array<[string, string]>;

  constructor(form: FakeForm) {
    this.values = form.controls
      .filter((item) => item.name && !item.disabled)
      .filter(
        (item) => !["checkbox", "radio"].includes(item.type) || item.checked,
      )
      .filter((item) => !["submit", "image"].includes(item.type))
      .map((item) => [item.name, item.value]);
  }

  entries() {
    return this.values[Symbol.iterator]();
  }
}

function createRuntimeHarness(input: {
  mode?: "published" | "preview";
  fetch?: ReturnType<typeof vi.fn>;
  receiverSensitiveApis?: boolean;
  controls: FakeControl[];
}) {
  const listeners = new Map<string, Array<(event: never) => void>>();
  const postMessage = vi.fn();
  const runtimeWindow = {
    location: {
      href: "https://magictrust.test/forms/contact-us/runtime",
    },
    parent: { postMessage },
    ResizeObserver: input.receiverSensitiveApis
      ? class {
          observe() {}
        }
      : undefined,
    addEventListener(type: string, listener: (event: never) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
  };
  const body = new FakeElement("body");
  const documentElement = new FakeElement("html");
  const runtimeDocument = {
    readyState: input.receiverSensitiveApis ? "loading" : "complete",
    body,
    documentElement,
    createElement(tagName: string) {
      return new FakeElement(tagName);
    },
    addEventListener: vi.fn(),
  };
  const form = new FakeForm(input.controls);
  const providedFetch = input.fetch ?? vi.fn();
  const fetch = input.receiverSensitiveApis
    ? vi.fn(function (
        this: unknown,
        request: RequestInfo | URL,
        init?: RequestInit,
      ) {
        if (this !== runtimeWindow) throw new TypeError("Illegal invocation");
        return providedFetch(request, init);
      })
    : providedFetch;
  const runtimeCrypto = {
    randomUUID(this: unknown) {
      if (input.receiverSensitiveApis && this !== runtimeCrypto) {
        throw new TypeError("Illegal invocation");
      }
      return "runtime-idempotency-key";
    },
  };
  function immediateTimeout(this: unknown, callback: () => void) {
    if (input.receiverSensitiveApis && this !== runtimeWindow) {
      throw new TypeError("Illegal invocation");
    }
    callback();
    return 1;
  }

  installMagicTrustFormRuntime(
    input.mode === "preview"
      ? { mode: "preview" }
      : {
          mode: "published",
          slug: "contact-us",
          resizeMessageType: "magictrust:runtime-resize",
        },
    {
      window: runtimeWindow,
      document: runtimeDocument,
      FormData: FakeFormData,
      fetch,
      crypto: runtimeCrypto,
      URL,
      setTimeout: immediateTimeout,
    } as never,
  );

  return {
    fetch,
    form,
    postMessage,
    feedback: () => form.feedback,
    submit() {
      const event = {
        target: form,
        preventDefault: vi.fn(),
      };
      for (const listener of listeners.get("submit") ?? []) {
        listener(event as never);
      }
      return event;
    },
  };
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushRuntime() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
