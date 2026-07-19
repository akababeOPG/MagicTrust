import type {
  AdminAuthStore,
  AdminRole,
  AdminSessionIdentity,
  AdminUser,
  CreateAdminLoginTokenInput,
  CreateAdminUserInput,
} from "@magictrust/database";
import { prepareAdminUserCreateInput } from "@magictrust/database";
import {
  decryptPii,
  hashAdminLoginToken,
  hashAdminPassword,
  hashAdminSessionToken,
  hashPii,
  verifyAdminPassword,
} from "@magictrust/privacy";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  adminSessionCookieOptions,
  clearAdminSessionCookieOptions,
  createAdminAuthService,
  normalizeAdminReturnTo,
} from "../../lib/admin-auth";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-admin-auth";

const validPassword = "correct horse battery staple";

type InMemoryAdminAuthState = {
  now: Date;
  nextId: number;
  tokens: string[];
  adminUsers: AdminUser[];
  passwordHashes: Map<string, string | null>;
  loginTokens: Array<{
    id: string;
    adminUserId: string;
    tokenHash: string;
    expiresAt: Date;
    usedAt: Date | null;
    createdAt: Date;
  }>;
  sessions: Array<{
    id: string;
    adminUserId: string;
    sessionTokenHash: string;
    expiresAt: Date;
    revokedAt: Date | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }>;
};

describe("admin password authentication", () => {
  test("creates an encrypted admin user with a password hash", async () => {
    const dependencies = createInMemoryDependencies();
    const passwordHash = await hashAdminPassword(validPassword);
    const prepared = prepareAdminUserCreateInput(
      "User@OnPointGlobal.com",
      "ADMIN",
    );
    const adminUser = await dependencies.adminAuthStore.createAdminUser({
      ...prepared,
      passwordHash,
    });

    expect(adminUser.role).toBe("ADMIN");
    expect(adminUser.emailEncrypted).not.toContain("User@OnPointGlobal.com");
    expect(decryptPii(adminUser.emailEncrypted)).toBe("user@onpointglobal.com");
    expect(adminUser.emailHash).toBe(hashPii("user@onpointglobal.com"));
    expect(dependencies.state.passwordHashes.get(adminUser.id)).toBe(
      passwordHash,
    );
    expect(passwordHash).not.toContain(validPassword);
    await expect(
      verifyAdminPassword(validPassword, passwordHash),
    ).resolves.toBe(true);
  });

  test.each(["ADMIN", "OPERATOR", "VIEWER"] as const)(
    "active %s can sign in with the correct password",
    async (role) => {
      const dependencies = createInMemoryDependencies({
        tokens: ["session-token"],
      });
      const adminUser = await createUser(
        dependencies,
        `${role.toLowerCase()}@onpointglobal.com`,
        role,
        validPassword,
      );

      const result = await createAdminAuthService(
        dependencies,
      ).authenticateWithPassword({
        email: ` ${role}@OnPointGlobal.com `,
        password: validPassword,
      });

      expect(result).toMatchObject({
        ok: true,
        session: { adminUserId: adminUser.id, role },
        sessionToken: "session-token",
      });
      expect(dependencies.state.sessions[0]?.sessionTokenHash).toBe(
        hashAdminSessionToken("session-token"),
      );
    },
  );

  test("incorrect password and unknown email return the same result", async () => {
    const dependencies = createInMemoryDependencies();
    const service = createAdminAuthService(dependencies);
    await createUser(
      dependencies,
      "known@onpointglobal.com",
      "ADMIN",
      validPassword,
    );

    const incorrect = await service.authenticateWithPassword({
      email: "known@onpointglobal.com",
      password: "incorrect-password",
    });
    const unknown = await service.authenticateWithPassword({
      email: "unknown@onpointglobal.com",
      password: "incorrect-password",
    });

    expect(incorrect).toEqual({ ok: false });
    expect(unknown).toEqual(incorrect);
    expect(dependencies.state.sessions).toHaveLength(0);
  });

  test("inactive users and users without a password hash fail safely", async () => {
    const dependencies = createInMemoryDependencies();
    const service = createAdminAuthService(dependencies);
    const inactive = await createUser(
      dependencies,
      "inactive@onpointglobal.com",
      "OPERATOR",
      validPassword,
    );
    const legacy = await createUser(
      dependencies,
      "legacy@onpointglobal.com",
      "VIEWER",
      null,
    );
    inactive.active = false;

    await expect(
      service.authenticateWithPassword({
        email: "inactive@onpointglobal.com",
        password: validPassword,
      }),
    ).resolves.toEqual({ ok: false });
    await expect(
      service.authenticateWithPassword({
        email: "legacy@onpointglobal.com",
        password: validPassword,
      }),
    ).resolves.toEqual({ ok: false });
    expect(dependencies.state.passwordHashes.get(legacy.id)).toBeNull();
    expect(dependencies.state.sessions).toHaveLength(0);
  });

  test("legacy single-use login tokens remain consumable during migration", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["session-token"],
    });
    const adminUser = await createUser(
      dependencies,
      "legacy-link@onpointglobal.com",
      "OPERATOR",
      null,
    );
    await dependencies.adminAuthStore.createAdminLoginToken({
      adminUserId: adminUser.id,
      tokenHash: hashAdminLoginToken("legacy-login-token"),
      expiresAt: new Date("2026-07-17T00:15:00.000Z"),
    });

    const result =
      await createAdminAuthService(dependencies).verifyLoginToken(
        "legacy-login-token",
      );

    expect(result).toMatchObject({
      sessionToken: "session-token",
      session: { adminUserId: adminUser.id, role: "OPERATOR" },
    });
  });

  test("session validation uses current role and rejects deactivated users", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["session-token"],
    });
    const service = createAdminAuthService(dependencies);
    const adminUser = await createUser(
      dependencies,
      "viewer@onpointglobal.com",
      "VIEWER",
      validPassword,
    );
    const login = await service.authenticateWithPassword({
      email: "viewer@onpointglobal.com",
      password: validPassword,
    });
    expect(login.ok).toBe(true);

    adminUser.role = "OPERATOR";
    expect(await service.validateSessionToken("session-token")).toMatchObject({
      adminUserId: adminUser.id,
      role: "OPERATOR",
    });

    adminUser.active = false;
    expect(await service.validateSessionToken("session-token")).toBeNull();
  });

  test("logout revokes the password-created session and preserves cookie safety", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["session-token"],
    });
    const service = createAdminAuthService(dependencies);
    await createUser(
      dependencies,
      "user@onpointglobal.com",
      "ADMIN",
      validPassword,
    );
    await service.authenticateWithPassword({
      email: "user@onpointglobal.com",
      password: validPassword,
    });

    await service.revokeSessionToken("session-token");

    expect(await service.validateSessionToken("session-token")).toBeNull();
    expect(clearAdminSessionCookieOptions("production")).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      maxAge: 0,
    });
    expect(adminSessionCookieOptions("development").secure).toBe(false);
  });

  test("raw password, session token, and plaintext email are never stored", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["raw-session-token"],
    });
    const service = createAdminAuthService(dependencies);
    await createUser(
      dependencies,
      "user@onpointglobal.com",
      "ADMIN",
      validPassword,
    );
    await service.authenticateWithPassword({
      email: "user@onpointglobal.com",
      password: validPassword,
    });

    const serialized = JSON.stringify({
      users: dependencies.state.adminUsers,
      passwordHashes: [...dependencies.state.passwordHashes.values()],
      sessions: dependencies.state.sessions,
    });
    expect(serialized).not.toContain(validPassword);
    expect(serialized).not.toContain("user@onpointglobal.com");
    expect(serialized).not.toContain("raw-session-token");
  });

  test("admin return destinations are restricted to internal pages", () => {
    expect(normalizeAdminReturnTo("/admin/requests/MT-123?tab=activity")).toBe(
      "/admin/requests/MT-123?tab=activity",
    );
    expect(normalizeAdminReturnTo("https://example.com/admin/requests")).toBe(
      "/admin/requests",
    );
    expect(normalizeAdminReturnTo("//example.com/admin/requests")).toBe(
      "/admin/requests",
    );
    expect(normalizeAdminReturnTo("/admin/auth/verify?token=secret")).toBe(
      "/admin/requests",
    );
  });
});

async function createUser(
  dependencies: ReturnType<typeof createInMemoryDependencies>,
  email: string,
  role: AdminRole,
  password: string | null,
) {
  const prepared = prepareAdminUserCreateInput(email, role);

  return dependencies.adminAuthStore.createAdminUser({
    ...prepared,
    passwordHash: password ? await hashAdminPassword(password) : null,
  });
}

function createInMemoryDependencies(
  options: { now?: Date; tokens?: string[] } = {},
) {
  const state: InMemoryAdminAuthState = {
    now: options.now ?? new Date("2026-07-17T00:00:00.000Z"),
    nextId: 1,
    tokens: [...(options.tokens ?? ["session-token"])],
    adminUsers: [],
    passwordHashes: new Map(),
    loginTokens: [],
    sessions: [],
  };

  return {
    state,
    appEnv: "development",
    now: () => state.now,
    generateToken: () => state.tokens.shift() ?? `token-${state.nextId++}`,
    adminAuthStore: createInMemoryAdminAuthStore(state),
  };
}

function createInMemoryAdminAuthStore(
  state: InMemoryAdminAuthState,
): AdminAuthStore {
  return {
    async createAdminUser(input: CreateAdminUserInput) {
      if (state.adminUsers.some((user) => user.emailHash === input.emailHash)) {
        throw new Error("ADMIN_USER_ALREADY_EXISTS");
      }

      const adminUser: AdminUser = {
        id: `admin-user-${state.nextId++}`,
        emailEncrypted: input.emailEncrypted,
        emailHash: input.emailHash,
        role: input.role,
        active: true,
        createdAt: state.now,
        updatedAt: state.now,
        lastLoginAt: null,
      };
      state.adminUsers.push(adminUser);
      state.passwordHashes.set(adminUser.id, input.passwordHash ?? null);

      return adminUser;
    },
    async findAdminPasswordCredentialByEmailHash(emailHash) {
      const adminUser = state.adminUsers.find(
        (user) => user.emailHash === emailHash,
      );

      return adminUser
        ? {
            id: adminUser.id,
            active: adminUser.active,
            passwordHash: state.passwordHashes.get(adminUser.id) ?? null,
          }
        : null;
    },
    async createAdminSession(input) {
      const adminUser = state.adminUsers.find(
        (user) => user.id === input.adminUserId && user.active,
      );

      if (!adminUser) return null;

      const session = {
        id: `admin-session-${state.nextId++}`,
        adminUserId: adminUser.id,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.expiresAt,
        revokedAt: null,
        createdAt: input.now,
        lastUsedAt: null,
      };
      state.sessions.push(session);
      adminUser.lastLoginAt = input.now;

      return sessionIdentity(adminUser, session.id);
    },
    async findActiveAdminUserByEmailHash(emailHash) {
      return (
        state.adminUsers.find(
          (user) => user.emailHash === emailHash && user.active,
        ) ?? null
      );
    },
    async createAdminLoginToken(input: CreateAdminLoginTokenInput) {
      const loginToken = {
        id: `admin-login-row-${state.nextId++}`,
        ...input,
        usedAt: null,
        createdAt: state.now,
      };
      state.loginTokens.push(loginToken);
      return loginToken;
    },
    async consumeAdminLoginToken(input) {
      const loginToken = state.loginTokens.find(
        (token) =>
          token.tokenHash === input.tokenHash &&
          !token.usedAt &&
          token.expiresAt > input.now,
      );
      const adminUser = loginToken
        ? state.adminUsers.find(
            (user) => user.id === loginToken.adminUserId && user.active,
          )
        : null;

      if (!loginToken || !adminUser) return null;

      loginToken.usedAt = input.now;
      const session = {
        id: `admin-session-${state.nextId++}`,
        adminUserId: adminUser.id,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.sessionExpiresAt,
        revokedAt: null,
        createdAt: input.now,
        lastUsedAt: null,
      };
      state.sessions.push(session);
      return sessionIdentity(adminUser, session.id);
    },
    async validateAdminSession(input) {
      const session = state.sessions.find(
        (candidate) =>
          candidate.sessionTokenHash === input.sessionTokenHash &&
          candidate.expiresAt > input.now &&
          !candidate.revokedAt,
      );
      const adminUser = session
        ? state.adminUsers.find(
            (user) => user.id === session.adminUserId && user.active,
          )
        : null;

      if (!session || !adminUser) return null;

      session.lastUsedAt = input.now;
      return sessionIdentity(adminUser, session.id);
    },
    async revokeAdminSession(sessionTokenHash, now) {
      const session = state.sessions.find(
        (candidate) => candidate.sessionTokenHash === sessionTokenHash,
      );

      if (session) session.revokedAt = now;
    },
  };
}

function sessionIdentity(
  adminUser: AdminUser,
  sessionId: string,
): AdminSessionIdentity {
  return {
    adminUserId: adminUser.id,
    role: adminUser.role,
    sessionId,
  };
}
