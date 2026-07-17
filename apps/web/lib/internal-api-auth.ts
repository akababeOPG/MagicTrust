import type {
  ApiClientScope,
  ApiClientStore,
  AuthenticatedApiClient,
} from "@magictrust/database";
import { apiClientScopesList } from "@magictrust/database";

export type InternalApiAuthDependencies = {
  apiKey: string | null;
  apiClientStore: ApiClientStore;
  appEnv: string;
};

export type InternalApiAuthResult =
  | {
      apiClient: AuthenticatedApiClient;
      response?: never;
    }
  | {
      apiClient?: never;
      response: Response;
    };

export async function authenticateInternalApiRequest(
  headers: Headers,
  dependencies: InternalApiAuthDependencies,
  requiredScope: ApiClientScope,
): Promise<InternalApiAuthResult> {
  const suppliedApiKey = normalizeApiKey(headers.get("x-api-key"));

  if (!suppliedApiKey) {
    return { response: unauthorized() };
  }

  const apiClient =
    await dependencies.apiClientStore.authenticateApiKey(suppliedApiKey);

  if (apiClient) {
    if (!apiClient.scopes.includes(requiredScope)) {
      return { response: forbidden() };
    }

    return { apiClient };
  }

  const legacyApiClient = authenticateLegacyApiKey(
    suppliedApiKey,
    dependencies,
  );

  if (!legacyApiClient) {
    return { response: unauthorized() };
  }

  return { apiClient: legacyApiClient };
}

function authenticateLegacyApiKey(
  suppliedApiKey: string,
  dependencies: InternalApiAuthDependencies,
): AuthenticatedApiClient | null {
  if (dependencies.appEnv === "production") {
    return null;
  }

  const legacyApiKey = normalizeApiKey(dependencies.apiKey);

  if (!legacyApiKey || suppliedApiKey !== legacyApiKey) {
    return null;
  }

  return {
    id: "internal-api",
    name: "Deprecated internal API key",
    keyId: "legacy-internal-api-key",
    scopes: [...apiClientScopesList],
  };
}

function normalizeApiKey(value: string | null): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}

function unauthorized(): Response {
  return Response.json(
    {
      error: {
        code: "UNAUTHORIZED",
        message: "Missing or invalid API key.",
      },
    },
    {
      status: 401,
    },
  );
}

function forbidden(): Response {
  return Response.json(
    {
      error: {
        code: "FORBIDDEN",
        message: "API client is not authorized for this operation.",
      },
    },
    {
      status: 403,
    },
  );
}
