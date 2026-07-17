import type {
  JsonObject,
  RequestAttachment,
  RequestComment,
  RequestCommunication,
  RequestEvent,
  RequestAccessToken,
  PrivacyRequest,
} from "@magictrust/domain";
import type {
  RequestDetails,
  RequestListFilters,
  RequestRepository,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import {
  encryptPii,
  encryptSubmittedPayload,
  hashAccessToken,
} from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAdminRequestComment,
  createAdminCustomEvent,
  downloadAdminAttachment,
  getAdminRequestDetail,
  getValidAdminStatusDestinations,
  listAdminRequests,
  parseAdminRequestListSearchParams,
  sendAdminConsumerNotification,
  updateAdminMutableData,
  updateAdminRequestStatus,
  uploadAdminRequestAttachment,
} from "../../lib/admin-dashboard";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-admin-dashboard";

describe("admin dashboard", () => {
  test("filters work correctly", async () => {
    const dependencies = createInMemoryDependencies();
    const params = new URLSearchParams({
      publicId: "req_two",
      type: "DATA_DELETION",
      status: "PROCESSING",
      createdFrom: "2026-07-01T00:00:00.000Z",
      createdTo: "2026-07-31T00:00:00.000Z",
    });

    const result = await listAdminRequests(params, dependencies);

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.requests : []).toEqual([
      expect.objectContaining({
        publicId: "req_two",
        type: "DATA_DELETION",
        status: "PROCESSING",
        source: {
          channel: "FORM",
          siteKey: "magictrust-hosted",
          formKey: "privacy-request",
        },
      }),
    ]);
  });

  test("pagination has no duplicates", async () => {
    const dependencies = createInMemoryDependencies();
    const first = await listAdminRequests(
      new URLSearchParams({ limit: "1" }),
      dependencies,
    );
    expect(first.ok).toBe(true);
    const cursor = first.ok ? first.data.pagination.nextCursor : undefined;

    const second = await listAdminRequests(
      new URLSearchParams({ limit: "1", cursor: cursor ?? "" }),
      dependencies,
    );

    expect(second.ok).toBe(true);
    expect(first.ok ? first.data.requests[0]?.publicId : null).toBe("req_two");
    expect(second.ok ? second.data.requests[0]?.publicId : null).toBe(
      "req_one",
    );
  });

  test("invalid filters show safe validation messages", () => {
    const invalidDate = parseAdminRequestListSearchParams(
      new URLSearchParams({ createdFrom: "not-a-date" }),
    );
    const invalidRange = parseAdminRequestListSearchParams(
      new URLSearchParams({
        createdFrom: "2026-07-31T00:00:00.000Z",
        createdTo: "2026-07-01T00:00:00.000Z",
      }),
    );
    const invalidCursor = parseAdminRequestListSearchParams(
      new URLSearchParams({ cursor: "not-base64" }),
    );

    expect(invalidDate).toEqual({
      ok: false,
      message: "createdFrom must be a valid ISO-8601 datetime.",
    });
    expect(invalidRange).toEqual({
      ok: false,
      message: "createdFrom must be before createdTo.",
    });
    expect(invalidCursor).toEqual({
      ok: false,
      message: "cursor is invalid.",
    });
  });

  test("request not found returns null", async () => {
    const dependencies = createInMemoryDependencies();

    await expect(
      getAdminRequestDetail("req_missing", dependencies),
    ).resolves.toBeNull();
  });

  test("detail hides encrypted fields, hashes, storage keys, and raw recipients", async () => {
    const dependencies = createInMemoryDependencies();
    const detail = await getAdminRequestDetail("req_one", dependencies);
    const serialized = JSON.stringify(detail);

    expect(detail?.communications[0]).toMatchObject({
      recipientMasked: "j***n@example.com",
    });
    expect(serialized).not.toContain("recipientEncrypted");
    expect(serialized).not.toContain("recipientHash");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("checksum");
    expect(serialized).not.toContain("manual/data-export.json");
    expect(serialized).not.toContain("john@example.com");
  });

  test.each(["ADMIN", "OPERATOR"] as const)(
    "%s can view requester identity and the original submission",
    async (role) => {
      const dependencies = createInMemoryDependencies();
      const detail = await getAdminRequestDetail("req_one", dependencies, role);

      expect(detail?.requester).toEqual({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+13055551234",
      });
      expect(detail?.originalSubmission).toMatchObject({
        type: "DATA_ACCESS",
        source: {
          channel: "API",
          siteKey: "test-site",
          formKey: "manual-api",
          sourceUrl: "https://example.com/privacy",
        },
        message: '<script>alert("unsafe")</script> Please process this.',
        submittedData: {
          processorReference: "job-12345",
          nested: { safe: true },
        },
      });
      expect(dependencies.state.sensitiveReads).toBe(1);
    },
  );

  test("VIEWER does not load or decrypt requester identity", async () => {
    const dependencies = createInMemoryDependencies();
    const detail = await getAdminRequestDetail(
      "req_one",
      dependencies,
      "VIEWER",
    );

    expect(detail).not.toHaveProperty("requester");
    expect(detail).not.toHaveProperty("originalSubmission");
    expect(dependencies.state.sensitiveReads).toBe(0);
  });

  test("sensitive admin view excludes ciphertext and unsafe submitted fields", async () => {
    const dependencies = createInMemoryDependencies();
    const detail = await getAdminRequestDetail(
      "req_one",
      dependencies,
      "ADMIN",
    );
    const serialized = JSON.stringify(detail);

    expect(serialized).not.toContain("submittedDataEncrypted");
    expect(serialized).not.toContain("submittedDataHash");
    expect(serialized).not.toContain("encryptionVersion");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("must-not-render");
    expect(serialized).not.toContain("duplicate@example.com");
    expect(serialized).not.toContain("private-token");
  });

  test("viewing sensitive request detail does not modify the request", async () => {
    const dependencies = createInMemoryDependencies();
    const before = JSON.stringify(dependencies.state.requests);
    const eventCount = dependencies.state.events.length;

    await getAdminRequestDetail("req_one", dependencies, "ADMIN");

    expect(JSON.stringify(dependencies.state.requests)).toBe(before);
    expect(dependencies.state.events).toHaveLength(eventCount);
  });

  test("mutable data and timeline render through sanitized detail", async () => {
    const dependencies = createInMemoryDependencies();
    const detail = await getAdminRequestDetail("req_one", dependencies);

    expect(detail?.mutableData).toEqual({
      processorReference: "job-12345",
    });
    expect(detail?.timeline).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "PUBLIC_ATTACHMENT_ADDED",
          actorType: "API_CLIENT",
          actorId: "privacy-processor",
          data: {
            attachmentId: "attachment-one",
            fileName: "data-export.json",
            actor: {
              type: "API_CLIENT",
              id: "privacy-processor",
            },
          },
        }),
      ]),
    );
  });

  test("attachment must belong to the requested record", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await downloadAdminAttachment(
      "req_two",
      "attachment-one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(404);
  });

  test("successful download creates ADMIN_ATTACHMENT_DOWNLOADED", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await downloadAdminAttachment(
      "req_one",
      "attachment-one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="data-export.json"',
    );
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "ADMIN_ATTACHMENT_DOWNLOADED",
          actorType: "ADMIN_USER",
          actorId: "admin-user-1",
          data: {
            attachmentId: "attachment-one",
            fileName: "data-export.json",
            mimeType: "application/json",
            sizeBytes: 11,
          },
        }),
      ]),
    );
  });

  test("normalized detail remains read-only", async () => {
    const dependencies = createInMemoryDependencies();
    const detail = await getAdminRequestDetail("req_one", dependencies);
    const serialized = JSON.stringify(detail);

    expect(serialized).not.toContain("Update status");
    expect(serialized).not.toContain("Add comment");
    expect(serialized).not.toContain("Send email");
    expect(detail).not.toHaveProperty("submittedData");
    expect(detail).not.toHaveProperty("requesterId");
  });

  test("ADMIN can change status and actor id is derived from the admin session", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "Processor picked up the request.",
        actorId: "spoofed-user",
      }),
      "req_one",
      adminSession({ adminUserId: "admin-user-99", role: "ADMIN" }),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.requests[0]?.status).toBe("PROCESSING");
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "STATUS_CHANGED",
          actorType: "ADMIN_USER",
          actorId: "admin-user-99",
          data: {
            previousStatus: "SUBMITTED",
            newStatus: "PROCESSING",
            reason: "Processor picked up the request.",
            actor: {
              type: "ADMIN_USER",
              id: "admin-user-99",
            },
          },
        }),
      ]),
    );
    expect(JSON.stringify(dependencies.state.events)).not.toContain(
      "spoofed-user",
    );
  });

  test("OPERATOR can change status and terminal status sets completedAt", async () => {
    const dependencies = createInMemoryDependencies();

    const response = await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "SUCCESS",
        reason: "Request completed.",
      }),
      "req_one",
      adminSession({ role: "OPERATOR" }),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.requests[0]?.status).toBe("SUCCESS");
    expect(dependencies.state.requests[0]?.completedAt).toBeInstanceOf(Date);
  });

  test("invalid status transition rejected", async () => {
    const dependencies = createInMemoryDependencies();
    dependencies.state.requests[0]!.status = "SUCCESS";

    const response = await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "Reopen request.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "Status+transition+is+not+allowed.",
    );
    expect(dependencies.state.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "STATUS_CHANGED" }),
      ]),
    );
    expect(getValidAdminStatusDestinations("SUCCESS")).toEqual([]);
  });

  test("reason required and length validated", async () => {
    const dependencies = createInMemoryDependencies();
    const missing = await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "   ",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const tooLong = await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "a".repeat(2_001),
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(missing.status).toBe(303);
    expect(tooLong.status).toBe(303);
    expect(dependencies.state.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "STATUS_CHANGED" }),
      ]),
    );
  });

  test("ADMIN can create INTERNAL comment", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await createAdminRequestComment(
      adminFormRequest("comment", {
        visibility: "INTERNAL",
        body: "Internal processing note.",
      }),
      "req_one",
      adminSession({ role: "ADMIN" }),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.comments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          visibility: "INTERNAL",
          body: "Internal processing note.",
          actorType: "ADMIN_USER",
          actorId: "admin-user-1",
        }),
      ]),
    );
  });

  test("OPERATOR can create PUBLIC comment and public visibility remains public only", async () => {
    const dependencies = createInMemoryDependencies();
    await createAdminRequestComment(
      adminFormRequest("comment", {
        visibility: "PUBLIC",
        body: "A public update.",
      }),
      "req_one",
      adminSession({ role: "OPERATOR" }),
      dependencies,
    );
    await createAdminRequestComment(
      adminFormRequest("comment", {
        visibility: "INTERNAL",
        body: "An internal update.",
      }),
      "req_one",
      adminSession({ role: "OPERATOR" }),
      dependencies,
    );

    const publicComments = dependencies.state.comments.filter(
      (comment) => comment.visibility === "PUBLIC",
    );
    const internalComments = dependencies.state.comments.filter(
      (comment) => comment.visibility === "INTERNAL",
    );

    expect(publicComments.map((comment) => comment.body)).toContain(
      "A public update.",
    );
    expect(publicComments.map((comment) => comment.body)).not.toContain(
      "An internal update.",
    );
    expect(internalComments.map((comment) => comment.body)).toContain(
      "An internal update.",
    );
  });

  test("comment body is not duplicated in event data", async () => {
    const dependencies = createInMemoryDependencies();
    await createAdminRequestComment(
      adminFormRequest("comment", {
        visibility: "PUBLIC",
        body: "Do not duplicate this body.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    const event = dependencies.state.events.find(
      (item) => item.type === "PUBLIC_COMMENT_ADDED",
    );

    expect(event?.data).toEqual({
      commentId: expect.any(String),
      visibility: "PUBLIC",
      actor: {
        type: "ADMIN_USER",
        id: "admin-user-1",
      },
    });
    expect(JSON.stringify(event?.data)).not.toContain(
      "Do not duplicate this body.",
    );
  });

  test("status and comment actions do not automatically send email", async () => {
    const dependencies = createInMemoryDependencies();
    await updateAdminRequestStatus(
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "Processor picked up the request.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminRequestComment(
      adminFormRequest("comment", {
        visibility: "PUBLIC",
        body: "Public comment without email.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("malformed and cross-origin submissions rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const malformed = await updateAdminRequestStatus(
      new Request("https://magictrust.test/admin/requests/req_one/status", {
        method: "POST",
        headers: {
          origin: "https://magictrust.test",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const crossOrigin = await createAdminRequestComment(
      adminFormRequest(
        "comment",
        {
          visibility: "PUBLIC",
          body: "Cross origin.",
        },
        "https://attacker.test",
      ),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(malformed.status).toBe(400);
    expect(crossOrigin.status).toBe(403);
  });

  test("duplicate submissions do not create duplicate records", async () => {
    const dependencies = createInMemoryDependencies();
    const statusRequest = () =>
      adminFormRequest("status", {
        newStatus: "PROCESSING",
        reason: "Processor picked up the request.",
      });
    const commentRequest = () =>
      adminFormRequest("comment", {
        visibility: "PUBLIC",
        body: "Duplicate-safe comment.",
      });

    await updateAdminRequestStatus(
      statusRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await updateAdminRequestStatus(
      statusRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminRequestComment(
      commentRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminRequestComment(
      commentRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(
      dependencies.state.events.filter(
        (event) => event.type === "STATUS_CHANGED",
      ),
    ).toHaveLength(1);
    expect(
      dependencies.state.comments.filter(
        (comment) => comment.body === "Duplicate-safe comment.",
      ),
    ).toHaveLength(1);
  });

  test("ADMIN and OPERATOR can upload attachments with session actor identity", async () => {
    const adminDependencies = createInMemoryDependencies();
    const operatorDependencies = createInMemoryDependencies();

    const adminResponse = await uploadAdminRequestAttachment(
      adminUploadRequest(),
      "req_one",
      adminSession({ adminUserId: "admin-upload", role: "ADMIN" }),
      adminDependencies,
    );
    const operatorResponse = await uploadAdminRequestAttachment(
      adminUploadRequest({ fileName: "operator.txt", visibility: "INTERNAL" }),
      "req_one",
      adminSession({ adminUserId: "operator-upload", role: "OPERATOR" }),
      operatorDependencies,
    );

    expect(adminResponse.status).toBe(303);
    expect(operatorResponse.status).toBe(303);
    expect(adminDependencies.state.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "admin-upload.txt",
          visibility: "PUBLIC",
          storageProvider: "vercel-blob",
          checksum: "sha256-uploaded",
          actorType: "ADMIN_USER",
          actorId: "admin-upload",
        }),
      ]),
    );
    expect(operatorDependencies.state.attachments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fileName: "operator.txt",
          visibility: "INTERNAL",
          actorType: "ADMIN_USER",
          actorId: "operator-upload",
        }),
      ]),
    );
  });

  test("file size and MIME validation", async () => {
    const dependencies = createInMemoryDependencies();
    const tooLarge = await uploadAdminRequestAttachment(
      adminUploadRequest({
        file: new File(["x".repeat(10 * 1024 * 1024 + 1)], "large.txt", {
          type: "text/plain",
        }),
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const badMime = await uploadAdminRequestAttachment(
      adminUploadRequest({
        file: new File(["x"], "image.png", { type: "image/png" }),
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(tooLarge.status).toBe(303);
    expect(badMime.status).toBe(303);
    expect(dependencies.state.uploadedFiles).toEqual([]);
  });

  test("upload does not send email or change status and duplicate retry is rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const first = await uploadAdminRequestAttachment(
      adminUploadRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    const duplicate = await uploadAdminRequestAttachment(
      adminUploadRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(first.status).toBe(303);
    expect(duplicate.status).toBe(303);
    expect(dependencies.state.sentEmails).toEqual([]);
    expect(dependencies.state.requests[0]?.status).toBe("SUBMITTED");
    expect(
      dependencies.state.attachments.filter(
        (attachment) => attachment.fileName === "admin-upload.txt",
      ),
    ).toHaveLength(1);
    expect(dependencies.state.uploadedFiles).toHaveLength(1);
  });

  test("cross-origin upload rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await uploadAdminRequestAttachment(
      adminUploadRequest({}, "https://attacker.test"),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(dependencies.state.uploadedFiles).toEqual([]);
  });

  test("standard notification sends email without changing status", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await sendAdminConsumerNotification(
      adminNotificationRequest({
        type: "REQUEST_UPDATED",
        message: "Your request is being reviewed.",
      }),
      "req_one",
      adminSession({ adminUserId: "admin-notify" }),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.sentEmails).toEqual([
      expect.objectContaining({
        to: "john@example.com",
        subject: "MagicTrust request updated: req_one",
        body: expect.stringContaining("Your request is being reviewed."),
      }),
    ]);
    expect(dependencies.state.requests[0]?.status).toBe("SUBMITTED");
    expect(dependencies.state.communications.at(-1)).toMatchObject({
      recipient: null,
      recipientEncrypted: expect.any(String),
      status: "SENT",
      actorType: "ADMIN_USER",
      actorId: "admin-notify",
    });
  });

  test("FILE_AVAILABLE requires a public attachment and creates secure access link", async () => {
    const dependencies = createInMemoryDependencies();
    dependencies.state.attachments.push({
      id: "attachment-internal",
      requestId: "request-one",
      visibility: "INTERNAL",
      fileName: "internal.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      storageProvider: "vercel-blob",
      storageKey: "hidden",
      checksum: "hidden",
      actorType: "ADMIN_USER",
      actorId: "admin-user-1",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
    });

    const missing = await sendAdminConsumerNotification(
      adminNotificationRequest({ type: "FILE_AVAILABLE" }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const internal = await sendAdminConsumerNotification(
      adminNotificationRequest({
        type: "FILE_AVAILABLE",
        attachmentId: "attachment-internal",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const publicResponse = await sendAdminConsumerNotification(
      adminNotificationRequest({
        type: "FILE_AVAILABLE",
        attachmentId: "attachment-one",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(missing.status).toBe(303);
    expect(internal.status).toBe(303);
    expect(publicResponse.status).toBe(303);
    expect(dependencies.state.accessTokens).toEqual([
      expect.objectContaining({
        tokenHash: hashAccessToken("secure-token"),
        usedAt: null,
      }),
    ]);
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      "Secure access link: https://magictrust.test/requests/req_one/access?token=secure-token",
    );
    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      "data-export.json",
    );
    expect(JSON.stringify(dependencies.state.sentEmails.at(-1))).not.toContain(
      "storageKey",
    );
  });

  test("attachment must belong to request for FILE_AVAILABLE", async () => {
    const dependencies = createInMemoryDependencies();
    dependencies.state.attachments.push({
      id: "attachment-other-request",
      requestId: "request-two",
      visibility: "PUBLIC",
      fileName: "other.txt",
      mimeType: "text/plain",
      sizeBytes: 12,
      storageProvider: "vercel-blob",
      storageKey: "hidden",
      checksum: "hidden",
      actorType: "ADMIN_USER",
      actorId: "admin-user-1",
      createdAt: new Date("2026-07-03T00:00:00.000Z"),
    });

    const response = await sendAdminConsumerNotification(
      adminNotificationRequest({
        type: "FILE_AVAILABLE",
        attachmentId: "attachment-other-request",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.accessTokens).toEqual([]);
    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("requester without usable email returns safe error", async () => {
    const dependencies = createInMemoryDependencies({
      requesterEmailEncrypted: null,
    });
    const response = await sendAdminConsumerNotification(
      adminNotificationRequest({ type: "REQUEST_UPDATED" }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "Requester+email+is+unavailable.",
    );
    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("provider failure records failed communication and event", async () => {
    const dependencies = createInMemoryDependencies({ emailShouldFail: true });
    const response = await sendAdminConsumerNotification(
      adminNotificationRequest({ type: "REQUEST_UPDATED" }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.communications.at(-1)).toMatchObject({
      status: "FAILED",
      errorMessage: "Email provider failed to send the notification.",
      recipient: null,
      recipientEncrypted: expect.any(String),
    });
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CONSUMER_NOTIFICATION_FAILED",
          actorType: "ADMIN_USER",
        }),
      ]),
    );
  });

  test("plaintext email and message body are absent from notification audit events", async () => {
    const dependencies = createInMemoryDependencies();
    await sendAdminConsumerNotification(
      adminNotificationRequest({
        type: "REQUEST_UPDATED",
        message: "Sensitive public message body.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    const notificationEvent = dependencies.state.events.find(
      (event) => event.type === "CONSUMER_NOTIFICATION_SENT",
    );

    expect(JSON.stringify(notificationEvent?.data)).not.toContain(
      "john@example.com",
    );
    expect(JSON.stringify(notificationEvent?.data)).not.toContain(
      "Sensitive public message body.",
    );
  });

  test("cross-origin notification rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const response = await sendAdminConsumerNotification(
      adminNotificationRequest(
        { type: "REQUEST_UPDATED" },
        "https://attacker.test",
      ),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("ADMIN and OPERATOR can update mutable data with session actor identity", async () => {
    const adminDependencies = createInMemoryDependencies();
    const operatorDependencies = createInMemoryDependencies();

    const adminResponse = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "Admin added resolution metadata.",
        actorId: "spoofed-user",
      }),
      "req_one",
      adminSession({ adminUserId: "admin-data", role: "ADMIN" }),
      adminDependencies,
    );
    const operatorResponse = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { matchedSystems: ["Vector"] },
        reason: "Operator added matched systems.",
      }),
      "req_one",
      adminSession({ adminUserId: "operator-data", role: "OPERATOR" }),
      operatorDependencies,
    );

    expect(adminResponse.status).toBe(303);
    expect(operatorResponse.status).toBe(303);
    expect(adminDependencies.state.requests[0]?.mutableData).toEqual({
      processorReference: "job-12345",
      resolutionCode: "DATA_EXPORT_READY",
    });
    expect(operatorDependencies.state.requests[0]?.mutableData).toEqual({
      processorReference: "job-12345",
      matchedSystems: ["Vector"],
    });
    expect(adminDependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "REQUEST_DATA_UPDATED",
          actorType: "ADMIN_USER",
          actorId: "admin-data",
          data: {
            changedKeys: ["resolutionCode"],
            reason: "Admin added resolution metadata.",
            actor: {
              type: "ADMIN_USER",
              id: "admin-data",
            },
          },
        }),
      ]),
    );
    expect(JSON.stringify(adminDependencies.state.events)).not.toContain(
      "spoofed-user",
    );
  });

  test("mutable update preserves submitted data and does not send email or change status", async () => {
    const dependencies = createInMemoryDependencies();
    const submittedDataBefore = JSON.stringify(
      dependencies.state.requests[0]?.submittedData,
    );
    const submittedDataEncryptedBefore =
      dependencies.state.requests[0]?.submittedDataEncrypted;

    await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(JSON.stringify(dependencies.state.requests[0]?.submittedData)).toBe(
      submittedDataBefore,
    );
    expect(dependencies.state.requests[0]?.submittedDataEncrypted).toBe(
      submittedDataEncryptedBefore,
    );
    expect(dependencies.state.requests[0]?.status).toBe("SUBMITTED");
    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("mutable data validation rejects invalid JSON, dangerous keys, and bad reason", async () => {
    const dependencies = createInMemoryDependencies();
    const invalidJson = await updateAdminMutableData(
      adminMutableDataRequest({
        dataText: "{",
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const dangerous = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { constructor: { polluted: true } },
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const missingReason = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: " ",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const longReason = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "a".repeat(2_001),
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const arrayRoot = await updateAdminMutableData(
      adminMutableDataRequest({
        dataText: "[]",
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const oversized = await updateAdminMutableData(
      adminMutableDataRequest({
        data: { value: "a".repeat(32 * 1024 + 1) },
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(invalidJson.status).toBe(303);
    expect(dangerous.status).toBe(303);
    expect(missingReason.status).toBe(303);
    expect(longReason.status).toBe(303);
    expect(arrayRoot.status).toBe(303);
    expect(oversized.status).toBe(303);
    expect(dependencies.state.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "REQUEST_DATA_UPDATED" }),
      ]),
    );
  });

  test("mutable audit contains changed keys but not mutable values", async () => {
    const dependencies = createInMemoryDependencies();
    await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "Admin added resolution metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    const event = dependencies.state.events.find(
      (item) => item.type === "REQUEST_DATA_UPDATED",
    );

    expect(event?.data).toEqual({
      changedKeys: ["resolutionCode"],
      reason: "Admin added resolution metadata.",
      actor: {
        type: "ADMIN_USER",
        id: "admin-user-1",
      },
    });
    expect(JSON.stringify(event?.data)).not.toContain("DATA_EXPORT_READY");
  });

  test("ADMIN and OPERATOR can create custom events", async () => {
    const adminDependencies = createInMemoryDependencies();
    const operatorDependencies = createInMemoryDependencies();

    const adminResponse = await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        visibility: "INTERNAL",
        data: { system: "Vector" },
      }),
      "req_one",
      adminSession({ adminUserId: "admin-event", role: "ADMIN" }),
      adminDependencies,
    );
    const operatorResponse = await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_READY",
        visibility: "PUBLIC",
        data: { message: "Ready" },
      }),
      "req_one",
      adminSession({ adminUserId: "operator-event", role: "OPERATOR" }),
      operatorDependencies,
    );

    expect(adminResponse.status).toBe(303);
    expect(operatorResponse.status).toBe(303);
    expect(adminDependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CUSTOM_EVENT",
          category: "CUSTOM",
          customType: "DATA_EXPORT_GENERATED",
          visibility: "INTERNAL",
          actorType: "ADMIN_USER",
          actorId: "admin-event",
          data: { system: "Vector" },
        }),
      ]),
    );
    expect(operatorDependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          customType: "DATA_EXPORT_READY",
          visibility: "PUBLIC",
          actorId: "operator-event",
        }),
      ]),
    );
  });

  test("custom event validation rejects reserved, invalid, oversized, and dangerous data", async () => {
    const dependencies = createInMemoryDependencies();
    const reserved = await createAdminCustomEvent(
      adminCustomEventRequest({ type: "STATUS_CHANGED" }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const invalidName = await createAdminCustomEvent(
      adminCustomEventRequest({ type: "bad-name" }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const oversized = await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        data: { value: "a".repeat(16 * 1024 + 1) },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    const dangerous = await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        data: { prototype: { polluted: true } },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(reserved.status).toBe(303);
    expect(invalidName.status).toBe(303);
    expect(oversized.status).toBe(303);
    expect(dangerous.status).toBe(303);
    expect(dependencies.state.events).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "CUSTOM_EVENT" }),
      ]),
    );
  });

  test("custom event visibility remains public-safe", async () => {
    const dependencies = createInMemoryDependencies();
    await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        visibility: "INTERNAL",
        data: { system: "Vector" },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_READY",
        visibility: "PUBLIC",
        data: { message: "Ready" },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    const publicEvents = dependencies.state.events
      .filter(
        (event) => event.category === "CUSTOM" && event.visibility === "PUBLIC",
      )
      .map((event) => ({
        type: event.customType,
        data: event.data,
        createdAt: event.createdAt.toISOString(),
      }));

    expect(publicEvents).toEqual([
      {
        type: "DATA_EXPORT_READY",
        data: { message: "Ready" },
        createdAt: "2026-07-03T00:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(publicEvents)).not.toContain("admin-user-1");
    expect(JSON.stringify(publicEvents)).not.toContain("ADMIN_USER");
    expect(JSON.stringify(publicEvents)).not.toContain("Vector");
  });

  test("custom event does not change status or send email", async () => {
    const dependencies = createInMemoryDependencies();
    await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        data: { system: "Vector" },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(dependencies.state.requests[0]?.status).toBe("SUBMITTED");
    expect(dependencies.state.sentEmails).toEqual([]);
  });

  test("mutable data and custom event duplicate submissions do not create duplicate records", async () => {
    const dependencies = createInMemoryDependencies();
    const mutableRequest = () =>
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "Admin added resolution metadata.",
      });
    const eventRequest = () =>
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        data: { system: "Vector" },
      });

    await updateAdminMutableData(
      mutableRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await updateAdminMutableData(
      mutableRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminCustomEvent(
      eventRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminCustomEvent(
      eventRequest(),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(
      dependencies.state.events.filter(
        (event) => event.type === "REQUEST_DATA_UPDATED",
      ),
    ).toHaveLength(1);
    expect(
      dependencies.state.events.filter(
        (event) => event.type === "CUSTOM_EVENT",
      ),
    ).toHaveLength(1);

    await updateAdminMutableData(
      adminMutableDataRequest({
        data: { resolutionCode: "DATA_EXPORT_READY" },
        reason: "Admin confirmed the same metadata.",
      }),
      "req_one",
      adminSession(),
      dependencies,
    );
    await createAdminCustomEvent(
      adminCustomEventRequest({
        type: "DATA_EXPORT_GENERATED",
        data: { system: "Console" },
      }),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(
      dependencies.state.events.filter(
        (event) => event.type === "REQUEST_DATA_UPDATED",
      ),
    ).toHaveLength(2);
    expect(
      dependencies.state.events.filter(
        (event) => event.type === "CUSTOM_EVENT",
      ),
    ).toHaveLength(2);
  });

  test("mutable data and custom event cross-origin submissions rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const mutable = await updateAdminMutableData(
      adminMutableDataRequest(
        {
          data: { resolutionCode: "DATA_EXPORT_READY" },
          reason: "Admin added resolution metadata.",
        },
        "https://attacker.test",
      ),
      "req_one",
      adminSession(),
      dependencies,
    );
    const event = await createAdminCustomEvent(
      adminCustomEventRequest(
        {
          type: "DATA_EXPORT_GENERATED",
          data: { system: "Vector" },
        },
        "https://attacker.test",
      ),
      "req_one",
      adminSession(),
      dependencies,
    );

    expect(mutable.status).toBe(403);
    expect(event.status).toBe(403);
  });
});

function adminSession(
  overrides: {
    adminUserId?: string;
    role?: "ADMIN" | "OPERATOR" | "VIEWER";
  } = {},
) {
  return {
    adminUserId: overrides.adminUserId ?? "admin-user-1",
    role: overrides.role ?? "ADMIN",
    sessionId: "admin-session-1",
  };
}

function createInMemoryDependencies(
  options: {
    emailShouldFail?: boolean;
    requesterEmailEncrypted?: string | null;
  } = {},
) {
  const createdAtOne = new Date("2026-07-01T00:00:00.000Z");
  const createdAtTwo = new Date("2026-07-02T00:00:00.000Z");
  const requests: PrivacyRequest[] = [
    {
      id: "request-one",
      publicId: "req_one",
      requesterId: "requester-one",
      type: "DATA_ACCESS",
      status: "SUBMITTED",
      submittedData: {
        type: "DATA_ACCESS",
        source: {
          channel: "API",
          siteKey: "test-site",
          formKey: "manual-api",
        },
      },
      submittedDataEncrypted: encryptSubmittedPayload({
        type: "DATA_ACCESS",
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
          sourceUrl: "https://example.com/privacy?token=private-token#consumer",
        },
        submittedData: {
          message: '<script>alert("unsafe")</script> Please process this.',
          processorReference: "job-12345",
          email: "duplicate@example.com",
          accessToken: "must-not-render",
          nested: {
            safe: true,
            password: "must-not-render",
          },
        },
      }),
      submittedDataHash: "submission-hash",
      encryptionVersion: 1,
      mutableData: {
        processorReference: "job-12345",
      },
      completedAt: null,
      createdAt: createdAtOne,
      updatedAt: createdAtOne,
    },
    {
      id: "request-two",
      publicId: "req_two",
      requesterId: "requester-two",
      type: "DATA_DELETION",
      status: "PROCESSING",
      submittedData: {
        type: "DATA_DELETION",
        source: {
          channel: "FORM",
          siteKey: "magictrust-hosted",
          formKey: "privacy-request",
        },
      },
      submittedDataEncrypted: "encrypted-submission-two",
      submittedDataHash: "submission-hash-two",
      encryptionVersion: 1,
      mutableData: {},
      completedAt: null,
      createdAt: createdAtTwo,
      updatedAt: createdAtTwo,
    },
  ];
  const events: RequestEvent[] = [
    {
      id: "event-one",
      privacyRequestId: "request-one",
      type: "PUBLIC_ATTACHMENT_ADDED",
      category: "BUILT_IN",
      visibility: "INTERNAL",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      data: {
        attachmentId: "attachment-one",
        fileName: "data-export.json",
        storageKey: "manual/data-export.json",
        checksum: "sha256-secret",
        recipient: "john@example.com",
        actor: {
          type: "API_CLIENT",
          id: "privacy-processor",
        },
      },
      createdAt: createdAtOne,
    },
  ];
  const comments: RequestComment[] = [
    {
      id: "comment-one",
      requestId: "request-one",
      visibility: "PUBLIC",
      body: "Your request is being processed.",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      createdAt: createdAtOne,
    },
  ];
  const attachments: RequestAttachment[] = [
    {
      id: "attachment-one",
      requestId: "request-one",
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 11,
      storageProvider: "vercel-blob",
      storageKey: "requests/req_one/attachments/data-export.json",
      checksum: "sha256-secret",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      createdAt: createdAtOne,
    },
  ];
  const accessTokens: RequestAccessToken[] = [];
  const communications: RequestCommunication[] = [
    {
      id: "communication-one",
      requestId: "request-one",
      channel: "EMAIL",
      direction: "OUTBOUND",
      recipient: null,
      recipientEncrypted: encryptPii("john@example.com"),
      recipientHash: "recipient-hash",
      encryptionVersion: 1,
      subject: "Your MagicTrust request was updated",
      body: "Plain body is stored but not returned by the dashboard model.",
      provider: "resend",
      providerMessageId: "message-1",
      status: "SENT",
      errorMessage: null,
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      createdAt: createdAtOne,
      sentAt: createdAtOne,
    },
  ];
  const state = {
    requests,
    events,
    comments,
    attachments,
    communications,
    accessTokens,
    sensitiveReads: 0,
    uploadedFiles: [] as Array<{
      storageKey: string;
      contentType: string;
      sizeBytes: number;
    }>,
    sentEmails: [] as Array<{ to: string; subject: string; body: string }>,
  };
  const requestRepository: RequestRepository = {
    async findByIdOrPublicId(id): Promise<RequestDetails | null> {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

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
        mutableData: request.mutableData,
        events: events
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
        comments: comments.filter(
          (comment) => comment.requestId === request.id,
        ),
        attachments: attachments.filter(
          (attachment) => attachment.requestId === request.id,
        ),
        communications: communications.filter(
          (communication) => communication.requestId === request.id,
        ),
      };
    },
    async findAdminSensitiveData(publicId) {
      state.sensitiveReads += 1;
      const request = requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      return {
        requestId: request.id,
        requesterEmailEncrypted: encryptPii("john@example.com"),
        requesterPhoneEncrypted: encryptPii("+13055551234"),
        requesterNameEncrypted: null,
        submittedDataEncrypted: request.submittedDataEncrypted,
      };
    },
    async list(filters: RequestListFilters) {
      const rows = requests
        .filter((request) =>
          filters.publicId ? request.publicId === filters.publicId : true,
        )
        .filter((request) =>
          filters.types ? filters.types.includes(request.type) : true,
        )
        .filter((request) =>
          filters.statuses ? filters.statuses.includes(request.status) : true,
        )
        .filter((request) =>
          filters.createdFrom ? request.createdAt >= filters.createdFrom : true,
        )
        .filter((request) =>
          filters.createdTo ? request.createdAt < filters.createdTo : true,
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
        requests: pageRows.map((request) => ({
          id: request.id,
          publicId: request.publicId,
          requesterId: request.requesterId,
          type: request.type,
          status: request.status,
          source: sourceFromSubmittedData(request.submittedData),
          completedAt: request.completedAt,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        })),
        nextCursor:
          rows.length > filters.limit && last
            ? { createdAt: last.createdAt, id: last.id }
            : null,
      };
    },
    async recordAdminAttachmentDownloaded(requestId, input) {
      events.push({
        id: "event-admin-download",
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });
    },
    async updateStatus(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const now = new Date("2026-07-03T00:00:00.000Z");
      const previousStatus = request.status;
      request.status = input.status;
      request.updatedAt = now;
      request.completedAt = isTerminalStatus(input.status) ? now : null;
      events.push({
        id: `event-status-${events.length + 1}`,
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
    },
    async addComment(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const comment: RequestComment = {
        id: `comment-${comments.length + 1}`,
        requestId: request.id,
        visibility: input.visibility,
        body: input.body,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      };
      comments.push(comment);
      events.push({
        id: `event-comment-${events.length + 1}`,
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });

      return comment;
    },
    async updateMutableData(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      request.mutableData = {
        ...request.mutableData,
        ...input.data,
      };
      request.updatedAt = new Date("2026-07-03T00:00:00.000Z");
      events.push({
        id: `event-data-${events.length + 1}`,
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });

      return {
        mutableData: request.mutableData,
        updatedAt: request.updatedAt,
      };
    },
    async addCustomEvent(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const event: RequestEvent = {
        id: `event-custom-${events.length + 1}`,
        privacyRequestId: request.id,
        type: "CUSTOM_EVENT",
        category: "CUSTOM",
        customType: input.customType,
        visibility: input.visibility,
        actorType: input.actorType,
        actorId: input.actorId,
        data: input.data,
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      };
      events.push(event);

      return {
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
      };
    },
    async addAttachment(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const attachment: RequestAttachment = {
        id: `attachment-${attachments.length + 1}`,
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      };
      attachments.push(attachment);
      events.push({
        id: `event-attachment-${events.length + 1}`,
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
          actor: {
            type: input.actorType,
            id: input.actorId,
          },
        },
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });

      return attachment;
    },
    async findConsumerNotificationTarget(id) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

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
        requesterEmailEncrypted:
          options.requesterEmailEncrypted === undefined
            ? encryptPii("john@example.com")
            : options.requesterEmailEncrypted,
      };
    },
    async createConsumerNotificationAccessToken(requestId, input) {
      const request = requests.find((item) => item.id === requestId);

      if (!request) {
        return null;
      }

      const accessToken: RequestAccessToken = {
        id: `access-token-${accessTokens.length + 1}`,
        requestId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      };
      accessTokens.push(accessToken);

      return accessToken;
    },
    async createCommunication(id, input) {
      const request = requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const communication: RequestCommunication = {
        id: `communication-${communications.length + 1}`,
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: null,
        recipientEncrypted: encryptPii(input.recipient),
        recipientHash: "recipient-hash",
        encryptionVersion: 1,
        subject: input.subject,
        body: input.body,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING",
        errorMessage: null,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
        sentAt: null,
      };
      communications.push(communication);

      return communication;
    },
    async markConsumerNotificationSent(requestId, communicationId, input) {
      const communication = communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "SENT";
      communication.providerMessageId = input.providerMessageId;
      communication.sentAt = new Date("2026-07-03T00:00:00.000Z");
      communication.errorMessage = null;
      events.push({
        id: `event-notification-${events.length + 1}`,
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });

      return communication;
    },
    async markConsumerNotificationFailed(requestId, communicationId, input) {
      const communication = communications.find(
        (item) => item.id === communicationId && item.requestId === requestId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "FAILED";
      communication.errorMessage = input.errorMessage;
      communication.providerMessageId = null;
      communication.sentAt = null;
      events.push({
        id: `event-notification-${events.length + 1}`,
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
        createdAt: new Date("2026-07-03T00:00:00.000Z"),
      });

      return communication;
    },
    findConsumerAccessLinkTarget: notImplemented,
    recordAttachmentDownloaded: notImplemented,
    markCommunicationSent: notImplemented,
    markCommunicationFailed: notImplemented,
    createConsumerAccessToken: notImplemented,
    recordConsumerAccessLinkSent: notImplemented,
    consumeConsumerAccessToken: notImplemented,
    validateConsumerAccessSession: notImplemented,
    recordConsumerAttachmentDownloaded: notImplemented,
    createIdentityVerificationToken: notImplemented,
    recordIdentityVerificationSent: notImplemented,
    verifyIdentityToken: notImplemented,
  };
  const storageProvider: PrivateFileStorageProvider = {
    provider: "vercel-blob",
    async uploadPrivateFile(input) {
      state.uploadedFiles.push({
        storageKey: input.storageKey,
        contentType: input.contentType,
        sizeBytes: input.body.size,
      });

      return {
        provider: "vercel-blob",
        storageKey: input.storageKey,
        checksum: "sha256-uploaded",
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

  return {
    state,
    requestRepository,
    storageProvider,
    emailProvider: {
      provider: "resend",
      async sendEmail(input) {
        if (options.emailShouldFail) {
          throw new Error("Email provider failed.");
        }

        state.sentEmails.push(input);

        return {
          provider: "resend",
          providerMessageId: "email-message-1",
        };
      },
    } satisfies EmailProvider,
    appBaseUrl: "https://magictrust.test",
    now: () => new Date("2026-07-03T00:00:00.000Z"),
    generateToken: () => "secure-token",
  };
}

function sourceFromSubmittedData(submittedData: JsonObject) {
  const source =
    submittedData.source &&
    typeof submittedData.source === "object" &&
    !Array.isArray(submittedData.source)
      ? (submittedData.source as JsonObject)
      : null;

  return source
    ? {
        channel: typeof source.channel === "string" ? source.channel : null,
        siteKey: typeof source.siteKey === "string" ? source.siteKey : null,
        formKey: typeof source.formKey === "string" ? source.formKey : null,
      }
    : null;
}

function adminFormRequest(
  action: "status" | "comment",
  fields: Record<string, string>,
  origin = "https://magictrust.test",
) {
  const body = new FormData();

  for (const [key, value] of Object.entries(fields)) {
    body.set(key, value);
  }

  return new Request(
    `https://magictrust.test/admin/requests/req_one/${action}`,
    {
      method: "POST",
      headers: {
        origin,
      },
      body,
    },
  );
}

function adminUploadRequest(
  overrides: {
    fileName?: string;
    file?: File;
    visibility?: string;
  } = {},
  origin = "https://magictrust.test",
) {
  const body = new FormData();
  body.set(
    "file",
    overrides.file ??
      new File(["uploaded"], overrides.fileName ?? "admin upload.txt", {
        type: "text/plain",
      }),
  );
  body.set("visibility", overrides.visibility ?? "PUBLIC");

  return new Request(
    "https://magictrust.test/admin/requests/req_one/attachments",
    {
      method: "POST",
      headers: {
        origin,
      },
      body,
    },
  );
}

function adminNotificationRequest(
  fields: {
    type?: string;
    message?: string;
    attachmentId?: string;
  },
  origin = "https://magictrust.test",
) {
  const body = new FormData();

  if (fields.type !== undefined) {
    body.set("type", fields.type);
  }

  if (fields.message !== undefined) {
    body.set("message", fields.message);
  }

  if (fields.attachmentId !== undefined) {
    body.set("attachmentId", fields.attachmentId);
  }

  return new Request(
    "https://magictrust.test/admin/requests/req_one/notifications",
    {
      method: "POST",
      headers: {
        origin,
      },
      body,
    },
  );
}

function adminMutableDataRequest(
  fields: {
    data?: Record<string, unknown>;
    dataText?: string;
    reason: string;
    actorId?: string;
  },
  origin = "https://magictrust.test",
) {
  const body = new FormData();
  body.set("data", fields.dataText ?? JSON.stringify(fields.data ?? {}));
  body.set("reason", fields.reason);

  if (fields.actorId !== undefined) {
    body.set("actorId", fields.actorId);
  }

  return new Request("https://magictrust.test/admin/requests/req_one/data", {
    method: "POST",
    headers: {
      origin,
    },
    body,
  });
}

function adminCustomEventRequest(
  fields: {
    type?: string;
    visibility?: string;
    data?: Record<string, unknown>;
    dataText?: string;
  },
  origin = "https://magictrust.test",
) {
  const body = new FormData();

  if (fields.type !== undefined) {
    body.set("type", fields.type);
  }

  body.set("visibility", fields.visibility ?? "INTERNAL");

  if (fields.dataText !== undefined) {
    body.set("data", fields.dataText);
  } else if (fields.data !== undefined) {
    body.set("data", JSON.stringify(fields.data));
  }

  return new Request("https://magictrust.test/admin/requests/req_one/events", {
    method: "POST",
    headers: {
      origin,
    },
    body,
  });
}

function isTerminalStatus(status: string): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}

function notImplemented(): never {
  throw new Error("Not implemented in admin dashboard tests.");
}
