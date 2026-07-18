import type {
  ActorType,
  CommentVisibility,
  JsonObject,
  RequestAttachment,
  RequestAccessSession,
  RequestAccessToken,
  RequestComment,
  RequestCommunication,
  RequestEventCategory,
  RequestEventType,
  RequestIdentityVerificationToken,
  RequestSlaState,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import { requestDueSoonWindowMs } from "@magictrust/domain";
import { encryptPii, hashPii } from "@magictrust/privacy";
import {
  and,
  desc,
  eq,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  notInArray,
  or,
} from "drizzle-orm";

import type { AdminRole } from "./admin-auth-store";
import type { createDatabase } from "./index";
import {
  adminUsers,
  privacyRequests,
  requestAccessSessions,
  requestAccessTokens,
  requestAttachments,
  requestComments,
  requestCommunications,
  requestEvents,
  requestIdentityVerificationTokens,
  requesters,
} from "./schema";
import { createRequestEventAndEnqueueWebhooks } from "./webhooks";

type Database = ReturnType<typeof createDatabase>;

export type RequestSummary = {
  id: string;
  publicId: string;
  requesterId: string;
  type: RequestType;
  status: RequestStatus;
  source?: SafeRequestSource | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  assignedToAdminUserId?: string | null;
  assignedAt?: Date | null;
  assignedByAdminUserId?: string | null;
  dueAt?: Date | null;
  dueAtSetAt?: Date | null;
  dueAtSetByAdminUserId?: string | null;
};

export type AdminUserAssignmentRecord = {
  id: string;
  emailEncrypted: string;
  role: AdminRole;
  active: boolean;
};

export type SafeRequestSource = {
  channel: string | null;
  siteKey: string | null;
  formKey: string | null;
};

export type RequestEventSummary = {
  id: string;
  privacyRequestId: string;
  type: RequestEventType;
  category: RequestEventCategory;
  customType: string | null;
  visibility: CommentVisibility;
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
  createdAt: Date;
};

export type RequestDetails = RequestSummary & {
  mutableData: JsonObject;
  events: RequestEventSummary[];
  comments: RequestComment[];
  attachments: RequestAttachment[];
  communications: RequestCommunication[];
};

export type AdminRequestSensitiveData = {
  requestId: string;
  requesterEmailEncrypted: string | null;
  requesterPhoneEncrypted: string | null;
  requesterNameEncrypted: string | null;
  submittedDataEncrypted: string | null;
};

export type AdminRequestListWorkflowData = AdminRequestSensitiveData & {
  hasPublicAttachment: boolean;
  latestResponseDeliveryStatus: "SENT" | "FAILED" | null;
};

export type ConsumerAccessLinkTarget = RequestSummary & {
  requesterEmailEncrypted: string | null;
};

export type ConsumerNotificationTarget = RequestSummary & {
  requesterEmailEncrypted: string | null;
};

export type ConsumerSecureRequestDetails = RequestSummary & {
  comments: RequestComment[];
  attachments: RequestAttachment[];
  events: RequestEventSummary[];
};

export type RequestListFilters = {
  publicId?: string;
  statuses?: RequestStatus[];
  types?: RequestType[];
  emailHash?: string;
  phoneHash?: string;
  createdFrom?: Date;
  createdTo?: Date;
  updatedFrom?: Date;
  updatedTo?: Date;
  assignedToAdminUserId?: string | null;
  dueState?: Exclude<RequestSlaState, "COMPLETED">;
  slaNow?: Date;
  cursor?: {
    createdAt: Date;
    id: string;
  };
  limit: number;
};

export type RequestListResult = {
  requests: RequestSummary[];
  nextCursor: {
    createdAt: Date;
    id: string;
  } | null;
};

export type RequestRepository = {
  findByIdOrPublicId(id: string): Promise<RequestDetails | null>;
  findAdminSensitiveData(
    publicId: string,
  ): Promise<AdminRequestSensitiveData | null>;
  findAdminListWorkflowData?(
    requestIds: string[],
  ): Promise<AdminRequestListWorkflowData[]>;
  findConsumerAccessLinkTarget(
    publicId: string,
  ): Promise<ConsumerAccessLinkTarget | null>;
  findConsumerNotificationTarget(
    id: string,
  ): Promise<ConsumerNotificationTarget | null>;
  listActiveAssignableAdminUsers(): Promise<AdminUserAssignmentRecord[]>;
  findAdminUsersByIds(ids: string[]): Promise<AdminUserAssignmentRecord[]>;
  list(filters: RequestListFilters): Promise<RequestListResult>;
  assignRequest(
    id: string,
    assigneeId: string,
    actor: AdminRequestAssignmentActor,
  ): Promise<RequestAssignmentMutationResult>;
  unassignRequest(
    id: string,
    actor: AdminRequestAssignmentActor,
  ): Promise<RequestAssignmentMutationResult>;
  setRequestDueDate(
    id: string,
    dueAt: Date,
    actor: AdminRequestAssignmentActor,
  ): Promise<RequestDueDateMutationResult>;
  clearRequestDueDate(
    id: string,
    actor: AdminRequestAssignmentActor,
  ): Promise<RequestDueDateMutationResult>;
  updateStatus(
    id: string,
    input: UpdateRequestStatusInput,
  ): Promise<RequestSummary | null>;
  updateMutableData(
    id: string,
    input: UpdateMutableDataInput,
  ): Promise<MutableDataUpdateResult | null>;
  addCustomEvent(
    id: string,
    input: AddCustomRequestEventInput,
  ): Promise<RequestEventSummary | null>;
  addComment(
    id: string,
    input: AddRequestCommentInput,
  ): Promise<RequestComment | null>;
  addAttachment(
    id: string,
    input: AddRequestAttachmentInput,
  ): Promise<RequestAttachment | null>;
  recordAttachmentDownloaded(
    requestId: string,
    input: RecordAttachmentDownloadedInput,
  ): Promise<void>;
  recordAdminAttachmentDownloaded(
    requestId: string,
    input: RecordAdminAttachmentDownloadedInput,
  ): Promise<void>;
  createCommunication(
    id: string,
    input: CreateRequestCommunicationInput,
  ): Promise<RequestCommunication | null>;
  markCommunicationSent(
    requestId: string,
    communicationId: string,
    input: MarkCommunicationSentInput,
  ): Promise<RequestCommunication | null>;
  markCommunicationFailed(
    requestId: string,
    communicationId: string,
    input: MarkCommunicationFailedInput,
  ): Promise<RequestCommunication | null>;
  createConsumerAccessToken(
    publicId: string,
    input: CreateConsumerAccessTokenInput,
  ): Promise<ConsumerAccessTokenPreparation | null>;
  createConsumerNotificationAccessToken(
    requestId: string,
    input: CreateConsumerNotificationAccessTokenInput,
  ): Promise<RequestAccessToken | null>;
  recordConsumerAccessLinkSent(
    requestId: string,
    input: RecordConsumerAccessLinkSentInput,
  ): Promise<void>;
  markConsumerNotificationSent(
    requestId: string,
    communicationId: string,
    input: MarkConsumerNotificationSentInput,
  ): Promise<RequestCommunication | null>;
  markConsumerNotificationFailed(
    requestId: string,
    communicationId: string,
    input: MarkConsumerNotificationFailedInput,
  ): Promise<RequestCommunication | null>;
  consumeConsumerAccessToken(
    publicId: string,
    input: ConsumeConsumerAccessTokenInput,
  ): Promise<ConsumerAccessSessionPreparation | null>;
  validateConsumerAccessSession(
    publicId: string,
    input: ValidateConsumerAccessSessionInput,
  ): Promise<ConsumerSecureRequestDetails | null>;
  recordConsumerAttachmentDownloaded(
    requestId: string,
    input: RecordConsumerAttachmentDownloadedInput,
  ): Promise<void>;
  createIdentityVerificationToken(
    requestId: string,
    input: CreateIdentityVerificationTokenInput,
  ): Promise<RequestIdentityVerificationToken | null>;
  recordIdentityVerificationSent(
    requestId: string,
    input: RecordIdentityVerificationSentInput,
  ): Promise<void>;
  verifyIdentityToken(
    publicId: string,
    input: VerifyIdentityTokenInput,
  ): Promise<RequestSummary | null>;
};

export type AdminRequestAssignmentActor = {
  id: string;
  role: AdminRole;
};

export type RequestAssignmentMutationResult =
  | { ok: true; request: RequestSummary; changed: boolean }
  | {
      ok: false;
      code: "NOT_FOUND" | "ASSIGNEE_NOT_FOUND" | "FORBIDDEN";
    };

export type RequestDueDateMutationResult =
  | { ok: true; request: RequestSummary; changed: boolean }
  | { ok: false; code: "NOT_FOUND" | "FORBIDDEN" };

export type UpdateRequestStatusInput = {
  status: RequestStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
};

export type UpdateMutableDataInput = {
  data: JsonObject;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
};

export type MutableDataUpdateResult = {
  mutableData: JsonObject;
  updatedAt: Date;
};

export type AddCustomRequestEventInput = {
  customType: string;
  visibility: CommentVisibility;
  data: JsonObject;
  actorType: ActorType;
  actorId: string | null;
};

export type AddRequestCommentInput = {
  visibility: CommentVisibility;
  body: string;
  actorType: ActorType;
  actorId: string | null;
};

export type AddRequestAttachmentInput = {
  visibility: CommentVisibility;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  checksum: string;
  actorType: ActorType;
  actorId: string | null;
};

export type RecordAttachmentDownloadedInput = {
  attachmentId: string;
  fileName: string;
  storageProvider: string;
  actorId: string;
};

export type RecordAdminAttachmentDownloadedInput = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  actorId: string;
};

export type CreateRequestCommunicationInput = {
  recipient: string;
  subject: string;
  body: string;
  provider: string;
  actorType: ActorType;
  actorId: string | null;
};

export type MarkCommunicationSentInput = {
  providerMessageId: string;
  actorType: ActorType;
  actorId: string | null;
};

export type MarkCommunicationFailedInput = {
  errorMessage: string;
  actorType: ActorType;
  actorId: string | null;
};

export type CreateConsumerAccessTokenInput = {
  tokenHash: string;
  expiresAt: Date;
  recipient: string;
  subject: string;
  body: string;
  provider: string;
};

export type ConsumerAccessTokenPreparation = {
  request: RequestSummary;
  accessToken: RequestAccessToken;
  communication: RequestCommunication;
};

export type CreateConsumerNotificationAccessTokenInput = {
  tokenHash: string;
  expiresAt: Date;
};

export type RecordConsumerAccessLinkSentInput = {
  accessTokenId: string;
  communicationId: string;
  provider: string;
  providerMessageId: string;
};

export type ConsumerNotificationType =
  | "REQUEST_UPDATED"
  | "REQUEST_COMPLETED"
  | "REQUEST_REJECTED"
  | "FILE_AVAILABLE";

export type MarkConsumerNotificationSentInput = {
  notificationType: ConsumerNotificationType;
  providerMessageId: string;
  actorType: ActorType;
  actorId: string | null;
};

export type MarkConsumerNotificationFailedInput = {
  notificationType: ConsumerNotificationType;
  errorMessage: string;
  actorType: ActorType;
  actorId: string | null;
};

export type ConsumeConsumerAccessTokenInput = {
  tokenHash: string;
  sessionHash: string;
  sessionExpiresAt: Date;
  now: Date;
};

export type ConsumerAccessSessionPreparation = {
  request: RequestSummary;
  accessToken: RequestAccessToken;
  accessSession: RequestAccessSession;
};

export type ValidateConsumerAccessSessionInput = {
  sessionHash: string;
  now: Date;
};

export type RecordConsumerAttachmentDownloadedInput = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

export type CreateIdentityVerificationTokenInput = {
  tokenHash: string;
  expiresAt: Date;
};

export type RecordIdentityVerificationSentInput = {
  verificationTokenId: string;
  communicationId: string;
  provider: string;
  providerMessageId: string;
};

export type VerifyIdentityTokenInput = {
  tokenHash: string;
  now: Date;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createRequestRepository(db: Database): RequestRepository {
  return {
    async findByIdOrPublicId(id) {
      const [request] = await db
        .select({
          id: privacyRequests.id,
          publicId: privacyRequests.publicId,
          requesterId: privacyRequests.requesterId,
          type: privacyRequests.type,
          status: privacyRequests.status,
          completedAt: privacyRequests.completedAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
          mutableData: privacyRequests.mutableData,
          assignedToAdminUserId: privacyRequests.assignedToAdminUserId,
          assignedAt: privacyRequests.assignedAt,
          assignedByAdminUserId: privacyRequests.assignedByAdminUserId,
        })
        .from(privacyRequests)
        .where(
          uuidPattern.test(id)
            ? or(eq(privacyRequests.id, id), eq(privacyRequests.publicId, id))
            : eq(privacyRequests.publicId, id),
        )
        .limit(1);

      if (!request) {
        return null;
      }

      const events = await db
        .select(eventSelection)
        .from(requestEvents)
        .where(eq(requestEvents.privacyRequestId, request.id))
        .orderBy(desc(requestEvents.createdAt));

      const comments = await db
        .select({
          id: requestComments.id,
          requestId: requestComments.requestId,
          visibility: requestComments.visibility,
          body: requestComments.body,
          actorType: requestComments.actorType,
          actorId: requestComments.actorId,
          createdAt: requestComments.createdAt,
        })
        .from(requestComments)
        .where(eq(requestComments.requestId, request.id))
        .orderBy(desc(requestComments.createdAt));

      const attachments = await db
        .select({
          id: requestAttachments.id,
          requestId: requestAttachments.requestId,
          visibility: requestAttachments.visibility,
          fileName: requestAttachments.fileName,
          mimeType: requestAttachments.mimeType,
          sizeBytes: requestAttachments.sizeBytes,
          storageProvider: requestAttachments.storageProvider,
          storageKey: requestAttachments.storageKey,
          checksum: requestAttachments.checksum,
          actorType: requestAttachments.actorType,
          actorId: requestAttachments.actorId,
          createdAt: requestAttachments.createdAt,
        })
        .from(requestAttachments)
        .where(eq(requestAttachments.requestId, request.id))
        .orderBy(desc(requestAttachments.createdAt));

      const communications = await db
        .select(communicationSelection)
        .from(requestCommunications)
        .where(eq(requestCommunications.requestId, request.id))
        .orderBy(desc(requestCommunications.createdAt));

      return {
        ...request,
        events: events.map((event) => ({
          ...event,
          data: event.data as JsonObject,
        })),
        comments,
        attachments,
        communications,
        mutableData: request.mutableData as JsonObject,
      };
    },
    async findAdminSensitiveData(publicId) {
      const [request] = await db
        .select({
          requestId: privacyRequests.id,
          requesterEmailEncrypted: requesters.emailEncrypted,
          requesterPhoneEncrypted: requesters.phoneEncrypted,
          requesterNameEncrypted: requesters.nameEncrypted,
          submittedDataEncrypted: privacyRequests.submittedDataEncrypted,
        })
        .from(privacyRequests)
        .innerJoin(requesters, eq(privacyRequests.requesterId, requesters.id))
        .where(eq(privacyRequests.publicId, publicId))
        .limit(1);

      return request ?? null;
    },
    async findAdminListWorkflowData(requestIds) {
      if (requestIds.length === 0) {
        return [];
      }

      const sensitiveRows = await db
        .select({
          requestId: privacyRequests.id,
          requesterEmailEncrypted: requesters.emailEncrypted,
          requesterPhoneEncrypted: requesters.phoneEncrypted,
          requesterNameEncrypted: requesters.nameEncrypted,
          submittedDataEncrypted: privacyRequests.submittedDataEncrypted,
        })
        .from(privacyRequests)
        .innerJoin(requesters, eq(privacyRequests.requesterId, requesters.id))
        .where(inArray(privacyRequests.id, requestIds));
      const publicAttachments = await db
        .select({ requestId: requestAttachments.requestId })
        .from(requestAttachments)
        .where(
          and(
            inArray(requestAttachments.requestId, requestIds),
            eq(requestAttachments.visibility, "PUBLIC"),
          ),
        );
      const deliveryEvents = await db
        .select({
          requestId: requestEvents.privacyRequestId,
          type: requestEvents.type,
          data: requestEvents.data,
          createdAt: requestEvents.createdAt,
        })
        .from(requestEvents)
        .where(
          and(
            inArray(requestEvents.privacyRequestId, requestIds),
            inArray(requestEvents.type, [
              "CONSUMER_NOTIFICATION_SENT",
              "CONSUMER_NOTIFICATION_FAILED",
            ]),
          ),
        )
        .orderBy(desc(requestEvents.createdAt));
      const attachmentRequestIds = new Set(
        publicAttachments.map((row) => row.requestId),
      );
      const latestDeliveryByRequest = new Map<string, "SENT" | "FAILED">();

      for (const event of deliveryEvents) {
        const data = event.data as JsonObject;

        if (
          data.notificationType === "FILE_AVAILABLE" &&
          !latestDeliveryByRequest.has(event.requestId)
        ) {
          latestDeliveryByRequest.set(
            event.requestId,
            event.type === "CONSUMER_NOTIFICATION_SENT" ? "SENT" : "FAILED",
          );
        }
      }

      return sensitiveRows.map((row) => ({
        ...row,
        hasPublicAttachment: attachmentRequestIds.has(row.requestId),
        latestResponseDeliveryStatus:
          latestDeliveryByRequest.get(row.requestId) ?? null,
      }));
    },
    async findConsumerAccessLinkTarget(publicId) {
      const [request] = await db
        .select({
          id: privacyRequests.id,
          publicId: privacyRequests.publicId,
          requesterId: privacyRequests.requesterId,
          type: privacyRequests.type,
          status: privacyRequests.status,
          completedAt: privacyRequests.completedAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
          requesterEmailEncrypted: requesters.emailEncrypted,
        })
        .from(privacyRequests)
        .innerJoin(requesters, eq(privacyRequests.requesterId, requesters.id))
        .where(eq(privacyRequests.publicId, publicId))
        .limit(1);

      return request ?? null;
    },
    async findConsumerNotificationTarget(id) {
      const [request] = await db
        .select({
          id: privacyRequests.id,
          publicId: privacyRequests.publicId,
          requesterId: privacyRequests.requesterId,
          type: privacyRequests.type,
          status: privacyRequests.status,
          completedAt: privacyRequests.completedAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
          requesterEmailEncrypted: requesters.emailEncrypted,
        })
        .from(privacyRequests)
        .innerJoin(requesters, eq(privacyRequests.requesterId, requesters.id))
        .where(requestIdentifierCondition(id))
        .limit(1);

      return request ?? null;
    },
    async listActiveAssignableAdminUsers() {
      return db
        .select({
          id: adminUsers.id,
          emailEncrypted: adminUsers.emailEncrypted,
          role: adminUsers.role,
          active: adminUsers.active,
        })
        .from(adminUsers)
        .where(
          and(
            eq(adminUsers.active, true),
            inArray(adminUsers.role, ["ADMIN", "OPERATOR"]),
          ),
        )
        .orderBy(adminUsers.role, adminUsers.createdAt);
    },
    async findAdminUsersByIds(ids) {
      if (ids.length === 0) return [];

      return db
        .select({
          id: adminUsers.id,
          emailEncrypted: adminUsers.emailEncrypted,
          role: adminUsers.role,
          active: adminUsers.active,
        })
        .from(adminUsers)
        .where(inArray(adminUsers.id, ids));
    },
    async list(filters) {
      const conditions = [
        filters.publicId
          ? eq(privacyRequests.publicId, filters.publicId)
          : undefined,
        filters.statuses && filters.statuses.length > 0
          ? inArray(privacyRequests.status, filters.statuses)
          : undefined,
        filters.types && filters.types.length > 0
          ? inArray(privacyRequests.type, filters.types)
          : undefined,
        filters.emailHash
          ? eq(requesters.emailHash, filters.emailHash)
          : undefined,
        filters.phoneHash
          ? eq(requesters.phoneHash, filters.phoneHash)
          : undefined,
        filters.createdFrom
          ? gte(privacyRequests.createdAt, filters.createdFrom)
          : undefined,
        filters.createdTo
          ? lt(privacyRequests.createdAt, filters.createdTo)
          : undefined,
        filters.updatedFrom
          ? gte(privacyRequests.updatedAt, filters.updatedFrom)
          : undefined,
        filters.updatedTo
          ? lt(privacyRequests.updatedAt, filters.updatedTo)
          : undefined,
        filters.assignedToAdminUserId === null
          ? isNull(privacyRequests.assignedToAdminUserId)
          : filters.assignedToAdminUserId
            ? eq(
                privacyRequests.assignedToAdminUserId,
                filters.assignedToAdminUserId,
              )
            : undefined,
        filters.dueState
          ? dueStateCondition(filters.dueState, filters.slaNow ?? new Date())
          : undefined,
        filters.cursor
          ? or(
              lt(privacyRequests.createdAt, filters.cursor.createdAt),
              and(
                eq(privacyRequests.createdAt, filters.cursor.createdAt),
                lt(privacyRequests.id, filters.cursor.id),
              ),
            )
          : undefined,
      ].filter((condition) => condition !== undefined);

      const rows = await db
        .select({
          id: privacyRequests.id,
          publicId: privacyRequests.publicId,
          requesterId: privacyRequests.requesterId,
          type: privacyRequests.type,
          status: privacyRequests.status,
          submittedData: privacyRequests.submittedData,
          completedAt: privacyRequests.completedAt,
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
          assignedToAdminUserId: privacyRequests.assignedToAdminUserId,
          assignedAt: privacyRequests.assignedAt,
          assignedByAdminUserId: privacyRequests.assignedByAdminUserId,
          dueAt: privacyRequests.dueAt,
          dueAtSetAt: privacyRequests.dueAtSetAt,
          dueAtSetByAdminUserId: privacyRequests.dueAtSetByAdminUserId,
        })
        .from(privacyRequests)
        .innerJoin(requesters, eq(privacyRequests.requesterId, requesters.id))
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(privacyRequests.createdAt), desc(privacyRequests.id))
        .limit(filters.limit + 1);
      const hasMore = rows.length > filters.limit;
      const pageRows = hasMore ? rows.slice(0, filters.limit) : rows;
      const last = pageRows.at(-1);

      return {
        requests: pageRows.map((row) => ({
          id: row.id,
          publicId: row.publicId,
          requesterId: row.requesterId,
          type: row.type,
          status: row.status,
          source: safeSourceFromSubmittedData(row.submittedData as JsonObject),
          completedAt: row.completedAt,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          assignedToAdminUserId: row.assignedToAdminUserId,
          assignedAt: row.assignedAt,
          assignedByAdminUserId: row.assignedByAdminUserId,
          dueAt: row.dueAt,
          dueAtSetAt: row.dueAtSetAt,
          dueAtSetByAdminUserId: row.dueAtSetByAdminUserId,
        })),
        nextCursor:
          hasMore && last
            ? {
                createdAt: last.createdAt,
                id: last.id,
              }
            : null,
      };
    },
    async assignRequest(id, assigneeId, actor) {
      return db.transaction(async (tx) => {
        const [assignee] = await tx
          .select({ id: adminUsers.id })
          .from(adminUsers)
          .where(
            and(
              eq(adminUsers.id, assigneeId),
              eq(adminUsers.active, true),
              inArray(adminUsers.role, ["ADMIN", "OPERATOR"]),
            ),
          )
          .limit(1);

        if (!assignee) {
          return { ok: false, code: "ASSIGNEE_NOT_FOUND" };
        }

        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1)
          .for("update");

        if (!request) return { ok: false, code: "NOT_FOUND" };
        if (actor.role === "VIEWER") {
          return { ok: false, code: "FORBIDDEN" };
        }
        if (
          actor.role === "OPERATOR" &&
          (assigneeId !== actor.id ||
            (request.assignedToAdminUserId !== null &&
              request.assignedToAdminUserId !== actor.id))
        ) {
          return { ok: false, code: "FORBIDDEN" };
        }
        if (request.assignedToAdminUserId === assigneeId) {
          return { ok: true, request, changed: false };
        }

        const now = new Date();
        const [updated] = await tx
          .update(privacyRequests)
          .set({
            assignedToAdminUserId: assigneeId,
            assignedAt: now,
            assignedByAdminUserId: actor.id,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning(requestSummarySelection);

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "REQUEST_ASSIGNED",
          actorType: "ADMIN_USER",
          actorId: actor.id,
          data: {
            assignedToAdminUserId: assigneeId,
            assignedByAdminUserId: actor.id,
          },
        });

        return { ok: true, request: updated, changed: true };
      });
    },
    async unassignRequest(id, actor) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1)
          .for("update");

        if (!request) return { ok: false, code: "NOT_FOUND" };
        if (
          actor.role === "VIEWER" ||
          (actor.role === "OPERATOR" &&
            request.assignedToAdminUserId !== null &&
            request.assignedToAdminUserId !== actor.id)
        ) {
          return { ok: false, code: "FORBIDDEN" };
        }
        if (request.assignedToAdminUserId === null) {
          return { ok: true, request, changed: false };
        }

        const previouslyAssignedToAdminUserId = request.assignedToAdminUserId;
        const now = new Date();
        const [updated] = await tx
          .update(privacyRequests)
          .set({
            assignedToAdminUserId: null,
            assignedAt: null,
            assignedByAdminUserId: null,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning(requestSummarySelection);

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "REQUEST_UNASSIGNED",
          actorType: "ADMIN_USER",
          actorId: actor.id,
          data: {
            previouslyAssignedToAdminUserId,
            assignedByAdminUserId: actor.id,
          },
        });

        return { ok: true, request: updated, changed: true };
      });
    },
    async setRequestDueDate(id, dueAt, actor) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1)
          .for("update");

        if (!request) return { ok: false, code: "NOT_FOUND" };
        if (!canManageRequestDueDate(request, actor)) {
          return { ok: false, code: "FORBIDDEN" };
        }
        if (request.dueAt?.getTime() === dueAt.getTime()) {
          return { ok: true, request, changed: false };
        }

        const previousDueAt = request.dueAt;
        const now = new Date();
        const [updated] = await tx
          .update(privacyRequests)
          .set({
            dueAt,
            dueAtSetAt: now,
            dueAtSetByAdminUserId: actor.id,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning(requestSummarySelection);

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: previousDueAt
            ? "REQUEST_DUE_DATE_UPDATED"
            : "REQUEST_DUE_DATE_SET",
          actorType: "ADMIN_USER",
          actorId: actor.id,
          data: previousDueAt
            ? {
                previousDueAt: previousDueAt.toISOString(),
                dueAt: dueAt.toISOString(),
              }
            : { dueAt: dueAt.toISOString() },
        });

        return { ok: true, request: updated, changed: true };
      });
    },
    async clearRequestDueDate(id, actor) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1)
          .for("update");

        if (!request) return { ok: false, code: "NOT_FOUND" };
        if (!canManageRequestDueDate(request, actor)) {
          return { ok: false, code: "FORBIDDEN" };
        }
        if (!request.dueAt) {
          return { ok: true, request, changed: false };
        }

        const previousDueAt = request.dueAt;
        const now = new Date();
        const [updated] = await tx
          .update(privacyRequests)
          .set({
            dueAt: null,
            dueAtSetAt: null,
            dueAtSetByAdminUserId: null,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning(requestSummarySelection);

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "REQUEST_DUE_DATE_CLEARED",
          actorType: "ADMIN_USER",
          actorId: actor.id,
          data: { previousDueAt: previousDueAt.toISOString() },
        });

        return { ok: true, request: updated, changed: true };
      });
    },
    async updateStatus(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
            publicId: privacyRequests.publicId,
            requesterId: privacyRequests.requesterId,
            type: privacyRequests.type,
            status: privacyRequests.status,
            completedAt: privacyRequests.completedAt,
            createdAt: privacyRequests.createdAt,
            updatedAt: privacyRequests.updatedAt,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const now = new Date();
        const completedAt = isTerminalStatus(input.status) ? now : null;
        const [updatedRequest] = await tx
          .update(privacyRequests)
          .set({
            status: input.status,
            completedAt,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning({
            id: privacyRequests.id,
            publicId: privacyRequests.publicId,
            requesterId: privacyRequests.requesterId,
            type: privacyRequests.type,
            status: privacyRequests.status,
            completedAt: privacyRequests.completedAt,
            createdAt: privacyRequests.createdAt,
            updatedAt: privacyRequests.updatedAt,
          });

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "STATUS_CHANGED",
          actorType: input.actorType,
          actorId: input.actorId,
          data: {
            previousStatus: request.status,
            newStatus: input.status,
            reason: input.reason,
            actor: {
              type: input.actorType,
              id: input.actorId,
            },
          },
        });

        return updatedRequest;
      });
    },
    async updateMutableData(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
            mutableData: privacyRequests.mutableData,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const now = new Date();
        const mutableData = {
          ...(request.mutableData as JsonObject),
          ...input.data,
        };
        const [updatedRequest] = await tx
          .update(privacyRequests)
          .set({
            mutableData,
            updatedAt: now,
          })
          .where(eq(privacyRequests.id, request.id))
          .returning({
            mutableData: privacyRequests.mutableData,
            updatedAt: privacyRequests.updatedAt,
          });

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return {
          mutableData: updatedRequest.mutableData as JsonObject,
          updatedAt: updatedRequest.updatedAt,
        };
      });
    },
    async addCustomEvent(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const event = await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "CUSTOM_EVENT",
          category: "CUSTOM",
          customType: input.customType,
          visibility: input.visibility,
          actorType: input.actorType,
          actorId: input.actorId,
          data: input.data,
        });

        return {
          ...event,
          data: event.data as JsonObject,
        };
      });
    },
    async addComment(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const [comment] = await tx
          .insert(requestComments)
          .values({
            requestId: request.id,
            visibility: input.visibility,
            body: input.body,
            actorType: input.actorType,
            actorId: input.actorId,
          })
          .returning({
            id: requestComments.id,
            requestId: requestComments.requestId,
            visibility: requestComments.visibility,
            body: requestComments.body,
            actorType: requestComments.actorType,
            actorId: requestComments.actorId,
            createdAt: requestComments.createdAt,
          });

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return comment;
      });
    },
    async addAttachment(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const [attachment] = await tx
          .insert(requestAttachments)
          .values({
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
          })
          .returning({
            id: requestAttachments.id,
            requestId: requestAttachments.requestId,
            visibility: requestAttachments.visibility,
            fileName: requestAttachments.fileName,
            mimeType: requestAttachments.mimeType,
            sizeBytes: requestAttachments.sizeBytes,
            storageProvider: requestAttachments.storageProvider,
            storageKey: requestAttachments.storageKey,
            checksum: requestAttachments.checksum,
            actorType: requestAttachments.actorType,
            actorId: requestAttachments.actorId,
            createdAt: requestAttachments.createdAt,
          });

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return attachment;
      });
    },
    async recordAttachmentDownloaded(requestId, input) {
      await db.transaction(async (tx) => {
        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });
      });
    },
    async recordAdminAttachmentDownloaded(requestId, input) {
      await db.transaction(async (tx) => {
        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });
      });
    },
    async createCommunication(id, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({
            id: privacyRequests.id,
          })
          .from(privacyRequests)
          .where(requestIdentifierCondition(id))
          .limit(1);

        if (!request) {
          return null;
        }

        const [communication] = await tx
          .insert(requestCommunications)
          .values({
            requestId: request.id,
            channel: "EMAIL",
            direction: "OUTBOUND",
            ...protectedRecipientValues(input.recipient),
            subject: input.subject,
            body: input.body,
            provider: input.provider,
            status: "PENDING",
            actorType: input.actorType,
            actorId: input.actorId,
          })
          .returning(communicationSelection);

        return communication;
      });
    },
    async markCommunicationSent(requestId, communicationId, input) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const [communication] = await tx
          .update(requestCommunications)
          .set({
            status: "SENT",
            providerMessageId: input.providerMessageId,
            errorMessage: null,
            sentAt: now,
          })
          .where(
            and(
              eq(requestCommunications.id, communicationId),
              eq(requestCommunications.requestId, requestId),
            ),
          )
          .returning(communicationSelection);

        if (!communication) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return communication;
      });
    },
    async markCommunicationFailed(requestId, communicationId, input) {
      return db.transaction(async (tx) => {
        const [communication] = await tx
          .update(requestCommunications)
          .set({
            status: "FAILED",
            errorMessage: input.errorMessage,
            sentAt: null,
          })
          .where(
            and(
              eq(requestCommunications.id, communicationId),
              eq(requestCommunications.requestId, requestId),
            ),
          )
          .returning(communicationSelection);

        if (!communication) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return communication;
      });
    },
    async createConsumerAccessToken(publicId, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(eq(privacyRequests.publicId, publicId))
          .limit(1);

        if (!request) {
          return null;
        }

        const [accessToken] = await tx
          .insert(requestAccessTokens)
          .values({
            requestId: request.id,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
          })
          .returning(accessTokenSelection);

        const [communication] = await tx
          .insert(requestCommunications)
          .values({
            requestId: request.id,
            channel: "EMAIL",
            direction: "OUTBOUND",
            ...protectedRecipientValues(input.recipient),
            subject: input.subject,
            body: input.body,
            provider: input.provider,
            status: "PENDING",
            actorType: "SYSTEM",
            actorId: "consumer-access-link",
          })
          .returning(communicationSelection);

        return {
          request,
          accessToken,
          communication,
        };
      });
    },
    async createConsumerNotificationAccessToken(requestId, input) {
      const [request] = await db
        .select({
          id: privacyRequests.id,
        })
        .from(privacyRequests)
        .where(eq(privacyRequests.id, requestId))
        .limit(1);

      if (!request) {
        return null;
      }

      const [accessToken] = await db
        .insert(requestAccessTokens)
        .values({
          requestId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        })
        .returning(accessTokenSelection);

      return accessToken;
    },
    async recordConsumerAccessLinkSent(requestId, input) {
      await db.transaction(async (tx) => {
        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: requestId,
          type: "CONSUMER_ACCESS_LINK_SENT",
          actorType: "SYSTEM",
          actorId: "consumer-access-link",
          data: {
            accessTokenId: input.accessTokenId,
            communicationId: input.communicationId,
            provider: input.provider,
            providerMessageId: input.providerMessageId,
          },
        });
      });
    },
    async markConsumerNotificationSent(requestId, communicationId, input) {
      return db.transaction(async (tx) => {
        const now = new Date();
        const [communication] = await tx
          .update(requestCommunications)
          .set({
            status: "SENT",
            providerMessageId: input.providerMessageId,
            errorMessage: null,
            sentAt: now,
          })
          .where(
            and(
              eq(requestCommunications.id, communicationId),
              eq(requestCommunications.requestId, requestId),
            ),
          )
          .returning(communicationSelection);

        if (!communication) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return communication;
      });
    },
    async markConsumerNotificationFailed(requestId, communicationId, input) {
      return db.transaction(async (tx) => {
        const [communication] = await tx
          .update(requestCommunications)
          .set({
            status: "FAILED",
            errorMessage: input.errorMessage,
            sentAt: null,
          })
          .where(
            and(
              eq(requestCommunications.id, communicationId),
              eq(requestCommunications.requestId, requestId),
            ),
          )
          .returning(communicationSelection);

        if (!communication) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
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
        });

        return communication;
      });
    },
    async consumeConsumerAccessToken(publicId, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(eq(privacyRequests.publicId, publicId))
          .limit(1);

        if (!request) {
          return null;
        }

        const [accessToken] = await tx
          .update(requestAccessTokens)
          .set({
            usedAt: input.now,
          })
          .where(
            and(
              eq(requestAccessTokens.requestId, request.id),
              eq(requestAccessTokens.tokenHash, input.tokenHash),
              isNull(requestAccessTokens.usedAt),
              gt(requestAccessTokens.expiresAt, input.now),
            ),
          )
          .returning(accessTokenSelection);

        if (!accessToken) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "CONSUMER_ACCESS_TOKEN_USED",
          actorType: "CONSUMER",
          actorId: null,
          data: {
            accessTokenId: accessToken.id,
          },
        });

        const [accessSession] = await tx
          .insert(requestAccessSessions)
          .values({
            requestId: request.id,
            sessionHash: input.sessionHash,
            expiresAt: input.sessionExpiresAt,
            lastSeenAt: input.now,
          })
          .returning(accessSessionSelection);

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "CONSUMER_ACCESS_SESSION_CREATED",
          actorType: "CONSUMER",
          actorId: null,
          data: {
            accessTokenId: accessToken.id,
            accessSessionId: accessSession.id,
          },
        });

        return {
          request,
          accessToken,
          accessSession,
        };
      });
    },
    async validateConsumerAccessSession(publicId, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(eq(privacyRequests.publicId, publicId))
          .limit(1);

        if (!request) {
          return null;
        }

        const [accessSession] = await tx
          .update(requestAccessSessions)
          .set({
            lastSeenAt: input.now,
          })
          .where(
            and(
              eq(requestAccessSessions.requestId, request.id),
              eq(requestAccessSessions.sessionHash, input.sessionHash),
              isNull(requestAccessSessions.revokedAt),
              gt(requestAccessSessions.expiresAt, input.now),
            ),
          )
          .returning(accessSessionSelection);

        if (!accessSession) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "CONSUMER_ACCESS_SESSION_USED",
          actorType: "CONSUMER",
          actorId: null,
          data: {
            accessSessionId: accessSession.id,
          },
        });

        const comments = await tx
          .select({
            id: requestComments.id,
            requestId: requestComments.requestId,
            visibility: requestComments.visibility,
            body: requestComments.body,
            actorType: requestComments.actorType,
            actorId: requestComments.actorId,
            createdAt: requestComments.createdAt,
          })
          .from(requestComments)
          .where(eq(requestComments.requestId, request.id))
          .orderBy(desc(requestComments.createdAt));

        const attachments = await tx
          .select(attachmentSelection)
          .from(requestAttachments)
          .where(
            and(
              eq(requestAttachments.requestId, request.id),
              eq(requestAttachments.visibility, "PUBLIC"),
            ),
          )
          .orderBy(desc(requestAttachments.createdAt));

        const events = await tx
          .select(eventSelection)
          .from(requestEvents)
          .where(
            and(
              eq(requestEvents.privacyRequestId, request.id),
              eq(requestEvents.category, "CUSTOM"),
              eq(requestEvents.visibility, "PUBLIC"),
            ),
          )
          .orderBy(desc(requestEvents.createdAt));

        return {
          ...request,
          comments,
          attachments,
          events: events.map((event) => ({
            ...event,
            data: event.data as JsonObject,
          })),
        };
      });
    },
    async recordConsumerAttachmentDownloaded(requestId, input) {
      await db.transaction(async (tx) => {
        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: requestId,
          type: "CONSUMER_ATTACHMENT_DOWNLOADED",
          actorType: "CONSUMER",
          actorId: null,
          data: {
            attachmentId: input.attachmentId,
            fileName: input.fileName,
            mimeType: input.mimeType,
            sizeBytes: input.sizeBytes,
          },
        });
      });
    },
    async createIdentityVerificationToken(requestId, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select({ id: privacyRequests.id })
          .from(privacyRequests)
          .where(eq(privacyRequests.id, requestId))
          .limit(1);

        if (!request) {
          return null;
        }

        await tx
          .update(requestIdentityVerificationTokens)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(requestIdentityVerificationTokens.requestId, requestId),
              isNull(requestIdentityVerificationTokens.usedAt),
            ),
          );

        const [verificationToken] = await tx
          .insert(requestIdentityVerificationTokens)
          .values({
            requestId,
            tokenHash: input.tokenHash,
            expiresAt: input.expiresAt,
          })
          .returning(identityVerificationTokenSelection);

        return verificationToken;
      });
    },
    async recordIdentityVerificationSent(requestId, input) {
      await db.transaction(async (tx) => {
        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: requestId,
          type: "IDENTITY_VERIFICATION_SENT",
          actorType: "SYSTEM",
          actorId: "public-intake",
          data: {
            verificationTokenId: input.verificationTokenId,
            communicationId: input.communicationId,
            provider: input.provider,
            providerMessageId: input.providerMessageId,
          },
        });
      });
    },
    async verifyIdentityToken(publicId, input) {
      return db.transaction(async (tx) => {
        const [request] = await tx
          .select(requestSummarySelection)
          .from(privacyRequests)
          .where(eq(privacyRequests.publicId, publicId))
          .limit(1);

        if (!request) {
          return null;
        }

        const [verificationToken] = await tx
          .update(requestIdentityVerificationTokens)
          .set({
            usedAt: input.now,
          })
          .where(
            and(
              eq(requestIdentityVerificationTokens.requestId, request.id),
              eq(requestIdentityVerificationTokens.tokenHash, input.tokenHash),
              isNull(requestIdentityVerificationTokens.usedAt),
              gt(requestIdentityVerificationTokens.expiresAt, input.now),
            ),
          )
          .returning(identityVerificationTokenSelection);

        if (!verificationToken) {
          return null;
        }

        const [updatedRequest] = await tx
          .update(privacyRequests)
          .set({
            status: "VERIFIED",
            updatedAt: input.now,
          })
          .where(
            and(
              eq(privacyRequests.id, request.id),
              eq(privacyRequests.status, "PENDING_VERIFICATION"),
            ),
          )
          .returning(requestSummarySelection);

        if (!updatedRequest) {
          return null;
        }

        await createRequestEventAndEnqueueWebhooks(tx, {
          privacyRequestId: request.id,
          type: "IDENTITY_VERIFIED",
          actorType: "CONSUMER",
          actorId: null,
          data: {
            verificationTokenId: verificationToken.id,
          },
        });

        return updatedRequest;
      });
    },
  };
}

const requestSummarySelection = {
  id: privacyRequests.id,
  publicId: privacyRequests.publicId,
  requesterId: privacyRequests.requesterId,
  type: privacyRequests.type,
  status: privacyRequests.status,
  completedAt: privacyRequests.completedAt,
  createdAt: privacyRequests.createdAt,
  updatedAt: privacyRequests.updatedAt,
  assignedToAdminUserId: privacyRequests.assignedToAdminUserId,
  assignedAt: privacyRequests.assignedAt,
  assignedByAdminUserId: privacyRequests.assignedByAdminUserId,
  dueAt: privacyRequests.dueAt,
  dueAtSetAt: privacyRequests.dueAtSetAt,
  dueAtSetByAdminUserId: privacyRequests.dueAtSetByAdminUserId,
};

const accessTokenSelection = {
  id: requestAccessTokens.id,
  requestId: requestAccessTokens.requestId,
  tokenHash: requestAccessTokens.tokenHash,
  expiresAt: requestAccessTokens.expiresAt,
  usedAt: requestAccessTokens.usedAt,
  createdAt: requestAccessTokens.createdAt,
};

const accessSessionSelection = {
  id: requestAccessSessions.id,
  requestId: requestAccessSessions.requestId,
  sessionHash: requestAccessSessions.sessionHash,
  expiresAt: requestAccessSessions.expiresAt,
  revokedAt: requestAccessSessions.revokedAt,
  createdAt: requestAccessSessions.createdAt,
  lastSeenAt: requestAccessSessions.lastSeenAt,
};

const attachmentSelection = {
  id: requestAttachments.id,
  requestId: requestAttachments.requestId,
  visibility: requestAttachments.visibility,
  fileName: requestAttachments.fileName,
  mimeType: requestAttachments.mimeType,
  sizeBytes: requestAttachments.sizeBytes,
  storageProvider: requestAttachments.storageProvider,
  storageKey: requestAttachments.storageKey,
  checksum: requestAttachments.checksum,
  actorType: requestAttachments.actorType,
  actorId: requestAttachments.actorId,
  createdAt: requestAttachments.createdAt,
};

const eventSelection = {
  id: requestEvents.id,
  privacyRequestId: requestEvents.privacyRequestId,
  type: requestEvents.type,
  category: requestEvents.category,
  customType: requestEvents.customType,
  visibility: requestEvents.visibility,
  actorType: requestEvents.actorType,
  actorId: requestEvents.actorId,
  data: requestEvents.data,
  createdAt: requestEvents.createdAt,
};

const identityVerificationTokenSelection = {
  id: requestIdentityVerificationTokens.id,
  requestId: requestIdentityVerificationTokens.requestId,
  tokenHash: requestIdentityVerificationTokens.tokenHash,
  expiresAt: requestIdentityVerificationTokens.expiresAt,
  usedAt: requestIdentityVerificationTokens.usedAt,
  createdAt: requestIdentityVerificationTokens.createdAt,
};

const communicationSelection = {
  id: requestCommunications.id,
  requestId: requestCommunications.requestId,
  channel: requestCommunications.channel,
  direction: requestCommunications.direction,
  recipient: requestCommunications.recipient,
  recipientEncrypted: requestCommunications.recipientEncrypted,
  recipientHash: requestCommunications.recipientHash,
  encryptionVersion: requestCommunications.encryptionVersion,
  subject: requestCommunications.subject,
  body: requestCommunications.body,
  provider: requestCommunications.provider,
  providerMessageId: requestCommunications.providerMessageId,
  status: requestCommunications.status,
  errorMessage: requestCommunications.errorMessage,
  actorType: requestCommunications.actorType,
  actorId: requestCommunications.actorId,
  createdAt: requestCommunications.createdAt,
  sentAt: requestCommunications.sentAt,
};

function requestIdentifierCondition(id: string) {
  return uuidPattern.test(id)
    ? or(eq(privacyRequests.id, id), eq(privacyRequests.publicId, id))
    : eq(privacyRequests.publicId, id);
}

function protectedRecipientValues(recipient: string) {
  return {
    recipient: null,
    recipientEncrypted: encryptPii(recipient),
    recipientHash: hashPii(recipient),
    encryptionVersion: 1,
  };
}

function safeSourceFromSubmittedData(
  submittedData: JsonObject,
): SafeRequestSource | null {
  const source =
    submittedData.source &&
    typeof submittedData.source === "object" &&
    !Array.isArray(submittedData.source)
      ? (submittedData.source as JsonObject)
      : null;

  if (!source) {
    return null;
  }

  return {
    channel: safeString(source.channel),
    siteKey: safeString(source.siteKey),
    formKey: safeString(source.formKey),
  };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isTerminalStatus(status: RequestStatus): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}

function canManageRequestDueDate(
  request: Pick<RequestSummary, "assignedToAdminUserId">,
  actor: AdminRequestAssignmentActor,
): boolean {
  if (actor.role === "ADMIN") return true;
  if (actor.role === "VIEWER") return false;
  return (
    request.assignedToAdminUserId === null ||
    request.assignedToAdminUserId === undefined ||
    request.assignedToAdminUserId === actor.id
  );
}

function dueStateCondition(
  state: Exclude<RequestSlaState, "COMPLETED">,
  now: Date,
) {
  const active = notInArray(privacyRequests.status, [
    "SUCCESS",
    "REJECTED",
    "CANCELLED",
  ]);
  const dueSoonUntil = new Date(now.getTime() + requestDueSoonWindowMs);

  switch (state) {
    case "NO_DUE_DATE":
      return and(active, isNull(privacyRequests.dueAt));
    case "OVERDUE":
      return and(active, lt(privacyRequests.dueAt, now));
    case "DUE_SOON":
      return and(
        active,
        gte(privacyRequests.dueAt, now),
        lte(privacyRequests.dueAt, dueSoonUntil),
      );
    case "ON_TRACK":
      return and(active, gt(privacyRequests.dueAt, dueSoonUntil));
  }
}
