import type {
  ActorType,
  CommentVisibility,
  JsonObject,
  RequestAttachment,
  RequestComment,
  RequestEventType,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import { and, desc, eq, or } from "drizzle-orm";

import type { createDatabase } from "./index";
import {
  privacyRequests,
  requestAttachments,
  requestComments,
  requestEvents,
} from "./schema";

type Database = ReturnType<typeof createDatabase>;

export type RequestSummary = {
  id: string;
  publicId: string;
  requesterId: string;
  type: RequestType;
  status: RequestStatus;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type RequestEventSummary = {
  id: string;
  privacyRequestId: string;
  type: RequestEventType;
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
  createdAt: Date;
};

export type RequestDetails = RequestSummary & {
  events: RequestEventSummary[];
  comments: RequestComment[];
  attachments: RequestAttachment[];
};

export type RequestListFilters = {
  status?: RequestStatus;
  type?: RequestType;
  limit: number;
};

export type RequestRepository = {
  findByIdOrPublicId(id: string): Promise<RequestDetails | null>;
  list(filters: RequestListFilters): Promise<RequestSummary[]>;
  updateStatus(
    id: string,
    input: UpdateRequestStatusInput,
  ): Promise<RequestSummary | null>;
  addComment(
    id: string,
    input: AddRequestCommentInput,
  ): Promise<RequestComment | null>;
  addAttachment(
    id: string,
    input: AddRequestAttachmentInput,
  ): Promise<RequestAttachment | null>;
};

export type UpdateRequestStatusInput = {
  status: RequestStatus;
  actorType: ActorType;
  actorId: string | null;
  reason: string | null;
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
        .select({
          id: requestEvents.id,
          privacyRequestId: requestEvents.privacyRequestId,
          type: requestEvents.type,
          actorType: requestEvents.actorType,
          actorId: requestEvents.actorId,
          data: requestEvents.data,
          createdAt: requestEvents.createdAt,
        })
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

      return {
        ...request,
        events: events.map((event) => ({
          ...event,
          data: event.data as JsonObject,
        })),
        comments,
        attachments,
      };
    },
    async list(filters) {
      const conditions = [
        filters.status ? eq(privacyRequests.status, filters.status) : undefined,
        filters.type ? eq(privacyRequests.type, filters.type) : undefined,
      ].filter((condition) => condition !== undefined);

      return db
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
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(privacyRequests.createdAt))
        .limit(filters.limit);
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

        await tx.insert(requestEvents).values({
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

        await tx.insert(requestEvents).values({
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

        await tx.insert(requestEvents).values({
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
  };
}

function requestIdentifierCondition(id: string) {
  return uuidPattern.test(id)
    ? or(eq(privacyRequests.id, id), eq(privacyRequests.publicId, id))
    : eq(privacyRequests.publicId, id);
}

function isTerminalStatus(status: RequestStatus): boolean {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}
