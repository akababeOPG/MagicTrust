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
import {
  getAppBaseUrl,
  getAppEnv,
  getRequiredDatabaseUrl,
} from "@magictrust/config";
import type { EmailProvider } from "@magictrust/email";
import { createResendEmailProvider } from "@magictrust/email";
import {
  hashAdminLoginToken,
  hashAdminSessionToken,
  hashPii,
  normalizeEmailForHash,
} from "@magictrust/privacy";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

export const adminSessionCookieName = "magictrust_admin_session";
const loginTokenTtlMs = 15 * 60 * 1000;
const sessionTtlMs = 8 * 60 * 60 * 1000;

export type AdminAuthDependencies = {
  adminAuthStore: AdminAuthStore;
  emailProvider: EmailProvider;
  appBaseUrl: string;
  appEnv: string;
  now: () => Date;
  generateToken: () => string;
};

export type AdminSession = {
  adminUserId: string;
  role: AdminRole;
  sessionId: string;
};

const requestLoginLinkSchema = z.object({
  email: z.string().email(),
});

const genericLoginResponse = {
  ok: true,
  message: "If an active admin user exists, a login link will be sent.",
};

export function createAdminAuthDependencies(): AdminAuthDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      adminAuthStore: missingDatabaseAdminAuthStore(),
      emailProvider: createResendEmailProvider(),
      appBaseUrl: getAppBaseUrl(),
      appEnv: getAppEnv(),
      now: () => new Date(),
      generateToken: generateAdminToken,
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    adminAuthStore: createAdminAuthStore(db),
    emailProvider: createResendEmailProvider(),
    appBaseUrl: getAppBaseUrl(),
    appEnv: getAppEnv(),
    now: () => new Date(),
    generateToken: generateAdminToken,
  };
}

export function createAdminAuthService(dependencies: AdminAuthDependencies) {
  return {
    async requestLoginLink(request: Request): Promise<Response> {
      const body = await readJson(request);
      const parsed = requestLoginLinkSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      const normalizedEmail = normalizeEmailForHash(parsed.data.email);
      const adminUser =
        await dependencies.adminAuthStore.findActiveAdminUserByEmailHash(
          hashPii(normalizedEmail),
        );

      if (!adminUser) {
        return Response.json(genericLoginResponse);
      }

      const token = dependencies.generateToken();
      const expiresAt = new Date(
        dependencies.now().getTime() + loginTokenTtlMs,
      );

      await dependencies.adminAuthStore.createAdminLoginToken({
        adminUserId: adminUser.id,
        tokenHash: hashAdminLoginToken(token),
        expiresAt,
      });

      const magicLink = `${dependencies.appBaseUrl.replace(/\/$/, "")}/admin/auth/verify?token=${encodeURIComponent(token)}`;

      await dependencies.emailProvider.sendEmail({
        to: normalizedEmail,
        subject: "Your MagicTrust admin login link",
        body: [
          "Use this link to sign in to MagicTrust.",
          "",
          magicLink,
          "",
          "This link expires in 15 minutes and can only be used once.",
        ].join("\n"),
      });

      return Response.json(genericLoginResponse);
    },
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
    ): Promise<AdminSessionIdentity | null> {
      return dependencies.adminAuthStore.validateAdminSession({
        sessionTokenHash: hashAdminSessionToken(sessionToken),
        now: dependencies.now(),
      });
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
  };
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

function unauthenticated(options?: { response?: "json" }): Response {
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

  redirect("/admin/login");
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validationError(): Response {
  return Response.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message: "Request payload is invalid.",
      },
    },
    {
      status: 400,
    },
  );
}

function missingDatabaseAdminAuthStore(): AdminAuthStore {
  return {
    createAdminUser() {
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
