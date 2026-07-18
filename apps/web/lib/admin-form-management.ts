import "server-only";

import { randomBytes } from "node:crypto";

import {
  createDatabase,
  createFormManagementStore,
} from "@magictrust/database";
import type {
  FormManagementErrorCode,
  FormManagementStore,
  FormStatus,
  FormVersionStatus,
  ManagedFormDetail,
} from "@magictrust/database";
import { getRequiredDatabaseUrl } from "@magictrust/config";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
});

export type AdminFormListItem = {
  publicId: string;
  name: string;
  slug: string;
  status: FormStatus;
  publishedVersionNumber: number | null;
  draftVersionNumber: number | null;
  updatedAt: string;
};

export type AdminFormDetailView = {
  publicId: string;
  name: string;
  slug: string;
  description: string | null;
  status: FormStatus;
  updatedAt: string;
  draftVersionNumber: number | null;
  publishedVersionNumber: number | null;
  versions: Array<{
    versionNumber: number;
    status: FormVersionStatus;
    createdAt: string;
    publishedAt: string | null;
  }>;
};

export type AdminFormDependencies = {
  store: FormManagementStore;
  now: () => Date;
  generatePublicId: () => string;
};

export function createAdminFormDependencies(): AdminFormDependencies {
  const databaseUrl = getRequiredDatabaseUrl();
  return {
    store: databaseUrl
      ? createFormManagementStore(createDatabase(databaseUrl))
      : missingStore(),
    now: () => new Date(),
    generatePublicId: () => `frm_${randomBytes(12).toString("base64url")}`,
  };
}

export async function listAdminForms(dependencies: AdminFormDependencies) {
  const forms = await dependencies.store.listForms();
  return forms.map((form) => ({
    publicId: form.publicId,
    name: form.name,
    slug: form.slug,
    status: form.status,
    publishedVersionNumber: form.publishedVersion?.versionNumber ?? null,
    draftVersionNumber: form.draftVersion?.versionNumber ?? null,
    updatedAt: form.updatedAt.toISOString(),
  })) satisfies AdminFormListItem[];
}

export async function getAdminForm(
  publicId: string,
  dependencies: AdminFormDependencies,
): Promise<AdminFormDetailView | null> {
  const detail = await dependencies.store.getForm(publicId);
  if (!detail) return null;
  return toDetailView(detail);
}

export async function createAdminForm(
  request: Request,
  session: AdminSession,
  dependencies: AdminFormDependencies,
) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  const data = await safeFormData(request);
  const parsed = createFormSchema.safeParse({
    name: data?.get("name"),
    slug: data?.get("slug"),
    description: optionalString(data?.get("description")),
  });
  if (!parsed.success) {
    return redirectForms(request, { error: "Enter a valid name and slug." });
  }
  const slug = normalizeSlug(parsed.data.slug);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return redirectForms(request, {
      error: "Slug may contain lowercase letters, numbers, and hyphens only.",
    });
  }
  const result = await dependencies.store.createForm({
    publicId: dependencies.generatePublicId(),
    name: parsed.data.name,
    slug,
    description: parsed.data.description,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  if (!result.ok) return failure(request, result.code);
  return Response.redirect(
    new URL(
      `/admin/forms/${encodeURIComponent(result.detail.form.publicId)}?success=Form+created.`,
      request.url,
    ),
    303,
  );
}

export async function publishAdminFormVersion(
  request: Request,
  publicId: string,
  versionNumber: number,
  session: AdminSession,
  dependencies: AdminFormDependencies,
) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  const result = await dependencies.store.publishFormVersion({
    publicId,
    versionNumber,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  if (!result.ok) return failure(request, result.code, publicId);
  return redirectDetail(request, publicId, { success: "Version published." });
}

export async function createAdminFormDraft(
  request: Request,
  publicId: string,
  session: AdminSession,
  dependencies: AdminFormDependencies,
) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  const result = await dependencies.store.createDraftVersion({
    publicId,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  if (!result.ok) return failure(request, result.code, publicId);
  return redirectDetail(request, publicId, { success: "New draft created." });
}

export async function archiveAdminForm(
  request: Request,
  publicId: string,
  session: AdminSession,
  dependencies: AdminFormDependencies,
) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  const result = await dependencies.store.archiveForm({
    publicId,
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  if (!result.ok) return failure(request, result.code, publicId);
  return redirectDetail(request, publicId, { success: "Form archived." });
}

function toDetailView(detail: ManagedFormDetail) {
  const draft = detail.versions.find((version) => version.status === "DRAFT");
  const published = detail.versions.find(
    (version) => version.status === "PUBLISHED",
  );
  return {
    publicId: detail.form.publicId,
    name: detail.form.name,
    slug: detail.form.slug,
    description: detail.form.description,
    status: detail.form.status,
    updatedAt: detail.form.updatedAt.toISOString(),
    draftVersionNumber: draft?.versionNumber ?? null,
    publishedVersionNumber: published?.versionNumber ?? null,
    versions: detail.versions.map((version) => ({
      versionNumber: version.versionNumber,
      status: version.status,
      createdAt: version.createdAt.toISOString(),
      publishedAt: version.publishedAt?.toISOString() ?? null,
    })),
  };
}

function normalizeSlug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function failure(
  request: Request,
  code: FormManagementErrorCode,
  publicId?: string,
) {
  if (code === "ACTOR_NOT_AUTHORIZED") {
    return Response.json(
      { error: { code: "FORBIDDEN", message: "Admin access is required." } },
      { status: 403 },
    );
  }
  const messages: Record<
    Exclude<FormManagementErrorCode, "ACTOR_NOT_AUTHORIZED">,
    string
  > = {
    DRAFT_ALREADY_EXISTS: "This form already has a draft.",
    DRAFT_NOT_FOUND: "Draft version could not be found.",
    FORM_ARCHIVED: "Archived forms cannot be changed.",
    FORM_NOT_FOUND: "Form could not be found.",
    NO_PUBLISHED_VERSION: "A published version is required.",
    SLUG_ALREADY_EXISTS: "A form with this slug already exists.",
  };
  return publicId
    ? redirectDetail(request, publicId, { error: messages[code] })
    : redirectForms(request, { error: messages[code] });
}

function redirectForms(request: Request, params: { error?: string }) {
  const url = new URL("/admin/forms", request.url);
  if (params.error) url.searchParams.set("error", params.error);
  return Response.redirect(url, 303);
}

function redirectDetail(
  request: Request,
  publicId: string,
  params: { success?: string; error?: string },
) {
  const url = new URL(
    `/admin/forms/${encodeURIComponent(publicId)}`,
    request.url,
  );
  if (params.success) url.searchParams.set("success", params.success);
  if (params.error) url.searchParams.set("error", params.error);
  return Response.redirect(url, 303);
}

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}

function forbiddenOrigin() {
  return Response.json(
    {
      error: {
        code: "INVALID_ORIGIN",
        message: "Request origin is not allowed.",
      },
    },
    { status: 403 },
  );
}

async function safeFormData(request: Request) {
  try {
    return await request.formData();
  } catch {
    return null;
  }
}

function optionalString(value: FormDataEntryValue | null | undefined) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function missingStore(): FormManagementStore {
  const missing = () => {
    throw new Error("DATABASE_URL is required for form management.");
  };
  return {
    createForm: missing,
    listForms: missing,
    getForm: missing,
    publishFormVersion: missing,
    createDraftVersion: missing,
    archiveForm: missing,
  };
}
