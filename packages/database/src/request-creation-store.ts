import type {
  CreatePrivacyRequestRecord,
  CreateRequesterRecord,
  CreateRequestEventRecord,
  JsonObject,
  PrivacyRequest,
  RequestCreationStore,
  RequestEvent,
} from "@magictrust/domain";

import type { createDatabase } from "./index";
import { privacyRequests, requestEvents, requesters } from "./schema";

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export function createRequestCreationStore(db: Database): RequestCreationStore {
  return {
    transaction(callback) {
      return db.transaction(async (tx) =>
        callback({
          createRequester: (data) => insertRequester(tx, data),
          createPrivacyRequest: (data) => insertPrivacyRequest(tx, data),
          createRequestEvent: (data) => insertRequestEvent(tx, data),
        }),
      );
    },
  };
}

async function insertRequester(tx: Transaction, data: CreateRequesterRecord) {
  const [requester] = await tx
    .insert(requesters)
    .values({
      externalId: data.externalId,
      emailEncrypted: data.emailEncrypted,
      phoneEncrypted: data.phoneEncrypted,
      nameEncrypted: data.nameEncrypted,
    })
    .returning({
      id: requesters.id,
      externalId: requesters.externalId,
    });

  return requester;
}

async function insertPrivacyRequest(
  tx: Transaction,
  data: CreatePrivacyRequestRecord,
): Promise<PrivacyRequest> {
  const [request] = await tx
    .insert(privacyRequests)
    .values({
      requesterId: data.requesterId,
      publicId: data.publicId,
      type: data.type,
      status: data.status,
      submittedData: data.submittedData,
      mutableData: data.mutableData,
    })
    .returning({
      id: privacyRequests.id,
      requesterId: privacyRequests.requesterId,
      publicId: privacyRequests.publicId,
      type: privacyRequests.type,
      status: privacyRequests.status,
      submittedData: privacyRequests.submittedData,
      mutableData: privacyRequests.mutableData,
      createdAt: privacyRequests.createdAt,
      updatedAt: privacyRequests.updatedAt,
      completedAt: privacyRequests.completedAt,
    });

  return {
    ...request,
    submittedData: request.submittedData as JsonObject,
    mutableData: request.mutableData as JsonObject,
  };
}

async function insertRequestEvent(
  tx: Transaction,
  data: CreateRequestEventRecord,
): Promise<RequestEvent> {
  const [event] = await tx
    .insert(requestEvents)
    .values({
      privacyRequestId: data.privacyRequestId,
      type: data.type,
      actorType: data.actorType,
      actorId: data.actorId,
      data: data.data,
    })
    .returning({
      id: requestEvents.id,
      privacyRequestId: requestEvents.privacyRequestId,
      type: requestEvents.type,
      actorType: requestEvents.actorType,
      actorId: requestEvents.actorId,
      data: requestEvents.data,
      createdAt: requestEvents.createdAt,
    });

  return {
    ...event,
    data: event.data as JsonObject,
  };
}
