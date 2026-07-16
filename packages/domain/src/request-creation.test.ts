import { randomUUID } from "node:crypto";

import { decryptPii, hashPii } from "@magictrust/privacy";
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

process.env.ENCRYPTION_KEY = "test-encryption-key-for-domain-package";

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
    expect(store.requesterRecord).toMatchObject({
      emailEncrypted: null,
      emailHash: null,
      phoneEncrypted: null,
      phoneHash: null,
      nameEncrypted: null,
    });
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

  test("stores encrypted and hashed requester email and phone", async () => {
    const store = createInMemoryStore();

    await createPrivacyRequest(
      {
        requester: {
          email: "  JOHN@example.com  ",
          phone: " (305) 555-1234 ",
        },
        type: "DATA_ACCESS",
        submittedData: {
          source: "test",
        },
        actor: {
          type: "API_CLIENT",
        },
      },
      store,
      {
        generatePublicId: () => "req_pii_test",
      },
    );

    expect(store.requesterRecord?.emailEncrypted).toEqual(expect.any(String));
    expect(store.requesterRecord?.emailEncrypted).not.toBe(
      "  JOHN@example.com  ",
    );
    expect(decryptPii(store.requesterRecord?.emailEncrypted ?? "")).toBe(
      "  JOHN@example.com  ",
    );
    expect(store.requesterRecord?.emailHash).toBe(hashPii("john@example.com"));
    expect(store.requesterRecord?.phoneEncrypted).toEqual(expect.any(String));
    expect(store.requesterRecord?.phoneEncrypted).not.toBe(" (305) 555-1234 ");
    expect(decryptPii(store.requesterRecord?.phoneEncrypted ?? "")).toBe(
      " (305) 555-1234 ",
    );
    expect(store.requesterRecord?.phoneHash).toBe(hashPii("3055551234"));
  });
});

function createInMemoryStore(): RequestCreationStore & {
  transactionCalls: number;
  operations: string[];
  requesterRecord: CreateRequesterRecord | null;
} {
  const state = {
    transactionCalls: 0,
    operations: [] as string[],
    requesterRecord: null as CreateRequesterRecord | null,
  };

  return {
    get transactionCalls() {
      return state.transactionCalls;
    },
    get operations() {
      return state.operations;
    },
    get requesterRecord() {
      return state.requesterRecord;
    },
    async transaction(callback) {
      state.transactionCalls += 1;

      return callback({
        async createRequester(data: CreateRequesterRecord): Promise<Requester> {
          state.operations.push("createRequester");
          state.requesterRecord = data;

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
            completedAt: null,
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
