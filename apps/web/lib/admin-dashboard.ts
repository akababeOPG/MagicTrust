import "server-only";

import { randomBytes } from "node:crypto";

import {
  createDatabase,
  createRequestRepository,
  type AdminRequestSensitiveData,
  type ConsumerNotificationType,
  type RequestDetails,
  type RequestListFilters,
  type RequestListResult,
  type RequestRepository,
} from "@magictrust/database";
import {
  commentVisibilities,
  decryptOriginalSubmittedData,
  requestStatuses,
  requestTypes,
  type JsonObject,
  type JsonValue,
  type RequestStatus,
  type RequestType,
} from "@magictrust/domain";
import { getAppBaseUrl, getRequiredDatabaseUrl } from "@magictrust/config";
import type { EmailProvider } from "@magictrust/email";
import { createResendEmailProvider } from "@magictrust/email";
import { decryptPii, hashAccessToken } from "@magictrust/privacy";
import {
  createVercelBlobPrivateStorageProvider,
  type PrivateFileStorageProvider,
} from "@magictrust/storage";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

export type AdminDashboardDependencies = {
  requestRepository: RequestRepository;
  storageProvider: PrivateFileStorageProvider;
  emailProvider: EmailProvider;
  appBaseUrl: string;
  now: () => Date;
  generateToken: () => string;
};

export type AdminRequestListView = {
  requests: AdminRequestListItem[];
  pagination: {
    limit: number;
    nextCursor?: string;
  };
};

export type AdminRequestListItem = {
  id: string;
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  source: {
    channel: string | null;
    siteKey: string | null;
    formKey: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type AdminRequestDetailView = AdminRequestListItem & {
  requester?: {
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  };
  originalSubmission?: {
    type: RequestType;
    source: {
      channel: string | null;
      siteKey: string | null;
      formKey: string | null;
      sourceUrl: string | null;
    };
    message: string | null;
    submittedData: JsonObject;
  };
  mutableData: JsonObject;
  timeline: Array<{
    id: string;
    type: string;
    category: string;
    visibility: string;
    actorType: string;
    actorId: string | null;
    data: JsonObject;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    visibility: string;
    body: string;
    actorType: string;
    actorId: string | null;
    createdAt: string;
  }>;
  attachments: Array<{
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    visibility: string;
    createdAt: string;
  }>;
  communications: Array<{
    id: string;
    channel: string;
    direction: string;
    recipientMasked: string | null;
    subject: string;
    provider: string;
    status: string;
    errorMessage: string | null;
    createdAt: string;
    sentAt: string | null;
  }>;
};

type AdminListParseResult =
  | {
      ok: true;
      filters: RequestListFilters;
    }
  | {
      ok: false;
      message: string;
    };

const defaultAdminPageSize = 25;
const maxAdminPageSize = 100;
const maxUploadSizeBytes = 10 * 1024 * 1024;
const allowedUploadMimeTypes = new Set([
  "application/json",
  "text/csv",
  "application/pdf",
  "text/plain",
  "application/zip",
]);
const notificationTypes = [
  "REQUEST_UPDATED",
  "REQUEST_COMPLETED",
  "REQUEST_REJECTED",
  "FILE_AVAILABLE",
] as const;
const builtInEventTypes = new Set([
  "CUSTOM_EVENT",
  "REQUEST_CREATED",
  "STATUS_CHANGED",
  "PUBLIC_COMMENT_ADDED",
  "INTERNAL_COMMENT_ADDED",
  "PUBLIC_ATTACHMENT_ADDED",
  "INTERNAL_ATTACHMENT_ADDED",
  "ATTACHMENT_DOWNLOADED",
  "ADMIN_ATTACHMENT_DOWNLOADED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "CONSUMER_ACCESS_LINK_SENT",
  "CONSUMER_ACCESS_TOKEN_USED",
  "CONSUMER_ACCESS_SESSION_CREATED",
  "CONSUMER_ACCESS_SESSION_USED",
  "CONSUMER_ATTACHMENT_DOWNLOADED",
  "IDENTITY_VERIFICATION_SENT",
  "IDENTITY_VERIFIED",
  "CONSUMER_NOTIFICATION_SENT",
  "CONSUMER_NOTIFICATION_FAILED",
  "REQUEST_DATA_UPDATED",
]);
const customEventNamePattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const maxAdminMutableDataBytes = 32 * 1024;
const maxCustomEventDataBytes = 16 * 1024;
const terminalStatuses = new Set<RequestStatus>([
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
]);
const sensitiveEventKeys = new Set([
  "storagekey",
  "checksum",
  "recipient",
  "recipientencrypted",
  "recipienthash",
  "email",
  "phone",
  "token",
  "tokenhash",
  "sessiontoken",
  "sessiontokenhash",
  "requester",
]);
const sensitiveSubmissionKeys = new Set([
  "proto",
  "prototype",
  "constructor",
  "firstname",
  "lastname",
  "email",
  "phone",
  "address",
  "requester",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "password",
  "secret",
  "apikey",
  "authorization",
  "encryptionkey",
  "encryptionversion",
  "encrypted",
  "ciphertext",
  "hash",
  "id",
  "requesterid",
  "privacyrequestid",
  "internalid",
  "submitteddataencrypted",
  "submitteddatahash",
  "emailencrypted",
  "emailhash",
  "phoneencrypted",
  "phonehash",
  "nameencrypted",
]);

export function createAdminDashboardDependencies(): AdminDashboardDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      requestRepository: missingDatabaseRequestRepository(),
      storageProvider: createVercelBlobPrivateStorageProvider(),
      emailProvider: createResendEmailProvider(),
      appBaseUrl: getAppBaseUrl(),
      now: () => new Date(),
      generateToken: generateSecureToken,
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    requestRepository: createRequestRepository(db),
    storageProvider: createVercelBlobPrivateStorageProvider(),
    emailProvider: createResendEmailProvider(),
    appBaseUrl: getAppBaseUrl(),
    now: () => new Date(),
    generateToken: generateSecureToken,
  };
}

export async function listAdminRequests(
  searchParams: URLSearchParams,
  dependencies: AdminDashboardDependencies,
): Promise<
  { ok: true; data: AdminRequestListView } | { ok: false; message: string }
> {
  const parsed = parseAdminRequestListSearchParams(searchParams);

  if (!parsed.ok) {
    return parsed;
  }

  const result = await dependencies.requestRepository.list(parsed.filters);

  return {
    ok: true,
    data: normalizeAdminRequestList(result, parsed.filters.limit),
  };
}

export async function getAdminRequestDetail(
  publicId: string,
  dependencies: AdminDashboardDependencies,
  role: AdminSession["role"] = "VIEWER",
): Promise<AdminRequestDetailView | null> {
  const request =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!request) {
    return null;
  }

  const detail = normalizeAdminRequestDetail(request);

  if (role !== "ADMIN" && role !== "OPERATOR") {
    return detail;
  }

  const sensitive =
    await dependencies.requestRepository.findAdminSensitiveData(publicId);

  if (!sensitive || sensitive.requestId !== request.id) {
    return detail;
  }

  return {
    ...detail,
    ...normalizeAdminSensitiveRequestData(request, sensitive),
  };
}

export async function downloadAdminAttachment(
  publicId: string,
  attachmentId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  const request =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!request) {
    return notFoundResponse();
  }

  const attachment = request.attachments.find(
    (item) => item.id === attachmentId,
  );

  if (!attachment) {
    return notFoundResponse();
  }

  if (attachment.storageProvider !== dependencies.storageProvider.provider) {
    return Response.json(
      {
        error: {
          code: "UNSUPPORTED_STORAGE_PROVIDER",
          message: "Attachment storage provider is not supported.",
        },
      },
      { status: 400 },
    );
  }

  const downloaded = await dependencies.storageProvider.downloadPrivateFile({
    storageKey: attachment.storageKey,
  });

  if (!downloaded) {
    return notFoundResponse();
  }

  await dependencies.requestRepository.recordAdminAttachmentDownloaded(
    request.id,
    {
      attachmentId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      actorId: adminSession.adminUserId,
    },
  );

  return new Response(downloaded.body, {
    status: 200,
    headers: {
      "content-type": downloaded.contentType || attachment.mimeType,
      "content-disposition": contentDispositionAttachment(attachment.fileName),
      "content-length": downloaded.sizeBytes.toString(),
    },
  });
}

export async function updateAdminRequestStatus(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const parsed = z
    .object({
      newStatus: z.enum(requestStatuses),
      reason: z.string().trim().min(1).max(2_000),
    })
    .safeParse({
      newStatus: formData.get("newStatus"),
      reason: formData.get("reason"),
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Status and reason are required.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const validDestinations = getValidAdminStatusDestinations(existing.status);

  if (!validDestinations.includes(parsed.data.newStatus)) {
    return redirectToRequestDetail(request, publicId, {
      error: "Status transition is not allowed.",
    });
  }

  const updated = await dependencies.requestRepository.updateStatus(
    existing.id,
    {
      status: parsed.data.newStatus,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
      reason: parsed.data.reason,
    },
  );

  if (!updated) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Status updated.",
  });
}

export async function createAdminRequestComment(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const parsed = z
    .object({
      visibility: z.enum(commentVisibilities),
      body: z.string().trim().min(1).max(5_000),
    })
    .safeParse({
      visibility: formData.get("visibility"),
      body: formData.get("body"),
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Comment visibility and body are required.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const duplicate = existing.comments.some(
    (comment) =>
      comment.visibility === parsed.data.visibility &&
      comment.body === parsed.data.body &&
      comment.actorType === "ADMIN_USER" &&
      comment.actorId === adminSession.adminUserId,
  );

  if (!duplicate) {
    const comment = await dependencies.requestRepository.addComment(
      existing.id,
      {
        visibility: parsed.data.visibility,
        body: parsed.data.body,
        actorType: "ADMIN_USER",
        actorId: adminSession.adminUserId,
      },
    );

    if (!comment) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }
  }

  return redirectToRequestDetail(request, publicId, {
    success: duplicate ? "Comment already recorded." : "Comment added.",
  });
}

export async function uploadAdminRequestAttachment(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const file = formData.get("file");
  const visibility = formData.get("visibility");

  if (!(file instanceof File)) {
    return redirectToRequestDetail(request, publicId, {
      error: "File is required.",
    });
  }

  if (file.size > maxUploadSizeBytes) {
    return redirectToRequestDetail(request, publicId, {
      error: "File is too large.",
    });
  }

  if (!allowedUploadMimeTypes.has(file.type)) {
    return redirectToRequestDetail(request, publicId, {
      error: "File MIME type is not supported.",
    });
  }

  const parsed = z
    .object({
      visibility: z.enum(commentVisibilities),
    })
    .safeParse({ visibility });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Attachment visibility is invalid.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const safeFileName = sanitizeFileName(file.name);
  const duplicate = existing.attachments.some(
    (attachment) =>
      attachment.visibility === parsed.data.visibility &&
      attachment.fileName === safeFileName &&
      attachment.mimeType === file.type &&
      attachment.sizeBytes === file.size &&
      attachment.actorType === "ADMIN_USER" &&
      attachment.actorId === adminSession.adminUserId,
  );

  if (duplicate) {
    return redirectToRequestDetail(request, publicId, {
      error: "Attachment upload was already recorded.",
    });
  }

  const storageKey = `requests/${existing.publicId}/attachments/${crypto.randomUUID()}-${safeFileName}`;
  const upload = await dependencies.storageProvider.uploadPrivateFile({
    body: file,
    storageKey,
    contentType: file.type,
  });
  const attachment = await dependencies.requestRepository.addAttachment(
    existing.id,
    {
      visibility: parsed.data.visibility,
      fileName: safeFileName,
      mimeType: file.type,
      sizeBytes: file.size,
      storageProvider: upload.provider,
      storageKey: upload.storageKey,
      checksum: upload.checksum,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
    },
  );

  if (!attachment) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Attachment uploaded.",
  });
}

export async function sendAdminConsumerNotification(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const parsed = z
    .object({
      type: z.enum(notificationTypes),
      message: z.string().trim().max(2_000).optional(),
      attachmentId: z.string().trim().optional(),
    })
    .safeParse({
      type: formData.get("type"),
      message: emptyToUndefined(formData.get("message")?.toString() ?? null),
      attachmentId: emptyToUndefined(
        formData.get("attachmentId")?.toString() ?? null,
      ),
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Notification payload is invalid.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const target =
    await dependencies.requestRepository.findConsumerNotificationTarget(
      existing.id,
    );

  if (!target) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (!target.requesterEmailEncrypted) {
    return redirectToRequestDetail(request, publicId, {
      error: "Requester email is unavailable.",
    });
  }

  let recipient: string;

  try {
    recipient = decryptPii(target.requesterEmailEncrypted);
  } catch {
    return redirectToRequestDetail(request, publicId, {
      error: "Requester email is unavailable.",
    });
  }

  let selectedAttachment: {
    id: string;
    fileName: string;
  } | null = null;
  let secureAccessUrl: string | null = null;

  if (parsed.data.type === "FILE_AVAILABLE") {
    if (!parsed.data.attachmentId) {
      return redirectToRequestDetail(request, publicId, {
        error: "A public attachment is required.",
      });
    }

    const attachment = existing.attachments.find(
      (item) => item.id === parsed.data.attachmentId,
    );

    if (!attachment || attachment.visibility !== "PUBLIC") {
      return redirectToRequestDetail(request, publicId, {
        error: "A valid public attachment is required.",
      });
    }

    selectedAttachment = {
      id: attachment.id,
      fileName: attachment.fileName,
    };
    const token = dependencies.generateToken();
    const accessToken =
      await dependencies.requestRepository.createConsumerNotificationAccessToken(
        existing.id,
        {
          tokenHash: hashAccessToken(token),
          expiresAt: new Date(dependencies.now().getTime() + 30 * 60 * 1000),
        },
      );

    if (!accessToken) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }

    secureAccessUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${existing.publicId}/access?token=${encodeURIComponent(token)}`;
  }

  const trackingUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${existing.publicId}`;
  const message = notificationMessage(parsed.data.type, {
    customMessage: parsed.data.message,
    attachmentFileName: selectedAttachment?.fileName ?? null,
  });
  const subject = notificationSubject(parsed.data.type, existing);
  const body = notificationBody({
    publicId: existing.publicId,
    status: existing.status,
    message,
    trackingUrl,
    secureAccessUrl,
  });

  const communication =
    await dependencies.requestRepository.createCommunication(existing.id, {
      recipient,
      subject,
      body,
      provider: dependencies.emailProvider.provider,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
    });

  if (!communication) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  try {
    const sent = await dependencies.emailProvider.sendEmail({
      to: recipient,
      subject,
      body,
    });
    const updated =
      await dependencies.requestRepository.markConsumerNotificationSent(
        existing.id,
        communication.id,
        {
          notificationType: parsed.data.type,
          providerMessageId: sent.providerMessageId,
          actorType: "ADMIN_USER",
          actorId: adminSession.adminUserId,
        },
      );

    if (!updated) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }

    return redirectToRequestDetail(request, publicId, {
      success: "Consumer notification sent.",
    });
  } catch {
    const failed =
      await dependencies.requestRepository.markConsumerNotificationFailed(
        existing.id,
        communication.id,
        {
          notificationType: parsed.data.type,
          errorMessage: "Email provider failed to send the notification.",
          actorType: "ADMIN_USER",
          actorId: adminSession.adminUserId,
        },
      );

    if (!failed) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }

    return redirectToRequestDetail(request, publicId, {
      error: "Consumer notification could not be sent.",
    });
  }
}

export async function updateAdminMutableData(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const reason = formData.get("reason");
  const data = formData.get("data");
  const parsedReason = z.string().trim().min(1).max(2_000).safeParse(reason);

  if (!parsedReason.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Mutable data update reason is required.",
    });
  }

  if (typeof data !== "string") {
    return redirectToRequestDetail(request, publicId, {
      error: "Mutable data must be a JSON object.",
    });
  }

  const parsedData = parseJsonObject(data);

  if (!parsedData.ok) {
    return redirectToRequestDetail(request, publicId, {
      error: parsedData.message,
    });
  }

  if (serializedJsonByteLength(parsedData.value) > maxAdminMutableDataBytes) {
    return redirectToRequestDetail(request, publicId, {
      error: "Mutable data is too large.",
    });
  }

  if (hasDangerousKeyInUnknown(parsedData.value)) {
    return redirectToRequestDetail(request, publicId, {
      error: "Mutable data contains unsafe keys.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const changedKeys = Object.keys(parsedData.value);
  const existingValuesMatch = Object.entries(parsedData.value).every(
    ([key, value]) =>
      stableStringify(existing.mutableData[key]) === stableStringify(value),
  );
  const duplicate =
    existingValuesMatch &&
    existing.events.some((event) => {
      const eventData = event.data as Record<string, unknown>;
      return (
        event.type === "REQUEST_DATA_UPDATED" &&
        event.actorType === "ADMIN_USER" &&
        event.actorId === adminSession.adminUserId &&
        eventData.reason === parsedReason.data &&
        stableStringify(eventData.changedKeys) === stableStringify(changedKeys)
      );
    });

  if (duplicate) {
    return redirectToRequestDetail(request, publicId, {
      success: "Mutable data already recorded.",
    });
  }

  const updated = await dependencies.requestRepository.updateMutableData(
    existing.id,
    {
      data: parsedData.value,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
      reason: parsedReason.data,
    },
  );

  if (!updated) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Mutable data updated.",
  });
}

export async function createAdminCustomEvent(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);

  if (!formData) {
    return actionError("VALIDATION_ERROR", "Request payload is invalid.", 400);
  }

  const type = formData.get("type");
  const visibility = formData.get("visibility");
  const data = formData.get("data");
  const parsed = z
    .object({
      type: z
        .string()
        .trim()
        .regex(customEventNamePattern)
        .refine((value) => !builtInEventTypes.has(value)),
      visibility: z.enum(commentVisibilities),
    })
    .safeParse({ type, visibility });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Custom event type or visibility is invalid.",
    });
  }

  const parsedData = parseJsonObject(
    typeof data === "string" && data.trim() ? data : "{}",
  );

  if (!parsedData.ok) {
    return redirectToRequestDetail(request, publicId, {
      error: parsedData.message,
    });
  }

  if (serializedJsonByteLength(parsedData.value) > maxCustomEventDataBytes) {
    return redirectToRequestDetail(request, publicId, {
      error: "Custom event data is too large.",
    });
  }

  if (hasDangerousKeyInUnknown(parsedData.value)) {
    return redirectToRequestDetail(request, publicId, {
      error: "Custom event data contains unsafe keys.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const duplicate = existing.events.some(
    (event) =>
      event.category === "CUSTOM" &&
      event.customType === parsed.data.type &&
      event.visibility === parsed.data.visibility &&
      event.actorType === "ADMIN_USER" &&
      event.actorId === adminSession.adminUserId &&
      stableStringify(event.data) === stableStringify(parsedData.value),
  );

  if (!duplicate) {
    const event = await dependencies.requestRepository.addCustomEvent(
      existing.id,
      {
        customType: parsed.data.type,
        visibility: parsed.data.visibility,
        data: parsedData.value,
        actorType: "ADMIN_USER",
        actorId: adminSession.adminUserId,
      },
    );

    if (!event) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }
  }

  return redirectToRequestDetail(request, publicId, {
    success: duplicate
      ? "Custom event already recorded."
      : "Custom event recorded.",
  });
}

export function getValidAdminStatusDestinations(
  status: RequestStatus,
): RequestStatus[] {
  if (terminalStatuses.has(status)) {
    return [];
  }

  return requestStatuses.filter((candidate) => candidate !== status);
}

export function parseAdminRequestListSearchParams(
  searchParams: URLSearchParams,
): AdminListParseResult {
  const limit = parseLimit(searchParams.get("limit"));

  if (!limit.ok) {
    return limit;
  }

  const type = parseSingleEnum(searchParams.get("type"), requestTypes, "type");

  if (!type.ok) {
    return type;
  }

  const status = parseSingleEnum(
    searchParams.get("status"),
    requestStatuses,
    "status",
  );

  if (!status.ok) {
    return status;
  }

  const createdFrom = parseDateFilter(searchParams.get("createdFrom"));
  const createdTo = parseDateFilter(searchParams.get("createdTo"));

  if (!createdFrom.ok) {
    return {
      ok: false,
      message: "createdFrom must be a valid ISO-8601 datetime.",
    };
  }

  if (!createdTo.ok) {
    return {
      ok: false,
      message: "createdTo must be a valid ISO-8601 datetime.",
    };
  }

  if (
    createdFrom.value &&
    createdTo.value &&
    createdFrom.value >= createdTo.value
  ) {
    return { ok: false, message: "createdFrom must be before createdTo." };
  }

  const cursor = parseAdminListCursor(searchParams.get("cursor"));

  if (!cursor.ok) {
    return cursor;
  }

  return {
    ok: true,
    filters: {
      publicId: emptyToUndefined(searchParams.get("publicId")),
      types: type.value ? [type.value] : undefined,
      statuses: status.value ? [status.value] : undefined,
      createdFrom: createdFrom.value,
      createdTo: createdTo.value,
      cursor: cursor.value,
      limit: limit.value,
    },
  };
}

export function encodeAdminRequestListCursor(cursor: {
  createdAt: Date;
  id: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString("base64url");
}

export function buildAdminRequestListQuery(
  searchParams: URLSearchParams,
  nextCursor?: string,
): string {
  const query = new URLSearchParams(searchParams);
  query.delete("cursor");

  if (nextCursor) {
    query.set("cursor", nextCursor);
  }

  const value = query.toString();

  return value ? `?${value}` : "";
}

export function normalizeAdminRequestDetail(
  request: RequestDetails,
): AdminRequestDetailView {
  return {
    ...normalizeAdminRequestListItem(request),
    mutableData: request.mutableData,
    timeline: request.events.map((event) => ({
      id: event.id,
      type: event.customType ?? event.type,
      category: event.category ?? "BUILT_IN",
      visibility: event.visibility ?? "INTERNAL",
      actorType: event.actorType,
      actorId: event.actorId,
      data: sanitizeEventData(event.data),
      createdAt: event.createdAt.toISOString(),
    })),
    comments: request.comments.map((comment) => ({
      id: comment.id,
      visibility: comment.visibility,
      body: comment.body,
      actorType: comment.actorType,
      actorId: comment.actorId,
      createdAt: comment.createdAt.toISOString(),
    })),
    attachments: request.attachments.map((attachment) => ({
      id: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      visibility: attachment.visibility,
      createdAt: attachment.createdAt.toISOString(),
    })),
    communications: request.communications.map((communication) => ({
      id: communication.id,
      channel: communication.channel,
      direction: communication.direction,
      recipientMasked: maskCommunicationRecipient(communication),
      subject: communication.subject,
      provider: communication.provider,
      status: communication.status,
      errorMessage: communication.errorMessage,
      createdAt: communication.createdAt.toISOString(),
      sentAt: communication.sentAt?.toISOString() ?? null,
    })),
  };
}

function normalizeAdminSensitiveRequestData(
  request: RequestDetails,
  sensitive: AdminRequestSensitiveData,
): Pick<AdminRequestDetailView, "requester" | "originalSubmission"> {
  const original = safelyDecryptOriginalSubmission(
    sensitive.submittedDataEncrypted,
  );
  const originalRequester = jsonObjectValue(original?.requester);
  const originalSource = jsonObjectValue(original?.source);
  const originalSubmittedData = jsonObjectValue(original?.submittedData);
  const encryptedName = safelyDecryptRequesterName(
    sensitive.requesterNameEncrypted,
  );

  return {
    requester: {
      firstName:
        stringValue(originalRequester?.firstName) ??
        encryptedName?.firstName ??
        null,
      lastName:
        stringValue(originalRequester?.lastName) ??
        encryptedName?.lastName ??
        null,
      email:
        safelyDecryptPii(sensitive.requesterEmailEncrypted) ??
        stringValue(originalRequester?.email),
      phone:
        safelyDecryptPii(sensitive.requesterPhoneEncrypted) ??
        stringValue(originalRequester?.phone),
    },
    originalSubmission: {
      type: requestTypes.includes(original?.type as RequestType)
        ? (original?.type as RequestType)
        : request.type,
      source: {
        channel:
          stringValue(originalSource?.channel) ??
          request.source?.channel ??
          null,
        siteKey:
          stringValue(originalSource?.siteKey) ??
          request.source?.siteKey ??
          null,
        formKey:
          stringValue(originalSource?.formKey) ??
          request.source?.formKey ??
          null,
        sourceUrl: sanitizeOriginalSourceUrl(
          stringValue(originalSource?.sourceUrl),
        ),
      },
      message: stringValue(originalSubmittedData?.message),
      submittedData: sanitizeOriginalSubmittedData(originalSubmittedData),
    },
  };
}

function safelyDecryptOriginalSubmission(
  submittedDataEncrypted: string | null,
): JsonObject | null {
  try {
    return decryptOriginalSubmittedData({ submittedDataEncrypted });
  } catch {
    return null;
  }
}

function safelyDecryptPii(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return decryptPii(value);
  } catch {
    return null;
  }
}

function safelyDecryptRequesterName(
  value: string | null,
): { firstName: string | null; lastName: string | null } | null {
  const decrypted = safelyDecryptPii(value);

  if (!decrypted) {
    return null;
  }

  try {
    const parsed = JSON.parse(decrypted) as unknown;
    const name = jsonObjectValue(parsed);

    return name
      ? {
          firstName: stringValue(name.firstName),
          lastName: stringValue(name.lastName),
        }
      : null;
  } catch {
    return null;
  }
}

function sanitizeOriginalSourceUrl(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value);

    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return null;
    }

    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function sanitizeOriginalSubmittedData(value: JsonObject | null): JsonObject {
  if (!value) {
    return {};
  }

  const sanitized = sanitizeOriginalSubmissionValue(value, "submittedData");

  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) {
    return {};
  }

  delete sanitized.message;

  return sanitized;
}

function sanitizeOriginalSubmissionValue(
  value: JsonValue,
  key: string,
): JsonValue | undefined {
  if (isSensitiveSubmissionKey(key)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeOriginalSubmissionValue(item, "item"))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (value && typeof value === "object") {
    const output: JsonObject = {};

    for (const [childKey, childValue] of Object.entries(value)) {
      const sanitized = sanitizeOriginalSubmissionValue(childValue, childKey);

      if (sanitized !== undefined) {
        output[childKey] = sanitized;
      }
    }

    return output;
  }

  return value;
}

function isSensitiveSubmissionKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");

  return (
    sensitiveSubmissionKeys.has(normalized) ||
    /(?:token|tokens|cookie|cookies|credential|credentials|password|secret|apikey|authorization|encryptionkey|encrypted|ciphertext|hash)$/.test(
      normalized,
    )
  );
}

function jsonObjectValue(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function stringValue(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizeAdminRequestList(
  result: RequestListResult,
  limit: number,
): AdminRequestListView {
  const response: AdminRequestListView = {
    requests: result.requests.map((request) =>
      normalizeAdminRequestListItem(request),
    ),
    pagination: {
      limit,
    },
  };

  if (result.nextCursor) {
    response.pagination.nextCursor = encodeAdminRequestListCursor(
      result.nextCursor,
    );
  }

  return response;
}

function normalizeAdminRequestListItem(request: {
  id: string;
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  source?: {
    channel: string | null;
    siteKey: string | null;
    formKey: string | null;
  } | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AdminRequestListItem {
  return {
    id: request.id,
    publicId: request.publicId,
    type: request.type,
    status: request.status,
    source: request.source ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}

function parseLimit(
  value: string | null,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, value: defaultAdminPageSize };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maxAdminPageSize) {
    return { ok: false, message: "limit must be an integer from 1 to 100." };
  }

  return { ok: true, value: parsed };
}

function parseSingleEnum<const T extends readonly string[]>(
  value: string | null,
  allowedValues: T,
  name: string,
): { ok: true; value: T[number] | undefined } | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, value: undefined };
  }

  const allowed = new Set<string>(allowedValues);

  if (!allowed.has(value)) {
    return { ok: false, message: `${name} contains an invalid value.` };
  }

  return { ok: true, value: value as T[number] };
}

function parseDateFilter(
  value: string | null,
): { ok: true; value: Date | undefined } | { ok: false } {
  if (value === null || value === "") {
    return { ok: true, value: undefined };
  }

  const parsed = z.string().datetime({ offset: true }).safeParse(value);

  if (!parsed.success) {
    return { ok: false };
  }

  const date = new Date(parsed.data);

  return Number.isNaN(date.getTime())
    ? { ok: false }
    : { ok: true, value: date };
}

function parseAdminListCursor(
  value: string | null,
):
  | { ok: true; value: RequestListFilters["cursor"] | undefined }
  | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return { ok: false, message: "cursor is invalid." };
    }

    const createdAt = new Date(parsed.createdAt);

    if (Number.isNaN(createdAt.getTime()) || !parsed.id.trim()) {
      return { ok: false, message: "cursor is invalid." };
    }

    return {
      ok: true,
      value: {
        createdAt,
        id: parsed.id,
      },
    };
  } catch {
    return { ok: false, message: "cursor is invalid." };
  }
}

function sanitizeEventData(data: JsonObject): JsonObject {
  const sanitized = sanitizeJsonValue(data);

  return sanitized && typeof sanitized === "object" && !Array.isArray(sanitized)
    ? sanitized
    : {};
}

function sanitizeJsonValue(value: JsonValue): JsonValue | undefined {
  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeJsonValue(item))
      .filter((item): item is JsonValue => item !== undefined);
  }

  if (value && typeof value === "object") {
    const result: JsonObject = {};

    for (const [key, nestedValue] of Object.entries(value)) {
      if (sensitiveEventKeys.has(key.toLowerCase())) {
        continue;
      }

      const sanitized = sanitizeJsonValue(nestedValue);

      if (sanitized !== undefined) {
        result[key] = sanitized;
      }
    }

    return result;
  }

  return value;
}

function maskCommunicationRecipient(communication: {
  recipient: string | null;
  recipientEncrypted: string | null;
}): string | null {
  if (communication.recipient) {
    return maskEmailAddress(communication.recipient);
  }

  if (!communication.recipientEncrypted) {
    return null;
  }

  try {
    return maskEmailAddress(decryptPii(communication.recipientEncrypted));
  } catch {
    return null;
  }
}

function maskEmailAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [localPart, domain] = value.split("@");

  if (!localPart || !domain) {
    return "***";
  }

  const first = localPart[0] ?? "*";
  const last = localPart.length > 1 ? localPart[localPart.length - 1] : "*";

  return `${first}***${last}@${domain}`;
}

function emptyToUndefined(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function contentDispositionAttachment(fileName: string): string {
  return `attachment; filename="${escapeHeaderValue(fileName)}"`;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .normalize("NFKD")
    .replace(/[^\w. -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);

  return sanitized || "attachment";
}

function notificationSubject(
  type: ConsumerNotificationType,
  request: { publicId: string },
): string {
  switch (type) {
    case "REQUEST_COMPLETED":
      return `MagicTrust request completed: ${request.publicId}`;
    case "REQUEST_REJECTED":
      return `MagicTrust request rejected: ${request.publicId}`;
    case "FILE_AVAILABLE":
      return `MagicTrust file available: ${request.publicId}`;
    case "REQUEST_UPDATED":
      return `MagicTrust request updated: ${request.publicId}`;
  }
}

function notificationMessage(
  type: ConsumerNotificationType,
  input: {
    customMessage: string | undefined;
    attachmentFileName: string | null;
  },
): string {
  if (input.customMessage) {
    return input.customMessage;
  }

  if (type === "FILE_AVAILABLE" && input.attachmentFileName) {
    return `A file is available for your request: ${input.attachmentFileName}`;
  }

  return "Your request has been updated.";
}

function notificationBody(input: {
  publicId: string;
  status: RequestStatus;
  message: string;
  trackingUrl: string;
  secureAccessUrl: string | null;
}): string {
  const lines = [
    "Your MagicTrust request has an update.",
    "",
    `Reference number: ${input.publicId}`,
    `Current status: ${input.status}`,
    "",
    input.message,
    "",
    `Track your request: ${input.trackingUrl}`,
  ];

  if (input.secureAccessUrl) {
    lines.push("", `Secure access link: ${input.secureAccessUrl}`);
  }

  return lines.join("\n");
}

function parseJsonObject(
  value: string,
): { ok: true; value: JsonObject } | { ok: false; message: string } {
  let parsed: unknown;

  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, message: "JSON is invalid." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "JSON must be an object." };
  }

  return { ok: true, value: parsed as JsonObject };
}

function hasDangerousKeyInUnknown(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKeyInUnknown(item));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      hasDangerousKeyInUnknown(child),
  );
}

function serializedJsonByteLength(value: JsonObject): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

async function safeFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");

  if (!origin) {
    return false;
  }

  return origin === new URL(request.url).origin;
}

function redirectToRequestDetail(
  request: Request,
  publicId: string,
  params: { success?: string; error?: string },
): Response {
  const url = new URL(
    `/admin/requests/${encodeURIComponent(publicId)}`,
    request.url,
  );

  if (params.success) {
    url.searchParams.set("success", params.success);
  }

  if (params.error) {
    url.searchParams.set("error", params.error);
  }

  return Response.redirect(url, 303);
}

function actionError(code: string, message: string, status: number): Response {
  return Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );
}

function notFoundResponse(): Response {
  return Response.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Request or attachment not found.",
      },
    },
    { status: 404 },
  );
}

function missingDatabaseRequestRepository(): RequestRepository {
  return {
    findByIdOrPublicId() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    findAdminSensitiveData() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    list() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    updateStatus() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    updateMutableData() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    addCustomEvent() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    addComment() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    addAttachment() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    recordAttachmentDownloaded() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    recordAdminAttachmentDownloaded() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    createCommunication() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    markCommunicationSent() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    markCommunicationFailed() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    findConsumerAccessLinkTarget() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    findConsumerNotificationTarget() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    createConsumerAccessToken() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    createConsumerNotificationAccessToken() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    recordConsumerAccessLinkSent() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    markConsumerNotificationSent() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    markConsumerNotificationFailed() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    consumeConsumerAccessToken() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    validateConsumerAccessSession() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    recordConsumerAttachmentDownloaded() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    createIdentityVerificationToken() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    recordIdentityVerificationSent() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    verifyIdentityToken() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
  };
}
