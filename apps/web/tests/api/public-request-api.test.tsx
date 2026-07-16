import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  PrivacyRequest,
  RequestAttachment,
  RequestComment,
  RequestCommunication,
  RequestCreationStore,
  RequestEvent,
  Requester,
} from "@magictrust/domain";
import type {
  RequestDetails,
  RequestListFilters,
  RequestRepository,
  RequestSummary,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
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
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

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
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

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
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

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
    expect(serialized).not.toContain("providerMessageId");
  });

  test("rejects honeypot submissions", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(
      publicRequest({
        website: "filled-by-bot",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("sends a receipt email after public request creation", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();
    const request = dependencies.state.requests[0];

    expect(response.status).toBe(201);
    expect(dependencies.state.sentEmails).toEqual([
      expect.objectContaining({
        to: "john@example.com",
        subject: `MagicTrust request received: ${body.request.publicId}`,
        body: expect.stringContaining(
          `Reference number: ${body.request.publicId}`,
        ),
      }),
    ]);
    expect(dependencies.state.communications).toEqual([
      expect.objectContaining({
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        provider: "resend",
        status: "SENT",
        actorType: "SYSTEM",
        actorId: "public-intake",
      }),
    ]);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: request.id,
          type: "EMAIL_SENT",
          actorType: "SYSTEM",
          actorId: "public-intake",
        }),
      ]),
    );
  });

  test("keeps public response contract when receipt email is sent", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      request: {
        publicId: expect.stringMatching(/^req_/),
        type: "DATA_ACCESS",
        status: "SUBMITTED",
        createdAt: expect.any(String),
      },
    });
  });

  test("failed receipt email still creates the request", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request).toMatchObject({
      publicId: expect.stringMatching(/^req_/),
      status: "SUBMITTED",
    });
    expect(dependencies.state.requests).toHaveLength(1);
  });

  test("failed receipt email records communication failure and event", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const request = dependencies.state.requests[0];

    expect(response.status).toBe(201);
    expect(dependencies.state.communications).toEqual([
      expect.objectContaining({
        requestId: request.id,
        provider: "resend",
        status: "FAILED",
        errorMessage: "Email provider failed to send the message.",
        actorType: "SYSTEM",
        actorId: "public-intake",
      }),
    ]);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: request.id,
          type: "EMAIL_FAILED",
          actorType: "SYSTEM",
          actorId: "public-intake",
        }),
      ]),
    );
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

type InMemoryState = {
  nextId: number;
  requesters: Requester[];
  requests: PrivacyRequest[];
  events: RequestEvent[];
  comments: RequestComment[];
  attachments: RequestAttachment[];
  communications: RequestCommunication[];
  sentEmails: Array<{ to: string; subject: string; body: string }>;
};

function createInMemoryDependencies(
  options: {
    emailShouldFail?: boolean;
  } = {},
) {
  const state: InMemoryState = {
    nextId: 1,
    requesters: [],
    requests: [],
    events: [],
    comments: [],
    attachments: [],
    communications: [],
    sentEmails: [],
  };

  const requestCreationStore: RequestCreationStore = {
    async transaction(callback) {
      return callback({
        async createRequester(data: CreateRequesterRecord): Promise<Requester> {
          expect(data.emailEncrypted).toEqual(expect.any(String));
          expect(data.emailHash).toEqual(expect.any(String));

          const requester = {
            id: `requester-${state.nextId++}`,
            externalId: data.externalId,
          };
          state.requesters.push(requester);

          return requester;
        },
        async createPrivacyRequest(
          data: CreatePrivacyRequestRecord,
        ): Promise<PrivacyRequest> {
          const request = {
            id: `request-${state.nextId++}`,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            updatedAt: new Date(Date.UTC(2026, 0, 1)),
            completedAt: null,
            ...data,
          };
          state.requests.push(request);

          return request;
        },
        async createRequestEvent(
          data: CreateRequestEventRecord,
        ): Promise<RequestEvent> {
          const event = {
            id: `event-${state.nextId++}`,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            ...data,
          };
          state.events.push(event);

          return event;
        },
      });
    },
  };

  const requestRepository: RequestRepository = {
    async findByIdOrPublicId(id): Promise<RequestDetails | null> {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      return {
        ...summaryFromRequest(request),
        events: state.events
          .filter((event) => event.privacyRequestId === request.id)
          .map((event) => ({
            id: event.id,
            privacyRequestId: event.privacyRequestId,
            type: event.type,
            actorType: event.actorType,
            actorId: event.actorId,
            data: event.data,
            createdAt: event.createdAt,
          })),
        comments: state.comments.filter(
          (comment) => comment.requestId === request.id,
        ),
        attachments: state.attachments.filter(
          (attachment) => attachment.requestId === request.id,
        ),
        communications: state.communications.filter(
          (communication) => communication.requestId === request.id,
        ),
      };
    },
    async list(filters: RequestListFilters): Promise<RequestSummary[]> {
      return state.requests
        .filter((request) =>
          filters.status ? request.status === filters.status : true,
        )
        .filter((request) =>
          filters.type ? request.type === filters.type : true,
        )
        .slice(0, filters.limit)
        .map(summaryFromRequest);
    },
    async updateStatus() {
      throw new Error("Not implemented in public intake tests.");
    },
    async addComment() {
      throw new Error("Not implemented in public intake tests.");
    },
    async addAttachment() {
      throw new Error("Not implemented in public intake tests.");
    },
    async recordAttachmentDownloaded() {
      throw new Error("Not implemented in public intake tests.");
    },
    async createCommunication(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const communication: RequestCommunication = {
        id: `communication-${state.nextId++}`,
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING",
        errorMessage: null,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        sentAt: null,
      };
      state.communications.push(communication);

      return communication;
    },
    async markCommunicationSent(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.requestId === requestId && item.id === communicationId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "SENT";
      communication.providerMessageId = input.providerMessageId;
      communication.errorMessage = null;
      communication.sentAt = new Date(Date.UTC(2026, 0, 1));
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_SENT",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId,
          provider: communication.provider,
          providerMessageId: input.providerMessageId,
          status: "SENT",
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return communication;
    },
    async markCommunicationFailed(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.requestId === requestId && item.id === communicationId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "FAILED";
      communication.errorMessage = input.errorMessage;
      communication.sentAt = null;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_FAILED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId,
          provider: communication.provider,
          status: "FAILED",
          errorMessage: input.errorMessage,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return communication;
    },
  };

  const emailProvider: EmailProvider = {
    provider: "resend",
    async sendEmail(input) {
      if (options.emailShouldFail) {
        throw new Error("Email provider failed to send the message.");
      }

      state.sentEmails.push(input);

      return {
        provider: "resend",
        providerMessageId: "receipt-message-1",
      };
    },
  };

  return {
    state,
    requestCreationStore,
    requestRepository,
    emailProvider,
  };
}

function summaryFromRequest(request: PrivacyRequest): RequestSummary {
  return {
    id: request.id,
    publicId: request.publicId,
    requesterId: request.requesterId,
    type: request.type,
    status: request.status,
    completedAt: request.completedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
