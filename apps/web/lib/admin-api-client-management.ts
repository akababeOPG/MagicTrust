import "server-only";

import { getRequiredDatabaseUrl } from "@magictrust/config";
import {
  apiClientScopesList,
  createApiClientManagementStore,
  createDatabase,
  generateApiKey,
  isApiClientScope,
  type ApiClientManagementStore,
  type ApiClientScope,
  type ManagedApiClient,
} from "@magictrust/database";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

export const apiClientScopeOptions = apiClientScopesList.map((scope) => ({
  value: scope,
  label: scope,
}));

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scopes: z.array(z.string()).min(1),
});

export type AdminApiClientDependencies = {
  store: ApiClientManagementStore;
  now: () => Date;
  generateKey: () => string;
};

export function createAdminApiClientDependencies(): AdminApiClientDependencies {
  const databaseUrl = getRequiredDatabaseUrl();
  return {
    store: databaseUrl
      ? createApiClientManagementStore(createDatabase(databaseUrl))
      : missingStore(),
    now: () => new Date(),
    generateKey: generateApiKey,
  };
}

export function listManagedApiClients(
  dependencies: AdminApiClientDependencies,
): Promise<ManagedApiClient[]> {
  return dependencies.store.listApiClients();
}

export async function createManagedApiClient(
  request: Request,
  session: AdminSession,
  dependencies: AdminApiClientDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request))
    return actionError("Request origin is not allowed.", 403);

  const formData = await request.formData().catch(() => null);
  const parsed = createSchema.safeParse({
    name: formData?.get("name"),
    scopes: formData?.getAll("scopes") ?? [],
  });
  const scopes = parsed.success
    ? parsed.data.scopes.filter(isApiClientScope)
    : [];

  if (!parsed.success || scopes.length !== parsed.data.scopes.length) {
    return Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Enter a name and select valid scopes.",
        },
      },
      { status: 400 },
    );
  }

  const rawKey = dependencies.generateKey();
  const client = await dependencies.store.createApiClient({
    name: parsed.data.name,
    scopes: scopes as ApiClientScope[],
    rawKey,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });

  if (!client) return actionError("API client could not be created.", 403);

  return Response.json(
    {
      client: {
        ...client,
        createdAt: client.createdAt.toISOString(),
        lastUsedAt: client.lastUsedAt?.toISOString() ?? null,
      },
      apiKey: rawKey,
    },
    {
      status: 201,
      headers: { "cache-control": "no-store, private" },
    },
  );
}

export async function revokeManagedApiClient(
  request: Request,
  apiClientId: string,
  session: AdminSession,
  dependencies: AdminApiClientDependencies,
): Promise<Response> {
  if (!isSameOriginRequest(request))
    return actionError("Request origin is not allowed.", 403);

  const revoked = await dependencies.store.revokeApiClient({
    apiClientId,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  return revoked
    ? redirectToList(request, { success: "API client revoked." })
    : actionError("API client could not be revoked.", 404);
}

function redirectToList(
  request: Request,
  message: { success?: string; error?: string },
): Response {
  const url = new URL("/admin/api-clients", request.url);
  if (message.success) url.searchParams.set("success", message.success);
  if (message.error) url.searchParams.set("error", message.error);
  return Response.redirect(url, 303);
}

function actionError(message: string, status: number): Response {
  return Response.json(
    { error: { code: status === 403 ? "FORBIDDEN" : "NOT_FOUND", message } },
    { status },
  );
}

function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function missingStore(): ApiClientManagementStore {
  const missing = () =>
    Promise.reject(
      new Error("DATABASE_URL is required for API client management."),
    );
  return {
    listApiClients: missing,
    createApiClient: missing,
    revokeApiClient: missing,
  };
}
