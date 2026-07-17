import type {
  JsonObject,
  RequestAttachment,
  RequestComment,
  RequestCommunication,
  RequestEvent,
  PrivacyRequest,
} from "@magictrust/domain";
import type {
  RequestDetails,
  RequestListFilters,
  RequestRepository,
} from "@magictrust/database";
import { encryptPii } from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAdminRequestComment,
  downloadAdminAttachment,
  getAdminRequestDetail,
  getValidAdminStatusDestinations,
  listAdminRequests,
  parseAdminRequestListSearchParams,
  updateAdminRequestStatus,
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

function createInMemoryDependencies() {
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
      submittedDataEncrypted: "encrypted-submission",
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
    findConsumerAccessLinkTarget: notImplemented,
    findConsumerNotificationTarget: notImplemented,
    updateMutableData: notImplemented,
    addCustomEvent: notImplemented,
    addAttachment: notImplemented,
    recordAttachmentDownloaded: notImplemented,
    createCommunication: notImplemented,
    markCommunicationSent: notImplemented,
    markCommunicationFailed: notImplemented,
    createConsumerAccessToken: notImplemented,
    createConsumerNotificationAccessToken: notImplemented,
    recordConsumerAccessLinkSent: notImplemented,
    markConsumerNotificationSent: notImplemented,
    markConsumerNotificationFailed: notImplemented,
    consumeConsumerAccessToken: notImplemented,
    validateConsumerAccessSession: notImplemented,
    recordConsumerAttachmentDownloaded: notImplemented,
    createIdentityVerificationToken: notImplemented,
    recordIdentityVerificationSent: notImplemented,
    verifyIdentityToken: notImplemented,
  };
  const storageProvider: PrivateFileStorageProvider = {
    provider: "vercel-blob",
    async uploadPrivateFile() {
      throw new Error("Not implemented in admin dashboard tests.");
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

function isTerminalStatus(status: string): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}

function notImplemented(): never {
  throw new Error("Not implemented in admin dashboard tests.");
}
