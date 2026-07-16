import {
  actorTypes,
  commentVisibilities,
  createPrivacyRequest,
  requestStatuses,
  requestTypes,
} from "@magictrust/domain";
import type {
  JsonObject,
  RequestCreationStore,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import type { RequestRepository } from "@magictrust/database";
import { z } from "zod";

export type InternalRequestApiDependencies = {
  apiKey: string | null;
  requestCreationStore: RequestCreationStore;
  requestRepository: RequestRepository;
};

const jsonSchema: z.ZodType<JsonObject[string]> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

const jsonObjectSchema: z.ZodType<JsonObject> = z.record(jsonSchema);

const createRequestSchema = z.object({
  type: z.enum(requestTypes),
  requester: z.object({
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
  }),
  source: z.object({
    channel: z.literal("API"),
    siteKey: z.string().min(1),
    formKey: z.string().min(1),
    sourceUrl: z.string().url(),
  }),
  submittedData: jsonObjectSchema,
});

const listRequestsQuerySchema = z.object({
  status: z.enum(requestStatuses).optional(),
  type: z.enum(requestTypes).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const actorSchema = z.object({
  type: z.enum(actorTypes),
  id: z.string().min(1).nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(requestStatuses),
  actor: actorSchema,
  reason: z.string().min(1).nullable().optional(),
});

const addCommentSchema = z.object({
  visibility: z.enum(commentVisibilities),
  body: z.string().min(1),
  actor: actorSchema,
});

export function createInternalRequestApi(
  dependencies: InternalRequestApiDependencies,
) {
  return {
    async create(request: Request): Promise<Response> {
      const unauthorized = authenticate(request.headers, dependencies.apiKey);

      if (unauthorized) {
        return unauthorized;
      }

      const body = await readJson(request);
      const parsed = createRequestSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      try {
        const result = await createPrivacyRequest(
          {
            requester: {},
            type: parsed.data.type,
            submittedData: parsed.data,
            actor: {
              type: "API_CLIENT",
              id: parsed.data.source.siteKey,
            },
          },
          dependencies.requestCreationStore,
        );

        return Response.json(
          {
            request: normalizeRequestSummary(result.request),
          },
          {
            status: 201,
          },
        );
      } catch {
        return serverError();
      }
    },

    async get(request: Request, id: string): Promise<Response> {
      const unauthorized = authenticate(request.headers, dependencies.apiKey);

      if (unauthorized) {
        return unauthorized;
      }

      let result;

      try {
        result = await dependencies.requestRepository.findByIdOrPublicId(id);
      } catch {
        return serverError();
      }

      if (!result) {
        return Response.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Request not found.",
            },
          },
          {
            status: 404,
          },
        );
      }

      return Response.json({
        request: {
          ...normalizeRequestSummary(result),
          events: result.events.map((event) => ({
            id: event.id,
            type: event.type,
            actorType: event.actorType,
            actorId: event.actorId,
            data: event.data,
            createdAt: event.createdAt.toISOString(),
          })),
          comments: result.comments.map((comment) => ({
            id: comment.id,
            requestId: comment.requestId,
            visibility: comment.visibility,
            body: comment.body,
            actorType: comment.actorType,
            actorId: comment.actorId,
            createdAt: comment.createdAt.toISOString(),
          })),
        },
      });
    },

    async list(request: Request): Promise<Response> {
      const unauthorized = authenticate(request.headers, dependencies.apiKey);

      if (unauthorized) {
        return unauthorized;
      }

      const url = new URL(request.url);
      const parsed = listRequestsQuerySchema.safeParse({
        status: emptyToUndefined(url.searchParams.get("status")),
        type: emptyToUndefined(url.searchParams.get("type")),
        limit: emptyToUndefined(url.searchParams.get("limit")),
      });

      if (!parsed.success) {
        return validationError();
      }

      let requests;

      try {
        requests = await dependencies.requestRepository.list(parsed.data);
      } catch {
        return serverError();
      }

      return Response.json({
        requests: requests.map((requestSummary) =>
          normalizeRequestSummary(requestSummary),
        ),
      });
    },

    async updateStatus(request: Request, id: string): Promise<Response> {
      const unauthorized = authenticate(request.headers, dependencies.apiKey);

      if (unauthorized) {
        return unauthorized;
      }

      const body = await readJson(request);
      const parsed = updateStatusSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      try {
        const updatedRequest =
          await dependencies.requestRepository.updateStatus(id, {
            status: parsed.data.status,
            actorType: parsed.data.actor.type,
            actorId: parsed.data.actor.id ?? null,
            reason: parsed.data.reason ?? null,
          });

        if (!updatedRequest) {
          return notFound();
        }

        return Response.json({
          request: normalizeRequestSummary(updatedRequest, {
            includeCompletedAt: true,
          }),
        });
      } catch {
        return serverError();
      }
    },

    async addComment(request: Request, id: string): Promise<Response> {
      const unauthorized = authenticate(request.headers, dependencies.apiKey);

      if (unauthorized) {
        return unauthorized;
      }

      const body = await readJson(request);
      const parsed = addCommentSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      try {
        const comment = await dependencies.requestRepository.addComment(id, {
          visibility: parsed.data.visibility,
          body: parsed.data.body,
          actorType: parsed.data.actor.type,
          actorId: parsed.data.actor.id ?? null,
        });

        if (!comment) {
          return notFound();
        }

        return Response.json(
          {
            comment: {
              id: comment.id,
              requestId: comment.requestId,
              visibility: comment.visibility,
              body: comment.body,
              actorType: comment.actorType,
              actorId: comment.actorId,
              createdAt: comment.createdAt.toISOString(),
            },
          },
          {
            status: 201,
          },
        );
      } catch {
        return serverError();
      }
    },
  };
}

function authenticate(
  headers: Headers,
  apiKey: string | null,
): Response | null {
  const suppliedApiKey = headers.get("x-api-key");

  if (!apiKey || !suppliedApiKey || suppliedApiKey !== apiKey) {
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

function notFound(): Response {
  return Response.json(
    {
      error: {
        code: "NOT_FOUND",
        message: "Request not found.",
      },
    },
    {
      status: 404,
    },
  );
}

function serverError(): Response {
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Request could not be processed.",
      },
    },
    {
      status: 500,
    },
  );
}

function normalizeRequestSummary(
  request: {
    id: string;
    publicId: string;
    type: RequestType;
    status: RequestStatus;
    requesterId: string;
    createdAt: Date;
    completedAt: Date | null;
  },
  options: { includeCompletedAt?: boolean } = {},
) {
  const summary = {
    id: request.id,
    publicId: request.publicId,
    type: request.type,
    status: request.status,
    requesterId: request.requesterId,
    createdAt: request.createdAt.toISOString(),
  };

  if (!options.includeCompletedAt) {
    return summary;
  }

  return {
    ...summary,
    completedAt: request.completedAt?.toISOString() ?? null,
  };
}

function emptyToUndefined(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}
