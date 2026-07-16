import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  PrivacyRequest,
  RequestComment,
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
import { describe, expect, test } from "vitest";

import { createInternalRequestApi } from "../../lib/internal-request-api";

const apiKey = "test-internal-api-key";

describe("internal request API", () => {
  test("returns 401 when API key is missing or invalid", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const missing = await api.list(
      new Request("https://magictrust.test/api/v1/requests"),
    );
    const invalid = await api.list(
      new Request("https://magictrust.test/api/v1/requests", {
        headers: {
          "x-api-key": "wrong",
        },
      }),
    );

    expect(missing.status).toBe(401);
    expect(invalid.status).toBe(401);
  });

  test("creates a request via API", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    const response = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request).toMatchObject({
      publicId: expect.stringMatching(/^req_/),
      type: "DATA_ACCESS",
      status: "SUBMITTED",
    });
    expect(body.request.id).toEqual(expect.any(String));
    expect(body.request.requesterId).toEqual(expect.any(String));
    expect(body.request.createdAt).toEqual(expect.any(String));
  });

  test("returns normalized JSON when transactional creation fails", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi({
      ...dependencies,
      requestCreationStore: {
        async transaction() {
          throw new Error("No transactions support in neon-http driver");
        },
      },
    });

    const response = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "Request could not be processed.",
      },
    });
  });

  test("fetches a request with events", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const createResponse = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const created = await createResponse.json();

    const response = await api.get(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.request.publicId}`,
      ),
      created.request.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request).toMatchObject({
      id: created.request.id,
      publicId: created.request.publicId,
      events: [
        {
          type: "REQUEST_CREATED",
          actorType: "API_CLIENT",
        },
      ],
    });
  });

  test("lists requests newest first with filters", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody({ type: "DATA_ACCESS" })),
      }),
    );
    await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(
          validCreateRequestBody({ type: "GENERAL_INQUIRY" }),
        ),
      }),
    );

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?type=GENERAL_INQUIRY&limit=10",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].type).toBe("GENERAL_INQUIRY");
  });

  test("returns 401 for unauthorized status update", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.updateStatus(
      new Request("https://magictrust.test/api/v1/requests/req_test/status", {
        method: "POST",
        body: JSON.stringify(validStatusUpdateBody()),
      }),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("updates request status and creates a STATUS_CHANGED event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.updateStatus(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/status`,
        {
          method: "POST",
          body: JSON.stringify(validStatusUpdateBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(200);
    expect(body.request.status).toBe("PROCESSING");
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "STATUS_CHANGED",
          data: expect.objectContaining({
            previousStatus: "SUBMITTED",
            newStatus: "PROCESSING",
            reason: "Request picked up for processing",
          }),
        }),
      ]),
    );
  });

  test("sets completedAt for terminal statuses", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.updateStatus(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/status`,
        {
          method: "POST",
          body: JSON.stringify(validStatusUpdateBody({ status: "SUCCESS" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request.completedAt).toEqual(expect.any(String));
  });

  test("creates a public comment and event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addComment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/comments`,
        {
          method: "POST",
          body: JSON.stringify(validCommentBody({ visibility: "PUBLIC" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.comment).toMatchObject({
      visibility: "PUBLIC",
      body: "Your request is being processed.",
      actorType: "API_CLIENT",
    });
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PUBLIC_COMMENT_ADDED",
          data: expect.objectContaining({
            commentId: body.comment.id,
            visibility: "PUBLIC",
          }),
        }),
      ]),
    );
  });

  test("creates an internal comment and event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addComment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/comments`,
        {
          method: "POST",
          body: JSON.stringify(validCommentBody({ visibility: "INTERNAL" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.comment.visibility).toBe("INTERNAL");
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "INTERNAL_COMMENT_ADDED",
        }),
      ]),
    );
  });

  test("GET detail includes comments with visibility", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.addComment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/comments`,
        {
          method: "POST",
          body: JSON.stringify(validCommentBody({ visibility: "PUBLIC" })),
        },
      ),
      created.publicId,
    );

    const detail = await getRequestDetail(api, created.publicId);

    expect(detail.comments).toEqual([
      expect.objectContaining({
        visibility: "PUBLIC",
        body: "Your request is being processed.",
      }),
    ]);
  });
});

function authenticatedRequest(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", apiKey);
  headers.set("content-type", "application/json");

  return new Request(input, {
    ...init,
    headers,
  });
}

function validCreateRequestBody(overrides: { type?: string } = {}) {
  return {
    type: overrides.type ?? "DATA_ACCESS",
    requester: {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+13055551234",
    },
    source: {
      channel: "API",
      siteKey: "test-site",
      formKey: "manual-api",
      sourceUrl: "https://example.com/privacy",
    },
    submittedData: {
      message: "I want to access my data",
    },
  };
}

function validStatusUpdateBody(overrides: { status?: string } = {}) {
  return {
    status: overrides.status ?? "PROCESSING",
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
    reason: "Request picked up for processing",
  };
}

function validCommentBody(overrides: { visibility?: string } = {}) {
  return {
    visibility: overrides.visibility ?? "PUBLIC",
    body: "Your request is being processed.",
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
  };
}

async function createRequest(api: ReturnType<typeof createInternalRequestApi>) {
  const response = await api.create(
    authenticatedRequest("https://magictrust.test/api/v1/requests", {
      method: "POST",
      body: JSON.stringify(validCreateRequestBody()),
    }),
  );
  const body = await response.json();

  return body.request;
}

async function getRequestDetail(
  api: ReturnType<typeof createInternalRequestApi>,
  id: string,
) {
  const response = await api.get(
    authenticatedRequest(`https://magictrust.test/api/v1/requests/${id}`),
    id,
  );
  const body = await response.json();

  return body.request;
}

function createInMemoryDependencies() {
  const state = {
    nextId: 1,
    requesters: [] as Requester[],
    requests: [] as PrivacyRequest[],
    events: [] as RequestEvent[],
    comments: [] as RequestComment[],
  };

  const creationStore: RequestCreationStore = {
    async transaction(callback) {
      return callback({
        async createRequester(data: CreateRequesterRecord) {
          const requester = {
            id: `requester-${state.nextId++}`,
            externalId: data.externalId,
          };

          state.requesters.push(requester);

          return requester;
        },
        async createPrivacyRequest(data: CreatePrivacyRequestRecord) {
          const now = new Date(Date.UTC(2026, 0, state.nextId++));
          const request = {
            id: `request-${state.nextId++}`,
            ...data,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
          };

          state.requests.push(request);

          return request;
        },
        async createRequestEvent(data: CreateRequestEventRecord) {
          const event = {
            id: `event-${state.nextId++}`,
            ...data,
            createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
          };

          state.events.push(event);

          return event;
        },
      });
    },
  };

  const requestRepository: RequestRepository = {
    async findByIdOrPublicId(id: string): Promise<RequestDetails | null> {
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
        comments: state.comments
          .filter((comment) => comment.requestId === request.id)
          .map((comment) => ({ ...comment })),
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
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .slice(0, filters.limit)
        .map(summaryFromRequest);
    },
    async updateStatus(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const previousStatus = request.status;
      const now = new Date(Date.UTC(2026, 0, state.nextId++));
      request.status = input.status;
      request.updatedAt = now;
      request.completedAt = isTerminalStatus(input.status) ? now : null;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "STATUS_CHANGED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          previousStatus,
          newStatus: input.status,
          reason: input.reason,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: now,
      });

      return summaryFromRequest(request);
    },
    async addComment(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const comment = {
        id: `comment-${state.nextId++}`,
        requestId: request.id,
        visibility: input.visibility,
        body: input.body,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      };
      state.comments.push(comment);
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type:
          input.visibility === "PUBLIC"
            ? "PUBLIC_COMMENT_ADDED"
            : "INTERNAL_COMMENT_ADDED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          commentId: comment.id,
          visibility: input.visibility,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return comment;
    },
  };

  return {
    apiKey,
    requestCreationStore: creationStore,
    requestRepository,
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

function isTerminalStatus(status: string): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}
