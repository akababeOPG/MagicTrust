import openApiDocument from "../../../../../docs/openapi.json";

export function GET(): Response {
  return Response.json(openApiDocument, {
    headers: {
      "cache-control": "public, max-age=300",
    },
  });
}
