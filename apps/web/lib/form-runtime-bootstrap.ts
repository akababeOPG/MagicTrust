export type FormRuntimeBootstrapConfig =
  | {
      mode: "published";
      slug: string;
      resizeMessageType: string;
    }
  | {
      mode: "preview";
    };

type RuntimeEnvironment = {
  window: Window;
  document: Document;
  FormData: typeof FormData;
  fetch: typeof fetch;
  crypto: Crypto;
  URL: typeof URL;
  setTimeout: typeof setTimeout;
};

export const formRuntimeFeedbackCss = `
.magictrust-submission-feedback {
  box-sizing: border-box;
  display: block;
  margin-block: 16px;
  padding: 12px;
  border: 1px solid currentColor;
  border-radius: 8px;
  font: inherit;
  line-height: 1.5;
  white-space: pre-line;
}
.magictrust-submission-feedback[hidden] {
  display: none;
}
`;

export function buildFormRuntimeBootstrap(config: FormRuntimeBootstrapConfig) {
  return `(${installMagicTrustFormRuntime.toString()})(${JSON.stringify(config)});`;
}

export function installMagicTrustFormRuntime(
  config: FormRuntimeBootstrapConfig,
  providedEnvironment?: RuntimeEnvironment,
) {
  const environment =
    providedEnvironment ??
    ({
      window,
      document,
      FormData,
      fetch,
      crypto,
      URL,
      setTimeout,
    } satisfies RuntimeEnvironment);
  const runtimeWindow = environment.window;
  const runtimeDocument = environment.document;
  const sendRequest = environment.fetch.bind(runtimeWindow);
  const schedule = environment.setTimeout.bind(runtimeWindow);
  const submissionEndpoint =
    config.mode === "published"
      ? new environment.URL(
          `/api/public/forms/${encodeURIComponent(config.slug)}/submissions`,
          runtimeWindow.location.href,
        ).toString()
      : null;
  const randomUuid =
    typeof environment.crypto.randomUUID === "function"
      ? environment.crypto.randomUUID.bind(environment.crypto)
      : null;
  const randomValues =
    typeof environment.crypto.getRandomValues === "function"
      ? environment.crypto.getRandomValues.bind(environment.crypto)
      : null;
  const submissionStates = new WeakMap<
    HTMLFormElement,
    {
      status: "idle" | "submitting" | "success" | "error";
      idempotencyKey: string | null;
      payload: string | null;
      feedback: HTMLElement | null;
      submitControls: Array<{
        control: HTMLButtonElement | HTMLInputElement;
        disabled: boolean;
      }>;
    }
  >();
  let lastHeight = 0;

  function stateFor(form: HTMLFormElement) {
    let state = submissionStates.get(form);
    if (!state) {
      state = {
        status: "idle",
        idempotencyKey: null,
        payload: null,
        feedback: null,
        submitControls: [],
      };
      submissionStates.set(form, state);
    }
    return state;
  }

  function serializeForm(form: HTMLFormElement) {
    const serialized: Record<string, string | string[]> = Object.create(null);
    const formData = new environment.FormData(form);

    for (const [name, value] of formData.entries()) {
      if (
        !name ||
        name === "requestType" ||
        name === "__proto__" ||
        name === "prototype" ||
        name === "constructor" ||
        typeof value !== "string"
      ) {
        continue;
      }

      if (!Object.prototype.hasOwnProperty.call(serialized, name)) {
        serialized[name] = value;
      } else {
        const current = serialized[name];
        serialized[name] = Array.isArray(current)
          ? [...current, value]
          : [current, value];
      }
    }

    return serialized;
  }

  function feedbackFor(
    form: HTMLFormElement,
    state: ReturnType<typeof stateFor>,
  ) {
    if (state.feedback) return state.feedback;
    const feedback = runtimeDocument.createElement("div");
    feedback.className = "magictrust-submission-feedback";
    feedback.tabIndex = -1;
    feedback.hidden = true;
    feedback.setAttribute("aria-atomic", "true");
    feedback.setAttribute("aria-live", "polite");
    feedback.setAttribute("role", "status");
    form.insertAdjacentElement("afterend", feedback);
    state.feedback = feedback;
    return feedback;
  }

  function showFeedback(
    form: HTMLFormElement,
    state: ReturnType<typeof stateFor>,
    status: "submitting" | "success" | "error",
    message: string,
  ) {
    const feedback = feedbackFor(form, state);
    feedback.hidden = false;
    feedback.dataset.state = status;
    feedback.setAttribute("role", status === "error" ? "alert" : "status");
    feedback.setAttribute(
      "aria-live",
      status === "error" ? "assertive" : "polite",
    );
    feedback.textContent = message;
    schedule(() => sendHeight(true), 0);
    if (status !== "submitting") {
      try {
        feedback.focus({ preventScroll: true });
      } catch {
        feedback.focus();
      }
    }
  }

  function setSubmitControlsDisabled(
    form: HTMLFormElement,
    state: ReturnType<typeof stateFor>,
    disabled: boolean,
  ) {
    if (disabled) {
      state.submitControls = Array.from(
        form.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
          'button[type="submit"], button:not([type]), input[type="submit"], input[type="image"]',
        ),
      ).map((control) => ({ control, disabled: control.disabled }));
      for (const item of state.submitControls) item.control.disabled = true;
      form.setAttribute("aria-busy", "true");
      return;
    }

    for (const item of state.submitControls) {
      item.control.disabled = item.disabled;
    }
    form.removeAttribute("aria-busy");
  }

  function generateIdempotencyKey() {
    if (randomUuid) {
      return randomUuid();
    }
    if (randomValues) {
      const bytes = randomValues(new Uint8Array(16));
      return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
        .join("")
        .replace(
          /^(........)(....)(....)(....)(............)$/,
          "$1-$2-$3-$4-$5",
        );
    }
    return `form-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function safeValidationMessage(responseBody: unknown) {
    if (!responseBody || typeof responseBody !== "object") return null;
    const error = (responseBody as { error?: unknown }).error;
    if (!error || typeof error !== "object") return null;
    const code = (error as { code?: unknown }).code;
    const message = (error as { message?: unknown }).message;
    return code === "VALIDATION_ERROR" &&
      typeof message === "string" &&
      message.length > 0 &&
      message.length <= 200 &&
      !/[\u0000-\u001f\u007f]/.test(message)
      ? message
      : null;
  }

  async function submitForm(form: HTMLFormElement) {
    const state = stateFor(form);
    if (state.status === "submitting" || state.status === "success") return;

    if (config.mode === "preview") {
      state.status = "success";
      showFeedback(
        form,
        state,
        "success",
        "Preview mode: submission was not sent.",
      );
      return;
    }

    const payload = JSON.stringify({ data: serializeForm(form) });
    const isRetry = state.status === "error" && state.payload === payload;
    if (!isRetry || !state.idempotencyKey) {
      state.idempotencyKey = generateIdempotencyKey();
    }
    state.payload = payload;
    state.status = "submitting";
    setSubmitControlsDisabled(form, state, true);
    showFeedback(form, state, "submitting", "Submitting your request…");

    try {
      const response = await sendRequest(submissionEndpoint!, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": state.idempotencyKey,
        },
        body: payload,
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
      const responseBody = (await response.json().catch(() => null)) as {
        publicId?: unknown;
      } | null;
      if (
        !response.ok ||
        typeof responseBody?.publicId !== "string" ||
        !/^req_[A-Za-z0-9_-]+$/.test(responseBody.publicId)
      ) {
        const publicMessage =
          response.status === 400 ? safeValidationMessage(responseBody) : null;
        throw { publicMessage };
      }

      state.status = "success";
      form.hidden = true;
      form.setAttribute("aria-hidden", "true");
      showFeedback(
        form,
        state,
        "success",
        `Your request has been submitted.\nReference: ${responseBody.publicId}\nCheck your email for any next steps related to your request.`,
      );
    } catch (error) {
      state.status = "error";
      setSubmitControlsDisabled(form, state, false);
      const publicMessage =
        error &&
        typeof error === "object" &&
        "publicMessage" in error &&
        typeof error.publicMessage === "string"
          ? error.publicMessage
          : "We couldn't submit your request. Please try again.";
      showFeedback(form, state, "error", publicMessage);
    }
  }

  function sendHeight(force = false) {
    if (config.mode !== "published") return;
    const body = runtimeDocument.body;
    const root = runtimeDocument.documentElement;
    const measured = Math.ceil(
      Math.max(
        body ? body.scrollHeight : 0,
        body ? body.offsetHeight : 0,
        root ? root.scrollHeight : 0,
        root ? root.offsetHeight : 0,
      ),
    );
    const height = Math.min(4000, Math.max(200, measured));
    if (!force && height === lastHeight) return;
    lastHeight = height;
    runtimeWindow.parent.postMessage(
      { type: config.resizeMessageType, height },
      "*",
    );
  }

  runtimeWindow.addEventListener(
    "submit",
    (event) => {
      event.preventDefault();
      const form = event.target;
      if (!form || (form as HTMLElement).tagName !== "FORM") return;
      void submitForm(form as HTMLFormElement);
    },
    true,
  );

  runtimeWindow.addEventListener("error", () => {
    const notice = runtimeDocument.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "This form could not finish loading.";
    (runtimeDocument.body || runtimeDocument.documentElement).appendChild(
      notice,
    );
    schedule(() => sendHeight(true), 0);
  });
  runtimeWindow.addEventListener("unhandledrejection", () => {
    const notice = runtimeDocument.createElement("p");
    notice.setAttribute("role", "alert");
    notice.textContent = "This form could not finish loading.";
    (runtimeDocument.body || runtimeDocument.documentElement).appendChild(
      notice,
    );
    schedule(() => sendHeight(true), 0);
  });

  if (runtimeDocument.readyState === "loading") {
    runtimeDocument.addEventListener("DOMContentLoaded", () => sendHeight(), {
      once: true,
    });
  } else {
    schedule(() => sendHeight(), 0);
  }
  runtimeWindow.addEventListener("load", () => sendHeight(), { once: true });
  const RuntimeResizeObserver = (
    runtimeWindow as Window & { ResizeObserver?: typeof ResizeObserver }
  ).ResizeObserver;
  if (typeof RuntimeResizeObserver === "function") {
    const resizeObserver = new RuntimeResizeObserver(() => sendHeight());
    resizeObserver.observe(runtimeDocument.documentElement);
  } else {
    schedule(() => sendHeight(), 250);
  }
}
