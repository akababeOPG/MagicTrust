import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, gt, isNull, or } from "drizzle-orm";

import type { createDatabase } from "./index";
import { apiClientKeys, apiClients, apiClientScopes } from "./schema";

type Database = ReturnType<typeof createDatabase>;

export const apiClientScopesList = [
  "requests:read",
  "requests:processing-data:read",
  "requests:create",
  "requests:update",
  "comments:write",
  "attachments:write",
  "attachments:read",
  "communications:write",
  "notifications:write",
  "events:write",
] as const;

export type ApiClientScope = (typeof apiClientScopesList)[number];

export type AuthenticatedApiClient = {
  id: string;
  name: string;
  keyId: string;
  scopes: ApiClientScope[];
};

export type ApiClientStore = {
  authenticateApiKey(
    rawKey: string,
    now?: Date,
  ): Promise<AuthenticatedApiClient | null>;
};

const apiKeyPrefixLength = 16;

export function generateApiKey(): string {
  return `mt_live_${randomBytes(32).toString("base64url")}`;
}

export function getApiKeyPrefix(rawKey: string): string {
  return rawKey.slice(0, apiKeyPrefixLength);
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

export function verifyApiKey(rawKey: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashApiKey(rawKey), "hex");
  const expected = Buffer.from(expectedHash, "hex");

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function isApiClientScope(value: string): value is ApiClientScope {
  return apiClientScopesList.includes(value as ApiClientScope);
}

export function createApiClientStore(db: Database): ApiClientStore {
  return {
    async authenticateApiKey(rawKey, now = new Date()) {
      const prefix = getApiKeyPrefix(rawKey);
      const candidates = await db
        .select({
          keyId: apiClientKeys.id,
          keyHash: apiClientKeys.keyHash,
          clientId: apiClients.id,
          clientName: apiClients.name,
        })
        .from(apiClientKeys)
        .innerJoin(apiClients, eq(apiClientKeys.apiClientId, apiClients.id))
        .where(
          and(
            eq(apiClientKeys.keyPrefix, prefix),
            eq(apiClientKeys.active, true),
            eq(apiClients.active, true),
            or(
              isNull(apiClientKeys.expiresAt),
              gt(apiClientKeys.expiresAt, now),
            ),
          ),
        );

      const match = candidates.find((candidate) =>
        verifyApiKey(rawKey, candidate.keyHash),
      );

      if (!match) {
        return null;
      }

      const scopes = await db
        .select({
          scope: apiClientScopes.scope,
        })
        .from(apiClientScopes)
        .where(eq(apiClientScopes.apiClientId, match.clientId));

      await db
        .update(apiClientKeys)
        .set({ lastUsedAt: now })
        .where(eq(apiClientKeys.id, match.keyId));

      return {
        id: match.clientId,
        name: match.clientName,
        keyId: match.keyId,
        scopes: scopes.map((item) => item.scope).filter(isApiClientScope),
      };
    },
  };
}
