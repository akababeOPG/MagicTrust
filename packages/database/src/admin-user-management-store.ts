import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { createDatabase } from "./index";
import type {
  AdminRole,
  AdminUser,
  CreateAdminUserInput,
} from "./admin-auth-store";
import { adminAuditEvents, adminSessions, adminUsers } from "./schema";

type Database = ReturnType<typeof createDatabase>;

export const adminAuditEventTypes = [
  "ADMIN_USER_CREATED",
  "ADMIN_USER_ROLE_CHANGED",
  "ADMIN_USER_ACTIVATED",
  "ADMIN_USER_DEACTIVATED",
  "ADMIN_USER_PASSWORD_SET",
  "ADMIN_USER_PASSWORD_RESET",
  "FORM_CREATED",
  "FORM_ARCHIVED",
  "FORM_VERSION_CREATED",
  "FORM_VERSION_PUBLISHED",
  "FORM_VERSION_UPDATED",
  "API_CLIENT_CREATED",
  "API_CLIENT_REVOKED",
] as const;

export type AdminAuditEventType = (typeof adminAuditEventTypes)[number];

export type AdminUserListFilters = {
  role?: AdminRole;
  active?: boolean;
};

export type ManagedAdminUserListItem = AdminUser & {
  hasPassword: boolean;
};

export type AdminUserManagementErrorCode =
  | "ACTOR_NOT_AUTHORIZED"
  | "ADMIN_USER_ALREADY_EXISTS"
  | "ADMIN_USER_NOT_FOUND"
  | "LAST_ACTIVE_ADMIN"
  | "SELF_PASSWORD_CHANGE_NOT_ALLOWED"
  | "SELF_DEACTIVATION"
  | "SELF_DEMOTION";

export type AdminUserManagementResult =
  | { ok: true; user: AdminUser; changed: boolean }
  | { ok: false; code: AdminUserManagementErrorCode };

export type CreateManagedAdminUserInput = Omit<
  CreateAdminUserInput,
  "passwordHash"
> & {
  passwordHash: string;
  actorAdminUserId: string;
  now: Date;
};

export type ChangeManagedAdminUserRoleInput = {
  targetAdminUserId: string;
  actorAdminUserId: string;
  role: AdminRole;
  now: Date;
};

export type SetManagedAdminUserActiveInput = {
  targetAdminUserId: string;
  actorAdminUserId: string;
  active: boolean;
  now: Date;
};

export type SetManagedAdminUserPasswordInput = {
  targetAdminUserId: string;
  actorAdminUserId: string;
  passwordHash: string;
  now: Date;
};

export type AdminUserManagementStore = {
  listAdminUsers(
    filters: AdminUserListFilters,
  ): Promise<ManagedAdminUserListItem[]>;
  createAdminUser(
    input: CreateManagedAdminUserInput,
  ): Promise<AdminUserManagementResult>;
  changeAdminUserRole(
    input: ChangeManagedAdminUserRoleInput,
  ): Promise<AdminUserManagementResult>;
  setAdminUserActive(
    input: SetManagedAdminUserActiveInput,
  ): Promise<AdminUserManagementResult>;
  setAdminUserPassword(
    input: SetManagedAdminUserPasswordInput,
  ): Promise<AdminUserManagementResult>;
};

export function createAdminUserManagementStore(
  db: Database,
): AdminUserManagementStore {
  return {
    async listAdminUsers(filters) {
      const conditions = [
        filters.role ? eq(adminUsers.role, filters.role) : undefined,
        filters.active === undefined
          ? undefined
          : eq(adminUsers.active, filters.active),
      ].filter((condition) => condition !== undefined);

      return db
        .select({
          ...adminUserSelection,
          hasPassword: sql<boolean>`${adminUsers.passwordHash} is not null`,
        })
        .from(adminUsers)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(adminUsers.createdAt), desc(adminUsers.id));
    },
    async createAdminUser(input) {
      return db.transaction(async (tx) => {
        const activeAdmins = await lockActiveAdmins(tx);

        if (
          !activeAdmins.some((admin) => admin.id === input.actorAdminUserId)
        ) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }

        const [created] = await tx
          .insert(adminUsers)
          .values({
            emailEncrypted: input.emailEncrypted,
            emailHash: input.emailHash,
            passwordHash: input.passwordHash,
            role: input.role,
            active: true,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing({ target: adminUsers.emailHash })
          .returning(adminUserSelection);

        if (!created) {
          return { ok: false, code: "ADMIN_USER_ALREADY_EXISTS" };
        }

        await insertAdminAuditEvent(tx, {
          type: "ADMIN_USER_CREATED",
          targetAdminUserId: created.id,
          actorAdminUserId: input.actorAdminUserId,
          data: { newRole: created.role },
          createdAt: input.now,
        });

        return { ok: true, user: created, changed: true };
      });
    },
    async changeAdminUserRole(input) {
      return db.transaction(async (tx) => {
        const activeAdmins = await lockActiveAdmins(tx);

        if (
          !activeAdmins.some((admin) => admin.id === input.actorAdminUserId)
        ) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }

        const target =
          activeAdmins.find((admin) => admin.id === input.targetAdminUserId) ??
          (await lockAdminUser(tx, input.targetAdminUserId));

        if (!target) {
          return { ok: false, code: "ADMIN_USER_NOT_FOUND" };
        }
        if (target.role === input.role) {
          return { ok: true, user: target, changed: false };
        }
        if (
          target.id === input.actorAdminUserId &&
          target.role === "ADMIN" &&
          input.role !== "ADMIN"
        ) {
          return { ok: false, code: "SELF_DEMOTION" };
        }
        if (
          target.active &&
          target.role === "ADMIN" &&
          input.role !== "ADMIN" &&
          activeAdmins.length <= 1
        ) {
          return { ok: false, code: "LAST_ACTIVE_ADMIN" };
        }

        const [updated] = await tx
          .update(adminUsers)
          .set({ role: input.role, updatedAt: input.now })
          .where(eq(adminUsers.id, target.id))
          .returning(adminUserSelection);

        await insertAdminAuditEvent(tx, {
          type: "ADMIN_USER_ROLE_CHANGED",
          targetAdminUserId: target.id,
          actorAdminUserId: input.actorAdminUserId,
          data: { oldRole: target.role, newRole: input.role },
          createdAt: input.now,
        });

        return { ok: true, user: updated, changed: true };
      });
    },
    async setAdminUserActive(input) {
      return db.transaction(async (tx) => {
        const activeAdmins = await lockActiveAdmins(tx);

        if (
          !activeAdmins.some((admin) => admin.id === input.actorAdminUserId)
        ) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }

        const target =
          activeAdmins.find((admin) => admin.id === input.targetAdminUserId) ??
          (await lockAdminUser(tx, input.targetAdminUserId));

        if (!target) {
          return { ok: false, code: "ADMIN_USER_NOT_FOUND" };
        }
        if (target.active === input.active) {
          return { ok: true, user: target, changed: false };
        }
        if (!input.active && target.id === input.actorAdminUserId) {
          return { ok: false, code: "SELF_DEACTIVATION" };
        }
        if (
          !input.active &&
          target.role === "ADMIN" &&
          activeAdmins.length <= 1
        ) {
          return { ok: false, code: "LAST_ACTIVE_ADMIN" };
        }

        const [updated] = await tx
          .update(adminUsers)
          .set({ active: input.active, updatedAt: input.now })
          .where(eq(adminUsers.id, target.id))
          .returning(adminUserSelection);

        await insertAdminAuditEvent(tx, {
          type: input.active
            ? "ADMIN_USER_ACTIVATED"
            : "ADMIN_USER_DEACTIVATED",
          targetAdminUserId: target.id,
          actorAdminUserId: input.actorAdminUserId,
          data: {},
          createdAt: input.now,
        });

        return { ok: true, user: updated, changed: true };
      });
    },
    async setAdminUserPassword(input) {
      return db.transaction(async (tx) => {
        const activeAdmins = await lockActiveAdmins(tx);

        if (
          !activeAdmins.some((admin) => admin.id === input.actorAdminUserId)
        ) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }

        if (input.targetAdminUserId === input.actorAdminUserId) {
          return { ok: false, code: "SELF_PASSWORD_CHANGE_NOT_ALLOWED" };
        }

        const target = await lockAdminUserPassword(tx, input.targetAdminUserId);

        if (!target) {
          return { ok: false, code: "ADMIN_USER_NOT_FOUND" };
        }

        const [updated] = await tx
          .update(adminUsers)
          .set({ passwordHash: input.passwordHash, updatedAt: input.now })
          .where(eq(adminUsers.id, target.id))
          .returning(adminUserSelection);

        await tx
          .update(adminSessions)
          .set({ revokedAt: input.now })
          .where(
            and(
              eq(adminSessions.adminUserId, target.id),
              isNull(adminSessions.revokedAt),
            ),
          );

        await insertAdminAuditEvent(tx, {
          type:
            target.passwordHash === null
              ? "ADMIN_USER_PASSWORD_SET"
              : "ADMIN_USER_PASSWORD_RESET",
          targetAdminUserId: target.id,
          actorAdminUserId: input.actorAdminUserId,
          data: {},
          createdAt: input.now,
        });

        return { ok: true, user: updated, changed: true };
      });
    },
  };
}

type AdminTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function lockActiveAdmins(tx: AdminTransaction): Promise<AdminUser[]> {
  return tx
    .select(adminUserSelection)
    .from(adminUsers)
    .where(and(eq(adminUsers.role, "ADMIN"), eq(adminUsers.active, true)))
    .orderBy(adminUsers.id)
    .for("update");
}

async function lockAdminUser(
  tx: AdminTransaction,
  adminUserId: string,
): Promise<AdminUser | null> {
  const [adminUser] = await tx
    .select(adminUserSelection)
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId))
    .limit(1)
    .for("update");

  return adminUser ?? null;
}

async function lockAdminUserPassword(
  tx: AdminTransaction,
  adminUserId: string,
): Promise<{ id: string; passwordHash: string | null } | null> {
  const [adminUser] = await tx
    .select({
      id: adminUsers.id,
      passwordHash: adminUsers.passwordHash,
    })
    .from(adminUsers)
    .where(eq(adminUsers.id, adminUserId))
    .limit(1)
    .for("update");

  return adminUser ?? null;
}

async function insertAdminAuditEvent(
  tx: AdminTransaction,
  input: {
    type: AdminAuditEventType;
    targetAdminUserId: string;
    actorAdminUserId: string;
    data: { oldRole?: AdminRole; newRole?: AdminRole };
    createdAt: Date;
  },
): Promise<void> {
  await tx.insert(adminAuditEvents).values(input);
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
