import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { GET as getSwaggerUi } from "../../app/api/docs/route";
import { GET as getOpenApi } from "../../app/api/openapi.json/route";

type OpenApiDocument = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: Record<string, unknown>;
};

describe("Internal API OpenAPI documentation", () => {
  test("serves a loadable OpenAPI 3.1 document with resolvable local references", async () => {
    const response = getOpenApi();
    const document = (await response.json()) as OpenApiDocument;

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(document.openapi).toBe("3.1.0");
    expect(document.paths).toBeTypeOf("object");

    for (const reference of collectLocalReferences(document)) {
      expect(
        resolveLocalReference(document, reference),
        reference,
      ).toBeDefined();
    }
  });

  test("renders Swagger UI against the canonical spec endpoint without embedded credentials", async () => {
    const response = getSwaggerUi();
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "connect-src 'self'",
    );
    expect(html).toContain("SwaggerUIBundle");
    expect(html).toContain('url: "/api/openapi.json"');
    expect(html).not.toContain("mt_live_");
    expect(html).not.toContain("INTERNAL_API_KEY=");
  });

  test("documented operations correspond to implemented route handlers", async () => {
    const document = (await getOpenApi().json()) as OpenApiDocument;
    const documentedRoutes = [
      ["/api/v1/requests", "post", "app/api/v1/requests/route.ts"],
      ["/api/v1/requests", "get", "app/api/v1/requests/route.ts"],
      ["/api/v1/requests/{id}", "get", "app/api/v1/requests/[id]/route.ts"],
      [
        "/api/v1/requests/{id}/processing-data",
        "get",
        "app/api/v1/requests/[id]/processing-data/route.ts",
      ],
      [
        "/api/v1/requests/{id}/status",
        "post",
        "app/api/v1/requests/[id]/status/route.ts",
      ],
      [
        "/api/v1/requests/{id}/processing-result",
        "post",
        "app/api/v1/requests/[id]/processing-result/route.ts",
      ],
      [
        "/api/v1/requests/{id}/comments",
        "post",
        "app/api/v1/requests/[id]/comments/route.ts",
      ],
      [
        "/api/v1/requests/{id}/attachments",
        "post",
        "app/api/v1/requests/[id]/attachments/route.ts",
      ],
      [
        "/api/v1/requests/{id}/attachments/upload",
        "post",
        "app/api/v1/requests/[id]/attachments/upload/route.ts",
      ],
      [
        "/api/v1/requests/{id}/attachments/{attachmentId}/download",
        "get",
        "app/api/v1/requests/[id]/attachments/[attachmentId]/download/route.ts",
      ],
      [
        "/api/v1/requests/{id}/communications/email",
        "post",
        "app/api/v1/requests/[id]/communications/email/route.ts",
      ],
      [
        "/api/v1/requests/{id}/data",
        "patch",
        "app/api/v1/requests/[id]/data/route.ts",
      ],
      [
        "/api/v1/requests/{id}/events",
        "post",
        "app/api/v1/requests/[id]/events/route.ts",
      ],
      [
        "/api/v1/requests/{id}/notifications",
        "post",
        "app/api/v1/requests/[id]/notifications/route.ts",
      ],
    ] as const;

    expect(documentedRoutes).toHaveLength(14);

    for (const [path, method, routeFile] of documentedRoutes) {
      expect(
        document.paths[path]?.[method],
        `${method.toUpperCase()} ${path}`,
      ).toBeDefined();
      expect(existsSync(resolve(process.cwd(), routeFile)), routeFile).toBe(
        true,
      );
    }
  });
});

function collectLocalReferences(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(collectLocalReferences);
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    key === "$ref" && typeof child === "string" && child.startsWith("#/")
      ? [child]
      : collectLocalReferences(child),
  );
}

function resolveLocalReference(
  document: OpenApiDocument,
  reference: string,
): unknown {
  return reference
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce<unknown>((value, segment) => {
      if (!value || typeof value !== "object") {
        return undefined;
      }

      return (value as Record<string, unknown>)[segment];
    }, document);
}
