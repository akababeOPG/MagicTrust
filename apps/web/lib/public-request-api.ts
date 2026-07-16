import { randomBytes } from "node:crypto";

import { createPrivacyRequest, requestTypes } from "@magictrust/domain";
import type {
  JsonObject,
  RequestCreationStore,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import type { RequestRepository } from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import {
  decryptPii,
  hashAccessSession,
  hashAccessToken,
} from "@magictrust/privacy";
import { z } from "zod";

export const consumerAccessSessionCookieName =
  "magictrust_consumer_access_session";
export const consumerAccessSessionTtlSeconds = 30 * 60;

export type PublicRequestApiDependencies = {
  requestCreationStore: RequestCreationStore;
  requestRepository: RequestRepository;
  emailProvider: EmailProvider;
  appBaseUrl: string;
  now: () => Date;
};

const publicRequestSchema = z.object({
  type: z.enum(requestTypes),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional().default(""),
  message: z.string().optional().default(""),
  sourceUrl: z.string().url().optional(),
  website: z.string().optional().default(""),
});

export function createPublicRequestApi(
  dependencies: PublicRequestApiDependencies,
) {
  return {
    async create(request: Request): Promise<Response> {
      const body = await readJson(request);
      const parsed = publicRequestSchema.safeParse(body);

      if (!parsed.success) {
        return validationError();
      }

      if (parsed.data.website.trim()) {
        return validationError("Request payload is invalid.");
      }

      try {
        const submittedData: JsonObject = {
          type: parsed.data.type,
          requester: {
            firstName: parsed.data.firstName,
            lastName: parsed.data.lastName,
            email: parsed.data.email,
            phone: parsed.data.phone || null,
          },
          source: {
            channel: "FORM",
            formKey: "privacy-request",
            siteKey: "magictrust-hosted",
            sourceUrl: parsed.data.sourceUrl ?? null,
          },
          submittedData: {
            message: parsed.data.message || null,
          },
        };

        const result = await createPrivacyRequest(
          {
            requester: {
              email: parsed.data.email,
              phone: parsed.data.phone || null,
            },
            type: parsed.data.type,
            submittedData,
            actor: {
              type: "CONSUMER",
            },
          },
          dependencies.requestCreationStore,
        );

        await sendReceiptEmail({
          requestRepository: dependencies.requestRepository,
          emailProvider: dependencies.emailProvider,
          requestId: result.request.id,
          recipient: parsed.data.email,
          publicId: result.request.publicId,
          type: result.request.type,
          status: result.request.status,
          appBaseUrl: dependencies.appBaseUrl,
        });

        return Response.json(
          {
            request: normalizePublicRequest(result.request),
          },
          {
            status: 201,
          },
        );
      } catch {
        return serverError();
      }
    },

    async get(publicId: string): Promise<Response> {
      try {
        const tracking = await getPublicRequestTrackingData(
          dependencies,
          publicId,
        );

        if (!tracking) {
          return notFound();
        }

        return Response.json({
          request: tracking,
        });
      } catch {
        return serverError();
      }
    },

    async requestAccessLink(publicId: string): Promise<Response> {
      await sendConsumerAccessLink(dependencies, publicId);

      return genericAccessLinkResponse();
    },
  };
}

export type PublicRequestTrackingData = {
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: string;
  completedAt: string | null;
  publicComments: Array<{
    body: string;
    createdAt: string;
  }>;
};

export type PublicSecureAccessData = PublicRequestTrackingData & {
  secureAccessVerified: true;
};

export async function getPublicRequestTrackingData(
  dependencies: Pick<PublicRequestApiDependencies, "requestRepository">,
  publicId: string,
): Promise<PublicRequestTrackingData | null> {
  if (!/^req_[A-Za-z0-9_-]+$/.test(publicId)) {
    return null;
  }

  const result =
    await dependencies.requestRepository.findByIdOrPublicId(publicId);

  if (!result || result.publicId !== publicId) {
    return null;
  }

  return {
    publicId: result.publicId,
    type: result.type,
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    completedAt: result.completedAt?.toISOString() ?? null,
    publicComments: result.comments
      .filter((comment) => comment.visibility === "PUBLIC")
      .map((comment) => ({
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
  };
}

export async function getPublicSecureAccessData(
  dependencies: Pick<PublicRequestApiDependencies, "requestRepository" | "now">,
  publicId: string,
  sessionToken: string | null | undefined,
): Promise<PublicSecureAccessData | null> {
  if (!/^req_[A-Za-z0-9_-]+$/.test(publicId) || !sessionToken) {
    return null;
  }

  const result =
    await dependencies.requestRepository.validateConsumerAccessSession(
      publicId,
      {
        sessionHash: hashAccessSession(sessionToken),
        now: dependencies.now(),
      },
    );

  if (!result || result.publicId !== publicId) {
    return null;
  }

  return {
    publicId: result.publicId,
    type: result.type,
    status: result.status,
    createdAt: result.createdAt.toISOString(),
    completedAt: result.completedAt?.toISOString() ?? null,
    publicComments: result.comments
      .filter((comment) => comment.visibility === "PUBLIC")
      .map((comment) => ({
        body: comment.body,
        createdAt: comment.createdAt.toISOString(),
      })),
    secureAccessVerified: true,
  };
}

export async function exchangeConsumerAccessTokenForSession(
  dependencies: Pick<PublicRequestApiDependencies, "requestRepository" | "now">,
  publicId: string,
  token: string | null | undefined,
): Promise<{ sessionToken: string; expiresAt: Date } | null> {
  if (!/^req_[A-Za-z0-9_-]+$/.test(publicId) || !token) {
    return null;
  }

  const sessionToken = generateSecureToken();
  const now = dependencies.now();
  const expiresAt = new Date(
    now.getTime() + consumerAccessSessionTtlSeconds * 1000,
  );
  const result =
    await dependencies.requestRepository.consumeConsumerAccessToken(publicId, {
      tokenHash: hashAccessToken(token),
      sessionHash: hashAccessSession(sessionToken),
      sessionExpiresAt: expiresAt,
      now,
    });

  if (!result) {
    return null;
  }

  return {
    sessionToken,
    expiresAt,
  };
}

async function sendConsumerAccessLink(
  dependencies: PublicRequestApiDependencies,
  publicId: string,
): Promise<void> {
  try {
    if (!/^req_[A-Za-z0-9_-]+$/.test(publicId)) {
      return;
    }

    const target =
      await dependencies.requestRepository.findConsumerAccessLinkTarget(
        publicId,
      );

    if (!target?.requesterEmailEncrypted) {
      return;
    }

    const recipient = decryptPii(target.requesterEmailEncrypted);
    const token = generateSecureToken();
    const accessUrl = `${dependencies.appBaseUrl.replace(/\/$/, "")}/requests/${target.publicId}/access?token=${encodeURIComponent(token)}`;
    const subject = `MagicTrust secure access link: ${target.publicId}`;
    const body = [
      "Use this secure link to access your MagicTrust request.",
      "",
      `Reference number: ${target.publicId}`,
      `Secure access link: ${accessUrl}`,
      "",
      "This link expires in 30 minutes and can only be used once.",
    ].join("\n");
    const preparation =
      await dependencies.requestRepository.createConsumerAccessToken(
        target.publicId,
        {
          tokenHash: hashAccessToken(token),
          expiresAt: new Date(dependencies.now().getTime() + 30 * 60 * 1000),
          recipient,
          subject,
          body,
          provider: dependencies.emailProvider.provider,
        },
      );

    if (!preparation) {
      return;
    }

    try {
      const sent = await dependencies.emailProvider.sendEmail({
        to: recipient,
        subject,
        body,
      });

      await dependencies.requestRepository.markCommunicationSent(
        preparation.request.id,
        preparation.communication.id,
        {
          providerMessageId: sent.providerMessageId,
          actorType: "SYSTEM",
          actorId: "consumer-access-link",
        },
      );

      await dependencies.requestRepository.recordConsumerAccessLinkSent(
        preparation.request.id,
        {
          accessTokenId: preparation.accessToken.id,
          communicationId: preparation.communication.id,
          provider: sent.provider,
          providerMessageId: sent.providerMessageId,
        },
      );
    } catch {
      await dependencies.requestRepository.markCommunicationFailed(
        preparation.request.id,
        preparation.communication.id,
        {
          errorMessage: "Email provider failed to send the message.",
          actorType: "SYSTEM",
          actorId: "consumer-access-link",
        },
      );
    }
  } catch {
    // Access link requests intentionally return a generic response.
  }
}

function generateSecureToken(): string {
  return randomBytes(32).toString("base64url");
}

async function sendReceiptEmail(input: {
  requestRepository: RequestRepository;
  emailProvider: EmailProvider;
  requestId: string;
  recipient: string;
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  appBaseUrl: string;
}): Promise<void> {
  const subject = `MagicTrust request received: ${input.publicId}`;
  const trackingUrl = `${input.appBaseUrl.replace(/\/$/, "")}/requests/${input.publicId}`;
  const body = [
    "We received your request.",
    "",
    `Reference number: ${input.publicId}`,
    `Request type: ${input.type}`,
    `Status: ${input.status}`,
    `Track your request: ${trackingUrl}`,
    "",
    "Please save this reference number for your records.",
  ].join("\n");

  try {
    const communication = await input.requestRepository.createCommunication(
      input.requestId,
      {
        recipient: input.recipient,
        subject,
        body,
        provider: input.emailProvider.provider,
        actorType: "SYSTEM",
        actorId: "public-intake",
      },
    );

    if (!communication) {
      return;
    }

    try {
      const sent = await input.emailProvider.sendEmail({
        to: input.recipient,
        subject,
        body,
      });

      await input.requestRepository.markCommunicationSent(
        input.requestId,
        communication.id,
        {
          providerMessageId: sent.providerMessageId,
          actorType: "SYSTEM",
          actorId: "public-intake",
        },
      );
    } catch {
      await input.requestRepository.markCommunicationFailed(
        input.requestId,
        communication.id,
        {
          errorMessage: "Email provider failed to send the message.",
          actorType: "SYSTEM",
          actorId: "public-intake",
        },
      );
    }
  } catch {
    // Receipt email failures must not prevent public request creation.
  }
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

function genericAccessLinkResponse(): Response {
  return Response.json({
    ok: true,
    message: "If the request exists, an access link will be sent.",
  });
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

function normalizePublicRequest(request: {
  publicId: string;
  type: RequestType;
  status: RequestStatus;
  createdAt: Date;
}) {
  return {
    publicId: request.publicId,
    type: request.type,
    status: request.status,
    createdAt: request.createdAt.toISOString(),
  };
}
