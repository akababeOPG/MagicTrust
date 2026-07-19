import type {
  AdminAuthStore,
  AdminAuditEventType,
  AdminRole,
  AdminUser,
  AdminUserManagementStore,
} from "@magictrust/database";
import { prepareAdminUserCreateInput } from "@magictrust/database";
import {
  decryptPii,
  hashAdminPassword,
  verifyAdminPassword,
} from "@magictrust/privacy";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminUserDirectory } from "../../lib/admin-user-directory";
import {
  changeManagedAdminUserRole,
  changeManagedAdminUserStatus,
  createManagedAdminUser,
  listManagedAdminUsers,
  setManagedAdminUserPassword,
} from "../../lib/admin-user-management";
import { createAdminAuthService } from "../../lib/admin-auth";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-admin-users";

type AuditRecord = {
  type: AdminAuditEventType;
  targetAdminUserId: string;
  actorAdminUserId: string;
  data: { oldRole?: AdminRole; newRole?: AdminRole };
  createdAt: Date;
};

type ManagementState = {
  users: AdminUser[];
  audits: AuditRecord[];
  assignments: Array<{ requestId: string; adminUserId: string }>;
  historicalActorReferences: Array<{ eventId: string; adminUserId: string }>;
  passwordHashes: Map<string, string | null>;
  sessions: Array<{
    id: string;
    adminUserId: string;
    revokedAt: Date | null;
  }>;
  sentEmails: string[];
  nextId: number;
  now: Date;
};

describe("admin user management", () => {
  test.each(["ADMIN", "OPERATOR", "VIEWER"] as const)(
    "ADMIN creates an encrypted active %s user",
    async (role) => {
      const dependencies = createDependencies();
      const response = await createManagedAdminUser(
        formRequest("/admin/users/create", {
          email: `New.${role}@OnPointGlobal.com`,
          role,
          password: "initial-password-123",
          passwordConfirmation: "initial-password-123",
        }),
        adminSession("admin-actor"),
        dependencies,
      );
      const created = dependencies.state.users.find(
        (user) => user.id !== "admin-actor",
      );

      expect(response.status).toBe(303);
      expect(created).toMatchObject({ role, active: true });
      const passwordHash = dependencies.state.passwordHashes.get(created!.id);
      expect(passwordHash).toEqual(expect.any(String));
      expect(passwordHash).not.toContain("initial-password-123");
      await expect(
        verifyAdminPassword("initial-password-123", passwordHash ?? null),
      ).resolves.toBe(true);
      expect(created?.emailEncrypted).not.toContain("OnPointGlobal.com");
      expect(decryptPii(created!.emailEncrypted)).toBe(
        `new.${role.toLowerCase()}@onpointglobal.com`,
      );
      expect(dependencies.state.audits.at(-1)).toMatchObject({
        type: "ADMIN_USER_CREATED",
        targetAdminUserId: created?.id,
        actorAdminUserId: "admin-actor",
        data: { newRole: role },
      });
      expect(JSON.stringify(dependencies.state.audits)).not.toContain(
        "onpointglobal.com",
      );
      expect(JSON.stringify(dependencies.state.audits)).not.toContain(
        "initial-password-123",
      );
      expect(dependencies.state.sentEmails).toHaveLength(0);
    },
  );

  test("newly created user can authenticate immediately", async () => {
    const dependencies = createDependencies();
    await createManagedAdminUser(
      formRequest("/admin/users/create", {
        email: "new.operator@onpointglobal.com",
        role: "OPERATOR",
        password: "initial-password-123",
        passwordConfirmation: "initial-password-123",
      }),
      adminSession("admin-actor"),
      dependencies,
    );

    const result = await createManagedAuthService(
      dependencies.state,
    ).authenticateWithPassword({
      email: "NEW.OPERATOR@onpointglobal.com",
      password: "initial-password-123",
    });

    expect(result).toMatchObject({
      ok: true,
      session: { role: "OPERATOR" },
    });
  });

  test("duplicate normalized email is rejected", async () => {
    const dependencies = createDependencies();
    await createManagedAdminUser(
      formRequest("/admin/users/create", {
        email: "duplicate@onpointglobal.com",
        role: "VIEWER",
        password: "initial-password-123",
        passwordConfirmation: "initial-password-123",
      }),
      adminSession("admin-actor"),
      dependencies,
    );

    const response = await createManagedAdminUser(
      formRequest("/admin/users/create", {
        email: " DUPLICATE@onpointglobal.com ",
        role: "OPERATOR",
        password: "another-password-123",
        passwordConfirmation: "another-password-123",
      }),
      adminSession("admin-actor"),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "A+user+with+this+email+already+exists",
    );
    expect(dependencies.state.users).toHaveLength(2);
    expect(dependencies.state.audits).toHaveLength(1);
  });

  test("short and mismatched creation passwords are rejected safely", async () => {
    const dependencies = createDependencies();
    const short = await createManagedAdminUser(
      formRequest("/admin/users/create", {
        email: "short@onpointglobal.com",
        role: "VIEWER",
        password: "short",
        passwordConfirmation: "short",
      }),
      adminSession("admin-actor"),
      dependencies,
    );
    const mismatch = await createManagedAdminUser(
      formRequest("/admin/users/create", {
        email: "mismatch@onpointglobal.com",
        role: "VIEWER",
        password: "valid-password-123",
        passwordConfirmation: "different-password-123",
      }),
      adminSession("admin-actor"),
      dependencies,
    );

    expect(short.headers.get("location")).toContain(
      "Password+must+be+at+least+10+characters",
    );
    expect(mismatch.headers.get("location")).toContain(
      "Passwords+do+not+match",
    );
    expect(dependencies.state.users).toHaveLength(1);
    expect(dependencies.state.audits).toHaveLength(0);
  });

  test("lists decrypted emails only for the authorized server view", async () => {
    const dependencies = createDependencies();
    const operator = await createUser(
      dependencies.state,
      "operator@onpointglobal.com",
      "OPERATOR",
      "operator-password-123",
    );
    await createUser(
      dependencies.state,
      "legacy-operator@onpointglobal.com",
      "OPERATOR",
    );
    const encrypted = dependencies.state.users[1]!.emailEncrypted;
    const hash = dependencies.state.users[1]!.emailHash;
    const passwordHash = dependencies.state.passwordHashes.get(operator.id)!;

    const result = await listManagedAdminUsers(
      new URLSearchParams({ role: "OPERATOR", status: "ACTIVE" }),
      dependencies,
    );
    const html = renderToStaticMarkup(
      <AdminUserDirectory
        session={adminSession("admin-actor")}
        params={new URLSearchParams()}
        result={result}
      />,
    );

    expect(result.ok && result.users).toHaveLength(2);
    expect(html).toContain("operator@onpointglobal.com");
    expect(html).not.toContain(encrypted);
    expect(html).not.toContain(hash);
    expect(html).not.toContain(passwordHash);
    expect(html).toContain('name="password"');
    expect(html).toContain('name="passwordConfirmation"');
    expect(html).toContain("Set password");
    expect(html).toContain("Reset password");
    expect(html).toContain("User");
    expect(html).toContain("Role");
    expect(html).toContain("Status");
    expect(html).toContain("Created");
    expect(html).toContain("Actions");
  });

  test("ADMIN changes another user's role and records safe audit data", async () => {
    const dependencies = createDependencies();
    const target = await createUser(
      dependencies.state,
      "viewer@onpointglobal.com",
      "VIEWER",
    );

    const response = await changeManagedAdminUserRole(
      formRequest(`/admin/users/${target.id}/role`, { role: "OPERATOR" }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(target.role).toBe("OPERATOR");
    expect(dependencies.state.audits.at(-1)).toMatchObject({
      type: "ADMIN_USER_ROLE_CHANGED",
      targetAdminUserId: target.id,
      actorAdminUserId: "admin-actor",
      data: { oldRole: "VIEWER", newRole: "OPERATOR" },
    });
  });

  test("ADMIN deactivates and reactivates another user without deleting references", async () => {
    const dependencies = createDependencies();
    const target = await createUser(
      dependencies.state,
      "assigned@onpointglobal.com",
      "OPERATOR",
    );
    dependencies.state.assignments.push({
      requestId: "request-1",
      adminUserId: target.id,
    });
    dependencies.state.historicalActorReferences.push({
      eventId: "event-1",
      adminUserId: target.id,
    });

    await changeManagedAdminUserStatus(
      formRequest(`/admin/users/${target.id}/status`, {
        action: "deactivate",
      }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );

    expect(target.active).toBe(false);
    expect(dependencies.state.assignments).toEqual([
      { requestId: "request-1", adminUserId: target.id },
    ]);
    expect(dependencies.state.historicalActorReferences).toEqual([
      { eventId: "event-1", adminUserId: target.id },
    ]);
    expect(dependencies.state.audits.at(-1)?.type).toBe(
      "ADMIN_USER_DEACTIVATED",
    );

    await changeManagedAdminUserStatus(
      formRequest(`/admin/users/${target.id}/status`, { action: "activate" }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );

    expect(target.active).toBe(true);
    expect(dependencies.state.audits.at(-1)?.type).toBe("ADMIN_USER_ACTIVATED");
  });

  test("ADMIN cannot deactivate or demote themselves", async () => {
    const dependencies = createDependencies({ secondAdmin: true });

    const deactivate = await changeManagedAdminUserStatus(
      formRequest("/admin/users/admin-actor/status", { action: "deactivate" }),
      "admin-actor",
      adminSession("admin-actor"),
      dependencies,
    );
    const demote = await changeManagedAdminUserRole(
      formRequest("/admin/users/admin-actor/role", { role: "OPERATOR" }),
      "admin-actor",
      adminSession("admin-actor"),
      dependencies,
    );

    expect(deactivate.headers.get("location")).toContain(
      "cannot+deactivate+your+own",
    );
    expect(demote.headers.get("location")).toContain(
      "cannot+remove+your+own+Admin+role",
    );
    expect(dependencies.state.users[0]).toMatchObject({
      role: "ADMIN",
      active: true,
    });
    expect(dependencies.state.audits).toHaveLength(0);
  });

  test("the last active ADMIN cannot be deactivated or demoted", async () => {
    const dependencies = createDependencies();

    const deactivate = await changeManagedAdminUserStatus(
      formRequest("/admin/users/admin-actor/status", { action: "deactivate" }),
      "admin-actor",
      adminSession("admin-actor"),
      dependencies,
    );
    const demote = await changeManagedAdminUserRole(
      formRequest("/admin/users/admin-actor/role", { role: "VIEWER" }),
      "admin-actor",
      adminSession("admin-actor"),
      dependencies,
    );

    expect(deactivate.status).toBe(303);
    expect(demote.status).toBe(303);
    expect(dependencies.state.users[0]).toMatchObject({
      role: "ADMIN",
      active: true,
    });
    expect(activeAdminCount(dependencies.state)).toBe(1);
  });

  test("ADMIN sets an initial password for a legacy user", async () => {
    const dependencies = createDependencies();
    const legacy = await createUser(
      dependencies.state,
      "legacy@onpointglobal.com",
      "VIEWER",
    );

    const response = await setManagedAdminUserPassword(
      formRequest(`/admin/users/${legacy.id}/password`, {
        password: "legacy-password-123",
        passwordConfirmation: "legacy-password-123",
      }),
      legacy.id,
      adminSession("admin-actor"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain("Password+updated");
    await expect(
      verifyAdminPassword(
        "legacy-password-123",
        dependencies.state.passwordHashes.get(legacy.id) ?? null,
      ),
    ).resolves.toBe(true);
    expect(dependencies.state.audits.at(-1)).toMatchObject({
      type: "ADMIN_USER_PASSWORD_SET",
      targetAdminUserId: legacy.id,
      actorAdminUserId: "admin-actor",
      data: {},
    });
  });

  test("password reset validates length and confirmation", async () => {
    const dependencies = createDependencies();
    const target = await createUser(
      dependencies.state,
      "target@onpointglobal.com",
      "VIEWER",
    );

    const short = await setManagedAdminUserPassword(
      formRequest(`/admin/users/${target.id}/password`, {
        password: "short",
        passwordConfirmation: "short",
      }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );
    const mismatch = await setManagedAdminUserPassword(
      formRequest(`/admin/users/${target.id}/password`, {
        password: "valid-password-123",
        passwordConfirmation: "different-password-123",
      }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );

    expect(short.headers.get("location")).toContain(
      "Password+must+be+at+least+10+characters",
    );
    expect(mismatch.headers.get("location")).toContain(
      "Passwords+do+not+match",
    );
    expect(dependencies.state.passwordHashes.get(target.id)).toBeNull();
    expect(dependencies.state.audits).toHaveLength(0);
  });

  test("ADMIN resets another user's password and revokes only their sessions", async () => {
    const dependencies = createDependencies();
    const target = await createUser(
      dependencies.state,
      "operator@onpointglobal.com",
      "OPERATOR",
      "old-password-123",
    );
    const unrelated = await createUser(
      dependencies.state,
      "viewer@onpointglobal.com",
      "VIEWER",
      "viewer-password-123",
    );
    dependencies.state.sessions.push(
      { id: "target-session", adminUserId: target.id, revokedAt: null },
      { id: "other-session", adminUserId: unrelated.id, revokedAt: null },
    );

    await setManagedAdminUserPassword(
      formRequest(`/admin/users/${target.id}/password`, {
        password: "new-password-456",
        passwordConfirmation: "new-password-456",
      }),
      target.id,
      adminSession("admin-actor"),
      dependencies,
    );

    const auth = createManagedAuthService(dependencies.state);
    await expect(
      auth.authenticateWithPassword({
        email: "operator@onpointglobal.com",
        password: "old-password-123",
      }),
    ).resolves.toEqual({ ok: false });
    await expect(
      auth.authenticateWithPassword({
        email: "operator@onpointglobal.com",
        password: "new-password-456",
      }),
    ).resolves.toMatchObject({ ok: true });
    expect(dependencies.state.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "target-session",
          revokedAt: dependencies.state.now,
        }),
        expect.objectContaining({ id: "other-session", revokedAt: null }),
      ]),
    );
    expect(dependencies.state.audits.at(-1)).toMatchObject({
      type: "ADMIN_USER_PASSWORD_RESET",
      data: {},
    });
    expect(JSON.stringify(dependencies.state.audits)).not.toContain(
      "new-password-456",
    );
    expect(JSON.stringify(dependencies.state.audits)).not.toContain("$2b$");
    expect(dependencies.state.sentEmails).toHaveLength(0);
  });

  test("self password reset stays on the CLI-only path", async () => {
    const dependencies = createDependencies();
    const response = await setManagedAdminUserPassword(
      formRequest("/admin/users/admin-actor/password", {
        password: "new-password-456",
        passwordConfirmation: "new-password-456",
      }),
      "admin-actor",
      adminSession("admin-actor"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain(
      "password+CLI+to+change+your+own",
    );
    expect(dependencies.state.audits).toHaveLength(0);
  });

  test("cross-origin mutations are rejected before storage", async () => {
    const dependencies = createDependencies();
    const response = await createManagedAdminUser(
      formRequest(
        "/admin/users/create",
        { email: "blocked@onpointglobal.com", role: "VIEWER" },
        "https://other.test",
      ),
      adminSession("admin-actor"),
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(dependencies.state.users).toHaveLength(1);
  });
});

function createDependencies(options: { secondAdmin?: boolean } = {}) {
  const state: ManagementState = {
    users: [],
    audits: [],
    assignments: [],
    historicalActorReferences: [],
    passwordHashes: new Map(),
    sessions: [],
    sentEmails: [],
    nextId: 1,
    now: new Date("2026-07-18T12:00:00.000Z"),
  };
  addUser(state, "admin-actor", "admin@onpointglobal.com", "ADMIN");
  if (options.secondAdmin) {
    addUser(state, "admin-second", "second@onpointglobal.com", "ADMIN");
  }

  return {
    state,
    now: () => state.now,
    store: createInMemoryStore(state),
  };
}

function createInMemoryStore(state: ManagementState): AdminUserManagementStore {
  return {
    async listAdminUsers(filters) {
      return state.users
        .filter(
          (user) =>
            (!filters.role || user.role === filters.role) &&
            (filters.active === undefined || user.active === filters.active),
        )
        .sort(
          (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
        )
        .map((user) => ({
          ...user,
          hasPassword: state.passwordHashes.get(user.id) !== null,
        }));
    },
    async createAdminUser(input) {
      if (!isActiveAdmin(state, input.actorAdminUserId)) {
        return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
      }
      if (state.users.some((user) => user.emailHash === input.emailHash)) {
        return { ok: false, code: "ADMIN_USER_ALREADY_EXISTS" };
      }
      const user: AdminUser = {
        id: `admin-user-${state.nextId++}`,
        emailEncrypted: input.emailEncrypted,
        emailHash: input.emailHash,
        role: input.role,
        active: true,
        createdAt: input.now,
        updatedAt: input.now,
        lastLoginAt: null,
      };
      state.users.push(user);
      state.passwordHashes.set(user.id, input.passwordHash ?? null);
      audit(state, "ADMIN_USER_CREATED", user.id, input.actorAdminUserId, {
        newRole: input.role,
      });
      return { ok: true, user, changed: true };
    },
    async changeAdminUserRole(input) {
      if (!isActiveAdmin(state, input.actorAdminUserId)) {
        return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
      }
      const user = state.users.find(
        (candidate) => candidate.id === input.targetAdminUserId,
      );
      if (!user) return { ok: false, code: "ADMIN_USER_NOT_FOUND" };
      if (user.role === input.role) return { ok: true, user, changed: false };
      if (user.id === input.actorAdminUserId && input.role !== "ADMIN") {
        return { ok: false, code: "SELF_DEMOTION" };
      }
      if (
        user.active &&
        user.role === "ADMIN" &&
        input.role !== "ADMIN" &&
        activeAdminCount(state) <= 1
      ) {
        return { ok: false, code: "LAST_ACTIVE_ADMIN" };
      }
      const oldRole = user.role;
      user.role = input.role;
      user.updatedAt = input.now;
      audit(state, "ADMIN_USER_ROLE_CHANGED", user.id, input.actorAdminUserId, {
        oldRole,
        newRole: input.role,
      });
      return { ok: true, user, changed: true };
    },
    async setAdminUserActive(input) {
      if (!isActiveAdmin(state, input.actorAdminUserId)) {
        return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
      }
      const user = state.users.find(
        (candidate) => candidate.id === input.targetAdminUserId,
      );
      if (!user) return { ok: false, code: "ADMIN_USER_NOT_FOUND" };
      if (user.active === input.active)
        return { ok: true, user, changed: false };
      if (!input.active && user.id === input.actorAdminUserId) {
        return { ok: false, code: "SELF_DEACTIVATION" };
      }
      if (
        !input.active &&
        user.role === "ADMIN" &&
        activeAdminCount(state) <= 1
      ) {
        return { ok: false, code: "LAST_ACTIVE_ADMIN" };
      }
      user.active = input.active;
      user.updatedAt = input.now;
      audit(
        state,
        input.active ? "ADMIN_USER_ACTIVATED" : "ADMIN_USER_DEACTIVATED",
        user.id,
        input.actorAdminUserId,
        {},
      );
      return { ok: true, user, changed: true };
    },
    async setAdminUserPassword(input) {
      if (!isActiveAdmin(state, input.actorAdminUserId)) {
        return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
      }
      if (input.targetAdminUserId === input.actorAdminUserId) {
        return { ok: false, code: "SELF_PASSWORD_CHANGE_NOT_ALLOWED" };
      }
      const user = state.users.find(
        (candidate) => candidate.id === input.targetAdminUserId,
      );
      if (!user) return { ok: false, code: "ADMIN_USER_NOT_FOUND" };

      const previousHash = state.passwordHashes.get(user.id) ?? null;
      state.passwordHashes.set(user.id, input.passwordHash);
      user.updatedAt = input.now;
      for (const session of state.sessions) {
        if (session.adminUserId === user.id && !session.revokedAt) {
          session.revokedAt = input.now;
        }
      }
      audit(
        state,
        previousHash ? "ADMIN_USER_PASSWORD_RESET" : "ADMIN_USER_PASSWORD_SET",
        user.id,
        input.actorAdminUserId,
        {},
      );
      return { ok: true, user, changed: true };
    },
  };
}

function audit(
  state: ManagementState,
  type: AdminAuditEventType,
  targetAdminUserId: string,
  actorAdminUserId: string,
  data: AuditRecord["data"],
) {
  state.audits.push({
    type,
    targetAdminUserId,
    actorAdminUserId,
    data,
    createdAt: state.now,
  });
}

async function createUser(
  state: ManagementState,
  email: string,
  role: AdminRole,
  password?: string,
) {
  const user = addUser(state, `admin-user-${state.nextId++}`, email, role);

  if (password) {
    state.passwordHashes.set(user.id, await hashAdminPassword(password));
  }

  return user;
}

function addUser(
  state: ManagementState,
  id: string,
  email: string,
  role: AdminRole,
) {
  const prepared = prepareAdminUserCreateInput(email, role);
  const user: AdminUser = {
    id,
    emailEncrypted: prepared.emailEncrypted,
    emailHash: prepared.emailHash,
    role,
    active: true,
    createdAt: state.now,
    updatedAt: state.now,
    lastLoginAt: null,
  };
  state.users.push(user);
  state.passwordHashes.set(user.id, null);
  return user;
}

function isActiveAdmin(state: ManagementState, id: string) {
  return state.users.some(
    (user) => user.id === id && user.active && user.role === "ADMIN",
  );
}

function activeAdminCount(state: ManagementState) {
  return state.users.filter((user) => user.active && user.role === "ADMIN")
    .length;
}

function createManagedAuthService(state: ManagementState) {
  const adminAuthStore = {
    async createAdminUser() {
      throw new Error("Not used by this test.");
    },
    async findAdminPasswordCredentialByEmailHash(emailHash: string) {
      const user = state.users.find(
        (candidate) => candidate.emailHash === emailHash,
      );

      return user
        ? {
            id: user.id,
            active: user.active,
            passwordHash: state.passwordHashes.get(user.id) ?? null,
          }
        : null;
    },
    async createAdminSession(input) {
      const user = state.users.find(
        (candidate) => candidate.id === input.adminUserId && candidate.active,
      );

      if (!user) return null;

      const sessionId = `session-${state.nextId++}`;
      state.sessions.push({
        id: sessionId,
        adminUserId: user.id,
        revokedAt: null,
      });

      return {
        adminUserId: user.id,
        role: user.role,
        sessionId,
      };
    },
    async findActiveAdminUserByEmailHash(emailHash: string) {
      return (
        state.users.find(
          (user) => user.emailHash === emailHash && user.active,
        ) ?? null
      );
    },
    async createAdminLoginToken() {
      throw new Error("Not used by this test.");
    },
    async consumeAdminLoginToken() {
      return null;
    },
    async validateAdminSession() {
      return null;
    },
    async revokeAdminSession() {},
  } satisfies AdminAuthStore;

  return createAdminAuthService({
    adminAuthStore,
    appEnv: "development",
    now: () => state.now,
    generateToken: () => `session-token-${state.nextId++}`,
  });
}

function adminSession(adminUserId: string) {
  return {
    adminUserId,
    role: "ADMIN" as const,
    sessionId: "session-1",
  };
}

function formRequest(
  path: string,
  values: Record<string, string>,
  origin = "https://magictrust.test",
) {
  return new Request(`https://magictrust.test${path}`, {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values),
  });
}
