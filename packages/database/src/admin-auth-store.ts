import { randomBytes } from "node:crypto";

import { prepareProtectedEmail } from "@magictrust/privacy";
import { and, eq, gt, isNull } from "drizzle-orm";

import type { createDatabase } from "./index";
import { adminLoginTokens, adminSessions, adminUsers } from "./schema";

type Database = ReturnType<typeof createDatabase>;

export const adminRoles = ["ADMIN", "OPERATOR", "VIEWER"] as const;

export type AdminRole = (typeof adminRoles)[number];

export type AdminUser = {
  id: string;
  emailEncrypted: string;
  emailHash: string;
  role: AdminRole;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
};

export type AdminSessionIdentity = {
  adminUserId: string;
  role: AdminRole;
  sessionId: string;
};

export type CreateAdminUserInput = {
  emailEncrypted: string;
  emailHash: string;
  role: AdminRole;
};

export type PreparedAdminUserCreateInput = CreateAdminUserInput & {
  normalizedEmail: string;
};

export type CreateAdminLoginTokenInput = {
  adminUserId: string;
  tokenHash: string;
  expiresAt: Date;
};

export type ConsumeAdminLoginTokenInput = {
  tokenHash: string;
  sessionTokenHash: string;
  sessionExpiresAt: Date;
  now: Date;
};

export type ValidateAdminSessionInput = {
  sessionTokenHash: string;
  now: Date;
};

export type AdminAuthStore = {
  createAdminUser(input: CreateAdminUserInput): Promise<AdminUser>;
  findActiveAdminUserByEmailHash(emailHash: string): Promise<AdminUser | null>;
  createAdminLoginToken(
    input: CreateAdminLoginTokenInput,
  ): Promise<{ id: string; adminUserId: string; expiresAt: Date }>;
  consumeAdminLoginToken(
    input: ConsumeAdminLoginTokenInput,
  ): Promise<AdminSessionIdentity | null>;
  validateAdminSession(
    input: ValidateAdminSessionInput,
  ): Promise<AdminSessionIdentity | null>;
  revokeAdminSession(sessionTokenHash: string, now: Date): Promise<void>;
};

export function generateAdminToken(): string {
  return randomBytes(32).toString("base64url");
}

export function isAdminRole(value: string): value is AdminRole {
  return adminRoles.includes(value as AdminRole);
}

export function prepareAdminUserCreateInput(
  email: string,
  role: AdminRole,
): PreparedAdminUserCreateInput {
  const protectedEmail = prepareProtectedEmail(email);

  return {
    ...protectedEmail,
    role,
  };
}

export function createAdminAuthStore(db: Database): AdminAuthStore {
  return {
    async createAdminUser(input) {
      const existing = await findAdminUserByEmailHash(db, input.emailHash);

      if (existing) {
        throw new Error("ADMIN_USER_ALREADY_EXISTS");
      }

      const [adminUser] = await db
        .insert(adminUsers)
        .values({
          emailEncrypted: input.emailEncrypted,
          emailHash: input.emailHash,
          role: input.role,
        })
        .returning(adminUserSelection);

      return adminUser;
    },
    async findActiveAdminUserByEmailHash(emailHash) {
      const [adminUser] = await db
        .select(adminUserSelection)
        .from(adminUsers)
        .where(
          and(eq(adminUsers.emailHash, emailHash), eq(adminUsers.active, true)),
        )
        .limit(1);

      return adminUser ?? null;
    },
    async createAdminLoginToken(input) {
      const [loginToken] = await db
        .insert(adminLoginTokens)
        .values(input)
        .returning({
          id: adminLoginTokens.id,
          adminUserId: adminLoginTokens.adminUserId,
          expiresAt: adminLoginTokens.expiresAt,
        });

      return loginToken;
    },
    async consumeAdminLoginToken(input) {
      return db.transaction(async (tx) => {
        const [loginToken] = await tx
          .update(adminLoginTokens)
          .set({
            usedAt: input.now,
          })
          .where(
            and(
              eq(adminLoginTokens.tokenHash, input.tokenHash),
              isNull(adminLoginTokens.usedAt),
              gt(adminLoginTokens.expiresAt, input.now),
            ),
          )
          .returning({
            id: adminLoginTokens.id,
            adminUserId: adminLoginTokens.adminUserId,
          });

        if (!loginToken) {
          return null;
        }

        const [adminUser] = await tx
          .select({
            id: adminUsers.id,
            role: adminUsers.role,
          })
          .from(adminUsers)
          .where(
            and(
              eq(adminUsers.id, loginToken.adminUserId),
              eq(adminUsers.active, true),
            ),
          )
          .limit(1);

        if (!adminUser) {
          return null;
        }

        const [session] = await tx
          .insert(adminSessions)
          .values({
            adminUserId: adminUser.id,
            sessionTokenHash: input.sessionTokenHash,
            expiresAt: input.sessionExpiresAt,
          })
          .returning({
            id: adminSessions.id,
          });

        await tx
          .update(adminUsers)
          .set({
            lastLoginAt: input.now,
            updatedAt: input.now,
          })
          .where(eq(adminUsers.id, adminUser.id));

        return {
          adminUserId: adminUser.id,
          role: adminUser.role,
          sessionId: session.id,
        };
      });
    },
    async validateAdminSession(input) {
      const [session] = await db
        .select({
          sessionId: adminSessions.id,
          adminUserId: adminUsers.id,
          role: adminUsers.role,
        })
        .from(adminSessions)
        .innerJoin(adminUsers, eq(adminSessions.adminUserId, adminUsers.id))
        .where(
          and(
            eq(adminSessions.sessionTokenHash, input.sessionTokenHash),
            gt(adminSessions.expiresAt, input.now),
            isNull(adminSessions.revokedAt),
            eq(adminUsers.active, true),
          ),
        )
        .limit(1);

      if (!session) {
        return null;
      }

      await db
        .update(adminSessions)
        .set({
          lastUsedAt: input.now,
        })
        .where(eq(adminSessions.id, session.sessionId));

      return session;
    },
    async revokeAdminSession(sessionTokenHash, now) {
      await db
        .update(adminSessions)
        .set({
          revokedAt: now,
        })
        .where(eq(adminSessions.sessionTokenHash, sessionTokenHash));
    },
  };
}

async function findAdminUserByEmailHash(
  db: Database,
  emailHash: string,
): Promise<AdminUser | null> {
  const [adminUser] = await db
    .select(adminUserSelection)
    .from(adminUsers)
    .where(eq(adminUsers.emailHash, emailHash))
    .limit(1);

  return adminUser ?? null;
}

const adminUserSelection = {
  id: adminUsers.id,
  emailEncrypted: adminUsers.emailEncrypted,
  emailHash: adminUsers.emailHash,
  role: adminUsers.role,
  active: adminUsers.active,
  createdAt: adminUsers.createdAt,
  updatedAt: adminUsers.updatedAt,
  lastLoginAt: adminUsers.lastLoginAt,
};
