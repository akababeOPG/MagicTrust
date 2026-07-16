import { randomUUID } from "node:crypto";

import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  PrivacyRequest,
  RequestCreationStore,
  RequestEvent,
  Requester,
} from "@magictrust/domain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import PrivacyRequestFormPage from "../../app/forms/privacy-request/page";
import { submitPrivacyRequestForm } from "../../lib/privacy-request-form-submit";
import { createPublicRequestApi } from "../../lib/public-request-api";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-public-intake";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public request API", () => {
  test("validates required fields", async () => {
    const api = createPublicRequestApi({
      requestCreationStore: createInMemoryStore(),
    });

    const response = await api.create(
      publicRequest({
        email: "",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("creates a request without requiring an API key", async () => {
    const api = createPublicRequestApi({
      requestCreationStore: createInMemoryStore(),
    });

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request).toMatchObject({
      publicId: expect.stringMatching(/^req_/),
      type: "DATA_ACCESS",
      status: "SUBMITTED",
      createdAt: expect.any(String),
    });
  });

  test("does not expose internal fields", async () => {
    const api = createPublicRequestApi({
      requestCreationStore: createInMemoryStore(),
    });

    const response = await api.create(publicRequest());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(serialized).not.toContain("id");
    expect(serialized).not.toContain("requesterId");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("events");
    expect(serialized).not.toContain("comments");
    expect(serialized).not.toContain("attachments");
    expect(serialized).not.toContain("communications");
  });

  test("rejects honeypot submissions", async () => {
    const api = createPublicRequestApi({
      requestCreationStore: createInMemoryStore(),
    });

    const response = await api.create(
      publicRequest({
        website: "filled-by-bot",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });
});

describe("hosted privacy request form", () => {
  test("renders the public intake form", () => {
    const html = renderToStaticMarkup(createElement(PrivacyRequestFormPage));

    expect(html).toContain("Privacy Request");
    expect(html).toContain('name="type"');
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="lastName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="message"');
    expect(html).toContain('name="website"');
  });

  test("submits successfully and resets the captured form", async () => {
    const resetForm = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          request: {
            publicId: "req_public_test",
            type: "DATA_ACCESS",
            status: "SUBMITTED",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
        {
          status: 201,
        },
      ),
    );

    const result = await submitPrivacyRequestForm(
      validFormData(),
      "https://magictrust.test/forms/privacy-request",
      resetForm,
    );

    expect(result).toEqual({
      ok: true,
      publicId: "req_public_test",
      requestStatus: "SUBMITTED",
    });
    expect(resetForm).toHaveBeenCalledOnce();
  });

  test("does not reset the form when submission fails", async () => {
    const resetForm = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request payload is invalid.",
          },
        },
        {
          status: 400,
        },
      ),
    );

    const result = await submitPrivacyRequestForm(
      validFormData(),
      "https://magictrust.test/forms/privacy-request",
      resetForm,
    );

    expect(result).toEqual({
      ok: false,
      message: "Request payload is invalid.",
    });
    expect(resetForm).not.toHaveBeenCalled();
  });
});

function validFormData() {
  const formData = new FormData();
  formData.set("type", "DATA_ACCESS");
  formData.set("firstName", "John");
  formData.set("lastName", "Doe");
  formData.set("email", "john@example.com");
  formData.set("phone", "+13055551234");
  formData.set("message", "I want to access my data.");
  formData.set("website", "");

  return formData;
}

function publicRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://magictrust.test/api/public/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "DATA_ACCESS",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+13055551234",
      message: "I want to access my data.",
      sourceUrl: "https://example.com/forms/privacy-request",
      website: "",
      ...overrides,
    }),
  });
}

function createInMemoryStore(): RequestCreationStore {
  return {
    async transaction(callback) {
      return callback({
        async createRequester(data: CreateRequesterRecord): Promise<Requester> {
          expect(data.emailEncrypted).toEqual(expect.any(String));
          expect(data.emailHash).toEqual(expect.any(String));

          return {
            id: randomUUID(),
            externalId: data.externalId,
          };
        },
        async createPrivacyRequest(
          data: CreatePrivacyRequestRecord,
        ): Promise<PrivacyRequest> {
          return {
            id: randomUUID(),
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            updatedAt: new Date(Date.UTC(2026, 0, 1)),
            completedAt: null,
            ...data,
          };
        },
        async createRequestEvent(
          data: CreateRequestEventRecord,
        ): Promise<RequestEvent> {
          return {
            id: randomUUID(),
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            ...data,
          };
        },
      });
    },
  };
}
