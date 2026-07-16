import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  PrivacyRequest,
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

function createInMemoryDependencies() {
  const state = {
    nextId: 1,
    requesters: [] as Requester[],
    requests: [] as PrivacyRequest[],
    events: [] as RequestEvent[],
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
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
