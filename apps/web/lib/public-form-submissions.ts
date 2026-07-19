import "server-only";

import {
  createApiIdempotencyStore,
  createDatabase,
  createFormManagementStore,
} from "@magictrust/database";
import type {
  ApiIdempotencyStore,
  FormManagementStore,
} from "@magictrust/database";
import { getRequiredDatabaseUrl } from "@magictrust/config";
import type { JsonObject } from "@magictrust/domain";
import { hashSubmittedPayload } from "@magictrust/privacy";
import { z } from "zod";

import {
  submitPublicIntakeRequest,
  type PublicRequestApiDependencies,
} from "./public-request-api";
import { getPublicRequestApiDependencies } from "./public-request-api-dependencies";

const maxSubmissionBytes = 256 * 1024;
const maxRequestBytes = maxSubmissionBytes + 64 * 1024;
const maxSubmissionDepth = 12;
const idempotencyTtlMs = 24 * 60 * 60 * 1000;
const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);

const submissionSchema = z
  .object({
    data: z.unknown(),
  })
  .strict();

const emailSchema = z.string().trim().email().max(320);
const optionalNameSchema = z.string().trim().min(1).max(200);
const optionalPhoneSchema = z.string().trim().min(1).max(64);
const slugSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

type IntakeDependencies = Pick<
  PublicRequestApiDependencies,
  | "requestCreationStore"
  | "requestRepository"
  | "emailProvider"
  | "appBaseUrl"
  | "now"
>;

export type PublicFormSubmissionDependencies = IntakeDependencies & {
  formStore: Pick<
    FormManagementStore,
    "getPublishedFormSubmissionTargetBySlug"
  >;
  idempotencyStore: ApiIdempotencyStore;
};

export function createPublicFormSubmissionDependencies(): PublicFormSubmissionDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    const intake = getPublicRequestApiDependencies();
    const missing = () => {
      throw new Error("DATABASE_URL is required for public form submissions.");
    };
    return {
      ...intake,
      formStore: {
        getPublishedFormSubmissionTargetBySlug: missing,
      },
      idempotencyStore: {
        findActive: missing,
        create: missing,
      },
    };
  }

  const db = createDatabase(databaseUrl);
  return {
    ...getPublicRequestApiDependencies(db),
    formStore: createFormManagementStore(db),
    idempotencyStore: createApiIdempotencyStore(db),
  };
}

export function createPublicFormSubmissionApi(
  dependencies: PublicFormSubmissionDependencies,
) {
  return {
    async create(request: Request, slug: string): Promise<Response> {
      const parsedSlug = slugSchema.safeParse(slug);
      if (!parsedSlug.success) return formNotFound();

      try {
        const form =
          await dependencies.formStore.getPublishedFormSubmissionTargetBySlug(
            parsedSlug.data,
          );
        if (!form) return formNotFound();

        const body = await readJson(request);
        const parsed = submissionSchema.safeParse(body);
        if (!parsed.success) return validationError();
        if (
          !parsed.data.data ||
          typeof parsed.data.data !== "object" ||
          Array.isArray(parsed.data.data) ||
          !isSafeJsonObject(parsed.data.data as Record<string, unknown>)
        ) {
          return validationError();
        }
        const data = parsed.data.data as JsonObject;
        if (
          Buffer.byteLength(JSON.stringify(data), "utf8") > maxSubmissionBytes
        ) {
          return validationError();
        }

        const requester = parseRequester(data);
        if (!requester) return validationError();

        const requestHash = hashSubmittedPayload({
          formPublicId: form.publicId,
          data,
        });
        const idempotencyKey = request.headers.get("Idempotency-Key")?.trim();
        if (idempotencyKey && idempotencyKey.length > 255) {
          return validationError("Idempotency-Key is too long.");
        }
        const idempotencyClientId = `public-form:${form.publicId}`;

        if (idempotencyKey) {
          const existing = await dependencies.idempotencyStore.findActive(
            idempotencyClientId,
            idempotencyKey,
            dependencies.now(),
          );
          if (existing) {
            if (existing.requestHash !== requestHash) {
              return idempotencyConflict();
            }
            return Response.json(existing.responseBody, {
              status: existing.responseStatus,
              headers: { "Idempotency-Replayed": "true" },
            });
          }
        }

        const remainingData = structuredClone(data);
        delete remainingData.email;
        delete remainingData.phone;
        delete remainingData.firstName;
        delete remainingData.lastName;

        const result = await submitPublicIntakeRequest(
          {
            type: form.requestType,
            email: requester.email,
            phone: requester.phone,
            submittedData: {
              type: form.requestType,
              requester: requester.original,
              source: {
                channel: "FORM",
                siteKey: "magictrust-managed-form",
                formKey: form.slug,
                formPublicId: form.publicId,
                formVersionNumber: form.versionNumber,
              },
              submittedData: remainingData,
            },
          },
          dependencies,
        );
        const responseBody = { publicId: result.publicId };

        if (idempotencyKey) {
          await dependencies.idempotencyStore.create({
            idempotencyKey,
            apiClientId: idempotencyClientId,
            method: "POST",
            route: `/api/public/forms/${form.slug}/submissions`,
            requestHash,
            responseStatus: 201,
            responseBody,
            expiresAt: new Date(
              dependencies.now().getTime() + idempotencyTtlMs,
            ),
          });
        }

        return Response.json(responseBody, { status: 201 });
      } catch {
        return serverError();
      }
    },
  };
}

function parseRequester(data: JsonObject): {
  email: string;
  phone: string | null;
  original: JsonObject;
} | null {
  const email = emailSchema.safeParse(data.email);
  const firstName = parseOptional(data.firstName, optionalNameSchema);
  const lastName = parseOptional(data.lastName, optionalNameSchema);
  const phone = parseOptional(data.phone, optionalPhoneSchema);
  if (!email.success || !firstName.ok || !lastName.ok || !phone.ok) {
    return null;
  }

  return {
    email: email.data,
    phone: phone.value,
    original: {
      ...(firstName.value ? { firstName: firstName.value } : {}),
      ...(lastName.value ? { lastName: lastName.value } : {}),
      email: email.data,
      phone: phone.value,
    },
  };
}

function parseOptional(
  value: unknown,
  schema: z.ZodType<string>,
): { ok: true; value: string | null } | { ok: false } {
  if (value === undefined || value === null || value === "") {
    return { ok: true, value: null };
  }
  const parsed = schema.safeParse(value);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

function isSafeJsonObject(value: Record<string, unknown>): value is JsonObject {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value, depth: 1 },
  ];

  while (pending.length > 0) {
    const current = pending.pop()!;
    if (
      current.value === null ||
      typeof current.value === "string" ||
      typeof current.value === "boolean"
    ) {
      continue;
    }
    if (typeof current.value === "number") {
      if (!Number.isFinite(current.value)) return false;
      continue;
    }
    if (typeof current.value !== "object") return false;
    if (current.depth > maxSubmissionDepth) return false;

    if (Array.isArray(current.value)) {
      for (const child of current.value) {
        pending.push({ value: child, depth: current.depth + 1 });
      }
      continue;
    }

    for (const [key, child] of Object.entries(current.value)) {
      if (dangerousKeys.has(key)) return false;
      pending.push({ value: child, depth: current.depth + 1 });
    }
  }

  return true;
}

async function readJson(request: Request): Promise<unknown> {
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > maxRequestBytes) return null;
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

function validationError(message = "Submission payload is invalid.") {
  return Response.json(
    { error: { code: "VALIDATION_ERROR", message } },
    { status: 400 },
  );
}

function formNotFound() {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Form not found." } },
    { status: 404 },
  );
}

function idempotencyConflict() {
  return Response.json(
    {
      error: {
        code: "IDEMPOTENCY_KEY_REUSED",
        message: "Idempotency-Key was already used for a different submission.",
      },
    },
    { status: 409 },
  );
}

function serverError() {
  return Response.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Submission could not be processed.",
      },
    },
    { status: 500 },
  );
}
