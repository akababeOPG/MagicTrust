import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  JsonObject,
  PrivacyRequest,
  RequestAccessToken,
  RequestAttachment,
  RequestComment,
  RequestCommunication,
  RequestCreationStore,
  RequestEvent,
  Requester,
} from "@magictrust/domain";
import type {
  ApiClientScope,
  AuthenticatedApiClient,
  ApiIdempotencyRecord,
  ApiIdempotencyStore,
  RequestDetails,
  RequestListFilters,
  RequestRepository,
  RequestSummary,
} from "@magictrust/database";
import {
  apiClientScopesList,
  getApiKeyPrefix,
  hashApiKey,
  verifyApiKey,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import {
  encryptPii,
  encryptSubmittedPayload,
  hashAccessToken,
  hashPii,
} from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { describe, expect, test } from "vitest";

import { createInternalRequestApi } from "../../lib/internal-request-api";

const apiKey = "mt_live_test-internal-api-key";
const legacyApiKey = "test-internal-api-key";
const apiClientId = "privacy-processor";
let idempotencyCounter = 1;
process.env.ENCRYPTION_KEY = "test-encryption-key-for-web-api";

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

  test("authenticates a valid database-backed API client key", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    const response = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );

    expect(response.status).toBe(200);
    expect(dependencies.state.apiClientKey.lastUsedAt).toBeInstanceOf(Date);
  });

  test("rejects expired API client keys", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({
        keyExpiresAt: new Date(Date.now() - 60_000),
      }),
    );

    const response = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );

    expect(response.status).toBe(401);
  });

  test("rejects inactive API clients and keys", async () => {
    const inactiveClientApi = createInternalRequestApi(
      createInMemoryDependencies({ clientActive: false }),
    );
    const inactiveKeyApi = createInternalRequestApi(
      createInMemoryDependencies({ keyActive: false }),
    );

    const inactiveClientResponse = await inactiveClientApi.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );
    const inactiveKeyResponse = await inactiveKeyApi.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );

    expect(inactiveClientResponse.status).toBe(401);
    expect(inactiveKeyResponse.status).toBe(401);
  });

  test("returns 403 when an API client is missing a required scope", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({ scopes: ["requests:read"] }),
    );

    const response = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("allows API clients with the authorized scope", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({ scopes: ["requests:read"] }),
    );

    const response = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );

    expect(response.status).toBe(200);
  });

  test("does not store raw API keys", () => {
    const dependencies = createInMemoryDependencies();

    expect(dependencies.state.apiClientKey.keyHash).not.toBe(apiKey);
    expect(dependencies.state.apiClientKey.keyHash).toBe(hashApiKey(apiKey));
  });

  test("derives API_CLIENT actorId from the authenticated API client", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.updateStatus(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/status`,
        {
          method: "POST",
          body: JSON.stringify({
            ...validStatusUpdateBody(),
            actor: {
              type: "API_CLIENT",
              id: "spoofed-client",
            },
          }),
        },
      ),
      created.publicId,
    );

    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "STATUS_CHANGED",
          actorId: apiClientId,
        }),
      ]),
    );
  });

  test("legacy INTERNAL_API_KEY works outside production", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({ dbKeyEnabled: false }),
    );

    const response = await api.list(
      new Request("https://magictrust.test/api/v1/requests", {
        headers: {
          "x-api-key": legacyApiKey,
        },
      }),
    );

    expect(response.status).toBe(200);
  });

  test("legacy INTERNAL_API_KEY is rejected in production", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({
        appEnv: "production",
        dbKeyEnabled: false,
      }),
    );

    const response = await api.list(
      new Request("https://magictrust.test/api/v1/requests", {
        headers: {
          "x-api-key": legacyApiKey,
        },
      }),
    );

    expect(response.status).toBe(401);
  });

  test("requires Idempotency-Key on protected mutations", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.create(
      new Request("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REQUIRED");
  });

  test("first idempotent request executes normally", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    const response = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "Idempotency-Key": "create-once",
        },
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBeNull();
    expect(dependencies.state.requests).toHaveLength(1);
    expect(dependencies.state.idempotencyRecords).toHaveLength(1);
  });

  test("same idempotency key and payload replays original response", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const requestBody = validCreateRequestBody();

    const first = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "Idempotency-Key": "same-create",
        },
        body: JSON.stringify(requestBody),
      }),
    );
    const firstBody = await first.json();
    const second = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "Idempotency-Key": "same-create",
        },
        body: JSON.stringify(requestBody),
      }),
    );
    const secondBody = await second.json();

    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(secondBody).toEqual(firstBody);
    expect(dependencies.state.requests).toHaveLength(1);
    expect(dependencies.state.events).toHaveLength(1);
  });

  test("same idempotency key with different payload returns 409", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "Idempotency-Key": "conflicting-create",
        },
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const response = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        headers: {
          "Idempotency-Key": "conflicting-create",
        },
        body: JSON.stringify(validCreateRequestBody({ type: "DATA_DELETION" })),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("IDEMPOTENCY_KEY_REUSED");
    expect(dependencies.state.requests).toHaveLength(1);
  });

  test("GET endpoints do not require Idempotency-Key", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.get(
      new Request(
        `https://magictrust.test/api/v1/requests/${created.publicId}`,
        {
          headers: {
            "x-api-key": apiKey,
          },
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(200);
  });

  test("file upload retries do not create duplicate storage or attachments", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const first = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": "same-upload",
          },
          body: validUploadFormData(),
        },
      ),
      created.publicId,
    );
    const firstBody = await first.json();
    const second = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": "same-upload",
          },
          body: validUploadFormData(),
        },
      ),
      created.publicId,
    );
    const secondBody = await second.json();

    expect(second.status).toBe(201);
    expect(second.headers.get("Idempotency-Replayed")).toBe("true");
    expect(secondBody).toEqual(firstBody);
    expect(dependencies.state.attachments).toHaveLength(1);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PUBLIC_ATTACHMENT_ADDED",
        }),
      ]),
    );
    expect(
      dependencies.state.events.filter(
        (event) => event.type === "PUBLIC_ATTACHMENT_ADDED",
      ),
    ).toHaveLength(1);
  });

  test("accepts the same valid API key across all Internal API v1 operations", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const createResponse = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const created = (await createResponse.json()).request;

    const listResponse = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );
    const getResponse = await api.get(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}`,
      ),
      created.publicId,
    );
    const processingDataResponse = await api.getProcessingData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/processing-data`,
      ),
      created.publicId,
    );
    const statusResponse = await api.updateStatus(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/status`,
        {
          method: "POST",
          body: JSON.stringify(validStatusUpdateBody()),
        },
      ),
      created.publicId,
    );
    const dataResponse = await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(validMutableDataBody()),
        },
      ),
      created.publicId,
    );
    const commentResponse = await api.addComment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/comments`,
        {
          method: "POST",
          body: JSON.stringify(validCommentBody()),
        },
      ),
      created.publicId,
    );
    const attachmentResponse = await api.addAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody()),
        },
      ),
      created.publicId,
    );
    const uploadResponse = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: validUploadFormData(),
        },
      ),
      created.publicId,
    );
    const uploaded = (await uploadResponse.json()).attachment;
    const downloadResponse = await api.downloadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/${uploaded.id}/download`,
      ),
      created.publicId,
      uploaded.id,
    );
    const emailResponse = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const notificationResponse = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      created.publicId,
    );
    const customEventResponse = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(validCustomEventBody()),
        },
      ),
      created.publicId,
    );
    const detailAfterEmailResponse = await api.get(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}`,
      ),
      created.publicId,
    );
    const detailAfterEmail = await detailAfterEmailResponse.json();

    expect(createResponse.status).toBe(201);
    expect(listResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(processingDataResponse.status).toBe(200);
    expect(statusResponse.status).toBe(200);
    expect(dataResponse.status).toBe(200);
    expect(commentResponse.status).toBe(201);
    expect(attachmentResponse.status).toBe(201);
    expect(uploadResponse.status).toBe(201);
    expect(downloadResponse.status).toBe(200);
    expect(emailResponse.status).toBe(201);
    expect(notificationResponse.status).toBe(201);
    expect(customEventResponse.status).toBe(201);
    expect(detailAfterEmailResponse.status).toBe(200);
    expect(detailAfterEmail.request.communications).toEqual([
      expect.objectContaining({
        channel: "EMAIL",
        status: "SENT",
      }),
      expect.objectContaining({
        channel: "EMAIL",
        status: "SENT",
      }),
    ]);
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
    expect(JSON.stringify(body)).not.toContain("emailEncrypted");
    expect(JSON.stringify(body)).not.toContain("emailHash");
    expect(JSON.stringify(body)).not.toContain("phoneEncrypted");
    expect(JSON.stringify(body)).not.toContain("phoneHash");
    expect(JSON.stringify(body)).not.toContain("submittedDataEncrypted");
    expect(JSON.stringify(body)).not.toContain("submittedDataHash");
    expect(JSON.stringify(body)).not.toContain("encryptionVersion");
    expect(dependencies.state.requests[0]?.submittedData).toEqual({
      type: "DATA_ACCESS",
      source: {
        channel: "API",
        formKey: "manual-api",
        siteKey: "test-site",
      },
    });
    expect(
      JSON.stringify(dependencies.state.requests[0]?.submittedData),
    ).not.toContain("john@example.com");
    expect(
      JSON.stringify(dependencies.state.requests[0]?.submittedData),
    ).not.toContain("+13055551234");
    expect(dependencies.state.requests[0]?.submittedDataEncrypted).toEqual(
      expect.any(String),
    );
    expect(dependencies.state.requests[0]?.submittedDataHash).toEqual(
      expect.any(String),
    );
    expect(dependencies.state.requests[0]?.encryptionVersion).toBe(1);
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
    const serialized = JSON.stringify(body);

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
    expect(serialized).not.toContain("John");
    expect(serialized).not.toContain("Doe");
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("+13055551234");
    expect(serialized).not.toContain("I want to access my data");
    expect(serialized).not.toContain("submittedDataEncrypted");
    expect(serialized).not.toContain("submittedDataHash");
    expect(serialized).not.toContain("encryptionVersion");
  });

  test("returns decrypted processing data to a scoped API client without mutating the request", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const originalSubmission = validCreateRequestBody();
    const created = await createRequest(api, originalSubmission);
    const statusBefore = dependencies.state.requests[0]?.status;
    const eventsBefore = structuredClone(dependencies.state.events);

    const response = await api.getProcessingData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/processing-data`,
      ),
      created.publicId,
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0",
    );
    expect(body.request).toEqual({
      id: created.id,
      publicId: created.publicId,
      type: "DATA_ACCESS",
      status: "SUBMITTED",
      requester: {
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+13055551234",
      },
      originalSubmittedData: originalSubmission,
      form: null,
    });
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("submittedDataEncrypted");
    expect(serialized).not.toContain("submittedDataHash");
    expect(serialized).not.toContain("encryptionVersion");
    expect(dependencies.state.requests[0]?.status).toBe(statusBefore);
    expect(dependencies.state.events).toEqual(eventsBefore);
  });

  test("returns null safely when optional processing data is unavailable", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const request = dependencies.state.requests[0];

    if (!request) throw new Error("Expected request fixture.");

    dependencies.state.requesterEmailEncrypted.set(request.requesterId, null);
    dependencies.state.requesterPhoneEncrypted.set(request.requesterId, null);
    dependencies.state.requesterNameEncrypted.set(request.requesterId, null);
    request.submittedDataEncrypted = encryptSubmittedPayload({
      type: request.type,
      source: { channel: "FORM" },
      submittedData: {},
    });

    const response = await api.getProcessingData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/processing-data`,
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.request.requester).toEqual({
      firstName: null,
      lastName: null,
      email: null,
      phone: null,
    });
    expect(body.request.form).toBeNull();
  });

  test("requires the processing-data scope", async () => {
    const dependencies = createInMemoryDependencies({
      scopes: ["requests:read"],
    });
    const api = createInternalRequestApi(dependencies);

    const response = await api.getProcessingData(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_example/processing-data",
      ),
      "req_example",
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("rejects an invalid API key for processing data", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.getProcessingData(
      new Request(
        "https://magictrust.test/api/v1/requests/req_example/processing-data",
        { headers: { "x-api-key": "invalid" } },
      ),
      "req_example",
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });

  test("returns 404 for unknown processing data requests", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.getProcessingData(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_unknown/processing-data",
      ),
      "req_unknown",
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
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
    expect(body.pagination).toEqual({
      limit: 10,
    });
  });

  test("returns 403 when listing without requests:read scope", async () => {
    const api = createInternalRequestApi(
      createInMemoryDependencies({ scopes: ["requests:create"] }),
    );

    const response = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );
    const body = await response.json();

    expect(response.status).toBe(403);
    expect(body.error.code).toBe("FORBIDDEN");
  });

  test("lists requests with exact publicId filter", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const first = await createRequest(api);
    await createRequest(api);

    const response = await api.list(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests?publicId=${first.publicId}`,
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].publicId).toBe(first.publicId);
  });

  test("lists requests with multiple status values", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const first = await createRequest(api);
    const second = await createRequest(api);
    const third = await createRequest(api);
    dependencies.state.requests.find((item) => item.id === first.id)!.status =
      "VERIFIED";
    dependencies.state.requests.find((item) => item.id === second.id)!.status =
      "PROCESSING";
    dependencies.state.requests.find((item) => item.id === third.id)!.status =
      "REJECTED";

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?status=VERIFIED,PROCESSING",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.requests.map((request: { status: string }) => request.status),
    ).toEqual(expect.arrayContaining(["VERIFIED", "PROCESSING"]));
    expect(body.requests).toHaveLength(2);
  });

  test("lists requests with multiple type values", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    await createRequest(api, validCreateRequestBody({ type: "DATA_ACCESS" }));
    await createRequest(api, validCreateRequestBody({ type: "DATA_DELETION" }));
    await createRequest(
      api,
      validCreateRequestBody({ type: "GENERAL_INQUIRY" }),
    );

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?type=DATA_ACCESS,DATA_DELETION",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.requests.map((request: { type: string }) => request.type),
    ).toEqual(expect.arrayContaining(["DATA_ACCESS", "DATA_DELETION"]));
    expect(body.requests).toHaveLength(2);
  });

  test("lists requests by exact email hash lookup", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const first = await createRequest(
      api,
      validCreateRequestBody({
        requester: { email: "User@Example.com", phone: "+13055550000" },
      }),
    );
    await createRequest(
      api,
      validCreateRequestBody({
        requester: { email: "other@example.com", phone: "+13055551111" },
      }),
    );

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?email=user@example.com",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].publicId).toBe(first.publicId);
    expect(dependencies.state.requesterEmailHash.get(first.requesterId)).toBe(
      hashPii("user@example.com"),
    );
  });

  test("lists requests by exact phone hash lookup", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const first = await createRequest(
      api,
      validCreateRequestBody({
        requester: { email: "phone@example.com", phone: "(305) 555-1234" },
      }),
    );
    await createRequest(
      api,
      validCreateRequestBody({
        requester: { email: "other@example.com", phone: "+13055551111" },
      }),
    );

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?phone=305-555-1234",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].publicId).toBe(first.publicId);
    expect(dependencies.state.requesterPhoneHash.get(first.requesterId)).toBe(
      hashPii("3055551234"),
    );
  });

  test("lists requests with date range filters", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const first = await createRequest(api);
    const second = await createRequest(api);
    const firstRecord = dependencies.state.requests.find(
      (item) => item.id === first.id,
    )!;
    const secondRecord = dependencies.state.requests.find(
      (item) => item.id === second.id,
    )!;
    firstRecord.createdAt = new Date("2026-07-01T00:00:00.000Z");
    firstRecord.updatedAt = new Date("2026-07-02T00:00:00.000Z");
    secondRecord.createdAt = new Date("2026-08-01T00:00:00.000Z");
    secondRecord.updatedAt = new Date("2026-08-02T00:00:00.000Z");

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?createdFrom=2026-07-01T00:00:00Z&createdTo=2026-07-31T00:00:00Z&updatedFrom=2026-07-01T00:00:00Z&updatedTo=2026-07-31T00:00:00Z",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].publicId).toBe(first.publicId);
  });

  test("lists requests with combined filters", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const match = await createRequest(
      api,
      validCreateRequestBody({
        type: "DATA_ACCESS",
        requester: { email: "match@example.com", phone: "+13055550000" },
      }),
    );
    const miss = await createRequest(
      api,
      validCreateRequestBody({
        type: "DATA_ACCESS",
        requester: { email: "miss@example.com", phone: "+13055551111" },
      }),
    );
    dependencies.state.requests.find((item) => item.id === match.id)!.status =
      "PROCESSING";
    dependencies.state.requests.find((item) => item.id === miss.id)!.status =
      "PROCESSING";

    const response = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?status=PROCESSING&type=DATA_ACCESS&email=match@example.com",
      ),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.requests).toHaveLength(1);
    expect(body.requests[0].publicId).toBe(match.publicId);
  });

  test("uses stable cursor pagination without duplicates", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    await createRequest(api);
    await createRequest(api);
    await createRequest(api);

    const firstResponse = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests?limit=2"),
    );
    const firstBody = await firstResponse.json();
    const secondResponse = await api.list(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests?limit=2&cursor=${encodeURIComponent(
          firstBody.pagination.nextCursor,
        )}`,
      ),
    );
    const secondBody = await secondResponse.json();

    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    expect(firstBody.requests).toHaveLength(2);
    expect(firstBody.pagination.nextCursor).toEqual(expect.any(String));
    expect(secondBody.requests).toHaveLength(1);
    expect(
      new Set(
        [...firstBody.requests, ...secondBody.requests].map(
          (request) => request.id,
        ),
      ).size,
    ).toBe(3);
  });

  test("returns 400 for invalid cursor and invalid date ranges", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const invalidCursor = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?cursor=not-a-cursor",
      ),
    );
    const invalidCreatedRange = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?createdFrom=2026-07-31T00:00:00Z&createdTo=2026-07-01T00:00:00Z",
      ),
    );
    const invalidUpdatedRange = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?updatedFrom=2026-07-31T00:00:00Z&updatedTo=2026-07-01T00:00:00Z",
      ),
    );

    expect(invalidCursor.status).toBe(400);
    expect(invalidCreatedRange.status).toBe(400);
    expect(invalidUpdatedRange.status).toBe(400);
  });

  test("returns 400 for invalid list filters", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const invalidType = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests?type=BAD"),
    );
    const invalidStatus = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?status=NOT_REAL",
      ),
    );
    const invalidDate = await api.list(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests?createdFrom=tomorrow",
      ),
    );
    const invalidLimit = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests?limit=500"),
    );

    expect(invalidType.status).toBe(400);
    expect(invalidStatus.status).toBe(400);
    expect(invalidDate.status).toBe(400);
    expect(invalidLimit.status).toBe(400);
  });

  test("list response excludes PII and returns safe source metadata only", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);

    await createRequest(api);
    dependencies.state.requests[0]!.mutableData = {
      processorReference: "job-12345",
    };

    const response = await api.list(
      authenticatedRequest("https://magictrust.test/api/v1/requests"),
    );
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("+13055551234");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("submittedData");
    expect(serialized).not.toContain("submittedDataEncrypted");
    expect(serialized).not.toContain("submittedDataHash");
    expect(serialized).not.toContain("mutableData");
    expect(serialized).not.toContain("job-12345");
    expect(body.requests[0].source).toEqual({
      channel: "API",
      siteKey: "test-site",
      formKey: "manual-api",
    });
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

  test("returns 401 for unauthorized mutable data update", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.updateMutableData(
      new Request("https://magictrust.test/api/v1/requests/req_test/data", {
        method: "PATCH",
        body: JSON.stringify(validMutableDataBody()),
      }),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("returns 404 when updating mutable data for a missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.updateMutableData(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/data",
        {
          method: "PATCH",
          body: JSON.stringify(validMutableDataBody()),
        },
      ),
      "req_missing",
    );

    expect(response.status).toBe(404);
  });

  test("merges mutable data and preserves existing keys", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(
            validMutableDataBody({
              data: {
                processorReference: "job-12345",
                matchedSystems: ["Vector"],
              },
            }),
          ),
        },
      ),
      created.publicId,
    );
    const response = await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(
            validMutableDataBody({
              data: {
                resolutionCode: "DATA_EXPORT_READY",
              },
            }),
          ),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(200);
    expect(body.request.mutableData).toEqual({
      processorReference: "job-12345",
      matchedSystems: ["Vector"],
      resolutionCode: "DATA_EXPORT_READY",
    });
    expect(body.request.updatedAt).toEqual(expect.any(String));
    expect(detail.mutableData).toEqual(body.request.mutableData);
    expect(detail.submittedData).toBeUndefined();
  });

  test("mutable data update never modifies submitted data", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const originalSubmittedData = structuredClone(
      dependencies.state.requests[0]!.submittedData,
    );

    await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(validMutableDataBody()),
        },
      ),
      created.publicId,
    );

    expect(dependencies.state.requests[0]!.submittedData).toEqual(
      originalSubmittedData,
    );
  });

  test("rejects dangerous mutable data keys", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: '{"data":{"safe":{"__proto__":{"polluted":true}}},"actor":{"type":"API_CLIENT","id":"privacy-processor"}}',
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
    expect(dependencies.state.requests[0]!.mutableData).toEqual({});
  });

  test("creates a REQUEST_DATA_UPDATED event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(validMutableDataBody()),
        },
      ),
      created.publicId,
    );
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(200);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REQUEST_DATA_UPDATED",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: {
            changedKeys: [
              "processorReference",
              "matchedSystems",
              "resolutionCode",
            ],
            reason: "Processor added resolution metadata",
            actor: {
              type: "API_CLIENT",
              id: "privacy-processor",
            },
          },
        }),
      ]),
    );
    expect(JSON.stringify(detail.events)).not.toContain("job-12345");
    expect(JSON.stringify(detail.events)).not.toContain("DATA_EXPORT_READY");
  });

  test("returns 401 for unauthorized custom event", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.addCustomEvent(
      new Request("https://magictrust.test/api/v1/requests/req_test/events", {
        method: "POST",
        body: JSON.stringify(validCustomEventBody()),
      }),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("returns 404 when adding a custom event to a missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.addCustomEvent(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/events",
        {
          method: "POST",
          body: JSON.stringify(validCustomEventBody()),
        },
      ),
      "req_missing",
    );

    expect(response.status).toBe(404);
  });

  test("creates a valid internal custom event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(validCustomEventBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.event).toMatchObject({
      type: "DATA_EXPORT_GENERATED",
      category: "CUSTOM",
      customType: "DATA_EXPORT_GENERATED",
      visibility: "INTERNAL",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      data: {
        system: "Vector",
        processorReference: "job-99999",
      },
    });
    expect(detail.events).toEqual([
      expect.objectContaining({
        type: "DATA_EXPORT_GENERATED",
        category: "CUSTOM",
        customType: "DATA_EXPORT_GENERATED",
        visibility: "INTERNAL",
      }),
      expect.objectContaining({
        type: "REQUEST_CREATED",
      }),
    ]);
  });

  test("creates a valid public custom event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(validCustomEventBody({ visibility: "PUBLIC" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.event.visibility).toBe("PUBLIC");
    expect(body.event.type).toBe("DATA_EXPORT_GENERATED");
  });

  test.each(["data_export", "1_BAD", "NO", "BAD-NAME"])(
    "rejects invalid custom event name %s",
    async (type) => {
      const dependencies = createInMemoryDependencies();
      const api = createInternalRequestApi(dependencies);
      const created = await createRequest(api);

      const response = await api.addCustomEvent(
        authenticatedRequest(
          `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
          {
            method: "POST",
            body: JSON.stringify(validCustomEventBody({ type })),
          },
        ),
        created.publicId,
      );

      expect(response.status).toBe(400);
    },
  );

  test("rejects reserved built-in event names", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(
            validCustomEventBody({ type: "REQUEST_CREATED" }),
          ),
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("rejects dangerous custom event data keys", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: '{"type":"DATA_EXPORT_GENERATED","visibility":"INTERNAL","data":{"safe":{"constructor":{"polluted":true}}},"actor":{"type":"API_CLIENT","id":"privacy-processor"}}',
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
    expect(dependencies.state.events).toHaveLength(1);
  });

  test("rejects custom event data larger than 16 KB", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(
            validCustomEventBody({
              data: {
                oversized: "x".repeat(17 * 1024),
              },
            }),
          ),
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("custom event does not modify status or mutable data", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    await api.updateMutableData(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/data`,
        {
          method: "PATCH",
          body: JSON.stringify(validMutableDataBody()),
        },
      ),
      created.publicId,
    );
    const mutableData = structuredClone(
      dependencies.state.requests[0]!.mutableData,
    );

    const response = await api.addCustomEvent(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/events`,
        {
          method: "POST",
          body: JSON.stringify(validCustomEventBody()),
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(201);
    expect(dependencies.state.requests[0]!.status).toBe("SUBMITTED");
    expect(dependencies.state.requests[0]!.mutableData).toEqual(mutableData);
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

  test("returns 401 for unauthorized attachment creation", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.addAttachment(
      new Request(
        "https://magictrust.test/api/v1/requests/req_test/attachments",
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody()),
        },
      ),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("creates a public attachment and event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody({ visibility: "PUBLIC" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.attachment).toMatchObject({
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 12345,
      storageProvider: "manual",
      storageKey: "manual/data-export.json",
      checksum: "sha256-placeholder",
      actorType: "API_CLIENT",
    });
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PUBLIC_ATTACHMENT_ADDED",
          data: expect.objectContaining({
            attachmentId: body.attachment.id,
            visibility: "PUBLIC",
          }),
        }),
      ]),
    );
  });

  test("creates an internal attachment and event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.addAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody({ visibility: "INTERNAL" })),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.attachment.visibility).toBe("INTERNAL");
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "INTERNAL_ATTACHMENT_ADDED",
        }),
      ]),
    );
  });

  test("GET detail includes attachments with visibility", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.addAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody({ visibility: "PUBLIC" })),
        },
      ),
      created.publicId,
    );

    const detail = await getRequestDetail(api, created.publicId);

    expect(detail.attachments).toEqual([
      expect.objectContaining({
        visibility: "PUBLIC",
        fileName: "data-export.json",
      }),
    ]);
  });

  test("returns 404 when adding attachment to missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());

    const response = await api.addAttachment(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/attachments",
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody()),
        },
      ),
      "req_missing",
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("returns 401 for unauthorized attachment upload", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.uploadAttachment(
      new Request(
        "https://magictrust.test/api/v1/requests/req_test/attachments/upload",
        {
          method: "POST",
          body: validUploadFormData(),
        },
      ),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("requires a file for attachment upload", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const formData = validUploadFormData();
    formData.delete("file");

    const response = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: formData,
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("rejects invalid upload visibility", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const formData = validUploadFormData({ visibility: "PRIVATE" });

    const response = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: formData,
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("rejects unsupported upload MIME types", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const formData = validUploadFormData({
      file: new File(["hello"], "image.png", { type: "image/png" }),
    });

    const response = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: formData,
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("rejects upload files larger than 10 MB", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const formData = validUploadFormData({
      file: new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.json", {
        type: "application/json",
      }),
    });

    const response = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: formData,
        },
      ),
      created.publicId,
    );

    expect(response.status).toBe(400);
  });

  test("uploads a file, creates attachment metadata, and creates an event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.uploadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/upload`,
        {
          method: "POST",
          body: validUploadFormData(),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(body.attachment).toMatchObject({
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 11,
      storageProvider: "vercel-blob",
      checksum: "sha256-test-checksum",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
    });
    expect(body.attachment.storageKey).toMatch(
      /^requests\/req_.+\/attachments\/.+-data-export\.json$/,
    );
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PUBLIC_ATTACHMENT_ADDED",
          data: expect.objectContaining({
            attachmentId: body.attachment.id,
            storageProvider: "vercel-blob",
          }),
        }),
      ]),
    );
  });

  test("returns 401 for unauthorized attachment download", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.downloadAttachment(
      new Request(
        "https://magictrust.test/api/v1/requests/req_test/attachments/attachment-1/download",
      ),
      "req_test",
      "attachment-1",
    );

    expect(response.status).toBe(401);
  });

  test("returns 404 when downloading from a missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.downloadAttachment(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/attachments/attachment-1/download",
      ),
      "req_missing",
      "attachment-1",
    );

    expect(response.status).toBe(404);
  });

  test("returns 404 when downloading a missing attachment", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.downloadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/attachment-missing/download`,
      ),
      created.publicId,
      "attachment-missing",
    );

    expect(response.status).toBe(404);
  });

  test("returns 404 when downloading an attachment from another request", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const firstRequest = await createRequest(api);
    const secondRequest = await createRequest(api);
    const attachment = await createUploadedAttachment(
      api,
      firstRequest.publicId,
    );

    const response = await api.downloadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${secondRequest.publicId}/attachments/${attachment.id}/download`,
      ),
      secondRequest.publicId,
      attachment.id,
    );

    expect(response.status).toBe(404);
  });

  test("downloads attachment file content", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const attachment = await createUploadedAttachment(api, created.publicId);

    const response = await api.downloadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/${attachment.id}/download`,
      ),
      created.publicId,
      attachment.id,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="data-export.json"',
    );
    expect(await response.text()).toBe('{"ok":true}');
  });

  test("creates an ATTACHMENT_DOWNLOADED event after successful download", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    const attachment = await createUploadedAttachment(api, created.publicId);

    const response = await api.downloadAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments/${attachment.id}/download?actorId=privacy-processor`,
      ),
      created.publicId,
      attachment.id,
    );
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(200);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ATTACHMENT_DOWNLOADED",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: expect.objectContaining({
            attachmentId: attachment.id,
            fileName: "data-export.json",
            storageProvider: "vercel-blob",
          }),
        }),
      ]),
    );
  });

  test("returns 401 for unauthorized email communication", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.sendEmailCommunication(
      new Request(
        "https://magictrust.test/api/v1/requests/req_test/communications/email",
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("returns 404 when sending email for a missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.sendEmailCommunication(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/communications/email",
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      "req_missing",
    );

    expect(response.status).toBe(404);
  });

  test("sends an email communication", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.communication).toMatchObject({
      channel: "EMAIL",
      direction: "OUTBOUND",
      recipientMasked: "j***n@example.com",
      subject: "Your MagicTrust request was updated",
      provider: "resend",
      providerMessageId: "email-message-1",
      status: "SENT",
      errorMessage: null,
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
    });
    expect(body.communication.body).toBeUndefined();
    expect(body.communication.recipient).toBeUndefined();
    expect(body.communication.recipientEncrypted).toBeUndefined();
    expect(body.communication.recipientHash).toBeUndefined();
    expect(body.communication.sentAt).toEqual(expect.any(String));
    expect(dependencies.state.communications[0]?.recipient).toBeNull();
    expect(dependencies.state.communications[0]?.recipientEncrypted).toEqual(
      expect.any(String),
    );
    expect(dependencies.state.communications[0]?.recipientHash).toBe(
      hashPii("john@example.com"),
    );
  });

  test("marks an email communication as failed when provider send fails", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.communication).toMatchObject({
      status: "FAILED",
      provider: "resend",
      providerMessageId: null,
      errorMessage: "Email provider failed to send the message.",
    });
    expect(body.communication.body).toBeUndefined();
    expect(body.communication.sentAt).toBeNull();
  });

  test("creates an EMAIL_SENT event", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "EMAIL_SENT",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: expect.objectContaining({
            communicationId: body.communication.id,
            provider: "resend",
            providerMessageId: "email-message-1",
            status: "SENT",
          }),
        }),
      ]),
    );
  });

  test("creates an EMAIL_FAILED event", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(502);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "EMAIL_FAILED",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: expect.objectContaining({
            communicationId: body.communication.id,
            provider: "resend",
            status: "FAILED",
          }),
        }),
      ]),
    );
  });

  test("GET detail includes communication metadata", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );

    const detail = await getRequestDetail(api, created.publicId);

    expect(detail.communications).toEqual([
      expect.objectContaining({
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipientMasked: "j***n@example.com",
        subject: "Your MagicTrust request was updated",
        provider: "resend",
        status: "SENT",
      }),
    ]);
    expect(detail.communications[0].body).toBeUndefined();
    expect(detail.communications[0].recipient).toBeUndefined();
    expect(detail.communications[0].recipientEncrypted).toBeUndefined();
    expect(detail.communications[0].recipientHash).toBeUndefined();
  });

  test("fetches request detail with communications after email send using the same API key", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const createResponse = await api.create(
      authenticatedRequest("https://magictrust.test/api/v1/requests", {
        method: "POST",
        body: JSON.stringify(validCreateRequestBody()),
      }),
    );
    const created = (await createResponse.json()).request;

    const emailResponse = await api.sendEmailCommunication(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/communications/email`,
        {
          method: "POST",
          body: JSON.stringify(validEmailCommunicationBody()),
        },
      ),
      created.publicId,
    );
    const detailResponse = await api.get(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}`,
      ),
      created.publicId,
    );
    const detail = await detailResponse.json();

    expect(createResponse.status).toBe(201);
    expect(emailResponse.status).toBe(201);
    expect(detailResponse.status).toBe(200);
    expect(detail.request.communications).toEqual([
      expect.objectContaining({
        channel: "EMAIL",
        direction: "OUTBOUND",
        provider: "resend",
        status: "SENT",
      }),
    ]);
  });

  test("returns 401 for unauthorized consumer notification", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.sendConsumerNotification(
      new Request(
        "https://magictrust.test/api/v1/requests/req_test/notifications",
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      "req_test",
    );

    expect(response.status).toBe(401);
  });

  test("returns 404 when notifying a missing request", async () => {
    const api = createInternalRequestApi(createInMemoryDependencies());
    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        "https://magictrust.test/api/v1/requests/req_missing/notifications",
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      "req_missing",
    );

    expect(response.status).toBe(404);
  });

  test("sends a successful update notification", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.communication).toMatchObject({
      channel: "EMAIL",
      direction: "OUTBOUND",
      recipientMasked: "j***n@example.com",
      provider: "resend",
      providerMessageId: "email-message-1",
      status: "SENT",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
    });
    expect(body.communication.body).toBeUndefined();
    expect(dependencies.state.sentEmails.at(-1)).toMatchObject({
      to: "john@example.com",
      subject: `MagicTrust request updated: ${created.publicId}`,
    });
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      "Your request is currently being processed.",
    );
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      `Reference number: ${created.publicId}`,
    );
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      "Current status: SUBMITTED",
    );
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      `Track your request: https://magictrust.test/requests/${created.publicId}`,
    );
  });

  test("marks a consumer notification as failed when provider send fails", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body.communication).toMatchObject({
      status: "FAILED",
      provider: "resend",
      providerMessageId: null,
      errorMessage: "Email provider failed to send the notification.",
    });
  });

  test("FILE_AVAILABLE creates a hashed access token and includes secure link", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(
            validNotificationBody({
              type: "FILE_AVAILABLE",
              message: "A file is available for your request.",
            }),
          ),
        },
      ),
      created.publicId,
    );
    const email = dependencies.state.sentEmails.at(-1);
    const token = extractAccessTokenFromEmail(email);

    expect(response.status).toBe(201);
    expect(dependencies.state.accessTokens).toHaveLength(1);
    expect(dependencies.state.accessTokens[0]?.tokenHash).not.toBe(token);
    expect(dependencies.state.accessTokens[0]?.tokenHash).toBe(
      hashAccessToken(token),
    );
    expect(email?.body).toContain(
      `Secure access link: https://magictrust.test/requests/${created.publicId}/access?token=`,
    );
  });

  test("consumer notification does not modify request status", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(
            validNotificationBody({ type: "REQUEST_COMPLETED" }),
          ),
        },
      ),
      created.publicId,
    );
    const detail = await getRequestDetail(api, created.publicId);

    expect(detail.status).toBe("SUBMITTED");
  });

  test("consumer notification creates communication and audit events", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(
            validNotificationBody({ type: "REQUEST_REJECTED" }),
          ),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(201);
    expect(detail.communications).toEqual([
      expect.objectContaining({
        id: body.communication.id,
        status: "SENT",
        subject: `MagicTrust request rejected: ${created.publicId}`,
      }),
    ]);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CONSUMER_NOTIFICATION_SENT",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: {
            notificationType: "REQUEST_REJECTED",
            communicationId: body.communication.id,
            actor: {
              type: "API_CLIENT",
              id: "privacy-processor",
            },
          },
        }),
      ]),
    );
  });

  test("failed consumer notification creates audit event", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);

    const response = await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(validNotificationBody()),
        },
      ),
      created.publicId,
    );
    const body = await response.json();
    const detail = await getRequestDetail(api, created.publicId);

    expect(response.status).toBe(502);
    expect(detail.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CONSUMER_NOTIFICATION_FAILED",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: {
            notificationType: "REQUEST_UPDATED",
            communicationId: body.communication.id,
            actor: {
              type: "API_CLIENT",
              id: "privacy-processor",
            },
          },
        }),
      ]),
    );
  });

  test("notification email does not expose internal comments or attachment internals", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createInternalRequestApi(dependencies);
    const created = await createRequest(api);
    await api.addComment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/comments`,
        {
          method: "POST",
          body: JSON.stringify(validCommentBody({ visibility: "INTERNAL" })),
        },
      ),
      created.publicId,
    );
    await api.addAttachment(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify(validAttachmentBody({ visibility: "INTERNAL" })),
        },
      ),
      created.publicId,
    );

    await api.sendConsumerNotification(
      authenticatedRequest(
        `https://magictrust.test/api/v1/requests/${created.publicId}/notifications`,
        {
          method: "POST",
          body: JSON.stringify(
            validNotificationBody({
              type: "FILE_AVAILABLE",
              message: "A public file is available.",
            }),
          ),
        },
      ),
      created.publicId,
    );
    const emailBody = dependencies.state.sentEmails.at(-1)?.body ?? "";

    expect(emailBody).not.toContain("Your request is being processed.");
    expect(emailBody).not.toContain("manual/data-export.json");
    expect(emailBody).not.toContain("sha256-placeholder");
    expect(emailBody).not.toContain("INTERNAL");
  });
});

function authenticatedRequest(input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("x-api-key", apiKey);

  if (init.method && init.method !== "GET" && !headers.has("Idempotency-Key")) {
    headers.set("Idempotency-Key", `test-idempotency-${idempotencyCounter++}`);
  }

  if (!(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

  return new Request(input, {
    ...init,
    headers,
  });
}

function validCreateRequestBody(
  overrides: {
    type?: string;
    requester?: {
      email?: string;
      phone?: string;
    };
  } = {},
) {
  return {
    type: overrides.type ?? "DATA_ACCESS",
    requester: {
      firstName: "John",
      lastName: "Doe",
      email: overrides.requester?.email ?? "john@example.com",
      phone: overrides.requester?.phone ?? "+13055551234",
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

function validMutableDataBody(
  overrides: {
    data?: Record<string, unknown>;
  } = {},
) {
  return {
    data: overrides.data ?? {
      processorReference: "job-12345",
      matchedSystems: ["Vector", "Console"],
      resolutionCode: "DATA_EXPORT_READY",
    },
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
    reason: "Processor added resolution metadata",
  };
}

function validCustomEventBody(
  overrides: {
    type?: string;
    visibility?: "INTERNAL" | "PUBLIC";
    data?: Record<string, unknown>;
  } = {},
) {
  return {
    type: overrides.type ?? "DATA_EXPORT_GENERATED",
    visibility: overrides.visibility ?? "INTERNAL",
    data: overrides.data ?? {
      system: "Vector",
      processorReference: "job-99999",
    },
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
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

function validAttachmentBody(overrides: { visibility?: string } = {}) {
  return {
    visibility: overrides.visibility ?? "PUBLIC",
    fileName: "data-export.json",
    mimeType: "application/json",
    sizeBytes: 12345,
    storageProvider: "manual",
    storageKey: "manual/data-export.json",
    checksum: "sha256-placeholder",
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
  };
}

function validEmailCommunicationBody() {
  return {
    to: "john@example.com",
    subject: "Your MagicTrust request was updated",
    body: "Your request has been updated.",
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
  };
}

function validNotificationBody(
  overrides: {
    type?:
      | "REQUEST_UPDATED"
      | "REQUEST_COMPLETED"
      | "REQUEST_REJECTED"
      | "FILE_AVAILABLE";
    message?: string;
  } = {},
) {
  return {
    type: overrides.type ?? "REQUEST_UPDATED",
    message: overrides.message ?? "Your request is currently being processed.",
    actor: {
      type: "API_CLIENT",
      id: "privacy-processor",
    },
  };
}

function validUploadFormData(
  overrides: {
    visibility?: string;
    file?: File;
  } = {},
) {
  const formData = new FormData();
  formData.set(
    "file",
    overrides.file ??
      new File([JSON.stringify({ ok: true })], "data export.json", {
        type: "application/json",
      }),
  );
  formData.set("visibility", overrides.visibility ?? "PUBLIC");
  formData.set("actorType", "API_CLIENT");
  formData.set("actorId", "privacy-processor");

  return formData;
}

async function createRequest(
  api: ReturnType<typeof createInternalRequestApi>,
  requestBody: ReturnType<
    typeof validCreateRequestBody
  > = validCreateRequestBody(),
) {
  const response = await api.create(
    authenticatedRequest("https://magictrust.test/api/v1/requests", {
      method: "POST",
      body: JSON.stringify(requestBody),
    }),
  );
  const responseBody = await response.json();

  return responseBody.request;
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

function extractAccessTokenFromEmail(
  email: { body: string } | undefined,
): string {
  const token = email?.body.match(/\/access\?token=([A-Za-z0-9_-]+)/)?.[1];

  if (!token) {
    throw new Error("Expected secure access token in email body.");
  }

  return token;
}

async function createUploadedAttachment(
  api: ReturnType<typeof createInternalRequestApi>,
  requestId: string,
) {
  const response = await api.uploadAttachment(
    authenticatedRequest(
      `https://magictrust.test/api/v1/requests/${requestId}/attachments/upload`,
      {
        method: "POST",
        body: validUploadFormData(),
      },
    ),
    requestId,
  );
  const body = await response.json();

  return body.attachment;
}

function createInMemoryDependencies(
  options: {
    emailShouldFail?: boolean;
    appEnv?: string;
    clientActive?: boolean;
    dbKeyEnabled?: boolean;
    keyActive?: boolean;
    keyExpiresAt?: Date | null;
    scopes?: ApiClientScope[];
  } = {},
) {
  const apiClientKey = {
    keyPrefix: getApiKeyPrefix(apiKey),
    keyHash: hashApiKey(apiKey),
    active: options.keyActive ?? true,
    expiresAt: options.keyExpiresAt ?? null,
    lastUsedAt: null as Date | null,
  };
  const apiClient = {
    id: apiClientId,
    name: "Privacy Processor",
    active: options.clientActive ?? true,
    scopes: options.scopes ?? [...apiClientScopesList],
  };
  const state = {
    nextId: 1,
    apiClient,
    apiClientKey,
    requesters: [] as Requester[],
    requesterEmailEncrypted: new Map<string, string | null>(),
    requesterPhoneEncrypted: new Map<string, string | null>(),
    requesterNameEncrypted: new Map<string, string | null>(),
    requesterEmailHash: new Map<string, string | null>(),
    requesterPhoneHash: new Map<string, string | null>(),
    requests: [] as PrivacyRequest[],
    events: [] as RequestEvent[],
    comments: [] as RequestComment[],
    attachments: [] as RequestAttachment[],
    communications: [] as RequestCommunication[],
    accessTokens: [] as RequestAccessToken[],
    idempotencyRecords: [] as ApiIdempotencyRecord[],
    sentEmails: [] as Array<{ to: string; subject: string; body: string }>,
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
          state.requesterEmailEncrypted.set(requester.id, data.emailEncrypted);
          state.requesterPhoneEncrypted.set(requester.id, data.phoneEncrypted);
          state.requesterNameEncrypted.set(requester.id, data.nameEncrypted);
          state.requesterEmailHash.set(requester.id, data.emailHash);
          state.requesterPhoneHash.set(requester.id, data.phoneHash);

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
    async listActiveAssignableAdminUsers() {
      return [];
    },
    async findAdminUsersByIds() {
      return [];
    },
    async assignRequest() {
      return { ok: false, code: "NOT_FOUND" };
    },
    async unassignRequest() {
      return { ok: false, code: "NOT_FOUND" };
    },
    async setRequestDueDate() {
      return { ok: false, code: "NOT_FOUND" };
    },
    async clearRequestDueDate() {
      return { ok: false, code: "NOT_FOUND" };
    },
    async transitionToProcessing() {
      return { ok: false, code: "NOT_FOUND" };
    },
    async findAdminSensitiveData(publicId) {
      const request = state.requests.find((item) => item.publicId === publicId);

      return request
        ? {
            requestId: request.id,
            requesterEmailEncrypted:
              state.requesterEmailEncrypted.get(request.requesterId) ?? null,
            requesterPhoneEncrypted:
              state.requesterPhoneEncrypted.get(request.requesterId) ?? null,
            requesterNameEncrypted:
              state.requesterNameEncrypted.get(request.requesterId) ?? null,
            submittedDataEncrypted: request.submittedDataEncrypted,
          }
        : null;
    },
    async findByIdOrPublicId(id: string): Promise<RequestDetails | null> {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      return {
        ...summaryFromRequest(request),
        mutableData: request.mutableData,
        events: state.events
          .filter((event) => event.privacyRequestId === request.id)
          .map((event) => ({
            id: event.id,
            privacyRequestId: event.privacyRequestId,
            type: event.type,
            category: event.category ?? "BUILT_IN",
            customType: event.customType ?? null,
            visibility: event.visibility ?? "INTERNAL",
            actorType: event.actorType,
            actorId: event.actorId,
            data: event.data,
            createdAt: event.createdAt,
          })),
        comments: state.comments
          .filter((comment) => comment.requestId === request.id)
          .map((comment) => ({ ...comment })),
        attachments: state.attachments
          .filter((attachment) => attachment.requestId === request.id)
          .map((attachment) => ({ ...attachment })),
        communications: state.communications
          .filter((communication) => communication.requestId === request.id)
          .map((communication) => ({ ...communication })),
      };
    },
    async findConsumerAccessLinkTarget() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async findConsumerNotificationTarget(id) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      return {
        ...summaryFromRequest(request),
        requesterEmailEncrypted:
          state.requesterEmailEncrypted.get(request.requesterId) ?? null,
      };
    },
    async list(filters: RequestListFilters) {
      const rows = state.requests
        .filter((request) =>
          filters.publicId ? request.publicId === filters.publicId : true,
        )
        .filter((request) =>
          filters.statuses ? filters.statuses.includes(request.status) : true,
        )
        .filter((request) =>
          filters.types ? filters.types.includes(request.type) : true,
        )
        .filter((request) =>
          filters.emailHash
            ? state.requesterEmailHash.get(request.requesterId) ===
              filters.emailHash
            : true,
        )
        .filter((request) =>
          filters.phoneHash
            ? state.requesterPhoneHash.get(request.requesterId) ===
              filters.phoneHash
            : true,
        )
        .filter((request) =>
          filters.createdFrom ? request.createdAt >= filters.createdFrom : true,
        )
        .filter((request) =>
          filters.createdTo ? request.createdAt < filters.createdTo : true,
        )
        .filter((request) =>
          filters.updatedFrom ? request.updatedAt >= filters.updatedFrom : true,
        )
        .filter((request) =>
          filters.updatedTo ? request.updatedAt < filters.updatedTo : true,
        )
        .filter((request) =>
          filters.cursor
            ? request.createdAt < filters.cursor.createdAt ||
              (request.createdAt.getTime() ===
                filters.cursor.createdAt.getTime() &&
                request.id < filters.cursor.id)
            : true,
        )
        .sort((left, right) => {
          const createdDiff =
            right.createdAt.getTime() - left.createdAt.getTime();

          return createdDiff === 0
            ? right.id.localeCompare(left.id)
            : createdDiff;
        });
      const pageRows = rows.slice(0, filters.limit);
      const last = pageRows.at(-1);

      return {
        requests: pageRows.map(summaryFromRequest),
        nextCursor:
          rows.length > filters.limit && last
            ? {
                createdAt: last.createdAt,
                id: last.id,
              }
            : null,
      };
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
    async updateMutableData(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const now = new Date(Date.UTC(2026, 0, state.nextId++));
      request.mutableData = {
        ...request.mutableData,
        ...input.data,
      };
      request.updatedAt = now;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "REQUEST_DATA_UPDATED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          changedKeys: Object.keys(input.data),
          reason: input.reason,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return {
        mutableData: request.mutableData,
        updatedAt: request.updatedAt,
      };
    },
    async addCustomEvent(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const event = {
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "CUSTOM_EVENT" as const,
        category: "CUSTOM" as const,
        customType: input.customType,
        visibility: input.visibility,
        actorType: input.actorType,
        actorId: input.actorId,
        data: input.data,
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      };
      state.events.unshift(event);

      return event;
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
    async addAttachment(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const attachment = {
        id: `attachment-${state.nextId++}`,
        requestId: request.id,
        visibility: input.visibility,
        fileName: input.fileName,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        storageProvider: input.storageProvider,
        storageKey: input.storageKey,
        checksum: input.checksum,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      };
      state.attachments.push(attachment);
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type:
          input.visibility === "PUBLIC"
            ? "PUBLIC_ATTACHMENT_ADDED"
            : "INTERNAL_ATTACHMENT_ADDED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          attachmentId: attachment.id,
          visibility: input.visibility,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          storageProvider: input.storageProvider,
          storageKey: input.storageKey,
          checksum: input.checksum,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return attachment;
    },
    async recordAttachmentDownloaded(requestId, input) {
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "ATTACHMENT_DOWNLOADED",
        actorType: "API_CLIENT",
        actorId: input.actorId,
        data: {
          attachmentId: input.attachmentId,
          fileName: input.fileName,
          storageProvider: input.storageProvider,
          actor: {
            type: "API_CLIENT",
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });
    },
    async recordAdminAttachmentDownloaded(requestId, input) {
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "ADMIN_ATTACHMENT_DOWNLOADED",
        actorType: "ADMIN_USER",
        actorId: input.actorId,
        data: {
          attachmentId: input.attachmentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });
    },
    async createCommunication(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const communication = {
        id: `communication-${state.nextId++}`,
        requestId: request.id,
        channel: "EMAIL" as const,
        direction: "OUTBOUND" as const,
        recipient: null,
        recipientEncrypted: encryptPii(input.recipient),
        recipientHash: hashPii(input.recipient),
        encryptionVersion: 1,
        subject: input.subject,
        body: input.body,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING" as const,
        errorMessage: null,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
        sentAt: null,
      };
      state.communications.push(communication);

      return communication;
    },
    async markCommunicationSent(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      const sentAt = new Date(Date.UTC(2026, 0, state.nextId++));
      communication.status = "SENT";
      communication.providerMessageId = input.providerMessageId;
      communication.errorMessage = null;
      communication.sentAt = sentAt;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_SENT",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId: communication.id,
          provider: communication.provider,
          providerMessageId: input.providerMessageId,
          status: "SENT",
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return { ...communication };
    },
    async markCommunicationFailed(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "FAILED";
      communication.errorMessage = input.errorMessage;
      communication.providerMessageId = null;
      communication.sentAt = null;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_FAILED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId: communication.id,
          provider: communication.provider,
          status: "FAILED",
          errorMessage: input.errorMessage,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return { ...communication };
    },
    async createConsumerAccessToken() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async createConsumerNotificationAccessToken(requestId, input) {
      const request = state.requests.find((item) => item.id === requestId);

      if (!request) {
        return null;
      }

      const accessToken = {
        id: `access-token-${state.nextId++}`,
        requestId: request.id,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      };
      state.accessTokens.push(accessToken);

      return accessToken;
    },
    async recordConsumerAccessLinkSent() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async markConsumerNotificationSent(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      const sentAt = new Date(Date.UTC(2026, 0, state.nextId++));
      communication.status = "SENT";
      communication.providerMessageId = input.providerMessageId;
      communication.errorMessage = null;
      communication.sentAt = sentAt;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "CONSUMER_NOTIFICATION_SENT",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          notificationType: input.notificationType,
          communicationId: communication.id,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return { ...communication };
    },
    async markConsumerNotificationFailed(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "FAILED";
      communication.errorMessage = input.errorMessage;
      communication.providerMessageId = null;
      communication.sentAt = null;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "CONSUMER_NOTIFICATION_FAILED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          notificationType: input.notificationType,
          communicationId: communication.id,
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
      });

      return { ...communication };
    },
    async consumeConsumerAccessToken() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async validateConsumerAccessSession() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async recordConsumerAttachmentDownloaded() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async createIdentityVerificationToken() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async recordIdentityVerificationSent() {
      throw new Error("Not implemented in internal request API tests.");
    },
    async verifyIdentityToken() {
      throw new Error("Not implemented in internal request API tests.");
    },
  };

  const storageProvider: PrivateFileStorageProvider = {
    provider: "vercel-blob",
    async uploadPrivateFile(input) {
      return {
        provider: "vercel-blob",
        storageKey: input.storageKey,
        checksum: "sha256-test-checksum",
      };
    },
    async downloadPrivateFile() {
      return {
        body: new Blob(['{"ok":true}'], {
          type: "application/json",
        }).stream(),
        contentType: "application/json",
        sizeBytes: 11,
      };
    },
  };

  const emailProvider: EmailProvider = {
    provider: "resend",
    async sendEmail(input) {
      if (options.emailShouldFail) {
        throw new Error("Email provider failed to send the message.");
      }

      state.sentEmails.push({
        to: input.to,
        subject: input.subject,
        body: input.body,
      });

      return {
        provider: "resend",
        providerMessageId: "email-message-1",
      };
    },
  };

  return {
    apiKey: legacyApiKey,
    apiClientStore: {
      async authenticateApiKey(
        rawKey: string,
      ): Promise<AuthenticatedApiClient | null> {
        if (options.dbKeyEnabled === false) {
          return null;
        }

        if (!apiClient.active || !apiClientKey.active) {
          return null;
        }

        if (apiClientKey.expiresAt && apiClientKey.expiresAt <= new Date()) {
          return null;
        }

        if (
          getApiKeyPrefix(rawKey) !== apiClientKey.keyPrefix ||
          !verifyApiKey(rawKey, apiClientKey.keyHash)
        ) {
          return null;
        }

        apiClientKey.lastUsedAt = new Date();

        return {
          id: apiClient.id,
          name: apiClient.name,
          keyId: "api-client-key-1",
          scopes: apiClient.scopes,
        };
      },
    },
    appEnv: options.appEnv ?? "development",
    requestCreationStore: creationStore,
    requestRepository,
    idempotencyStore: {
      async findActive(apiClientId, idempotencyKey, now) {
        return (
          state.idempotencyRecords.find(
            (record) =>
              record.apiClientId === apiClientId &&
              record.idempotencyKey === idempotencyKey &&
              record.expiresAt > now,
          ) ?? null
        );
      },
      async create(input) {
        const record = {
          id: `idempotency-${state.nextId++}`,
          ...input,
          createdAt: new Date(Date.UTC(2026, 0, state.nextId++)),
        };
        state.idempotencyRecords.push(record);

        return record;
      },
    } satisfies ApiIdempotencyStore,
    storageProvider,
    emailProvider,
    appBaseUrl: "https://magictrust.test",
    state,
  };
}

function summaryFromRequest(request: PrivacyRequest): RequestSummary {
  return {
    id: request.id,
    publicId: request.publicId,
    requesterId: request.requesterId,
    type: request.type,
    status: request.status,
    source: sourceFromSubmittedData(request.submittedData),
    completedAt: request.completedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}

function sourceFromSubmittedData(request: JsonObject) {
  const source =
    request.source &&
    typeof request.source === "object" &&
    !Array.isArray(request.source)
      ? (request.source as JsonObject)
      : null;

  return source
    ? {
        channel: typeof source.channel === "string" ? source.channel : null,
        siteKey: typeof source.siteKey === "string" ? source.siteKey : null,
        formKey: typeof source.formKey === "string" ? source.formKey : null,
      }
    : null;
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}
