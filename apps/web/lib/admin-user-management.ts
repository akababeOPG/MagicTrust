import "server-only";

import {
  adminRoles,
  createAdminUserManagementStore,
  createDatabase,
  prepareAdminUserCreateInput,
} from "@magictrust/database";
import type {
  AdminRole,
  AdminUserManagementErrorCode,
  AdminUserManagementStore,
} from "@magictrust/database";
import { getRequiredDatabaseUrl } from "@magictrust/config";
import { decryptPii } from "@magictrust/privacy";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

const userStatusFilters = ["ACTIVE", "INACTIVE"] as const;

const listFiltersSchema = z.object({
  role: z.enum(adminRoles).optional(),
  status: z.enum(userStatusFilters).optional(),
});

const createUserSchema = z.object({
  email: z.string().trim().email().max(320),
  role: z.enum(adminRoles),
});

const changeRoleSchema = z.object({
  role: z.enum(adminRoles),
});

const changeStatusSchema = z.object({
  action: z.enum(["activate", "deactivate"]),
});

export type AdminUserListItem = {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
  createdAt: string;
};

export type AdminUserListResult =
  { ok: true; users: AdminUserListItem[] } | { ok: false; message: string };

export type AdminUserManagementDependencies = {
  store: AdminUserManagementStore;
  now: () => Date;
};

export function createAdminUserManagementDependencies(): AdminUserManagementDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      store: missingDatabaseStore(),
      now: () => new Date(),
    };
  }

  return {
    store: createAdminUserManagementStore(createDatabase(databaseUrl)),
    now: () => new Date(),
  };
}

export async function listManagedAdminUsers(
  params: URLSearchParams,
  dependencies: AdminUserManagementDependencies,
): Promise<AdminUserListResult> {
  const parsed = listFiltersSchema.safeParse({
    role: optionalParam(params.get("role")),
    status: optionalParam(params.get("status")),
  });

  if (!parsed.success) {
    return {
      ok: false,
      message: "Role or status filter is invalid.",
    };
  }

  const users = await dependencies.store.listAdminUsers({
    role: parsed.data.role,
    active:
      parsed.data.status === undefined
        ? undefined
        : parsed.data.status === "ACTIVE",
  });

  return {
    ok: true,
    users: users.map((user) => ({
      id: user.id,
      email: safelyDecryptEmail(user.emailEncrypted),
      role: user.role,
      active: user.active,
      createdAt: user.createdAt.toISOString(),
    })),
  };
}

export async function createManagedAdminUser(
  request: Request,
  session: AdminSession,
  dependencies: AdminUserManagementDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);
  const parsed = createUserSchema.safeParse({
    email: formData?.get("email"),
    role: formData?.get("role"),
  });

  if (!parsed.success) {
    return redirectToUsers(request, {
      error: "Enter a valid email and select a role.",
    });
  }

  const prepared = prepareAdminUserCreateInput(
    parsed.data.email,
    parsed.data.role,
  );
  const result = await dependencies.store.createAdminUser({
    emailEncrypted: prepared.emailEncrypted,
    emailHash: prepared.emailHash,
    role: prepared.role,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });

  if (!result.ok) {
    return mutationFailureResponse(request, result.code);
  }

  return redirectToUsers(request, { success: "User created." });
}

export async function changeManagedAdminUserRole(
  request: Request,
  targetAdminUserId: string,
  session: AdminSession,
  dependencies: AdminUserManagementDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);
  const parsed = changeRoleSchema.safeParse({ role: formData?.get("role") });

  if (!parsed.success) {
    return redirectToUsers(request, { error: "Select a valid role." });
  }

  const result = await dependencies.store.changeAdminUserRole({
    targetAdminUserId,
    actorAdminUserId: session.adminUserId,
    role: parsed.data.role,
    now: dependencies.now(),
  });

  if (!result.ok) {
    return mutationFailureResponse(request, result.code);
  }

  return redirectToUsers(request, {
    success: result.changed ? "User role updated." : "User role unchanged.",
  });
}

export async function changeManagedAdminUserStatus(
  request: Request,
  targetAdminUserId: string,
  session: AdminSession,
  dependencies: AdminUserManagementDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request)) {
    return actionError("INVALID_ORIGIN", "Request origin is not allowed.", 403);
  }

  const formData = await safeFormData(request);
  const parsed = changeStatusSchema.safeParse({
    action: formData?.get("action"),
  });

  if (!parsed.success) {
    return redirectToUsers(request, { error: "User action is invalid." });
  }

  const active = parsed.data.action === "activate";
  const result = await dependencies.store.setAdminUserActive({
    targetAdminUserId,
    actorAdminUserId: session.adminUserId,
    active,
    now: dependencies.now(),
  });

  if (!result.ok) {
    return mutationFailureResponse(request, result.code);
  }

  return redirectToUsers(request, {
    success: active ? "User activated." : "User deactivated.",
  });
}

function mutationFailureResponse(
  request: Request,
  code: AdminUserManagementErrorCode,
): Response {
  if (code === "ACTOR_NOT_AUTHORIZED") {
    return actionError(
      "FORBIDDEN",
      "Admin role is not allowed to perform this action.",
      403,
    );
  }

  const messages: Record<
    Exclude<AdminUserManagementErrorCode, "ACTOR_NOT_AUTHORIZED">,
    string
  > = {
    ADMIN_USER_ALREADY_EXISTS: "A user with this email already exists.",
    ADMIN_USER_NOT_FOUND: "User could not be found.",
    LAST_ACTIVE_ADMIN: "The last active Admin cannot be changed.",
    SELF_DEACTIVATION: "You cannot deactivate your own account.",
    SELF_DEMOTION: "You cannot remove your own Admin role.",
  };

  return redirectToUsers(request, { error: messages[code] });
}

function safelyDecryptEmail(emailEncrypted: string): string {
  try {
    return decryptPii(emailEncrypted);
  } catch {
    return "Email unavailable";
  }
}

function optionalParam(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

async function safeFormData(request: Request): Promise<FormData | null> {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function redirectToUsers(
  request: Request,
  params: { success?: string; error?: string },
): Response {
  const url = new URL("/admin/users", request.url);

  if (params.success) url.searchParams.set("success", params.success);
  if (params.error) url.searchParams.set("error", params.error);

  return Response.redirect(url, 303);
}

function actionError(code: string, message: string, status: number): Response {
  return Response.json({ error: { code, message } }, { status });
}

function missingDatabaseStore(): AdminUserManagementStore {
  const missing = () => {
    throw new Error("DATABASE_URL is required for admin user management.");
  };

  return {
    listAdminUsers: missing,
    createAdminUser: missing,
    changeAdminUserRole: missing,
    setAdminUserActive: missing,
  };
}
