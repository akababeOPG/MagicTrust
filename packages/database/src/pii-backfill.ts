import type { JsonObject, RequestType } from "@magictrust/domain";
import {
  encryptPii,
  encryptSubmittedPayload,
  hashPii,
  hashSubmittedPayload,
} from "@magictrust/privacy";

export type LegacyRequestBackfillRow = {
  id: string;
  type: RequestType;
  submittedData: JsonObject;
  submittedDataEncrypted: string | null;
};

export type LegacyCommunicationBackfillRow = {
  id: string;
  recipient: string | null;
};

export type RequestBackfillUpdate = {
  id: string;
  submittedData: JsonObject;
  submittedDataEncrypted: string;
  submittedDataHash: string;
  encryptionVersion: 1;
};

export type CommunicationBackfillUpdate = {
  id: string;
  recipient: null;
  recipientEncrypted: string;
  recipientHash: string;
  encryptionVersion: 1;
};

export function prepareLegacyRequestBackfill(
  row: LegacyRequestBackfillRow,
): RequestBackfillUpdate | null {
  if (row.submittedDataEncrypted) {
    return null;
  }

  return {
    id: row.id,
    submittedData: sanitizeSubmittedDataSnapshot(row.submittedData, row.type),
    submittedDataEncrypted: encryptSubmittedPayload(row.submittedData),
    submittedDataHash: hashSubmittedPayload(row.submittedData),
    encryptionVersion: 1,
  };
}

export function prepareLegacyCommunicationBackfill(
  row: LegacyCommunicationBackfillRow,
): CommunicationBackfillUpdate | null {
  if (!row.recipient) {
    return null;
  }

  return {
    id: row.id,
    recipient: null,
    recipientEncrypted: encryptPii(row.recipient),
    recipientHash: hashPii(row.recipient),
    encryptionVersion: 1,
  };
}

export function sanitizeSubmittedDataSnapshot(
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
