import { createHash, randomBytes } from "node:crypto";

import {
  actorTypes,
  commentVisibilities,
  createPrivacyRequest,
  requestStatuses,
  requestTypes,
} from "@magictrust/domain";
import type {
  JsonObject,
  JsonValue,
  RequestCreationStore,
  RequestCommunication,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import type {
  ApiClientScope,
  ApiClientStore,
  AuthenticatedApiClient,
  ApiIdempotencyStore,
  RequestListFilters,
  RequestRepository,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import { decryptPii, hashAccessToken, hashPii } from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { z } from "zod";

import { authenticateInternalApiRequest } from "./internal-api-auth";

export type InternalRequestApiDependencies = {
  apiKey: string | null;
  apiClientStore: ApiClientStore;
  appEnv: string;
  requestCreationStore: RequestCreationStore;
  requestRepository: RequestRepository;
  idempotencyStore: ApiIdempotencyStore;
  storageProvider: PrivateFileStorageProvider;
  emailProvider: EmailProvider;
  appBaseUrl: string;
};

const maxUploadSizeBytes = 10 * 1024 * 1024;
const allowedUploadMimeTypes = new Set([
  "application/json",
  "text/csv",
  "application/pdf",
  "text/plain",
  "application/zip",
]);

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

const actorSchema = z.object({
  type: z.enum(actorTypes),
  id: z.string().min(1).nullable().optional(),
});

const updateStatusSchema = z.object({
  status: z.enum(requestStatuses),
  actor: actorSchema,
  reason: z.string().min(1).nullable().optional(),
});

const updateMutableDataSchema = z.object({
  data: jsonObjectSchema,
  actor: actorSchema,
  reason: z.string().min(1).nullable().optional(),
});

const builtInEventTypes = new Set([
  "CUSTOM_EVENT",
  "REQUEST_CREATED",
  "STATUS_CHANGED",
  "PUBLIC_COMMENT_ADDED",
  "INTERNAL_COMMENT_ADDED",
  "PUBLIC_ATTACHMENT_ADDED",
  "INTERNAL_ATTACHMENT_ADDED",
  "ATTACHMENT_DOWNLOADED",
  "ADMIN_ATTACHMENT_DOWNLOADED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "CONSUMER_ACCESS_LINK_SENT",
  "CONSUMER_ACCESS_TOKEN_USED",
  "CONSUMER_ACCESS_SESSION_CREATED",
  "CONSUMER_ACCESS_SESSION_USED",
  "CONSUMER_ATTACHMENT_DOWNLOADED",
  "IDENTITY_VERIFICATION_SENT",
  "IDENTITY_VERIFIED",
  "CONSUMER_NOTIFICATION_SENT",
  "CONSUMER_NOTIFICATION_FAILED",
  "REQUEST_DATA_UPDATED",
  "REQUEST_ASSIGNED",
  "REQUEST_UNASSIGNED",
  "REQUEST_DUE_DATE_SET",
  "REQUEST_DUE_DATE_UPDATED",
  "REQUEST_DUE_DATE_CLEARED",
]);

const customEventNamePattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const maxCustomEventDataBytes = 16 * 1024;

const addCustomEventSchema = z.object({
  type: z
    .string()
    .regex(customEventNamePattern)
    .refine((type) => !builtInEventTypes.has(type)),
  visibility: z.enum(commentVisibilities),
  data: jsonObjectSchema,
  actor: actorSchema,
});

const addCommentSchema = z.object({
  visibility: z.enum(commentVisibilities),
  body: z.string().min(1),
  actor: actorSchema,
});

const addAttachmentSchema = z.object({
  visibility: z.enum(commentVisibilities),
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storageProvider: z.string().min(1),
  storageKey: z.string().min(1),
  checksum: z.string().min(1),
  actor: actorSchema,
});

const sendEmailCommunicationSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  actor: actorSchema,
});

const notificationTypes = [
  "REQUEST_UPDATED",
  "REQUEST_COMPLETED",
  "REQUEST_REJECTED",
  "FILE_AVAILABLE",
] as const;

const sendConsumerNotificationSchema = z.object({
  type: z.enum(notificationTypes),
  message: z.string().min(1),
  actor: actorSchema,
});

const downloadAttachmentQuerySchema = z.object({
  actorId: z.string().min(1).max(128).default("internal-api"),
});

const idempotencyTtlMs = 24 * 60 * 60 * 1000;

export function createInternalRequestApi(
  dependencies: InternalRequestApiDependencies,
) {
  return {
    async create(request: Request): Promise<Response> {
      const auth = await authorize(request, dependencies, "requests:create");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          createRequest(preparedRequest, dependencies, auth.apiClient),
      );
    },

    async get(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "requests:read");

      if (auth.response) {
        return auth.response;
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
          mutableData: result.mutableData,
          events: result.events.map((event) => ({
            id: event.id,
            type: event.customType ?? event.type,
            category: event.category ?? "BUILT_IN",
            customType: event.customType,
            visibility: event.visibility ?? "INTERNAL",
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
          attachments: result.attachments.map((attachment) => ({
            id: attachment.id,
            requestId: attachment.requestId,
            visibility: attachment.visibility,
            fileName: attachment.fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            storageProvider: attachment.storageProvider,
            storageKey: attachment.storageKey,
            checksum: attachment.checksum,
            actorType: attachment.actorType,
            actorId: attachment.actorId,
            createdAt: attachment.createdAt.toISOString(),
          })),
          communications: result.communications.map((communication) =>
            normalizeCommunicationMetadata(communication),
          ),
        },
      });
    },

    async list(request: Request): Promise<Response> {
      const auth = await authorize(request, dependencies, "requests:read");

      if (auth.response) {
        return auth.response;
      }

      const url = new URL(request.url);
      const parsed = parseListRequestsQuery(url.searchParams);

      if (!parsed.ok) {
        return validationError(parsed.message);
      }

      let result;

      try {
        result = await dependencies.requestRepository.list(parsed.filters);
      } catch {
        return serverError();
      }

      const response: {
        requests: ReturnType<typeof normalizeRequestListItem>[];
        pagination: {
          limit: number;
          nextCursor?: string;
        };
      } = {
        requests: result.requests.map((requestSummary) =>
          normalizeRequestListItem(requestSummary),
        ),
        pagination: {
          limit: parsed.filters.limit,
        },
      };

      if (result.nextCursor) {
        response.pagination.nextCursor = encodeListCursor(result.nextCursor);
      }

      return Response.json(response);
    },

    async updateStatus(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "requests:update");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          updateStatus(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async updateMutableData(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "requests:update");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          updateMutableData(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async addCustomEvent(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "events:write");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          addCustomEvent(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async addComment(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "comments:write");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          addComment(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async addAttachment(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "attachments:write");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          addAttachment(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async uploadAttachment(request: Request, id: string): Promise<Response> {
      const auth = await authorize(request, dependencies, "attachments:write");

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          uploadAttachment(preparedRequest, id, dependencies, auth.apiClient),
      );
    },

    async downloadAttachment(
      request: Request,
      requestId: string,
      attachmentId: string,
    ): Promise<Response> {
      const auth = await authorize(request, dependencies, "attachments:read");

      if (auth.response) {
        return auth.response;
      }

      const url = new URL(request.url);
      const parsed = downloadAttachmentQuerySchema.safeParse({
        actorId: emptyToUndefined(url.searchParams.get("actorId")),
      });

      if (!parsed.success) {
        return validationError();
      }

      let existingRequest;

      try {
        existingRequest =
          await dependencies.requestRepository.findByIdOrPublicId(requestId);
      } catch {
        return serverError();
      }

      if (!existingRequest) {
        return notFound();
      }

      const attachment = existingRequest.attachments.find(
        (item) => item.id === attachmentId,
      );

      if (!attachment) {
        return notFound();
      }

      if (
        attachment.storageProvider !== dependencies.storageProvider.provider
      ) {
        return unsupportedStorageProvider();
      }

      try {
        const downloaded =
          await dependencies.storageProvider.downloadPrivateFile({
            storageKey: attachment.storageKey,
          });

        if (!downloaded) {
          return notFound();
        }

        await dependencies.requestRepository.recordAttachmentDownloaded(
          existingRequest.id,
          {
            attachmentId: attachment.id,
            fileName: attachment.fileName,
            storageProvider: attachment.storageProvider,
            actorId: auth.apiClient.id,
          },
        );

        return new Response(downloaded.body, {
          status: 200,
          headers: {
            "content-type": downloaded.contentType || attachment.mimeType,
            "content-disposition": contentDispositionAttachment(
              attachment.fileName,
            ),
            "content-length": downloaded.sizeBytes.toString(),
          },
        });
      } catch {
        return serverError();
      }
    },

    async sendEmailCommunication(
      request: Request,
      id: string,
    ): Promise<Response> {
      const auth = await authorize(
        request,
        dependencies,
        "communications:write",
      );

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          sendEmailCommunication(
            preparedRequest,
            id,
            dependencies,
            auth.apiClient,
          ),
      );
    },

    async sendConsumerNotification(
      request: Request,
      id: string,
    ): Promise<Response> {
      const auth = await authorize(
        request,
        dependencies,
        "notifications:write",
      );

      if (auth.response) {
        return auth.response;
      }

      return withIdempotency(
        request,
        dependencies,
        auth.apiClient,
        (preparedRequest) =>
          sendConsumerNotification(
            preparedRequest,
            id,
            dependencies,
            auth.apiClient,
          ),
      );
    },
  };
}

async function authorize(
  request: Request,
  dependencies: InternalRequestApiDependencies,
  scope: ApiClientScope,
) {
  return authenticateInternalApiRequest(request.headers, dependencies, scope);
}

function actorIdFor(
  actor: { type: string; id?: string | null },
  apiClient: AuthenticatedApiClient,
): string | null {
  return actor.type === "API_CLIENT" ? apiClient.id : (actor.id ?? null);
}

function actorIdForFields(
  actorType: string,
  actorId: string | null,
  apiClient: AuthenticatedApiClient,
): string | null {
  return actorType === "API_CLIENT" ? apiClient.id : actorId;
}

async function createRequest(
  request: Request,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  const parsed = createRequestSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  try {
    const result = await createPrivacyRequest(
      {
        requester: {
          email: parsed.data.requester.email,
          phone: parsed.data.requester.phone,
        },
        type: parsed.data.type,
        submittedData: parsed.data,
        actor: {
          type: "API_CLIENT",
          id: apiClient.id,
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
}

async function updateStatus(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  const parsed = updateStatusSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  try {
    const updatedRequest = await dependencies.requestRepository.updateStatus(
      id,
      {
        status: parsed.data.status,
        actorType: parsed.data.actor.type,
        actorId: actorIdFor(parsed.data.actor, apiClient),
        reason: parsed.data.reason ?? null,
      },
    );

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
}

async function updateMutableData(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  if (hasDangerousKeyInUnknown(body)) {
    return validationError();
  }

  const parsed = updateMutableDataSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  try {
    const updated = await dependencies.requestRepository.updateMutableData(id, {
      data: parsed.data.data,
      actorType: parsed.data.actor.type,
      actorId: actorIdFor(parsed.data.actor, apiClient),
      reason: parsed.data.reason ?? null,
    });

    if (!updated) {
      return notFound();
    }

    return Response.json({
      request: {
        mutableData: updated.mutableData,
        updatedAt: updated.updatedAt.toISOString(),
      },
    });
  } catch {
    return serverError();
  }
}

async function addCustomEvent(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  if (hasDangerousKeyInUnknown(body)) {
    return validationError();
  }

  const parsed = addCustomEventSchema.safeParse(body);

  if (
    !parsed.success ||
    serializedJsonByteLength(parsed.data.data) > maxCustomEventDataBytes
  ) {
    return validationError();
  }

  try {
    const event = await dependencies.requestRepository.addCustomEvent(id, {
      customType: parsed.data.type,
      visibility: parsed.data.visibility,
      data: parsed.data.data,
      actorType: parsed.data.actor.type,
      actorId: actorIdFor(parsed.data.actor, apiClient),
    });

    if (!event) {
      return notFound();
    }

    return Response.json(
      {
        event: normalizeRequestEvent(event),
      },
      {
        status: 201,
      },
    );
  } catch {
    return serverError();
  }
}

async function addComment(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
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
      actorId: actorIdFor(parsed.data.actor, apiClient),
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
}

async function addAttachment(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  const parsed = addAttachmentSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  try {
    const attachment = await dependencies.requestRepository.addAttachment(id, {
      visibility: parsed.data.visibility,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      sizeBytes: parsed.data.sizeBytes,
      storageProvider: parsed.data.storageProvider,
      storageKey: parsed.data.storageKey,
      checksum: parsed.data.checksum,
      actorType: parsed.data.actor.type,
      actorId: actorIdFor(parsed.data.actor, apiClient),
    });

    if (!attachment) {
      return notFound();
    }

    return Response.json(
      {
        attachment: {
          id: attachment.id,
          requestId: attachment.requestId,
          visibility: attachment.visibility,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          storageProvider: attachment.storageProvider,
          storageKey: attachment.storageKey,
          checksum: attachment.checksum,
          actorType: attachment.actorType,
          actorId: attachment.actorId,
          createdAt: attachment.createdAt.toISOString(),
        },
      },
      {
        status: 201,
      },
    );
  } catch {
    return serverError();
  }
}

async function uploadAttachment(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return validationError();
  }

  const file = formData.get("file");
  const visibility = formData.get("visibility");
  const actorType = formData.get("actorType");
  const actorId = formData.get("actorId");

  if (!(file instanceof File)) {
    return validationError("File is required.");
  }

  if (file.size > maxUploadSizeBytes) {
    return validationError("File is too large.");
  }

  if (!allowedUploadMimeTypes.has(file.type)) {
    return validationError("File MIME type is not supported.");
  }

  const parsed = z
    .object({
      visibility: z.enum(commentVisibilities),
      actorType: z.enum(actorTypes),
      actorId: z.string().min(1).nullable(),
    })
    .safeParse({
      visibility,
      actorType,
      actorId: typeof actorId === "string" && actorId ? actorId : null,
    });

  if (!parsed.success) {
    return validationError();
  }

  let existingRequest;

  try {
    existingRequest =
      await dependencies.requestRepository.findByIdOrPublicId(id);
  } catch {
    return serverError();
  }

  if (!existingRequest) {
    return notFound();
  }

  const safeFileName = sanitizeFileName(file.name);
  const storageKey = `requests/${existingRequest.publicId}/attachments/${crypto.randomUUID()}-${safeFileName}`;

  try {
    const upload = await dependencies.storageProvider.uploadPrivateFile({
      body: file,
      storageKey,
      contentType: file.type,
    });
    const attachment = await dependencies.requestRepository.addAttachment(
      existingRequest.id,
      {
        visibility: parsed.data.visibility,
        fileName: safeFileName,
        mimeType: file.type,
        sizeBytes: file.size,
        storageProvider: upload.provider,
        storageKey: upload.storageKey,
        checksum: upload.checksum,
        actorType: parsed.data.actorType,
        actorId: actorIdForFields(
          parsed.data.actorType,
          parsed.data.actorId,
          apiClient,
        ),
      },
    );

    if (!attachment) {
      return notFound();
    }

    return Response.json(
      {
        attachment: {
          id: attachment.id,
          requestId: attachment.requestId,
          visibility: attachment.visibility,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          storageProvider: attachment.storageProvider,
          storageKey: attachment.storageKey,
          checksum: attachment.checksum,
          actorType: attachment.actorType,
          actorId: attachment.actorId,
          createdAt: attachment.createdAt.toISOString(),
        },
      },
      {
        status: 201,
      },
    );
  } catch {
    return serverError();
  }
}

async function sendEmailCommunication(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  const parsed = sendEmailCommunicationSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  let existingRequest;

  try {
    existingRequest =
      await dependencies.requestRepository.findByIdOrPublicId(id);
  } catch {
    return serverError();
  }

  if (!existingRequest) {
    return notFound();
  }

  let communication;

  try {
    communication = await dependencies.requestRepository.createCommunication(
      existingRequest.id,
      {
        recipient: parsed.data.to,
        subject: parsed.data.subject,
        body: parsed.data.body,
        provider: dependencies.emailProvider.provider,
        actorType: parsed.data.actor.type,
        actorId: actorIdFor(parsed.data.actor, apiClient),
      },
    );
  } catch {
    return serverError();
  }

  if (!communication) {
    return notFound();
  }

  try {
    const sent = await dependencies.emailProvider.sendEmail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      body: parsed.data.body,
    });
    const updated = await dependencies.requestRepository.markCommunicationSent(
      existingRequest.id,
      communication.id,
      {
        providerMessageId: sent.providerMessageId,
        actorType: parsed.data.actor.type,
        actorId: actorIdFor(parsed.data.actor, apiClient),
      },
    );

    if (!updated) {
      return notFound();
    }

    return Response.json(
      {
        communication: normalizeCommunicationMetadata(updated),
      },
      {
        status: 201,
      },
    );
  } catch {
    const failed = await dependencies.requestRepository.markCommunicationFailed(
      existingRequest.id,
      communication.id,
      {
        errorMessage: "Email provider failed to send the message.",
        actorType: parsed.data.actor.type,
        actorId: actorIdFor(parsed.data.actor, apiClient),
      },
    );

    if (!failed) {
      return notFound();
    }

    return Response.json(
      {
        communication: normalizeCommunicationMetadata(failed),
      },
      {
        status: 502,
      },
    );
  }
}

async function sendConsumerNotification(
  request: Request,
  id: string,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
): Promise<Response> {
  const body = await readJson(request);
  const parsed = sendConsumerNotificationSchema.safeParse(body);

  if (!parsed.success) {
    return validationError();
  }

  let existingRequest;

  try {
    existingRequest =
      await dependencies.requestRepository.findConsumerNotificationTarget(id);
  } catch {
    return serverError();
  }

  if (!existingRequest) {
    return notFound();
  }

  if (!existingRequest.requesterEmailEncrypted) {
    return Response.json(
      {
        error: {
          code: "NOTIFICATION_UNAVAILABLE",
          message: "Requester email is unavailable.",
        },
      },
      {
        status: 422,
      },
    );
  }

  let recipient: string;

  try {
    recipient = decryptPii(existingRequest.requesterEmailEncrypted);
  } catch {
    return serverError();
  }

  let secureAccessUrl: string | null = null;

  if (parsed.data.type === "FILE_AVAILABLE") {
    const token = generateSecureToken();
    let accessToken;

    try {
      accessToken =
        await dependencies.requestRepository.createConsumerNotificationAccessToken(
          existingRequest.id,
          {
            tokenHash: hashAccessToken(token),
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        );
    } catch {
      return serverError();
    }

    if (!accessToken) {
      return notFound();
    }

    secureAccessUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${existingRequest.publicId}/access?token=${encodeURIComponent(token)}`;
  }

  const trackingUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${existingRequest.publicId}`;
  const subject = notificationSubject(parsed.data.type, existingRequest);
  const emailBody = notificationBody({
    publicId: existingRequest.publicId,
    status: existingRequest.status,
    message: parsed.data.message,
    trackingUrl,
    secureAccessUrl,
  });

  let communication;

  try {
    communication = await dependencies.requestRepository.createCommunication(
      existingRequest.id,
      {
        recipient,
        subject,
        body: emailBody,
        provider: dependencies.emailProvider.provider,
        actorType: parsed.data.actor.type,
        actorId: actorIdFor(parsed.data.actor, apiClient),
      },
    );
  } catch {
    return serverError();
  }

  if (!communication) {
    return notFound();
  }

  try {
    const sent = await dependencies.emailProvider.sendEmail({
      to: recipient,
      subject,
      body: emailBody,
    });
    const updated =
      await dependencies.requestRepository.markConsumerNotificationSent(
        existingRequest.id,
        communication.id,
        {
          notificationType: parsed.data.type,
          providerMessageId: sent.providerMessageId,
          actorType: parsed.data.actor.type,
          actorId: actorIdFor(parsed.data.actor, apiClient),
        },
      );

    if (!updated) {
      return notFound();
    }

    return Response.json(
      {
        communication: normalizeCommunicationMetadata(updated),
      },
      {
        status: 201,
      },
    );
  } catch {
    const failed =
      await dependencies.requestRepository.markConsumerNotificationFailed(
        existingRequest.id,
        communication.id,
        {
          notificationType: parsed.data.type,
          errorMessage: "Email provider failed to send the notification.",
          actorType: parsed.data.actor.type,
          actorId: actorIdFor(parsed.data.actor, apiClient),
        },
      );

    if (!failed) {
      return notFound();
    }

    return Response.json(
      {
        communication: normalizeCommunicationMetadata(failed),
      },
      {
        status: 502,
      },
    );
  }
}

async function withIdempotency(
  request: Request,
  dependencies: InternalRequestApiDependencies,
  apiClient: AuthenticatedApiClient,
  operation: (request: Request) => Promise<Response>,
): Promise<Response> {
  const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();

  if (!idempotencyKey) {
    return Response.json(
      {
        error: {
          code: "IDEMPOTENCY_KEY_REQUIRED",
          message: "Idempotency-Key header is required.",
        },
      },
      {
        status: 400,
      },
    );
  }

  const prepared = await prepareIdempotentRequest(request);
  const now = new Date();
  const existing = await dependencies.idempotencyStore.findActive(
    apiClient.id,
    idempotencyKey,
    now,
  );

  if (existing) {
    if (existing.requestHash !== prepared.requestHash) {
      return Response.json(
        {
          error: {
            code: "IDEMPOTENCY_KEY_REUSED",
            message:
              "Idempotency-Key was already used for a different request.",
          },
        },
        {
          status: 409,
        },
      );
    }

    return Response.json(existing.responseBody, {
      status: existing.responseStatus,
      headers: {
        "Idempotency-Replayed": "true",
      },
    });
  }

  const response = await operation(prepared.request);
  const responseBody = (await response.clone().json()) as JsonValue;
  await dependencies.idempotencyStore.create({
    idempotencyKey,
    apiClientId: apiClient.id,
    method: prepared.method,
    route: prepared.route,
    requestHash: prepared.requestHash,
    responseStatus: response.status,
    responseBody,
    expiresAt: new Date(now.getTime() + idempotencyTtlMs),
  });

  return response;
}

async function prepareIdempotentRequest(request: Request): Promise<{
  request: Request;
  method: string;
  route: string;
  requestHash: string;
}> {
  const method = request.method.toUpperCase();
  const route = new URL(request.url).pathname;
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const clonedFormData = new FormData();
    const safeParts: JsonObject = {};

    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        const checksum = hashBuffer(await value.arrayBuffer());
        clonedFormData.append(key, value);
        safeParts[key] = {
          kind: "file",
          fileName: value.name,
          mimeType: value.type,
          sizeBytes: value.size,
          checksum,
        };
      } else {
        clonedFormData.append(key, value);
        safeParts[key] = value;
      }
    }

    const headers = new Headers(request.headers);
    headers.delete("content-type");

    return {
      request: new Request(request.url, {
        method,
        headers,
        body: clonedFormData,
      }),
      method,
      route,
      requestHash: hashStableJson({
        method,
        route,
        payload: safeParts,
      }),
    };
  }

  const text = await request.text();
  const payload = parseJsonOrText(text);

  return {
    request: new Request(request.url, {
      method,
      headers: request.headers,
      body: text,
    }),
    method,
    route,
    requestHash: hashStableJson({
      method,
      route,
      payload,
    }),
  };
}

function parseJsonOrText(value: string): unknown {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return value;
  }
}

function hashStableJson(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function hashBuffer(value: ArrayBuffer): string {
  return createHash("sha256").update(Buffer.from(value)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

type ListQueryParseResult =
  | {
      ok: true;
      filters: RequestListFilters;
    }
  | {
      ok: false;
      message: string;
    };

function parseListRequestsQuery(
  searchParams: URLSearchParams,
): ListQueryParseResult {
  const limit = parseLimit(searchParams.get("limit"));

  if (!limit.ok) {
    return limit;
  }

  const types = parseEnumList(searchParams.get("type"), requestTypes, "type");

  if (!types.ok) {
    return types;
  }

  const statuses = parseEnumList(
    searchParams.get("status"),
    requestStatuses,
    "status",
  );

  if (!statuses.ok) {
    return statuses;
  }

  const createdFrom = parseDateFilter(searchParams.get("createdFrom"));
  const createdTo = parseDateFilter(searchParams.get("createdTo"));
  const updatedFrom = parseDateFilter(searchParams.get("updatedFrom"));
  const updatedTo = parseDateFilter(searchParams.get("updatedTo"));

  if (!createdFrom.ok) {
    return {
      ok: false,
      message: "createdFrom must be a valid ISO-8601 datetime.",
    };
  }

  if (!createdTo.ok) {
    return {
      ok: false,
      message: "createdTo must be a valid ISO-8601 datetime.",
    };
  }

  if (!updatedFrom.ok) {
    return {
      ok: false,
      message: "updatedFrom must be a valid ISO-8601 datetime.",
    };
  }

  if (!updatedTo.ok) {
    return {
      ok: false,
      message: "updatedTo must be a valid ISO-8601 datetime.",
    };
  }

  if (
    createdFrom.value &&
    createdTo.value &&
    createdFrom.value >= createdTo.value
  ) {
    return { ok: false, message: "createdFrom must be before createdTo." };
  }

  if (
    updatedFrom.value &&
    updatedTo.value &&
    updatedFrom.value >= updatedTo.value
  ) {
    return { ok: false, message: "updatedFrom must be before updatedTo." };
  }

  const cursor = parseListCursor(searchParams.get("cursor"));

  if (!cursor.ok) {
    return cursor;
  }

  return {
    ok: true,
    filters: {
      publicId: emptyToUndefined(searchParams.get("publicId")),
      types: types.values,
      statuses: statuses.values,
      emailHash: hashOptionalPiiSearchValue(searchParams.get("email")),
      phoneHash: hashOptionalPiiSearchValue(searchParams.get("phone")),
      createdFrom: createdFrom.value,
      createdTo: createdTo.value,
      updatedFrom: updatedFrom.value,
      updatedTo: updatedTo.value,
      cursor: cursor.value,
      limit: limit.value,
    },
  };
}

function parseLimit(
  value: string | null,
): { ok: true; value: number } | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, value: 25 };
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    return { ok: false, message: "limit must be an integer from 1 to 100." };
  }

  return { ok: true, value: parsed };
}

function parseEnumList<const T extends readonly string[]>(
  value: string | null,
  allowedValues: T,
  name: string,
):
  | { ok: true; values: T[number][] | undefined }
  | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, values: undefined };
  }

  const values = value.split(",").map((item) => item.trim());
  const allowed = new Set<string>(allowedValues);

  if (values.length === 0 || values.some((item) => !allowed.has(item))) {
    return { ok: false, message: `${name} contains an invalid value.` };
  }

  return { ok: true, values: [...new Set(values)] as T[number][] };
}

function parseDateFilter(
  value: string | null,
): { ok: true; value: Date | undefined } | { ok: false } {
  if (value === null || value === "") {
    return { ok: true, value: undefined };
  }

  const parsed = z.string().datetime({ offset: true }).safeParse(value);

  if (!parsed.success) {
    return { ok: false };
  }

  const date = new Date(parsed.data);

  return Number.isNaN(date.getTime())
    ? { ok: false }
    : { ok: true, value: date };
}

function hashOptionalPiiSearchValue(value: string | null): string | undefined {
  const normalized = emptyToUndefined(value);

  return normalized ? hashPii(normalized) : undefined;
}

function encodeListCursor(cursor: { createdAt: Date; id: string }): string {
  return Buffer.from(
    JSON.stringify({
      createdAt: cursor.createdAt.toISOString(),
      id: cursor.id,
    }),
  ).toString("base64url");
}

function parseListCursor(
  value: string | null,
):
  | { ok: true; value: RequestListFilters["cursor"] | undefined }
  | { ok: false; message: string } {
  if (value === null || value === "") {
    return { ok: true, value: undefined };
  }

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.createdAt !== "string" ||
      typeof parsed.id !== "string"
    ) {
      return { ok: false, message: "cursor is invalid." };
    }

    const createdAt = new Date(parsed.createdAt);

    if (Number.isNaN(createdAt.getTime()) || !parsed.id.trim()) {
      return { ok: false, message: "cursor is invalid." };
    }

    return {
      ok: true,
      value: {
        createdAt,
        id: parsed.id,
      },
    };
  } catch {
    return { ok: false, message: "cursor is invalid." };
  }
}

function normalizeRequestEvent(event: {
  id: string;
  privacyRequestId: string;
  type: string;
  category?: string;
  customType?: string | null;
  visibility?: string;
  actorType: string;
  actorId: string | null;
  data: JsonObject;
  createdAt: Date;
}) {
  return {
    id: event.id,
    requestId: event.privacyRequestId,
    type: event.customType ?? event.type,
    category: event.category ?? "BUILT_IN",
    customType: event.customType ?? null,
    visibility: event.visibility ?? "INTERNAL",
    actorType: event.actorType,
    actorId: event.actorId,
    data: event.data,
    createdAt: event.createdAt.toISOString(),
  };
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validationError(message = "Request payload is invalid."): Response {
  return Response.json(
    {
      error: {
        code: "VALIDATION_ERROR",
        message,
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

function unsupportedStorageProvider(): Response {
  return Response.json(
    {
      error: {
        code: "UNSUPPORTED_STORAGE_PROVIDER",
        message: "Attachment storage provider is not supported.",
      },
    },
    {
      status: 400,
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

function normalizeRequestListItem(request: {
  id: string;
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  requesterId: string;
  source?: {
    channel: string | null;
    siteKey: string | null;
    formKey: string | null;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: request.id,
    publicId: request.publicId,
    type: request.type,
    status: request.status,
    requesterId: request.requesterId,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    completedAt: request.completedAt?.toISOString() ?? null,
    source: request.source ?? null,
  };
}

function normalizeCommunicationMetadata(communication: RequestCommunication) {
  return {
    id: communication.id,
    requestId: communication.requestId,
    channel: communication.channel,
    direction: communication.direction,
    recipientMasked: maskCommunicationRecipient(communication),
    subject: communication.subject,
    provider: communication.provider,
    providerMessageId: communication.providerMessageId,
    status: communication.status,
    errorMessage: communication.errorMessage,
    actorType: communication.actorType,
    actorId: communication.actorId,
    createdAt: communication.createdAt.toISOString(),
    sentAt: communication.sentAt?.toISOString() ?? null,
  };
}

function maskEmailAddress(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const [localPart, domain] = value.split("@");

  if (!localPart || !domain) {
    return "***";
  }

  const first = localPart[0] ?? "*";
  const last = localPart.length > 1 ? localPart[localPart.length - 1] : "*";

  return `${first}***${last}@${domain}`;
}

function maskCommunicationRecipient(
  communication: RequestCommunication,
): string | null {
  if (communication.recipient) {
    return maskEmailAddress(communication.recipient);
  }

  if (!communication.recipientEncrypted) {
    return null;
  }

  try {
    return maskEmailAddress(decryptPii(communication.recipientEncrypted));
  } catch {
    return null;
  }
}

function emptyToUndefined(value: string | null): string | undefined {
  return value === null || value === "" ? undefined : value;
}

function sanitizeFileName(fileName: string): string {
  const sanitized = fileName
    .normalize("NFKD")
    .replace(/[^\w. -]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 160);

  return sanitized || "attachment";
}

function contentDispositionAttachment(fileName: string): string {
  return `attachment; filename="${escapeHeaderValue(fileName)}"`;
}

function escapeHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, "_");
}

function hasDangerousKeyInUnknown(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some((item) => hasDangerousKeyInUnknown(item));
  }

  return Object.entries(value as Record<string, unknown>).some(
    ([key, child]) =>
      key === "__proto__" ||
      key === "prototype" ||
      key === "constructor" ||
      hasDangerousKeyInUnknown(child),
  );
}

function serializedJsonByteLength(value: JsonObject): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

function notificationSubject(
  type: (typeof notificationTypes)[number],
  request: { publicId: string },
): string {
  switch (type) {
    case "REQUEST_COMPLETED":
      return `MagicTrust request completed: ${request.publicId}`;
    case "REQUEST_REJECTED":
      return `MagicTrust request rejected: ${request.publicId}`;
    case "FILE_AVAILABLE":
      return `MagicTrust file available: ${request.publicId}`;
    case "REQUEST_UPDATED":
      return `MagicTrust request updated: ${request.publicId}`;
  }
}

function notificationBody(input: {
  publicId: string;
  status: RequestStatus;
  message: string;
  trackingUrl: string;
  secureAccessUrl: string | null;
}): string {
  const lines = [
    "Your MagicTrust request has an update.",
    "",
    `Reference number: ${input.publicId}`,
    `Current status: ${input.status}`,
    "",
    input.message,
    "",
    `Track your request: ${input.trackingUrl}`,
  ];

  if (input.secureAccessUrl) {
    lines.push("", `Secure access link: ${input.secureAccessUrl}`);
  }

  return lines.join("\n");
}
