import "server-only";

import {
  createDatabase,
  createRequestRepository,
  type RequestDetails,
  type RequestListFilters,
  type RequestListResult,
  type RequestRepository,
} from "@magictrust/database";
import {
  commentVisibilities,
  requestStatuses,
  requestTypes,
  type JsonObject,
  type JsonValue,
  type RequestStatus,
  type RequestType,
} from "@magictrust/domain";
import { getRequiredDatabaseUrl } from "@magictrust/config";
import { decryptPii } from "@magictrust/privacy";
import {
  createVercelBlobPrivateStorageProvider,
  type PrivateFileStorageProvider,
} from "@magictrust/storage";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

export type AdminDashboardDependencies = {
  requestRepository: RequestRepository;
  storageProvider: PrivateFileStorageProvider;
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

export function createAdminDashboardDependencies(): AdminDashboardDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      requestRepository: missingDatabaseRequestRepository(),
      storageProvider: createVercelBlobPrivateStorageProvider(),
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    requestRepository: createRequestRepository(db),
    storageProvider: createVercelBlobPrivateStorageProvider(),
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
): Promise<AdminRequestDetailView | null> {
  const request =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  return request ? normalizeAdminRequestDetail(request) : null;
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
