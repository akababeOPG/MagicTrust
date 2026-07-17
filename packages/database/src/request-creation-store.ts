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
import { privacyRequests, requesters } from "./schema";
import { createRequestEventAndEnqueueWebhooks } from "./webhooks";

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
      emailHash: data.emailHash,
      phoneEncrypted: data.phoneEncrypted,
      phoneHash: data.phoneHash,
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
      submittedDataEncrypted: data.submittedDataEncrypted,
      submittedDataHash: data.submittedDataHash,
      encryptionVersion: data.encryptionVersion,
      mutableData: data.mutableData,
    })
    .returning({
      id: privacyRequests.id,
      requesterId: privacyRequests.requesterId,
      publicId: privacyRequests.publicId,
      type: privacyRequests.type,
      status: privacyRequests.status,
      submittedData: privacyRequests.submittedData,
      submittedDataEncrypted: privacyRequests.submittedDataEncrypted,
      submittedDataHash: privacyRequests.submittedDataHash,
      encryptionVersion: privacyRequests.encryptionVersion,
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
  return createRequestEventAndEnqueueWebhooks(tx, {
    privacyRequestId: data.privacyRequestId,
    type: data.type,
    actorType: data.actorType,
    actorId: data.actorId,
    data: data.data,
  });
}
