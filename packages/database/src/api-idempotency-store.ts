import type { JsonValue } from "@magictrust/domain";
import { and, eq, gt } from "drizzle-orm";

import type { createDatabase } from "./index";
import { apiIdempotencyRecords } from "./schema";

type Database = ReturnType<typeof createDatabase>;

export type ApiIdempotencyRecord = {
  id: string;
  idempotencyKey: string;
  apiClientId: string;
  method: string;
  route: string;
  requestHash: string;
  responseStatus: number;
  responseBody: JsonValue;
  createdAt: Date;
  expiresAt: Date;
};

export type CreateApiIdempotencyRecordInput = {
  idempotencyKey: string;
  apiClientId: string;
  method: string;
  route: string;
  requestHash: string;
  responseStatus: number;
  responseBody: JsonValue;
  expiresAt: Date;
};

export type ApiIdempotencyStore = {
  findActive(
    apiClientId: string,
    idempotencyKey: string,
    now: Date,
  ): Promise<ApiIdempotencyRecord | null>;
  create(input: CreateApiIdempotencyRecordInput): Promise<ApiIdempotencyRecord>;
};

export function createApiIdempotencyStore(db: Database): ApiIdempotencyStore {
  return {
    async findActive(apiClientId, idempotencyKey, now) {
      const [record] = await db
        .select(apiIdempotencyRecordSelection)
        .from(apiIdempotencyRecords)
        .where(
          and(
            eq(apiIdempotencyRecords.apiClientId, apiClientId),
            eq(apiIdempotencyRecords.idempotencyKey, idempotencyKey),
            gt(apiIdempotencyRecords.expiresAt, now),
          ),
        )
        .limit(1);

      return record
        ? {
            ...record,
            responseBody: record.responseBody as JsonValue,
          }
        : null;
    },
    async create(input) {
      const [record] = await db
        .insert(apiIdempotencyRecords)
        .values(input)
        .returning(apiIdempotencyRecordSelection);

      return {
        ...record,
        responseBody: record.responseBody as JsonValue,
      };
    },
  };
}

const apiIdempotencyRecordSelection = {
  id: apiIdempotencyRecords.id,
  idempotencyKey: apiIdempotencyRecords.idempotencyKey,
  apiClientId: apiIdempotencyRecords.apiClientId,
  method: apiIdempotencyRecords.method,
  route: apiIdempotencyRecords.route,
  requestHash: apiIdempotencyRecords.requestHash,
  responseStatus: apiIdempotencyRecords.responseStatus,
  responseBody: apiIdempotencyRecords.responseBody,
  createdAt: apiIdempotencyRecords.createdAt,
  expiresAt: apiIdempotencyRecords.expiresAt,
};
