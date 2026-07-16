import { createPrivacyRequest, requestTypes } from "@magictrust/domain";
import type {
  JsonObject,
  RequestCreationStore,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import type { RequestRepository } from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import { z } from "zod";

export type PublicRequestApiDependencies = {
  requestCreationStore: RequestCreationStore;
  requestRepository: RequestRepository;
  emailProvider: EmailProvider;
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
  };
}

async function sendReceiptEmail(input: {
  requestRepository: RequestRepository;
  emailProvider: EmailProvider;
  requestId: string;
  recipient: string;
  publicId: string;
  type: RequestType;
  status: RequestStatus;
}): Promise<void> {
  const subject = `MagicTrust request received: ${input.publicId}`;
  const body = [
    "We received your request.",
    "",
    `Reference number: ${input.publicId}`,
    `Request type: ${input.type}`,
    `Status: ${input.status}`,
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
