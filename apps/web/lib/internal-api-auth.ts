export function authenticateInternalApiRequest(
  headers: Headers,
  apiKey: string | null,
): Response | null {
  const suppliedApiKey = headers.get("x-api-key");

  if (
    !normalizeApiKey(apiKey) ||
    normalizeApiKey(suppliedApiKey) !== normalizeApiKey(apiKey)
  ) {
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

  return null;
}

function normalizeApiKey(value: string | null): string | null {
  const normalized = value?.trim();

  return normalized ? normalized : null;
}
