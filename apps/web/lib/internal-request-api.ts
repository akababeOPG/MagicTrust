import { randomBytes } from "node:crypto";

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
  RequestCommunication,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import type { RequestRepository } from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import { decryptPii, hashAccessToken } from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { z } from "zod";

import { authenticateInternalApiRequest } from "./internal-api-auth";

export type InternalRequestApiDependencies = {
  apiKey: string | null;
  requestCreationStore: RequestCreationStore;
  requestRepository: RequestRepository;
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

export function createInternalRequestApi(
  dependencies: InternalRequestApiDependencies,
) {
  return {
    async create(request: Request): Promise<Response> {
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

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
            requester: {
              email: parsed.data.requester.email,
              phone: parsed.data.requester.phone,
            },
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
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

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
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

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
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

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
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

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

    async addAttachment(request: Request, id: string): Promise<Response> {
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

      if (unauthorized) {
        return unauthorized;
      }

      const body = await readJson(request);
      const parsed = addAttachmentSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      try {
        const attachment = await dependencies.requestRepository.addAttachment(
          id,
          {
            visibility: parsed.data.visibility,
            fileName: parsed.data.fileName,
            mimeType: parsed.data.mimeType,
            sizeBytes: parsed.data.sizeBytes,
            storageProvider: parsed.data.storageProvider,
            storageKey: parsed.data.storageKey,
            checksum: parsed.data.checksum,
            actorType: parsed.data.actor.type,
            actorId: parsed.data.actor.id ?? null,
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
    },

    async uploadAttachment(request: Request, id: string): Promise<Response> {
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

      if (unauthorized) {
        return unauthorized;
      }

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
            actorId: parsed.data.actorId,
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
    },

    async downloadAttachment(
      request: Request,
      requestId: string,
      attachmentId: string,
    ): Promise<Response> {
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

      if (unauthorized) {
        return unauthorized;
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
            actorId: parsed.data.actorId,
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
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

      if (unauthorized) {
        return unauthorized;
      }

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
        communication =
          await dependencies.requestRepository.createCommunication(
            existingRequest.id,
            {
              recipient: parsed.data.to,
              subject: parsed.data.subject,
              body: parsed.data.body,
              provider: dependencies.emailProvider.provider,
              actorType: parsed.data.actor.type,
              actorId: parsed.data.actor.id ?? null,
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
        const updated =
          await dependencies.requestRepository.markCommunicationSent(
            existingRequest.id,
            communication.id,
            {
              providerMessageId: sent.providerMessageId,
              actorType: parsed.data.actor.type,
              actorId: parsed.data.actor.id ?? null,
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
          await dependencies.requestRepository.markCommunicationFailed(
            existingRequest.id,
            communication.id,
            {
              errorMessage: "Email provider failed to send the message.",
              actorType: parsed.data.actor.type,
              actorId: parsed.data.actor.id ?? null,
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
    },

    async sendConsumerNotification(
      request: Request,
      id: string,
    ): Promise<Response> {
      const unauthorized = authenticateInternalApiRequest(
        request.headers,
        dependencies.apiKey,
      );

      if (unauthorized) {
        return unauthorized;
      }

      const body = await readJson(request);
      const parsed = sendConsumerNotificationSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      let existingRequest;

      try {
        existingRequest =
          await dependencies.requestRepository.findConsumerNotificationTarget(
            id,
          );
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
        communication =
          await dependencies.requestRepository.createCommunication(
            existingRequest.id,
            {
              recipient,
              subject,
              body: emailBody,
              provider: dependencies.emailProvider.provider,
              actorType: parsed.data.actor.type,
              actorId: parsed.data.actor.id ?? null,
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
              actorId: parsed.data.actor.id ?? null,
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
              actorId: parsed.data.actor.id ?? null,
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
    },
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

function normalizeCommunicationMetadata(communication: RequestCommunication) {
  return {
    id: communication.id,
    requestId: communication.requestId,
    channel: communication.channel,
    direction: communication.direction,
    recipient: communication.recipient,
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
