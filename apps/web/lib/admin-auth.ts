import "server-only";

import {
  createDatabase,
  createAdminAuthStore,
  generateAdminToken,
} from "@magictrust/database";
import type {
  AdminAuthStore,
  AdminRole,
  AdminSessionIdentity,
} from "@magictrust/database";
import { getAppEnv, getRequiredDatabaseUrl } from "@magictrust/config";
import {
  decryptPii,
  hashAdminLoginToken,
  hashAdminSessionToken,
  hashEmail,
  normalizeEmailForHash,
  verifyAdminPassword,
} from "@magictrust/privacy";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminSessionCookieName } from "./admin-auth-constants";

export { adminSessionCookieName } from "./admin-auth-constants";

const sessionTtlMs = 8 * 60 * 60 * 1000;

export type AdminAuthDependencies = {
  adminAuthStore: AdminAuthStore;
  appEnv: string;
  now: () => Date;
  generateToken: () => string;
};

export type AdminSession = {
  adminUserId: string;
  role: AdminRole;
  sessionId: string;
  displayName?: string;
  email?: string;
};

const adminPasswordLoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(1024),
});

export type AdminPasswordLoginResult =
  | { ok: true; session: AdminSessionIdentity; sessionToken: string }
  | { ok: false };

export function createAdminAuthDependencies(): AdminAuthDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      adminAuthStore: missingDatabaseAdminAuthStore(),
      appEnv: getAppEnv(),
      now: () => new Date(),
      generateToken: generateAdminToken,
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    adminAuthStore: createAdminAuthStore(db),
    appEnv: getAppEnv(),
    now: () => new Date(),
    generateToken: generateAdminToken,
  };
}

export function createAdminAuthService(dependencies: AdminAuthDependencies) {
  return {
    async authenticateWithPassword(
      input: unknown,
    ): Promise<AdminPasswordLoginResult> {
      const parsed = adminPasswordLoginSchema.safeParse(input);

      if (!parsed.success) {
        return { ok: false };
      }

      const normalizedEmail = normalizeEmailForHash(parsed.data.email);
      const credential =
        await dependencies.adminAuthStore.findAdminPasswordCredentialByEmailHash(
          hashEmail(normalizedEmail),
        );
      const passwordMatches = await verifyAdminPassword(
        parsed.data.password,
        credential?.passwordHash ?? null,
      );

      if (!credential || !credential.active || !passwordMatches) {
        return { ok: false };
      }

      const now = dependencies.now();
      const sessionToken = dependencies.generateToken();
      const session = await dependencies.adminAuthStore.createAdminSession({
        adminUserId: credential.id,
        sessionTokenHash: hashAdminSessionToken(sessionToken),
        expiresAt: new Date(now.getTime() + sessionTtlMs),
        now,
      });

      return session ? { ok: true, session, sessionToken } : { ok: false };
    },
    // Deprecated migration path for login links issued before password auth.
    async verifyLoginToken(token: string): Promise<{
      session: AdminSessionIdentity;
      sessionToken: string;
    } | null> {
      const now = dependencies.now();
      const sessionToken = dependencies.generateToken();
      const session = await dependencies.adminAuthStore.consumeAdminLoginToken({
        tokenHash: hashAdminLoginToken(token),
        sessionTokenHash: hashAdminSessionToken(sessionToken),
        sessionExpiresAt: new Date(now.getTime() + sessionTtlMs),
        now,
      });

      return session ? { session, sessionToken } : null;
    },
    async validateSessionToken(
      sessionToken: string,
    ): Promise<AdminSession | null> {
      const session = await dependencies.adminAuthStore.validateAdminSession({
        sessionTokenHash: hashAdminSessionToken(sessionToken),
        now: dependencies.now(),
      });

      return session ? toAdminSession(session) : null;
    },
    async revokeSessionToken(sessionToken: string): Promise<void> {
      await dependencies.adminAuthStore.revokeAdminSession(
        hashAdminSessionToken(sessionToken),
        dependencies.now(),
      );
    },
  };
}

export async function requireAdminSession(options?: {
  response?: "json";
  redirectTo?: string;
}): Promise<AdminSession | Response> {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(adminSessionCookieName)?.value;

  if (!sessionToken) {
    return unauthenticated(options);
  }

  const service = createAdminAuthService(createAdminAuthDependencies());
  const session = await service.validateSessionToken(sessionToken);

  if (!session) {
    return unauthenticated(options);
  }

  return {
    adminUserId: session.adminUserId,
    role: session.role,
    sessionId: session.sessionId,
    displayName: session.displayName,
    email: session.email,
  };
}

export async function requireAdminRole(
  allowedRoles: readonly AdminRole[],
  options?: { response?: "json"; redirectTo?: string },
): Promise<AdminSession | Response> {
  const session = await requireAdminSession(options);

  if (session instanceof Response) {
    return session;
  }

  if (!allowedRoles.includes(session.role)) {
    return forbidden(options);
  }

  return session;
}

export function adminSessionCookieOptions(appEnv: string) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: appEnv === "production",
    path: "/",
    maxAge: sessionTtlMs / 1000,
  };
}

export function clearAdminSessionCookieOptions(appEnv: string) {
  return {
    ...adminSessionCookieOptions(appEnv),
    maxAge: 0,
  };
}

export function normalizeAdminReturnTo(value: unknown): string {
  if (typeof value !== "string") {
    return "/admin";
  }

  const candidate = value.trim();

  if (
    (candidate !== "/admin" && !candidate.startsWith("/admin/")) ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    candidate.startsWith("/admin/login") ||
    candidate.startsWith("/admin/auth/")
  ) {
    return "/admin";
  }

  try {
    const parsed = new URL(candidate, "https://magictrust.invalid");

    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "/admin";
  }
}

function unauthenticated(options?: {
  response?: "json";
  redirectTo?: string;
}): Response {
  if (options?.response === "json") {
    return Response.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Admin authentication is required.",
        },
      },
      {
        status: 401,
      },
    );
  }

  const redirectTo = options?.redirectTo;

  redirect(
    redirectTo
      ? `/admin/login?returnTo=${encodeURIComponent(normalizeAdminReturnTo(redirectTo))}`
      : "/admin/login",
  );
}

function forbidden(options?: { response?: "json" }): Response {
  if (options?.response === "json") {
    return Response.json(
      {
        error: {
          code: "FORBIDDEN",
          message: "Admin role is not allowed to perform this action.",
        },
      },
      {
        status: 403,
      },
    );
  }

  return new Response("Forbidden", { status: 403 });
}

function toAdminSession(session: AdminSessionIdentity): AdminSession {
  const email = safelyDecryptAdminEmail(session.emailEncrypted);
  const displayName = email ? displayNameFromEmail(email) : undefined;

  return {
    adminUserId: session.adminUserId,
    role: session.role,
    sessionId: session.sessionId,
    ...(email ? { email } : {}),
    ...(displayName ? { displayName } : {}),
  };
}

function safelyDecryptAdminEmail(
  value: string | undefined,
): string | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return decryptPii(value);
  } catch {
    return undefined;
  }
}

function displayNameFromEmail(email: string): string | undefined {
  const localPart = email.split("@", 1)[0]?.trim();

  if (!localPart) {
    return undefined;
  }

  const parts = localPart.split(/[._-]+/);

  if (
    parts.length === 0 ||
    parts.some((part) => !/^[A-Za-z][A-Za-z0-9]*$/.test(part))
  ) {
    return undefined;
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

function missingDatabaseAdminAuthStore(): AdminAuthStore {
  return {
    createAdminUser() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    findAdminPasswordCredentialByEmailHash() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    createAdminSession() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    findActiveAdminUserByEmailHash() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    createAdminLoginToken() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    consumeAdminLoginToken() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    validateAdminSession() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
    revokeAdminSession() {
      throw new Error("DATABASE_URL is required for admin authentication.");
    },
  };
}
