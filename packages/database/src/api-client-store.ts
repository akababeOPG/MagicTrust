import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { and, desc, eq, gt, inArray, isNull, or } from "drizzle-orm";

import type { createDatabase } from "./index";
import {
  adminAuditEvents,
  adminUsers,
  apiClientKeys,
  apiClients,
  apiClientScopes,
} from "./schema";

type Database = ReturnType<typeof createDatabase>;

export const apiClientScopesList = [
  "requests:read",
  "requests:processing-data:read",
  "requests:create",
  "requests:update",
  "requests:processing-result:write",
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

export type ManagedApiClient = {
  id: string;
  name: string;
  active: boolean;
  scopes: ApiClientScope[];
  createdAt: Date;
  lastUsedAt: Date | null;
};

export type ApiClientManagementStore = {
  listApiClients(): Promise<ManagedApiClient[]>;
  createApiClient(input: {
    name: string;
    scopes: ApiClientScope[];
    rawKey: string;
    actorAdminUserId: string;
    now: Date;
  }): Promise<ManagedApiClient | null>;
  revokeApiClient(input: {
    apiClientId: string;
    actorAdminUserId: string;
    now: Date;
  }): Promise<boolean>;
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

export function createApiClientManagementStore(
  db: Database,
): ApiClientManagementStore {
  return {
    async listApiClients() {
      const clients = await db
        .select()
        .from(apiClients)
        .orderBy(desc(apiClients.createdAt), desc(apiClients.id));
      if (clients.length === 0) return [];

      const ids = clients.map((client) => client.id);
      const [scopes, keys] = await Promise.all([
        db
          .select()
          .from(apiClientScopes)
          .where(inArray(apiClientScopes.apiClientId, ids)),
        db
          .select({
            apiClientId: apiClientKeys.apiClientId,
            lastUsedAt: apiClientKeys.lastUsedAt,
          })
          .from(apiClientKeys)
          .where(inArray(apiClientKeys.apiClientId, ids)),
      ]);

      return clients.map((client) => ({
        ...client,
        scopes: scopes
          .filter((item) => item.apiClientId === client.id)
          .map((item) => item.scope)
          .filter(isApiClientScope),
        lastUsedAt:
          keys
            .filter((key) => key.apiClientId === client.id && key.lastUsedAt)
            .map((key) => key.lastUsedAt!)
            .sort((left, right) => right.getTime() - left.getTime())[0] ?? null,
      }));
    },
    async createApiClient(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) return null;

        const [client] = await tx
          .insert(apiClients)
          .values({
            name: input.name,
            active: true,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning();
        if (!client) return null;

        await tx.insert(apiClientKeys).values({
          apiClientId: client.id,
          keyPrefix: getApiKeyPrefix(input.rawKey),
          keyHash: hashApiKey(input.rawKey),
          active: true,
          createdAt: input.now,
        });
        await tx
          .insert(apiClientScopes)
          .values(
            input.scopes.map((scope) => ({ apiClientId: client.id, scope })),
          );
        await tx.insert(adminAuditEvents).values({
          type: "API_CLIENT_CREATED",
          actorAdminUserId: input.actorAdminUserId,
          data: { apiClientId: client.id, scopes: input.scopes },
          createdAt: input.now,
        });

        return { ...client, scopes: input.scopes, lastUsedAt: null };
      });
    },
    async revokeApiClient(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) return false;

        const [client] = await tx
          .update(apiClients)
          .set({ active: false, updatedAt: input.now })
          .where(eq(apiClients.id, input.apiClientId))
          .returning({ id: apiClients.id });
        if (!client) return false;

        await tx
          .update(apiClientKeys)
          .set({ active: false })
          .where(eq(apiClientKeys.apiClientId, client.id));
        await tx.insert(adminAuditEvents).values({
          type: "API_CLIENT_REVOKED",
          actorAdminUserId: input.actorAdminUserId,
          data: { apiClientId: client.id },
          createdAt: input.now,
        });
        return true;
      });
    },
  };
}

async function isActiveAdmin(
  db: Parameters<Parameters<Database["transaction"]>[0]>[0],
  adminUserId: string,
): Promise<boolean> {
  const [admin] = await db
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.id, adminUserId),
        eq(adminUsers.role, "ADMIN"),
        eq(adminUsers.active, true),
      ),
    )
    .limit(1);
  return Boolean(admin);
}
