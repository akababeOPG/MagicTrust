import "server-only";

import { randomBytes } from "node:crypto";

import {
  createDatabase,
  createRequestRepository,
  type AdminHomeSummary,
  type AdminUserAssignmentRecord,
  type AdminRequestListWorkflowData,
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
  deriveRequestSlaState,
  formatDueDate,
  formatDueRelative,
  getAllowedWorkflowTransitions,
  getRequestNextStep,
  getWorkflowDefinitionForRequest,
  requestStatuses,
  requestTypes,
  type JsonObject,
  type JsonValue,
  type RequestStatus,
  type RequestSlaState,
  type RequestType,
} from "@magictrust/domain";
import { getAppBaseUrl, getRequiredDatabaseUrl } from "@magictrust/config";
import type { EmailProvider } from "@magictrust/email";
import { createResendEmailProvider } from "@magictrust/email";
import {
  decryptPii,
  hashAccessToken,
  hashIdentityVerificationToken,
  hashPii,
  normalizeEmailForHash,
  normalizePhoneForHash,
} from "@magictrust/privacy";
import {
  createVercelBlobPrivateStorageProvider,
  type PrivateFileStorageProvider,
} from "@magictrust/storage";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";
import { guidedCompletionConfig } from "./guided-completion";

export type AdminDashboardDependencies = {
  requestRepository: RequestRepository;
  storageProvider: PrivateFileStorageProvider;
  emailProvider: EmailProvider;
  appBaseUrl: string;
  now: () => Date;
  generateToken: () => string;
};

type AdminRequestQueryDependencies = Pick<
  AdminDashboardDependencies,
  "requestRepository" | "now"
>;

export type AdminHomeView = {
  summary: AdminHomeSummary;
  recentRequests: AdminRequestListItem[];
};

export type AdminRequestListView = {
  requests: AdminRequestListItem[];
  assignmentOptions: AdminAssignmentOption[];
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
  requesterSummary?: {
    name: string;
    contact: string | null;
  };
  ageDays?: number;
  nextStep?: string;
  assignment: {
    displayName: string | null;
    isCurrentUser: boolean;
  };
  due: {
    dueAt: string | null;
    state: RequestSlaState;
    stateLabel: string;
    dateLabel: string;
    shortDateLabel: string;
    relativeLabel: string | null;
  };
};

export type AdminAssignmentOption = {
  id: string;
  displayName: string;
  role: "ADMIN" | "OPERATOR";
};

export type AdminRequestDetailView = AdminRequestListItem & {
  assignment: AdminRequestListItem["assignment"] & {
    assignedToAdminUserId: string | null;
    assignedAt: string | null;
    options: AdminAssignmentOption[];
  };
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

type AdminViewerContext = {
  role: AdminSession["role"];
  adminUserId: string | null;
};

const defaultAdminPageSize = 25;
const maxAdminPageSize = 100;
const dueFilterValues = [
  "overdue",
  "due-soon",
  "on-track",
  "no-due-date",
] as const;
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
const conversationalWaitingSubject =
  "More information is needed for your MagicTrust request";
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
  "REQUEST_ASSIGNED",
  "REQUEST_UNASSIGNED",
  "REQUEST_DUE_DATE_SET",
  "REQUEST_DUE_DATE_UPDATED",
  "REQUEST_DUE_DATE_CLEARED",
]);
const customEventNamePattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const maxAdminMutableDataBytes = 32 * 1024;
const maxCustomEventDataBytes = 16 * 1024;
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
  dependencies: AdminRequestQueryDependencies,
  viewer:
    | AdminSession["role"]
    | Pick<AdminSession, "role" | "adminUserId"> = "VIEWER",
): Promise<
  { ok: true; data: AdminRequestListView } | { ok: false; message: string }
> {
  const context = adminViewerContext(viewer);
  const parsed = parseAdminRequestListSearchParams(
    searchParams,
    context.role,
    context.adminUserId,
  );

  if (!parsed.ok) {
    return parsed;
  }

  const now = dependencies.now();

  const assignmentOptions =
    context.role === "ADMIN"
      ? normalizeAssignmentOptions(
          await dependencies.requestRepository.listActiveAssignableAdminUsers(),
        )
      : [];

  if (
    typeof parsed.filters.assignedToAdminUserId === "string" &&
    context.role === "ADMIN" &&
    !assignmentOptions.some(
      (option) => option.id === parsed.filters.assignedToAdminUserId,
    )
  ) {
    return { ok: false, message: "Assigned user is not available." };
  }

  const result = await dependencies.requestRepository.list({
    ...parsed.filters,
    slaNow: now,
  });
  const workflowRows = dependencies.requestRepository.findAdminListWorkflowData
    ? await dependencies.requestRepository.findAdminListWorkflowData(
        result.requests.map((request) => request.id),
      )
    : [];
  const workflowByRequest = new Map(
    workflowRows.map((row) => [row.requestId, row]),
  );
  const assignedUsers =
    context.role === "VIEWER"
      ? []
      : await dependencies.requestRepository.findAdminUsersByIds([
          ...new Set(
            result.requests
              .map((request) => request.assignedToAdminUserId)
              .filter((id): id is string => Boolean(id)),
          ),
        ]);
  const assignedUserById = new Map(
    assignedUsers.map((user) => [user.id, adminUserDisplayName(user)]),
  );

  return {
    ok: true,
    data: normalizeAdminRequestList(
      result,
      parsed.filters.limit,
      context,
      workflowByRequest,
      assignedUserById,
      assignmentOptions,
      now,
    ),
  };
}

export async function getAdminHomeDashboard(
  session: Pick<AdminSession, "adminUserId" | "role">,
  dependencies: AdminRequestQueryDependencies,
): Promise<AdminHomeView> {
  const getSummary = dependencies.requestRepository.getAdminHomeSummary;

  if (!getSummary) {
    throw new Error("Admin dashboard summary query is unavailable.");
  }

  const now = dependencies.now();
  const [summary, recent] = await Promise.all([
    getSummary.call(dependencies.requestRepository, {
      adminUserId: session.adminUserId,
      now,
    }),
    listAdminRequests(
      new URLSearchParams({ limit: "8" }),
      { ...dependencies, now: () => now },
      session,
    ),
  ]);

  if (!recent.ok) {
    throw new Error("Recent requests could not be loaded.");
  }

  return {
    summary,
    recentRequests: recent.data.requests,
  };
}

export async function getAdminRequestDetail(
  publicId: string,
  dependencies: AdminDashboardDependencies,
  viewer:
    | AdminSession["role"]
    | Pick<AdminSession, "role" | "adminUserId"> = "VIEWER",
): Promise<AdminRequestDetailView | null> {
  const context = adminViewerContext(viewer);
  const request =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!request) {
    return null;
  }

  const [assignedUser] =
    context.role !== "VIEWER" && request.assignedToAdminUserId
      ? await dependencies.requestRepository.findAdminUsersByIds([
          request.assignedToAdminUserId,
        ])
      : [];
  const assignmentOptions =
    context.role === "ADMIN"
      ? normalizeAssignmentOptions(
          await dependencies.requestRepository.listActiveAssignableAdminUsers(),
        )
      : [];
  const detail = normalizeAdminRequestDetail(
    request,
    context,
    assignedUser ? adminUserDisplayName(assignedUser) : null,
    assignmentOptions,
    dependencies.now(),
  );

  if (context.role !== "ADMIN" && context.role !== "OPERATOR") {
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

export async function updateAdminRequestAssignment(
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
    .discriminatedUnion("action", [
      z.object({
        action: z.literal("assign"),
        assigneeId: z.string().uuid().optional(),
      }),
      z.object({ action: z.literal("unassign") }),
    ])
    .safeParse({
      action: formData.get("action"),
      assigneeId:
        typeof formData.get("assigneeId") === "string" &&
        formData.get("assigneeId") !== ""
          ? formData.get("assigneeId")
          : undefined,
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Assignment selection is invalid.",
    });
  }

  if (
    parsed.data.action === "assign" &&
    adminSession.role === "OPERATOR" &&
    parsed.data.assigneeId &&
    parsed.data.assigneeId !== adminSession.adminUserId
  ) {
    return actionError(
      "FORBIDDEN",
      "Operators may assign requests only to themselves.",
      403,
    );
  }

  const actor = {
    id: adminSession.adminUserId,
    role: adminSession.role,
  };
  const result =
    parsed.data.action === "unassign"
      ? await dependencies.requestRepository.unassignRequest(publicId, actor)
      : await dependencies.requestRepository.assignRequest(
          publicId,
          adminSession.role === "OPERATOR"
            ? adminSession.adminUserId
            : (parsed.data.assigneeId ?? ""),
          actor,
        );

  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }

    if (result.code === "FORBIDDEN") {
      return actionError(
        "FORBIDDEN",
        "You are not allowed to change this assignment.",
        403,
      );
    }

    return redirectToRequestDetail(request, publicId, {
      error: "The selected assignee is not available.",
    });
  }

  const assigned = parsed.data.action === "assign";

  return redirectToRequestDetail(request, publicId, {
    success: result.changed
      ? assigned
        ? "Request assigned."
        : "Request unassigned."
      : assigned
        ? "Request is already assigned to that user."
        : "Request is already unassigned.",
  });
}

export async function updateAdminRequestDueDate(
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

  const action = z.enum(["set", "clear"]).safeParse(formData.get("action"));

  if (!action.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Due date action is invalid.",
    });
  }

  const dueAt =
    action.data === "set" ? parseUtcDueDateInput(formData.get("dueAt")) : null;

  if (action.data === "set" && !dueAt) {
    return redirectToRequestDetail(request, publicId, {
      error: "Enter a valid due date and time in UTC.",
    });
  }

  const actor = {
    id: adminSession.adminUserId,
    role: adminSession.role,
  };
  const result =
    action.data === "clear"
      ? await dependencies.requestRepository.clearRequestDueDate(
          publicId,
          actor,
        )
      : await dependencies.requestRepository.setRequestDueDate(
          publicId,
          dueAt!,
          actor,
        );

  if (!result.ok) {
    if (result.code === "NOT_FOUND") {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }

    return actionError(
      "FORBIDDEN",
      "You are not allowed to change this due date.",
      403,
    );
  }

  const set = action.data === "set";

  return redirectToRequestDetail(request, publicId, {
    success: result.changed
      ? set
        ? "Due date saved."
        : "Due date cleared."
      : set
        ? "Due date is already set to that time."
        : "Request already has no due date.",
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

  const validDestinations = getValidAdminStatusDestinations(existing);

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

export async function addAdminInternalNote(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);
  const parsed = z
    .object({ body: z.string().trim().min(1).max(5_000) })
    .safeParse({ body: formData?.get("body") });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Internal note is required.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const duplicate = existing.comments.some(
    (comment) =>
      comment.visibility === "INTERNAL" &&
      comment.body === parsed.data.body &&
      comment.actorType === "ADMIN_USER" &&
      comment.actorId === adminSession.adminUserId,
  );

  if (!duplicate) {
    await dependencies.requestRepository.addComment(existing.id, {
      visibility: "INTERNAL",
      body: parsed.data.body,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
    });
  }

  return redirectToRequestDetail(request, publicId, {
    success: duplicate
      ? "Internal note already recorded."
      : "Internal note added.",
  });
}

export async function startAdminRequestProcessing(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (
    existing.assignedToAdminUserId !== null &&
    existing.assignedToAdminUserId !== undefined &&
    existing.assignedToAdminUserId !== adminSession.adminUserId
  ) {
    return processingTransitionFailureResponse(
      request,
      publicId,
      "ASSIGNED_TO_ANOTHER_USER",
    );
  }

  if (existing.status === "PROCESSING") {
    return redirectToRequestDetail(request, publicId, {
      success: "Processing has already started.",
    });
  }

  if (
    getRequestNextStep(existing).actionType !== "START_PROCESSING" ||
    !getAllowedWorkflowTransitions(existing).includes("PROCESSING")
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "This request is not ready to process.",
    });
  }

  const result = await dependencies.requestRepository.transitionToProcessing(
    existing.id,
    {
      expectedStatus: existing.status,
      actor: {
        id: adminSession.adminUserId,
        role: adminSession.role,
      },
      reason: "Processing started from admin dashboard",
    },
  );

  if (!result.ok) {
    return processingTransitionFailureResponse(request, publicId, result.code);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Processing started.",
  });
}

function processingTransitionFailureResponse(
  request: Request,
  publicId: string,
  code:
    | "NOT_FOUND"
    | "ASSIGNED_TO_ANOTHER_USER"
    | "ACTOR_NOT_ASSIGNABLE"
    | "STATUS_CHANGED",
): Response {
  if (code === "NOT_FOUND") {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (code === "ACTOR_NOT_ASSIGNABLE") {
    return actionError("FORBIDDEN", "You cannot process this request.", 403);
  }

  return redirectToRequestDetail(request, publicId, {
    error:
      code === "ASSIGNED_TO_ANOTHER_USER"
        ? "This request is assigned to another user."
        : "The request changed before processing could start. Try again.",
  });
}

export async function waitAdminRequestForRequester(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);
  const parsed = z
    .object({ message: z.string().trim().min(1).max(2_000) })
    .safeParse({ message: formData?.get("message") });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Message to requester is required.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (existing.status === "WAITING_FOR_REQUESTER") {
    return redirectToRequestDetail(request, publicId, {
      success: "Request is already waiting for the requester.",
    });
  }

  const nextStep = getRequestNextStep(existing);
  const workflow = getWorkflowDefinitionForRequest(existing);

  if (
    workflow.id !== "CONVERSATIONAL_PROCESSING" ||
    nextStep.secondaryActionType !== "WAIT_FOR_REQUESTER" ||
    !getAllowedWorkflowTransitions(existing).includes("WAITING_FOR_REQUESTER")
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "This request cannot wait for the requester right now.",
    });
  }

  const retryCommunication = findFailedNotificationCommunication(existing, {
    notificationType: "REQUEST_UPDATED",
    subject: conversationalWaitingSubject,
    actorId: adminSession.adminUserId,
    message: parsed.data.message,
  });

  if (!retryCommunication) {
    const comment = await dependencies.requestRepository.addComment(
      existing.id,
      {
        visibility: "PUBLIC",
        body: parsed.data.message,
        actorType: "ADMIN_USER",
        actorId: adminSession.adminUserId,
      },
    );

    if (!comment) {
      return actionError("NOT_FOUND", "Request not found.", 404);
    }
  }

  const notificationForm = new FormData();
  notificationForm.set("type", "REQUEST_UPDATED");
  const notificationRequest = new Request(request.url, {
    method: "POST",
    headers: { origin: new URL(request.url).origin },
    body: notificationForm,
  });
  const delivery = await sendAdminConsumerNotification(
    notificationRequest,
    publicId,
    adminSession,
    dependencies,
    {
      subject: conversationalWaitingSubject,
      message: parsed.data.message,
      status: "WAITING_FOR_REQUESTER",
      includeSecureAccessLink: true,
      retryCommunicationId: retryCommunication?.id,
    },
  );
  const location = delivery.headers.get("location");
  const delivered =
    delivery.status === 303 &&
    location !== null &&
    new URL(location).searchParams.has("success");

  if (!delivered) {
    return redirectToRequestDetail(request, publicId, {
      error:
        "The requester message could not be sent. The request remains in processing. Try again.",
    });
  }

  const updated = await dependencies.requestRepository.updateStatus(
    existing.id,
    {
      status: "WAITING_FOR_REQUESTER",
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
      reason: "Waiting for requester response",
    },
  );

  if (!updated) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Requester notified. The request is now waiting for a response.",
  });
}

export async function resumeAdminRequestProcessing(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (
    existing.assignedToAdminUserId !== null &&
    existing.assignedToAdminUserId !== undefined &&
    existing.assignedToAdminUserId !== adminSession.adminUserId
  ) {
    return processingTransitionFailureResponse(
      request,
      publicId,
      "ASSIGNED_TO_ANOTHER_USER",
    );
  }

  if (
    existing.status === "PROCESSING" &&
    existing.events.some(
      (event) =>
        event.type === "STATUS_CHANGED" &&
        event.data.previousStatus === "WAITING_FOR_REQUESTER" &&
        event.data.newStatus === "PROCESSING",
    )
  ) {
    return redirectToRequestDetail(request, publicId, {
      success: "Processing has already resumed.",
    });
  }

  if (
    getWorkflowDefinitionForRequest(existing).id !==
      "CONVERSATIONAL_PROCESSING" ||
    getRequestNextStep(existing).actionType !== "RESUME_PROCESSING" ||
    !getAllowedWorkflowTransitions(existing).includes("PROCESSING")
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "This request is not waiting for processing to resume.",
    });
  }

  const result = await dependencies.requestRepository.transitionToProcessing(
    existing.id,
    {
      expectedStatus: existing.status,
      actor: {
        id: adminSession.adminUserId,
        role: adminSession.role,
      },
      reason: "Processing resumed from admin dashboard",
    },
  );

  if (!result.ok) {
    return processingTransitionFailureResponse(request, publicId, result.code);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Processing resumed.",
  });
}

export async function resendAdminIdentityVerification(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  if (
    (existing.type !== "DATA_ACCESS" && existing.type !== "DATA_DELETION") ||
    existing.status !== "PENDING_VERIFICATION"
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "Verification cannot be resent for this request.",
    });
  }

  const latestSent = existing.events.find(
    (event) => event.type === "IDENTITY_VERIFICATION_SENT",
  );

  if (
    latestSent &&
    dependencies.now().getTime() - latestSent.createdAt.getTime() < 10_000
  ) {
    return redirectToRequestDetail(request, publicId, {
      success: "Verification email was already sent.",
    });
  }

  const target =
    await dependencies.requestRepository.findConsumerNotificationTarget(
      existing.id,
    );

  if (!target?.requesterEmailEncrypted) {
    return redirectToRequestDetail(request, publicId, {
      error: "Requester email is unavailable.",
    });
  }

  const recipient = safelyDecryptPii(target.requesterEmailEncrypted);

  if (!recipient) {
    return redirectToRequestDetail(request, publicId, {
      error: "Requester email is unavailable.",
    });
  }

  const token = dependencies.generateToken();
  const verification =
    await dependencies.requestRepository.createIdentityVerificationToken(
      existing.id,
      {
        tokenHash: hashIdentityVerificationToken(token),
        expiresAt: new Date(dependencies.now().getTime() + 24 * 60 * 60 * 1000),
      },
    );

  if (!verification) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const verificationUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${existing.publicId}/verify?token=${encodeURIComponent(token)}`;
  const subject = `Verify your MagicTrust request: ${existing.publicId}`;
  const body = [
    "Verify your email to continue your privacy request.",
    "",
    `Reference number: ${existing.publicId}`,
    `Verification link: ${verificationUrl}`,
    "",
    "This link expires in 24 hours and can be used once.",
  ].join("\n");
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
    await dependencies.requestRepository.markCommunicationSent(
      existing.id,
      communication.id,
      {
        providerMessageId: sent.providerMessageId,
        actorType: "ADMIN_USER",
        actorId: adminSession.adminUserId,
      },
    );
    await dependencies.requestRepository.recordIdentityVerificationSent(
      existing.id,
      {
        verificationTokenId: verification.id,
        communicationId: communication.id,
        provider: sent.provider,
        providerMessageId: sent.providerMessageId,
      },
    );

    return redirectToRequestDetail(request, publicId, {
      success: "Verification email sent.",
    });
  } catch {
    await dependencies.requestRepository.markCommunicationFailed(
      existing.id,
      communication.id,
      {
        errorMessage: "Email provider failed to send the message.",
        actorType: "ADMIN_USER",
        actorId: adminSession.adminUserId,
      },
    );

    return redirectToRequestDetail(request, publicId, {
      error: "Verification email could not be sent.",
    });
  }
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

export async function uploadAdminResponseFile(
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

  formData.set("visibility", "PUBLIC");
  const guidedRequest = new Request(request.url, {
    method: "POST",
    headers: { origin: new URL(request.url).origin },
    body: formData,
  });

  return uploadAdminRequestAttachment(
    guidedRequest,
    publicId,
    adminSession,
    dependencies,
  );
}

export async function sendAdminConsumerNotification(
  request: Request,
  publicId: string,
  adminSession: AdminSession,
  dependencies: AdminDashboardDependencies,
  overrides?: {
    subject: string;
    message: string;
    status?: RequestStatus;
    includeSecureAccessLink?: boolean;
    retryCommunicationId?: string;
  },
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

  const retryCommunication = overrides?.retryCommunicationId
    ? (existing.communications.find(
        (communication) =>
          communication.id === overrides.retryCommunicationId &&
          communication.status === "FAILED" &&
          communication.actorType === "ADMIN_USER" &&
          communication.actorId === adminSession.adminUserId,
      ) ?? null)
    : null;

  if (overrides?.retryCommunicationId && !retryCommunication) {
    return redirectToRequestDetail(request, publicId, {
      error: "The failed notification could not be retried.",
    });
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
  }

  if (
    !retryCommunication &&
    (parsed.data.type === "FILE_AVAILABLE" ||
      overrides?.includeSecureAccessLink)
  ) {
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
  const message =
    overrides?.message ??
    notificationMessage(parsed.data.type, {
      customMessage: parsed.data.message,
      attachmentFileName: selectedAttachment?.fileName ?? null,
    });
  const subject =
    overrides?.subject ?? notificationSubject(parsed.data.type, existing);
  const body =
    retryCommunication?.body ??
    notificationBody({
      publicId: existing.publicId,
      status: overrides?.status ?? existing.status,
      message,
      trackingUrl,
      secureAccessUrl,
    });

  if (retryCommunication && retryCommunication.subject !== subject) {
    return redirectToRequestDetail(request, publicId, {
      error: "The failed notification could not be retried.",
    });
  }

  const communication =
    retryCommunication ??
    (await dependencies.requestRepository.createCommunication(existing.id, {
      recipient,
      subject,
      body,
      provider: dependencies.emailProvider.provider,
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
    }));

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

export async function sendAdminDataAccessResponse(
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
      attachmentId: z.string().trim().min(1).optional(),
      message: z.string().trim().max(2_000).optional(),
    })
    .safeParse({
      attachmentId: emptyToUndefined(
        formData.get("attachmentId")?.toString() ?? null,
      ),
      message: emptyToUndefined(formData.get("message")?.toString() ?? null),
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: "Response details are invalid.",
    });
  }

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const publicAttachments = existing.attachments.filter(
    (item) => item.visibility === "PUBLIC",
  );
  const nextStep = getRequestNextStep({
    type: existing.type,
    status: existing.status,
    hasPublicAttachments: publicAttachments.length > 0,
  });

  if (getWorkflowDefinitionForRequest(existing).id !== "DATA_ACCESS_STANDARD") {
    return redirectToRequestDetail(request, publicId, {
      error:
        "Secure response delivery is available for data access requests only.",
    });
  }

  if (existing.status === "SUCCESS") {
    return redirectToRequestDetail(request, publicId, {
      success: "This request is already completed.",
    });
  }

  if (
    nextStep.actionType !== "SEND_RESPONSE" ||
    !getAllowedWorkflowTransitions(existing).includes("SUCCESS")
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "This request is not ready for response delivery.",
    });
  }

  const attachment = parsed.data.attachmentId
    ? publicAttachments.find((item) => item.id === parsed.data.attachmentId)
    : (publicAttachments[0] ?? null);

  if (parsed.data.attachmentId && !attachment) {
    return redirectToRequestDetail(request, publicId, {
      error: "Select a valid response file.",
    });
  }

  const notificationType = attachment ? "FILE_AVAILABLE" : "REQUEST_COMPLETED";

  const alreadyDelivered = existing.events.some(
    (event) =>
      event.type === "CONSUMER_NOTIFICATION_SENT" &&
      event.data.notificationType === notificationType,
  );

  if (!alreadyDelivered) {
    const notificationForm = new FormData();
    notificationForm.set("type", notificationType);

    if (attachment) {
      notificationForm.set("attachmentId", attachment.id);
    }

    if (parsed.data.message) {
      notificationForm.set("message", parsed.data.message);
    }

    const notificationRequest = new Request(request.url, {
      method: "POST",
      headers: { origin: new URL(request.url).origin },
      body: notificationForm,
    });
    const delivery = await sendAdminConsumerNotification(
      notificationRequest,
      publicId,
      adminSession,
      dependencies,
    );
    const location = delivery.headers.get("location");
    const delivered =
      delivery.status === 303 &&
      location !== null &&
      new URL(location).searchParams.has("success");

    if (!delivered) {
      return redirectToRequestDetail(request, publicId, {
        error:
          "Response could not be sent. Review the delivery status and try again.",
      });
    }
  }

  const updated = await dependencies.requestRepository.updateStatus(
    existing.id,
    {
      status: "SUCCESS",
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
      reason: "Response delivered securely from admin dashboard",
    },
  );

  if (!updated) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: "Response sent and request completed.",
  });
}

export async function completeAdminGuidedRequest(
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

  const existing =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!existing) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  const workflowId = getWorkflowDefinitionForRequest(existing).id;
  const completion = guidedCompletionConfig(workflowId);

  if (!completion) {
    return redirectToRequestDetail(request, publicId, {
      error: "This completion action is not available for this request.",
    });
  }

  const parsed = z
    .object({
      confirmed: z.literal("on"),
      completionNote: z.string().trim().max(5_000).optional(),
    })
    .safeParse({
      confirmed: formData.get("confirmed"),
      completionNote: emptyToUndefined(
        formData.get("completionNote")?.toString() ?? null,
      ),
    });

  if (!parsed.success) {
    return redirectToRequestDetail(request, publicId, {
      error: completion.confirmationError,
    });
  }

  if (existing.status === "SUCCESS") {
    return redirectToRequestDetail(request, publicId, {
      success: "This request is already completed.",
    });
  }

  if (
    getRequestNextStep(existing).actionType !== "COMPLETE_REQUEST" ||
    !getAllowedWorkflowTransitions(existing).includes("SUCCESS")
  ) {
    return redirectToRequestDetail(request, publicId, {
      error: "This request is not ready for completion.",
    });
  }

  if (parsed.data.completionNote) {
    const duplicateNote = existing.comments.some(
      (comment) =>
        comment.visibility === "INTERNAL" &&
        comment.body === parsed.data.completionNote &&
        comment.actorType === "ADMIN_USER" &&
        comment.actorId === adminSession.adminUserId,
    );

    if (!duplicateNote) {
      const note = await dependencies.requestRepository.addComment(
        existing.id,
        {
          visibility: "INTERNAL",
          body: parsed.data.completionNote,
          actorType: "ADMIN_USER",
          actorId: adminSession.adminUserId,
        },
      );

      if (!note) {
        return actionError("NOT_FOUND", "Request not found.", 404);
      }
    }
  }

  const publicAttachments = existing.attachments.filter(
    (attachment) => attachment.visibility === "PUBLIC",
  );
  const attachment = publicAttachments[0] ?? null;
  const notificationType = attachment ? "FILE_AVAILABLE" : "REQUEST_COMPLETED";
  const alreadyNotified = existing.events.some((event) => {
    const communicationId = event.data.communicationId;

    return (
      event.type === "CONSUMER_NOTIFICATION_SENT" &&
      event.data.notificationType === notificationType &&
      typeof communicationId === "string" &&
      existing.communications.some(
        (communication) =>
          communication.id === communicationId &&
          communication.subject === completion.subject &&
          communication.status === "SENT",
      )
    );
  });
  const retryCommunication =
    workflowId === "CONVERSATIONAL_PROCESSING"
      ? findFailedNotificationCommunication(existing, {
          notificationType,
          subject: completion.subject,
          actorId: adminSession.adminUserId,
        })
      : null;

  if (!alreadyNotified) {
    const notificationForm = new FormData();
    notificationForm.set("type", notificationType);

    if (attachment) {
      notificationForm.set("attachmentId", attachment.id);
    }

    const notificationRequest = new Request(request.url, {
      method: "POST",
      headers: { origin: new URL(request.url).origin },
      body: notificationForm,
    });
    const delivery = await sendAdminConsumerNotification(
      notificationRequest,
      publicId,
      adminSession,
      dependencies,
      {
        subject: completion.subject,
        message: attachment
          ? completion.messageWithFiles
          : completion.messageWithoutFiles,
        status: "SUCCESS",
        includeSecureAccessLink: completion.includeSecureAccessLink,
        retryCommunicationId: retryCommunication?.id,
      },
    );
    const location = delivery.headers.get("location");
    const delivered =
      delivery.status === 303 &&
      location !== null &&
      new URL(location).searchParams.has("success");

    if (!delivered) {
      return redirectToRequestDetail(request, publicId, {
        error:
          "Completion notification could not be sent. The request remains in processing.",
      });
    }
  }

  const updated = await dependencies.requestRepository.updateStatus(
    existing.id,
    {
      status: "SUCCESS",
      actorType: "ADMIN_USER",
      actorId: adminSession.adminUserId,
      reason: completion.statusReason,
    },
  );

  if (!updated) {
    return actionError("NOT_FOUND", "Request not found.", 404);
  }

  return redirectToRequestDetail(request, publicId, {
    success: completion.successMessage,
  });
}

export const completeAdminDeletionRequest = completeAdminGuidedRequest;

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
  request: Pick<RequestDetails, "type" | "status">,
): RequestStatus[] {
  return getAllowedWorkflowTransitions(request);
}

export function parseAdminRequestListSearchParams(
  searchParams: URLSearchParams,
  role: AdminSession["role"] = "VIEWER",
  adminUserId: string | null = null,
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

  const due = parseSingleEnum(searchParams.get("due"), dueFilterValues, "due");

  if (!due.ok) {
    return due;
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

  const assignedTo = emptyToUndefined(searchParams.get("assignedTo"));
  let assignedToAdminUserId: string | null | undefined;

  if (assignedTo === "unassigned") {
    assignedToAdminUserId = null;
  } else if (assignedTo === "me") {
    if (role === "VIEWER" || !adminUserId) {
      return { ok: false, message: "Assigned user filter is not allowed." };
    }
    assignedToAdminUserId = adminUserId;
  } else if (assignedTo) {
    if (role !== "ADMIN" || !z.string().uuid().safeParse(assignedTo).success) {
      return { ok: false, message: "Assigned user filter is not allowed." };
    }
    assignedToAdminUserId = assignedTo;
  }

  const rawSearch = emptyToUndefined(
    searchParams.get("search") ?? searchParams.get("publicId"),
  );
  const search = rawSearch?.trim() || undefined;
  const searchFilters: Pick<
    RequestListFilters,
    "publicId" | "emailHash" | "phoneHash"
  > = {};

  if (search) {
    if (search.startsWith("req_")) {
      if (!/^req_[A-Za-z0-9_-]+$/.test(search)) {
        return { ok: false, message: "Request search value is invalid." };
      }

      searchFilters.publicId = search;
    } else if (role === "VIEWER") {
      return {
        ok: false,
        message: "VIEWER users may search by request ID only.",
      };
    } else if (search.includes("@")) {
      const normalized = normalizeEmailForHash(search);

      if (!z.string().email().safeParse(normalized).success) {
        return { ok: false, message: "Email search value is invalid." };
      }

      searchFilters.emailHash = hashPii(normalized);
    } else {
      const normalized = normalizePhoneForHash(search);

      if (!/^\+?[0-9]{7,20}$/.test(normalized)) {
        return { ok: false, message: "Phone search value is invalid." };
      }

      searchFilters.phoneHash = hashPii(normalized);
    }
  }

  return {
    ok: true,
    filters: {
      ...searchFilters,
      types: type.value ? [type.value] : undefined,
      statuses: status.value ? [status.value] : undefined,
      createdFrom: createdFrom.value,
      createdTo: createdTo.value,
      assignedToAdminUserId,
      dueState: due.value ? dueFilterState(due.value) : undefined,
      cursor: cursor.value,
      limit: limit.value,
    },
  };
}

function dueFilterState(
  value: (typeof dueFilterValues)[number],
): Exclude<RequestSlaState, "COMPLETED"> {
  switch (value) {
    case "overdue":
      return "OVERDUE";
    case "due-soon":
      return "DUE_SOON";
    case "on-track":
      return "ON_TRACK";
    case "no-due-date":
      return "NO_DUE_DATE";
  }
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
  context: AdminViewerContext = { role: "VIEWER", adminUserId: null },
  assignedToDisplayName: string | null = null,
  assignmentOptions: AdminAssignmentOption[] = [],
  now: Date = new Date(),
): AdminRequestDetailView {
  const effectiveAssignedToDisplayName = request.assignedToAdminUserId
    ? (assignedToDisplayName ??
      (context.role === "VIEWER" ? "Assigned" : "Admin user"))
    : null;

  return {
    ...normalizeAdminRequestListItem(
      request,
      context,
      effectiveAssignedToDisplayName,
      now,
    ),
    assignment: {
      displayName: effectiveAssignedToDisplayName,
      isCurrentUser:
        Boolean(context.adminUserId) &&
        request.assignedToAdminUserId === context.adminUserId,
      assignedToAdminUserId: request.assignedToAdminUserId ?? null,
      assignedAt: request.assignedAt?.toISOString() ?? null,
      options: assignmentOptions,
    },
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
  context: AdminViewerContext,
  workflowByRequest: Map<string, AdminRequestListWorkflowData>,
  assignedUserById: Map<string, string>,
  assignmentOptions: AdminAssignmentOption[],
  now: Date,
): AdminRequestListView {
  const response: AdminRequestListView = {
    assignmentOptions,
    requests: result.requests.map((request) => {
      const workflow = workflowByRequest.get(request.id);

      return {
        ...normalizeAdminRequestListItem(
          request,
          context,
          request.assignedToAdminUserId
            ? (assignedUserById.get(request.assignedToAdminUserId) ??
                (context.role === "VIEWER" ? "Assigned" : "Admin user"))
            : null,
          now,
        ),
        requesterSummary: normalizeRequesterSummary(workflow, context.role),
        ageDays: Math.max(
          0,
          Math.floor(
            (now.getTime() - request.createdAt.getTime()) /
              (24 * 60 * 60 * 1000),
          ),
        ),
        nextStep: getRequestNextStep({
          type: request.type,
          status: request.status,
          hasPublicAttachments: workflow?.hasPublicAttachment ?? false,
          latestResponseDeliveryStatus:
            workflow?.latestResponseDeliveryStatus ?? null,
        }).listLabel,
      };
    }),
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

function adminViewerContext(
  viewer: AdminSession["role"] | Pick<AdminSession, "role" | "adminUserId">,
): AdminViewerContext {
  return typeof viewer === "string"
    ? { role: viewer, adminUserId: null }
    : { role: viewer.role, adminUserId: viewer.adminUserId };
}

function normalizeAssignmentOptions(
  users: AdminUserAssignmentRecord[],
): AdminAssignmentOption[] {
  return users
    .filter(
      (
        user,
      ): user is AdminUserAssignmentRecord & {
        role: "ADMIN" | "OPERATOR";
      } => user.active && (user.role === "ADMIN" || user.role === "OPERATOR"),
    )
    .map((user) => ({
      id: user.id,
      displayName: adminUserDisplayName(user),
      role: user.role,
    }))
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
}

function adminUserDisplayName(user: AdminUserAssignmentRecord): string {
  const email = safelyDecryptPii(user.emailEncrypted);
  const localPart = email?.split("@", 1)[0]?.trim();
  const shortName = localPart
    ?.split(/[._-]+/)
    .find((part) => /^[A-Za-z][A-Za-z0-9]*$/.test(part));

  if (!shortName) {
    return user.role === "ADMIN" ? "Administrator" : "Operator";
  }

  return shortName.charAt(0).toUpperCase() + shortName.slice(1).toLowerCase();
}

function normalizeRequesterSummary(
  workflow: AdminRequestListWorkflowData | undefined,
  role: AdminSession["role"],
): { name: string; contact: string | null } {
  if (role === "VIEWER" || !workflow) {
    return { name: "Restricted", contact: null };
  }

  const original = safelyDecryptOriginalSubmission(
    workflow.submittedDataEncrypted,
  );
  const requester = jsonObjectValue(original?.requester);
  const encryptedName = safelyDecryptRequesterName(
    workflow.requesterNameEncrypted,
  );
  const firstName =
    stringValue(requester?.firstName) ?? encryptedName?.firstName;
  const lastName = stringValue(requester?.lastName) ?? encryptedName?.lastName;
  const name =
    [firstName, lastName].filter(Boolean).join(" ") || "Name unavailable";
  const email = safelyDecryptPii(workflow.requesterEmailEncrypted);
  const phone = safelyDecryptPii(workflow.requesterPhoneEncrypted);

  return {
    name,
    contact: email
      ? maskEmailAddress(email)
      : phone
        ? maskPhoneNumber(phone)
        : null,
  };
}

function maskPhoneNumber(value: string): string {
  const normalized = normalizePhoneForHash(value);
  const suffix = normalized.replace(/\D/g, "").slice(-4);

  return suffix ? `${"*".repeat(6)}${suffix}` : "Phone provided";
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
  assignedToAdminUserId?: string | null;
  dueAt?: Date | null;
}): AdminRequestListItem;
function normalizeAdminRequestListItem(
  request: {
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
    assignedToAdminUserId?: string | null;
    dueAt?: Date | null;
  },
  context?: AdminViewerContext,
  assignedToDisplayName?: string | null,
  now?: Date,
): AdminRequestListItem;
function normalizeAdminRequestListItem(
  request: {
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
    assignedToAdminUserId?: string | null;
    dueAt?: Date | null;
  },
  context: AdminViewerContext = { role: "VIEWER", adminUserId: null },
  assignedToDisplayName: string | null = null,
  now: Date = new Date(),
): AdminRequestListItem {
  return {
    id: request.id,
    publicId: request.publicId,
    type: request.type,
    status: request.status,
    source: request.source ?? null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    assignment: {
      displayName: assignedToDisplayName,
      isCurrentUser:
        Boolean(context.adminUserId) &&
        request.assignedToAdminUserId === context.adminUserId,
    },
    due: normalizeRequestDueSummary(request, now),
  };
}

function normalizeRequestDueSummary(
  request: Pick<RequestDetails, "status" | "dueAt">,
  now: Date,
): AdminRequestListItem["due"] {
  const dueAt = request.dueAt ?? null;
  const state = deriveRequestSlaState({ status: request.status, dueAt, now });

  return {
    dueAt: dueAt?.toISOString() ?? null,
    state,
    stateLabel: requestSlaStateLabel(state),
    dateLabel: dueAt ? formatDueDate(dueAt) : "No due date",
    shortDateLabel: dueAt ? formatDueDate(dueAt, "short") : "—",
    relativeLabel:
      state === "COMPLETED"
        ? dueAt
          ? "Completed"
          : null
        : dueAt
          ? formatDueRelative(dueAt, now)
          : null,
  };
}

function requestSlaStateLabel(state: RequestSlaState): string {
  switch (state) {
    case "NO_DUE_DATE":
      return "No due date";
    case "ON_TRACK":
      return "On track";
    case "DUE_SOON":
      return "Due soon";
    case "OVERDUE":
      return "Overdue";
    case "COMPLETED":
      return "Completed";
  }
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

function parseUtcDueDateInput(value: FormDataEntryValue | null): Date | null {
  if (typeof value !== "string" || value.length === 0) return null;

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    const date = new Date(`${value}:00.000Z`);

    return !Number.isNaN(date.getTime()) &&
      date.toISOString().slice(0, 16) === value
      ? date
      : null;
  }

  const parsed = z.string().datetime({ offset: true }).safeParse(value);

  if (!parsed.success) return null;
  const date = new Date(parsed.data);
  return Number.isNaN(date.getTime()) ? null : date;
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
  if (type === "FILE_AVAILABLE") {
    const fileLine = input.attachmentFileName
      ? `\n\nResponse file: ${input.attachmentFileName}`
      : "";
    const completion = `Your request has been completed and response files are available securely.${fileLine}`;
    return input.customMessage
      ? `${completion}\n\n${input.customMessage}`
      : completion;
  }

  if (type === "REQUEST_COMPLETED") {
    const completion = "Your request has been completed.";
    return input.customMessage
      ? `${completion}\n\n${input.customMessage}`
      : completion;
  }

  if (input.customMessage) {
    return input.customMessage;
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

function findFailedNotificationCommunication(
  request: Pick<RequestDetails, "events" | "communications">,
  input: {
    notificationType: ConsumerNotificationType;
    subject: string;
    actorId: string;
    message?: string;
  },
): RequestDetails["communications"][number] | null {
  const failedEvents = request.events
    .filter(
      (event) =>
        event.type === "CONSUMER_NOTIFICATION_FAILED" &&
        event.actorType === "ADMIN_USER" &&
        event.actorId === input.actorId &&
        event.data.notificationType === input.notificationType,
    )
    .sort(
      (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
    );

  for (const event of failedEvents) {
    const communicationId = event.data.communicationId;

    if (typeof communicationId !== "string") continue;

    const communication = request.communications.find(
      (item) =>
        item.id === communicationId &&
        item.status === "FAILED" &&
        item.subject === input.subject &&
        (!input.message ||
          item.body.includes(`\n\n${input.message}\n\nTrack your request:`)),
    );

    if (communication) return communication;
  }

  return null;
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
    listActiveAssignableAdminUsers() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    findAdminUsersByIds() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    getAdminHomeSummary() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    assignRequest() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    unassignRequest() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    setRequestDueDate() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    clearRequestDueDate() {
      throw new Error("DATABASE_URL is required for the admin dashboard.");
    },
    transitionToProcessing() {
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
