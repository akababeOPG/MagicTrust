import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
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
  RequestDetails,
  RequestListFilters,
  RequestRepository,
  RequestSummary,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import { hashAccessToken } from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { describe, expect, test } from "vitest";

import { createInternalRequestApi } from "../../lib/internal-request-api";

const apiKey = "test-internal-api-key";
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
    expect(statusResponse.status).toBe(200);
    expect(dataResponse.status).toBe(200);
    expect(commentResponse.status).toBe(201);
    expect(attachmentResponse.status).toBe(201);
    expect(uploadResponse.status).toBe(201);
    expect(downloadResponse.status).toBe(200);
    expect(emailResponse.status).toBe(201);
    expect(notificationResponse.status).toBe(201);
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
      recipient: "john@example.com",
      subject: "Your MagicTrust request was updated",
      provider: "resend",
      providerMessageId: "email-message-1",
      status: "SENT",
      errorMessage: null,
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
    });
    expect(body.communication.body).toBeUndefined();
    expect(body.communication.sentAt).toEqual(expect.any(String));
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
        recipient: "john@example.com",
        subject: "Your MagicTrust request was updated",
        provider: "resend",
        status: "SENT",
      }),
    ]);
    expect(detail.communications[0].body).toBeUndefined();
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
      recipient: "john@example.com",
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

  if (!(init.body instanceof FormData)) {
    headers.set("content-type", "application/json");
  }

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
  } = {},
) {
  const state = {
    nextId: 1,
    requesters: [] as Requester[],
    requesterEmailEncrypted: new Map<string, string | null>(),
    requests: [] as PrivacyRequest[],
    events: [] as RequestEvent[],
    comments: [] as RequestComment[],
    attachments: [] as RequestAttachment[],
    communications: [] as RequestCommunication[],
    accessTokens: [] as RequestAccessToken[],
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
        mutableData: request.mutableData,
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
        recipient: input.recipient,
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
    apiKey,
    requestCreationStore: creationStore,
    requestRepository,
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
