import type {
  ActorType,
  JsonObject,
  RequestEventType,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import { and, desc, eq, or } from "drizzle-orm";

import type { createDatabase } from "./index";
import { privacyRequests, requestEvents } from "./schema";

type Database = ReturnType<typeof createDatabase>;

export type RequestSummary = {
  id: string;
  publicId: string;
  requesterId: string;
  type: RequestType;
  status: RequestStatus;
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
};

export type RequestListFilters = {
  status?: RequestStatus;
  type?: RequestType;
  limit: number;
};

export type RequestRepository = {
  findByIdOrPublicId(id: string): Promise<RequestDetails | null>;
  list(filters: RequestListFilters): Promise<RequestSummary[]>;
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

      return {
        ...request,
        events: events.map((event) => ({
          ...event,
          data: event.data as JsonObject,
        })),
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
          createdAt: privacyRequests.createdAt,
          updatedAt: privacyRequests.updatedAt,
        })
        .from(privacyRequests)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(privacyRequests.createdAt))
        .limit(filters.limit);
    },
  };
}
