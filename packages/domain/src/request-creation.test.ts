import { randomUUID } from "node:crypto";

import { describe, expect, test } from "vitest";

import {
  createPrivacyRequest,
  generatePublicId,
  type CreatePrivacyRequestRecord,
  type CreateRequestEventRecord,
  type CreateRequesterRecord,
  type JsonObject,
  type PrivacyRequest,
  type RequestCreationStore,
  type RequestEvent,
  type Requester,
} from "./index";

describe("createPrivacyRequest", () => {
  test("creates a requester and privacy request transactionally", async () => {
    const store = createInMemoryStore();

    const result = await createPrivacyRequest(
      {
        requester: {
          externalId: "consumer-123",
        },
        type: "DATA_ACCESS",
        submittedData: {
          source: "test",
        },
        actor: {
          type: "CONSUMER",
          id: "consumer-123",
        },
      },
      store,
      {
        generatePublicId: () => "req_test_public_id",
      },
    );

    expect(store.transactionCalls).toBe(1);
    expect(store.operations).toEqual([
      "createRequester",
      "createPrivacyRequest",
      "createRequestEvent",
    ]);
    expect(result.requester.externalId).toBe("consumer-123");
    expect(result.request.requesterId).toBe(result.requester.id);
    expect(result.request.publicId).toBe("req_test_public_id");
    expect(result.request.status).toBe("SUBMITTED");
  });

  test("generates public_id values with the expected prefix", () => {
    const publicId = generatePublicId();

    expect(publicId).toMatch(/^req_[A-Za-z0-9_-]+$/);
    expect(publicId.length).toBeGreaterThan(12);
  });

  test("creates a REQUEST_CREATED event for the new request", async () => {
    const store = createInMemoryStore();

    const result = await createPrivacyRequest(
      {
        requester: {},
        type: "DO_NOT_CONTACT",
        submittedData: {
          channel: "phone",
        },
        actor: {
          type: "API_CLIENT",
          id: "internal-system",
        },
      },
      store,
      {
        generatePublicId: () => "req_event_test",
      },
    );

    expect(result.event).toMatchObject({
      privacyRequestId: result.request.id,
      type: "REQUEST_CREATED",
      actorType: "API_CLIENT",
      actorId: "internal-system",
      data: {
        publicId: "req_event_test",
        requestType: "DO_NOT_CONTACT",
        status: "SUBMITTED",
      },
    });
  });

  test("keeps submitted_data separate from mutable_data", async () => {
    const store = createInMemoryStore();
    const submittedData: JsonObject = {
      requester: {
        email: "consumer@example.test",
      },
      request: {
        details: "Original request text",
      },
    };

    const result = await createPrivacyRequest(
      {
        requester: {},
        type: "GENERAL_INQUIRY",
        submittedData,
        actor: {
          type: "CONSUMER",
        },
      },
      store,
      {
        generatePublicId: () => "req_data_test",
      },
    );

    submittedData.request = {
      details: "Changed after creation",
    };

    expect(result.request.submittedData).toEqual({
      requester: {
        email: "consumer@example.test",
      },
      request: {
        details: "Original request text",
      },
    });
    expect(result.request.mutableData).toEqual({});
    expect(result.request.mutableData).not.toBe(result.request.submittedData);
  });
});

function createInMemoryStore(): RequestCreationStore & {
  transactionCalls: number;
  operations: string[];
} {
  const state = {
    transactionCalls: 0,
    operations: [] as string[],
  };

  return {
    get transactionCalls() {
      return state.transactionCalls;
    },
    get operations() {
      return state.operations;
    },
    async transaction(callback) {
      state.transactionCalls += 1;

      return callback({
        async createRequester(data: CreateRequesterRecord): Promise<Requester> {
          state.operations.push("createRequester");

          expect(data.emailEncrypted).toBeNull();
          expect(data.phoneEncrypted).toBeNull();
          expect(data.nameEncrypted).toBeNull();

          return {
            id: randomUUID(),
            externalId: data.externalId,
          };
        },
        async createPrivacyRequest(
          data: CreatePrivacyRequestRecord,
        ): Promise<PrivacyRequest> {
          state.operations.push("createPrivacyRequest");

          return {
            id: randomUUID(),
            createdAt: new Date(),
            updatedAt: new Date(),
            ...data,
          };
        },
        async createRequestEvent(
          data: CreateRequestEventRecord,
        ): Promise<RequestEvent> {
          state.operations.push("createRequestEvent");

          return {
            id: randomUUID(),
            createdAt: new Date(),
            ...data,
          };
        },
      });
    },
  };
}
