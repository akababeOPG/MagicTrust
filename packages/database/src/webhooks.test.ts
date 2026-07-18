import { decryptPii } from "@magictrust/privacy";
import { afterEach, describe, expect, test, vi } from "vitest";

import {
  buildWebhookPayload,
  createRequestEventAndEnqueueWebhooks,
  deliverWebhook,
  getEffectiveWebhookEventType,
  prepareWebhookEndpointCreate,
  serializeWebhookPayload,
  signWebhookPayload,
  validateWebhookDestination,
  validateWebhookEventName,
  type WebhookDeliveryClaim,
} from "./webhooks";

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalEncryptionKey;
});

describe("webhooks", () => {
  test("endpoint URL and signing secret are encrypted at rest", () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-webhooks";

    const prepared = prepareWebhookEndpointCreate({
      name: "Privacy Processor",
      url: "https://processor.example.com/webhooks/magictrust?token=secret",
      events: ["REQUEST_CREATED"],
      signingSecret: "whsec_test_secret",
    });

    expect(prepared.urlHost).toBe("processor.example.com");
    expect(prepared.urlEncrypted).not.toContain("processor.example.com");
    expect(prepared.urlEncrypted).not.toContain("token=secret");
    expect(prepared.signingSecretEncrypted).not.toContain("whsec_test_secret");
    expect(decryptPii(prepared.urlEncrypted)).toBe(
      "https://processor.example.com/webhooks/magictrust?token=secret",
    );
    expect(decryptPii(prepared.signingSecretEncrypted)).toBe(
      "whsec_test_secret",
    );
  });

  test("unsafe destination URLs are rejected", () => {
    expect(() =>
      validateWebhookDestination("http://processor.example.com/webhooks"),
    ).toThrow("HTTPS");
    expect(() =>
      validateWebhookDestination("https://user:pass@example.com/webhooks"),
    ).toThrow("credentials");
    expect(() =>
      validateWebhookDestination("https://localhost/webhooks"),
    ).toThrow("local hostname");
    expect(() =>
      validateWebhookDestination("https://127.0.0.1/webhooks"),
    ).toThrow();
    expect(() =>
      validateWebhookDestination("https://10.0.0.5/webhooks"),
    ).toThrow("private or loopback IP");
  });

  test("event name validation supports built-ins and custom names", () => {
    expect(validateWebhookEventName("REQUEST_CREATED")).toBe(true);
    expect(validateWebhookEventName("DATA_EXPORT_GENERATED")).toBe(true);
    expect(validateWebhookEventName("CUSTOM_EVENT")).toBe(false);
    expect(validateWebhookEventName("bad-name")).toBe(false);
  });

  test("custom event uses custom_type as the effective event name", () => {
    expect(
      getEffectiveWebhookEventType({
        type: "CUSTOM_EVENT",
        category: "CUSTOM",
        customType: "DATA_EXPORT_GENERATED",
      }),
    ).toBe("DATA_EXPORT_GENERATED");
  });

  test("built-in events bypass custom event name validation", () => {
    expect(
      getEffectiveWebhookEventType({
        type: "REQUEST_DATA_UPDATED",
        category: "BUILT_IN",
        customType: "not-a-valid-custom-name",
      }),
    ).toBe("REQUEST_DATA_UPDATED");
  });

  test("custom events still require a valid custom_type", () => {
    expect(() =>
      getEffectiveWebhookEventType({
        type: "CUSTOM_EVENT",
        category: "CUSTOM",
        customType: null,
      }),
    ).toThrow("valid custom event type");
    expect(() =>
      getEffectiveWebhookEventType({
        type: "CUSTOM_EVENT",
        category: "CUSTOM",
        customType: "bad-name",
      }),
    ).toThrow("valid custom event type");
  });

  test("REQUEST_DATA_UPDATED succeeds without a subscribed endpoint", async () => {
    const executor = fakeWebhookEnqueueExecutor([]);

    const event = await createRequestEventAndEnqueueWebhooks(
      executor as never,
      mutableDataEventInput(),
    );

    expect(event).toMatchObject({
      type: "REQUEST_DATA_UPDATED",
      category: "BUILT_IN",
      visibility: "INTERNAL",
    });
    expect(executor.events).toHaveLength(1);
    expect(executor.deliveries).toHaveLength(0);
  });

  test("REQUEST_DATA_UPDATED enqueues a PII-safe subscribed delivery", async () => {
    const executor = fakeWebhookEnqueueExecutor([{ id: "endpoint-1" }]);

    await createRequestEventAndEnqueueWebhooks(
      executor as never,
      mutableDataEventInput(),
    );

    expect(executor.events).toHaveLength(1);
    expect(executor.deliveries).toHaveLength(1);
    expect(executor.deliveries[0]).toMatchObject({
      webhookEndpointId: "endpoint-1",
      requestEventId: "event-1",
      eventType: "REQUEST_DATA_UPDATED",
      payload: {
        event: {
          type: "REQUEST_DATA_UPDATED",
          visibility: "INTERNAL",
        },
        actor: { type: "ADMIN_USER", id: "admin-user-1" },
        data: {
          changedKeys: ["processorReference"],
          reason: "Processor metadata updated.",
        },
      },
    });
    expect(JSON.stringify(executor.deliveries[0])).not.toContain(
      "john@example.com",
    );
    expect(JSON.stringify(executor.deliveries[0])).not.toContain("mutableData");
  });

  test("built-in payload normalizes absent visibility without changing the event", () => {
    const event = {
      ...sampleEvent(),
      type: "REQUEST_DATA_UPDATED" as const,
      visibility: null,
      data: { changedKeys: ["resolutionCode"], reason: "Resolution added." },
    };
    const payload = buildWebhookPayload({
      deliveryId: "delivery-1",
      effectiveEventType: "REQUEST_DATA_UPDATED",
      event,
      request: sampleRequest(),
    });

    expect(payload.event.visibility).toBe("INTERNAL");
    expect(event.visibility).toBeNull();
  });

  test("payload includes safe metadata and excludes sensitive event data", () => {
    const payload = buildWebhookPayload({
      deliveryId: "delivery-1",
      effectiveEventType: "REQUEST_DATA_UPDATED",
      event: {
        id: "event-1",
        type: "REQUEST_DATA_UPDATED",
        category: "BUILT_IN",
        customType: null,
        visibility: "INTERNAL",
        actorType: "ADMIN_USER",
        actorId: "admin-user-1",
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        data: {
          changedKeys: ["processorReference"],
          reason: "Processor metadata updated.",
          mutableData: { email: "john@example.com" },
          token: "secret-token",
          storageKey: "blob/private/key",
          checksum: "sha256-secret",
        },
      },
      request: {
        id: "request-1",
        publicId: "req_example",
        type: "DATA_ACCESS",
        status: "PROCESSING",
        createdAt: new Date("2026-07-16T00:00:00.000Z"),
        updatedAt: new Date("2026-07-17T00:00:00.000Z"),
      },
    });
    const serialized = JSON.stringify(payload);

    expect(payload).toMatchObject({
      version: "1",
      deliveryId: "delivery-1",
      event: {
        id: "event-1",
        type: "REQUEST_DATA_UPDATED",
        visibility: "INTERNAL",
      },
      request: {
        id: "request-1",
        publicId: "req_example",
        type: "DATA_ACCESS",
        status: "PROCESSING",
      },
      actor: {
        type: "ADMIN_USER",
        id: "admin-user-1",
      },
      data: {
        changedKeys: ["processorReference"],
        reason: "Processor metadata updated.",
      },
    });
    expect(serialized).not.toContain("requesterId");
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("mutableData");
    expect(serialized).toContain("Processor metadata updated.");
    expect(serialized).not.toContain("secret-token");
    expect(serialized).not.toContain("blob/private/key");
    expect(serialized).not.toContain("sha256-secret");
  });

  test("assignment webhook payloads use the built-in safe allowlist", () => {
    const payload = buildWebhookPayload({
      deliveryId: "delivery-assignment",
      effectiveEventType: "REQUEST_ASSIGNED",
      event: {
        ...sampleEvent(),
        type: "REQUEST_ASSIGNED",
        data: {
          assignedToAdminUserId: "admin-user-2",
          assignedByAdminUserId: "admin-user-1",
          email: "operator@example.com",
          emailHash: "secret-hash",
        },
      },
      request: sampleRequest(),
    });

    expect(payload.event.type).toBe("REQUEST_ASSIGNED");
    expect(payload.data).toEqual({
      assignedToAdminUserId: "admin-user-2",
      assignedByAdminUserId: "admin-user-1",
    });
    expect(JSON.stringify(payload)).not.toContain("operator@example.com");
    expect(JSON.stringify(payload)).not.toContain("secret-hash");
  });

  test("due-date webhook payloads use the built-in safe allowlist", () => {
    const payload = buildWebhookPayload({
      deliveryId: "delivery-due-date",
      effectiveEventType: "REQUEST_DUE_DATE_UPDATED",
      event: {
        ...sampleEvent(),
        type: "REQUEST_DUE_DATE_UPDATED",
        data: {
          previousDueAt: "2026-07-20T00:00:00.000Z",
          dueAt: "2026-07-24T00:00:00.000Z",
          adminEmail: "admin@example.com",
          requesterEmail: "consumer@example.com",
          emailHash: "secret-hash",
        },
      },
      request: sampleRequest(),
    });

    expect(payload.data).toEqual({
      previousDueAt: "2026-07-20T00:00:00.000Z",
      dueAt: "2026-07-24T00:00:00.000Z",
    });
    expect(JSON.stringify(payload)).not.toContain("admin@example.com");
    expect(JSON.stringify(payload)).not.toContain("consumer@example.com");
    expect(JSON.stringify(payload)).not.toContain("secret-hash");
  });

  test("custom event payload includes validated custom event data", () => {
    const payload = buildWebhookPayload({
      deliveryId: "delivery-1",
      effectiveEventType: "DATA_EXPORT_READY",
      event: {
        id: "event-1",
        type: "CUSTOM_EVENT",
        category: "CUSTOM",
        customType: "DATA_EXPORT_READY",
        visibility: "PUBLIC",
        actorType: "API_CLIENT",
        actorId: "processor",
        createdAt: new Date("2026-07-17T00:00:00.000Z"),
        data: { processorReference: "job-12345" },
      },
      request: sampleRequest(),
    });

    expect(payload.event.type).toBe("DATA_EXPORT_READY");
    expect(payload.data).toEqual({ processorReference: "job-12345" });
  });

  test("signature uses timestamp plus deterministic raw body", () => {
    const payload = buildWebhookPayload({
      deliveryId: "delivery-1",
      effectiveEventType: "REQUEST_CREATED",
      event: sampleEvent(),
      request: sampleRequest(),
    });
    const body = serializeWebhookPayload(payload);

    expect(
      signWebhookPayload({
        signingSecret: "whsec_test_secret",
        timestamp: 1_784_246_400,
        body,
      }),
    ).toMatch(/^v1=[a-f0-9]{64}$/);
    expect(
      signWebhookPayload({
        signingSecret: "whsec_test_secret",
        timestamp: 1_784_246_400,
        body,
      }),
    ).toBe(
      signWebhookPayload({
        signingSecret: "whsec_test_secret",
        timestamp: 1_784_246_400,
        body,
      }),
    );
  });

  test("2xx marks delivered and uses required headers", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-webhooks";
    const db = fakeDeliveryDb();
    const fetchImpl = vi.fn().mockResolvedValue({ status: 204 });
    const delivery = sampleDelivery();

    const result = await deliverWebhook(db as never, delivery, {
      now: new Date("2026-07-17T00:00:00.000Z"),
      fetchImpl,
    });

    expect(result).toBe("delivered");
    expect(db.updates[0]).toMatchObject({ status: "DELIVERED" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://processor.example.com/webhooks/magictrust",
      expect.objectContaining({
        redirect: "manual",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          "User-Agent": "MagicTrust-Webhooks/1.0",
          "X-MagicTrust-Event": "REQUEST_CREATED",
          "X-MagicTrust-Delivery-Id": delivery.id,
          "X-MagicTrust-Signature": expect.stringMatching(/^v1=/),
        }),
      }),
    );
  });

  test("retryable failures schedule retry and preserve delivery id", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-webhooks";
    const db = fakeDeliveryDb();
    const delivery = sampleDelivery({ attemptCount: 1 });
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ status: 500 })
      .mockResolvedValueOnce({ status: 429 });

    const first = await deliverWebhook(db as never, delivery, {
      now: new Date("2026-07-17T00:00:00.000Z"),
      fetchImpl,
    });
    const second = await deliverWebhook(db as never, delivery, {
      now: new Date("2026-07-17T00:01:00.000Z"),
      fetchImpl,
    });

    expect(first).toBe("retrying");
    expect(second).toBe("retrying");
    expect(db.updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "RETRYING",
          lastErrorCode: "HTTP_500",
        }),
        expect.objectContaining({
          status: "RETRYING",
          lastErrorCode: "HTTP_429",
        }),
      ]),
    );
    expect(
      fetchImpl.mock.calls[0]?.[1].headers["X-MagicTrust-Delivery-Id"],
    ).toBe(delivery.id);
    expect(
      fetchImpl.mock.calls[1]?.[1].headers["X-MagicTrust-Delivery-Id"],
    ).toBe(delivery.id);
  });

  test("non-retryable 4xx and maximum attempts mark dead", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-webhooks";
    const fourOhFourDb = fakeDeliveryDb();
    const maxAttemptDb = fakeDeliveryDb();

    expect(
      await deliverWebhook(
        fourOhFourDb as never,
        sampleDelivery({ attemptCount: 1 }),
        {
          now: new Date("2026-07-17T00:00:00.000Z"),
          fetchImpl: vi.fn().mockResolvedValue({ status: 400 }),
        },
      ),
    ).toBe("dead");
    expect(
      await deliverWebhook(
        maxAttemptDb as never,
        sampleDelivery({ attemptCount: 5 }),
        {
          now: new Date("2026-07-17T00:00:00.000Z"),
          fetchImpl: vi.fn().mockResolvedValue({ status: 500 }),
        },
      ),
    ).toBe("dead");
    expect(fourOhFourDb.updates[0]).toMatchObject({
      status: "DEAD",
      lastErrorCode: "HTTP_400",
    });
    expect(maxAttemptDb.updates[0]).toMatchObject({
      status: "DEAD",
      lastErrorCode: "HTTP_500",
    });
  });

  test("inactive endpoint is not delivered", async () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-webhooks";
    const db = fakeDeliveryDb();
    const fetchImpl = vi.fn();

    const result = await deliverWebhook(
      db as never,
      sampleDelivery({ endpointActive: false }),
      {
        now: new Date("2026-07-17T00:00:00.000Z"),
        fetchImpl,
      },
    );

    expect(result).toBe("dead");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(db.updates[0]).toMatchObject({
      status: "DEAD",
      lastErrorCode: "ENDPOINT_INACTIVE",
    });
  });
});

function sampleRequest() {
  return {
    id: "request-1",
    publicId: "req_example",
    type: "DATA_ACCESS" as const,
    status: "PROCESSING" as const,
    createdAt: new Date("2026-07-16T00:00:00.000Z"),
    updatedAt: new Date("2026-07-17T00:00:00.000Z"),
  };
}

function mutableDataEventInput() {
  return {
    privacyRequestId: "request-1",
    type: "REQUEST_DATA_UPDATED" as const,
    actorType: "ADMIN_USER" as const,
    actorId: "admin-user-1",
    data: {
      changedKeys: ["processorReference"],
      reason: "Processor metadata updated.",
      actor: { type: "ADMIN_USER", id: "admin-user-1" },
      mutableData: { email: "john@example.com" },
    },
  };
}

function fakeWebhookEnqueueExecutor(
  subscribedEndpoints: Array<{ id: string }>,
) {
  const events: Array<Record<string, unknown>> = [];
  const deliveries: Array<Record<string, unknown>> = [];
  let selectCount = 0;
  let insertCount = 0;

  return {
    events,
    deliveries,
    insert() {
      const currentInsert = insertCount;
      insertCount += 1;

      if (currentInsert === 0) {
        return {
          values(values: Record<string, unknown>) {
            const event = {
              id: "event-1",
              category: "BUILT_IN",
              customType: null,
              visibility: null,
              createdAt: new Date("2026-07-17T00:00:00.000Z"),
              ...values,
            };
            events.push(event);

            return {
              returning() {
                return Promise.resolve([event]);
              },
            };
          },
        };
      }

      return {
        values(values: Array<Record<string, unknown>>) {
          deliveries.push(...values);

          return {
            onConflictDoNothing() {
              return Promise.resolve();
            },
          };
        },
      };
    },
    select() {
      const currentSelect = selectCount;
      selectCount += 1;

      if (currentSelect === 0) {
        return {
          from() {
            return {
              innerJoin() {
                return {
                  where() {
                    return Promise.resolve(subscribedEndpoints);
                  },
                };
              },
            };
          },
        };
      }

      return {
        from() {
          return {
            where() {
              return {
                limit() {
                  return Promise.resolve([sampleRequest()]);
                },
              };
            },
          };
        },
      };
    },
  };
}

function sampleEvent() {
  return {
    id: "event-1",
    privacyRequestId: "request-1",
    type: "REQUEST_CREATED" as const,
    category: "BUILT_IN" as const,
    customType: null,
    visibility: "INTERNAL" as const,
    actorType: "CONSUMER" as const,
    actorId: null,
    createdAt: new Date("2026-07-17T00:00:00.000Z"),
    data: {},
  };
}

function sampleDelivery(
  overrides: Partial<WebhookDeliveryClaim> = {},
): WebhookDeliveryClaim {
  const endpoint = prepareWebhookEndpointCreate({
    name: "Privacy Processor",
    url: "https://processor.example.com/webhooks/magictrust",
    events: ["REQUEST_CREATED"],
    signingSecret: "whsec_test_secret",
  });
  const payload = buildWebhookPayload({
    deliveryId: "delivery-1",
    effectiveEventType: "REQUEST_CREATED",
    event: sampleEvent(),
    request: sampleRequest(),
  });

  return {
    id: "delivery-1",
    webhookEndpointId: "endpoint-1",
    requestEventId: "event-1",
    eventType: "REQUEST_CREATED",
    payload,
    status: "PENDING",
    attemptCount: 1,
    nextAttemptAt: new Date("2026-07-17T00:00:00.000Z"),
    lastAttemptAt: null,
    deliveredAt: null,
    responseStatus: null,
    lastErrorCode: null,
    endpointActive: true,
    urlEncrypted: endpoint.urlEncrypted,
    urlHost: endpoint.urlHost,
    signingSecretEncrypted: endpoint.signingSecretEncrypted,
    ...overrides,
  };
}

function fakeDeliveryDb() {
  const updates: Array<Record<string, unknown>> = [];

  return {
    updates,
    update() {
      return {
        set(values: Record<string, unknown>) {
          updates.push(values);
          return {
            where() {
              return Promise.resolve();
            },
          };
        },
      };
    },
  };
}
