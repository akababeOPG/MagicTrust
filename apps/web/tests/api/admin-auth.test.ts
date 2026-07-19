import type {
  AdminAuthStore,
  AdminSessionIdentity,
  AdminUser,
  CreateAdminLoginTokenInput,
  CreateAdminUserInput,
} from "@magictrust/database";
import { prepareAdminUserCreateInput } from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import {
  decryptPii,
  hashAdminLoginToken,
  hashAdminSessionToken,
  hashPii,
} from "@magictrust/privacy";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  adminSessionCookieOptions,
  clearAdminSessionCookieOptions,
  createAdminAuthService,
} from "../../lib/admin-auth";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-admin-auth";

type InMemoryAdminAuthState = {
  now: Date;
  nextId: number;
  tokens: string[];
  adminUsers: AdminUser[];
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
  sentEmails: Array<{ to: string; subject: string; body: string }>;
};

describe("admin authentication", () => {
  test("creates an encrypted admin user", async () => {
    const store = createInMemoryAdminAuthStore();
    const prepared = prepareAdminUserCreateInput(
      "User@OnPointGlobal.com",
      "ADMIN",
    );

    const adminUser = await store.createAdminUser(prepared);

    expect(adminUser.role).toBe("ADMIN");
    expect(adminUser.emailEncrypted).not.toContain("User@OnPointGlobal.com");
    expect(decryptPii(adminUser.emailEncrypted)).toBe("user@onpointglobal.com");
    expect(adminUser.emailHash).toBe(hashPii("user@onpointglobal.com"));
  });

  test("rejects duplicate admin emails", async () => {
    const store = createInMemoryAdminAuthStore();
    const prepared = prepareAdminUserCreateInput(
      "user@onpointglobal.com",
      "ADMIN",
    );

    await store.createAdminUser(prepared);

    await expect(store.createAdminUser(prepared)).rejects.toThrow(
      "ADMIN_USER_ALREADY_EXISTS",
    );
  });

  test("returns generic login response for known and unknown users", async () => {
    const dependencies = createInMemoryDependencies();
    const service = createAdminAuthService(dependencies);
    await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "ADMIN"),
    );

    const known = await service.requestLoginLink(
      loginRequest("user@onpointglobal.com"),
    );
    const unknown = await service.requestLoginLink(
      loginRequest("unknown@onpointglobal.com"),
    );

    expect(await known.json()).toEqual(await unknown.json());
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
  });

  test("returns the generic response when the email provider rejects delivery", async () => {
    const dependencies = createInMemoryDependencies();
    const service = createAdminAuthService(dependencies);
    await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "ADMIN"),
    );
    dependencies.emailProvider.sendEmail = vi
      .fn()
      .mockRejectedValue(new Error("provider rejected delivery"));

    const response = await service.requestLoginLink(
      loginRequest("user@onpointglobal.com"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "If an active admin user exists, a login link will be sent.",
    });
    expect(dependencies.state.loginTokens).toHaveLength(1);
  });

  test("active users receive login email and inactive users do not", async () => {
    const dependencies = createInMemoryDependencies();
    const service = createAdminAuthService(dependencies);
    const active = await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("active@onpointglobal.com", "ADMIN"),
    );
    const inactive = await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("inactive@onpointglobal.com", "VIEWER"),
    );
    dependencies.state.adminUsers.find(
      (user) => user.id === inactive.id,
    )!.active = false;

    await service.requestLoginLink(loginRequest("active@onpointglobal.com"));
    await service.requestLoginLink(loginRequest("inactive@onpointglobal.com"));

    expect(dependencies.state.sentEmails).toHaveLength(1);
    expect(dependencies.state.sentEmails[0]?.to).toBe(
      "active@onpointglobal.com",
    );
    expect(dependencies.state.loginTokens).toHaveLength(1);
    expect(dependencies.state.loginTokens[0]?.adminUserId).toBe(active.id);
  });

  test("valid magic link creates a session", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["login-token", "session-token"],
    });
    const service = createAdminAuthService(dependencies);
    const adminUser = await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "OPERATOR"),
    );

    await service.requestLoginLink(loginRequest("user@onpointglobal.com"));
    const result = await service.verifyLoginToken("login-token");

    expect(result?.sessionToken).toBe("session-token");
    expect(result?.session).toMatchObject({
      adminUserId: adminUser.id,
      role: "OPERATOR",
    });
    expect(dependencies.state.sessions).toHaveLength(1);
    expect(dependencies.state.sessions[0]?.sessionTokenHash).toBe(
      hashAdminSessionToken("session-token"),
    );
  });

  test("expired and used login tokens are rejected", async () => {
    const expired = createInMemoryDependencies({
      now: new Date("2026-07-17T01:00:00.000Z"),
    });
    const expiredService = createAdminAuthService(expired);
    const expiredUser = await expired.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("expired@onpointglobal.com", "ADMIN"),
    );
    await expired.adminAuthStore.createAdminLoginToken({
      adminUserId: expiredUser.id,
      tokenHash: hashAdminLoginToken("expired-token"),
      expiresAt: new Date("2026-07-17T00:59:00.000Z"),
    });

    const used = createInMemoryDependencies({
      tokens: ["session-token"],
    });
    const usedService = createAdminAuthService(used);
    const usedUser = await used.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("used@onpointglobal.com", "ADMIN"),
    );
    await used.adminAuthStore.createAdminLoginToken({
      adminUserId: usedUser.id,
      tokenHash: hashAdminLoginToken("used-token"),
      expiresAt: new Date("2026-07-17T00:15:00.000Z"),
    });
    used.state.loginTokens[0]!.usedAt = new Date("2026-07-17T00:01:00.000Z");

    expect(await expiredService.verifyLoginToken("expired-token")).toBeNull();
    expect(await usedService.verifyLoginToken("used-token")).toBeNull();
  });

  test("protected session validation requires active users", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["login-token", "session-token"],
    });
    const service = createAdminAuthService(dependencies);
    const adminUser = await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "VIEWER"),
    );

    await service.requestLoginLink(loginRequest("user@onpointglobal.com"));
    await service.verifyLoginToken("login-token");

    expect(await service.validateSessionToken("session-token")).toMatchObject({
      adminUserId: adminUser.id,
      role: "VIEWER",
    });

    dependencies.state.adminUsers.find(
      (user) => user.id === adminUser.id,
    )!.active = false;

    expect(await service.validateSessionToken("session-token")).toBeNull();
  });

  test("protected session validation uses the current persisted role", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["login-token", "session-token"],
    });
    const service = createAdminAuthService(dependencies);
    const adminUser = await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("current-role@onpointglobal.com", "VIEWER"),
    );

    await service.requestLoginLink(
      loginRequest("current-role@onpointglobal.com"),
    );
    await service.verifyLoginToken("login-token");

    dependencies.state.adminUsers.find(
      (user) => user.id === adminUser.id,
    )!.role = "OPERATOR";

    expect(await service.validateSessionToken("session-token")).toMatchObject({
      adminUserId: adminUser.id,
      role: "OPERATOR",
    });
  });

  test("logout revokes session and clears cookie", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["login-token", "session-token"],
    });
    const service = createAdminAuthService(dependencies);
    await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "ADMIN"),
    );
    await service.requestLoginLink(loginRequest("user@onpointglobal.com"));
    await service.verifyLoginToken("login-token");

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

  test("raw tokens and plaintext emails are not stored", async () => {
    const dependencies = createInMemoryDependencies({
      tokens: ["login-token", "session-token"],
    });
    const service = createAdminAuthService(dependencies);
    await dependencies.adminAuthStore.createAdminUser(
      prepareAdminUserCreateInput("user@onpointglobal.com", "ADMIN"),
    );

    await service.requestLoginLink(loginRequest("user@onpointglobal.com"));
    await service.verifyLoginToken("login-token");

    expect(JSON.stringify(dependencies.state.adminUsers)).not.toContain(
      "user@onpointglobal.com",
    );
    expect(JSON.stringify(dependencies.state.loginTokens)).not.toContain(
      "login-token",
    );
    expect(JSON.stringify(dependencies.state.sessions)).not.toContain(
      "session-token",
    );
  });
});

function loginRequest(email: string) {
  return new Request("https://magictrust.test/api/admin/auth/request-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ email }),
  });
}

function createInMemoryDependencies(
  options: {
    now?: Date;
    tokens?: string[];
  } = {},
) {
  const state: InMemoryAdminAuthState = {
    now: options.now ?? new Date("2026-07-17T00:00:00.000Z"),
    nextId: 1,
    tokens: [...(options.tokens ?? ["login-token", "session-token"])],
    adminUsers: [] as AdminUser[],
    loginTokens: [] as Array<{
      id: string;
      adminUserId: string;
      tokenHash: string;
      expiresAt: Date;
      usedAt: Date | null;
      createdAt: Date;
    }>,
    sessions: [] as Array<{
      id: string;
      adminUserId: string;
      sessionTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>,
    sentEmails: [] as Array<{ to: string; subject: string; body: string }>,
  };

  return {
    state,
    appBaseUrl: "https://magictrust.test",
    appEnv: "development",
    now: () => state.now,
    generateToken: () => state.tokens.shift() ?? `token-${state.nextId++}`,
    emailProvider: {
      provider: "resend",
      async sendEmail(input) {
        state.sentEmails.push(input);

        return {
          provider: "resend",
          providerMessageId: `email-${state.nextId++}`,
        };
      },
    } satisfies EmailProvider,
    adminAuthStore: createInMemoryAdminAuthStore(state),
  };
}

function createInMemoryAdminAuthStore(
  existingState?: InMemoryAdminAuthState,
): AdminAuthStore {
  const state = existingState ?? {
    now: new Date("2026-07-17T00:00:00.000Z"),
    nextId: 1,
    tokens: [],
    adminUsers: [] as AdminUser[],
    loginTokens: [] as Array<
      CreateAdminLoginTokenInput & {
        id: string;
        usedAt: Date | null;
        createdAt: Date;
      }
    >,
    sessions: [] as Array<{
      id: string;
      adminUserId: string;
      sessionTokenHash: string;
      expiresAt: Date;
      revokedAt: Date | null;
      createdAt: Date;
      lastUsedAt: Date | null;
    }>,
    sentEmails: [],
  };

  return {
    async createAdminUser(input: CreateAdminUserInput) {
      if (state.adminUsers.some((user) => user.emailHash === input.emailHash)) {
        throw new Error("ADMIN_USER_ALREADY_EXISTS");
      }

      const now = state.now;
      const adminUser: AdminUser = {
        id: `admin-user-${state.nextId++}`,
        emailEncrypted: input.emailEncrypted,
        emailHash: input.emailHash,
        role: input.role,
        active: true,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      };
      state.adminUsers.push(adminUser);

      return adminUser;
    },
    async findActiveAdminUserByEmailHash(emailHash: string) {
      return (
        state.adminUsers.find(
          (user) => user.emailHash === emailHash && user.active,
        ) ?? null
      );
    },
    async createAdminLoginToken(input) {
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

      if (!loginToken) {
        return null;
      }

      loginToken.usedAt = input.now;

      const adminUser = state.adminUsers.find(
        (user) => user.id === loginToken.adminUserId && user.active,
      );

      if (!adminUser) {
        return null;
      }

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
      adminUser.lastLoginAt = input.now;

      return {
        adminUserId: adminUser.id,
        role: adminUser.role,
        sessionId: session.id,
      } satisfies AdminSessionIdentity;
    },
    async validateAdminSession(input) {
      const session = state.sessions.find(
        (item) =>
          item.sessionTokenHash === input.sessionTokenHash &&
          item.expiresAt > input.now &&
          !item.revokedAt,
      );

      if (!session) {
        return null;
      }

      const adminUser = state.adminUsers.find(
        (user) => user.id === session.adminUserId && user.active,
      );

      if (!adminUser) {
        return null;
      }

      session.lastUsedAt = input.now;

      return {
        adminUserId: adminUser.id,
        role: adminUser.role,
        sessionId: session.id,
      };
    },
    async revokeAdminSession(sessionTokenHash, now) {
      const session = state.sessions.find(
        (item) => item.sessionTokenHash === sessionTokenHash,
      );

      if (session) {
        session.revokedAt = now;
      }
    },
  };
}
