import { randomBytes } from "node:crypto";

import {
  decryptSubmittedPayload,
  encryptPii,
  encryptSubmittedPayload,
  hashPii,
  hashSubmittedPayload,
} from "@magictrust/privacy";

import type {
  ActorType,
  JsonObject,
  PrivacyRequest,
  RequestEvent,
  Requester,
  RequestStatus,
  RequestType,
} from "./types";

export type CreateRequestInput = {
  requester: {
    externalId?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  type: RequestType;
  submittedData: JsonObject;
  actor: {
    type: ActorType;
    id?: string | null;
  };
  initialStatus?: Extract<RequestStatus, "SUBMITTED" | "PENDING_VERIFICATION">;
};

export type CreateRequesterRecord = {
  externalId: string | null;
  emailEncrypted: string | null;
  emailHash: string | null;
  phoneEncrypted: string | null;
  phoneHash: string | null;
  nameEncrypted: string | null;
};

export type CreatePrivacyRequestRecord = {
  requesterId: string;
  publicId: string;
  type: RequestType;
  status: Extract<RequestStatus, "SUBMITTED" | "PENDING_VERIFICATION">;
  submittedData: JsonObject;
  submittedDataEncrypted: string;
  submittedDataHash: string;
  encryptionVersion: number;
  mutableData: JsonObject;
};

export type CreateRequestEventRecord = {
  privacyRequestId: string;
  type: "REQUEST_CREATED";
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
};

export type RequestCreationTransaction = {
  createRequester(data: CreateRequesterRecord): Promise<Requester>;
  createPrivacyRequest(
    data: CreatePrivacyRequestRecord,
  ): Promise<PrivacyRequest>;
  createRequestEvent(data: CreateRequestEventRecord): Promise<RequestEvent>;
};

export type RequestCreationStore = {
  transaction<T>(
    callback: (tx: RequestCreationTransaction) => Promise<T>,
  ): Promise<T>;
};

export type CreateRequestResult = {
  requester: Requester;
  request: PrivacyRequest;
  event: RequestEvent;
};

export type CreateRequestOptions = {
  generatePublicId?: () => string;
};

export function generatePublicId(): string {
  return `req_${randomBytes(12).toString("base64url")}`;
}

export function decryptOriginalSubmittedData(input: {
  submittedDataEncrypted: string | null;
}): JsonObject | null {
  if (!input.submittedDataEncrypted) {
    return null;
  }

  const decrypted = decryptSubmittedPayload(input.submittedDataEncrypted);

  if (!decrypted || typeof decrypted !== "object" || Array.isArray(decrypted)) {
    throw new Error("Encrypted submitted payload did not contain an object.");
  }

  return decrypted as JsonObject;
}

export async function createPrivacyRequest(
  input: CreateRequestInput,
  store: RequestCreationStore,
  options: CreateRequestOptions = {},
): Promise<CreateRequestResult> {
  const originalSubmittedData = cloneJsonObject(input.submittedData);
  const submittedData = sanitizeSubmittedDataSnapshot(
    originalSubmittedData,
    input.type,
  );

  return store.transaction(async (tx) => {
    const publicId = (options.generatePublicId ?? generatePublicId)();
    const requester = await tx.createRequester({
      externalId: input.requester.externalId ?? null,
      emailEncrypted: encryptOptionalPii(input.requester.email),
      emailHash: hashOptionalPii(input.requester.email),
      phoneEncrypted: encryptOptionalPii(input.requester.phone),
      phoneHash: hashOptionalPii(input.requester.phone),
      nameEncrypted: null,
    });

    const request = await tx.createPrivacyRequest({
      requesterId: requester.id,
      publicId,
      type: input.type,
      status: input.initialStatus ?? "SUBMITTED",
      submittedData,
      submittedDataEncrypted: encryptSubmittedPayload(originalSubmittedData),
      submittedDataHash: hashSubmittedPayload(originalSubmittedData),
      encryptionVersion: 1,
      mutableData: {},
    });

    const event = await tx.createRequestEvent({
      privacyRequestId: request.id,
      type: "REQUEST_CREATED",
      actorType: input.actor.type,
      actorId: input.actor.id ?? null,
      data: {
        publicId: request.publicId,
        requestType: request.type,
        status: request.status,
      },
    });

    return {
      requester,
      request,
      event,
    };
  });
}

function encryptOptionalPii(value: string | null | undefined): string | null {
  return value ? encryptPii(value) : null;
}

function hashOptionalPii(value: string | null | undefined): string | null {
  return value ? hashPii(value) : null;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  return structuredClone(value);
}

function sanitizeSubmittedDataSnapshot(
  submittedData: JsonObject,
  requestType: RequestType,
): JsonObject {
  const source =
    submittedData.source &&
    typeof submittedData.source === "object" &&
    !Array.isArray(submittedData.source)
      ? (submittedData.source as JsonObject)
      : {};

  return {
    type: requestType,
    source: {
      channel: safeString(source.channel),
      formKey: safeString(source.formKey),
      siteKey: safeString(source.siteKey),
    },
  };
}

function safeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
