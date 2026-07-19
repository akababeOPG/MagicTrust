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
import { getAppBaseUrl, getRequiredDatabaseUrl } from "@magictrust/config";
import { requestTypes } from "@magictrust/domain";
import type { RequestType } from "@magictrust/domain";
import { z } from "zod";

import type { AdminSession } from "./admin-auth";

const createFormSchema = z.object({
  name: z.string().trim().min(1).max(160),
  slug: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  requestType: z.enum(requestTypes),
});

const saveDraftSchema = z.object({
  html: z.string(),
  css: z.string(),
  javascript: z.string(),
  expectedUpdatedAt: z.string().datetime(),
});

export const formSourceLimits = {
  html: 250 * 1024,
  css: 250 * 1024,
  javascript: 250 * 1024,
} as const;

export type AdminFormListItem = {
  publicId: string;
  name: string;
  slug: string;
  requestType: RequestType;
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
  requestType: RequestType;
  status: FormStatus;
  updatedAt: string;
  draftVersionNumber: number | null;
  publishedVersionNumber: number | null;
  embedSnippet: string | null;
  versions: Array<{
    versionNumber: number;
    status: FormVersionStatus;
    createdAt: string;
    publishedAt: string | null;
  }>;
};

export type AdminFormDraftEditorView = {
  publicId: string;
  formName: string;
  versionNumber: number;
  html: string;
  css: string;
  javascript: string;
  updatedAt: string;
};

export type AdminFormDependencies = {
  store: FormManagementStore;
  now: () => Date;
  generatePublicId: () => string;
  appBaseUrl: string;
};

export function createAdminFormDependencies(): AdminFormDependencies {
  const databaseUrl = getRequiredDatabaseUrl();
  return {
    store: databaseUrl
      ? createFormManagementStore(createDatabase(databaseUrl))
      : missingStore(),
    now: () => new Date(),
    generatePublicId: () => `frm_${randomBytes(12).toString("base64url")}`,
    appBaseUrl: getAppBaseUrl(),
  };
}

export async function listAdminForms(dependencies: AdminFormDependencies) {
  const forms = await dependencies.store.listForms();
  return forms.map((form) => ({
    publicId: form.publicId,
    name: form.name,
    slug: form.slug,
    requestType: form.requestType,
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
  return toDetailView(detail, dependencies.appBaseUrl);
}

export async function getAdminFormDraftEditor(
  publicId: string,
  versionNumber: number,
  dependencies: AdminFormDependencies,
): Promise<AdminFormDraftEditorView | null> {
  const detail = await dependencies.store.getForm(publicId);
  if (!detail || detail.form.status !== "ACTIVE") return null;
  const draft = detail.versions.find(
    (version) =>
      version.versionNumber === versionNumber && version.status === "DRAFT",
  );
  if (!draft) return null;
  return {
    publicId: detail.form.publicId,
    formName: detail.form.name,
    versionNumber: draft.versionNumber,
    html: draft.html,
    css: draft.css,
    javascript: draft.javascript,
    updatedAt: draft.updatedAt.toISOString(),
  };
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
    requestType: data?.get("requestType"),
  });
  if (!parsed.success) {
    return redirectForms(request, {
      error: "Enter a valid name, slug, and request type.",
    });
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
    requestType: parsed.data.requestType,
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

export async function saveAdminFormDraft(
  request: Request,
  publicId: string,
  versionNumber: number,
  session: AdminSession,
  dependencies: AdminFormDependencies,
) {
  if (!sameOrigin(request)) return forbiddenOrigin();
  const data = await safeFormData(request);
  const parsed = saveDraftSchema.safeParse({
    html: data?.get("html"),
    css: data?.get("css"),
    javascript: data?.get("javascript"),
    expectedUpdatedAt: data?.get("expectedUpdatedAt"),
  });
  if (!parsed.success) {
    return redirectEditor(request, publicId, versionNumber, {
      error: "Draft source is invalid.",
    });
  }
  const oversized = sourceSizeError(parsed.data);
  if (oversized) {
    return redirectEditor(request, publicId, versionNumber, {
      error: oversized,
    });
  }
  const result = await dependencies.store.updateDraftVersion({
    publicId,
    versionNumber,
    html: parsed.data.html,
    css: parsed.data.css,
    javascript: parsed.data.javascript,
    expectedUpdatedAt: new Date(parsed.data.expectedUpdatedAt),
    actorAdminUserId: session.adminUserId,
    now: dependencies.now(),
  });
  if (!result.ok) {
    if (result.code === "DRAFT_STALE") {
      return redirectEditor(request, publicId, versionNumber, {
        error:
          "This draft was updated elsewhere. Reload the page before saving your changes.",
      });
    }
    return failure(request, result.code, publicId);
  }
  return redirectEditor(request, publicId, versionNumber, {
    success: "Draft saved.",
  });
}

function toDetailView(detail: ManagedFormDetail, appBaseUrl: string) {
  const draft = detail.versions.find((version) => version.status === "DRAFT");
  const published = detail.versions.find(
    (version) => version.status === "PUBLISHED",
  );
  return {
    publicId: detail.form.publicId,
    name: detail.form.name,
    slug: detail.form.slug,
    description: detail.form.description,
    requestType: detail.form.requestType,
    status: detail.form.status,
    updatedAt: detail.form.updatedAt.toISOString(),
    draftVersionNumber: draft?.versionNumber ?? null,
    publishedVersionNumber: published?.versionNumber ?? null,
    embedSnippet:
      detail.form.status === "ACTIVE" && published
        ? buildFormEmbedSnippet(detail.form.slug, appBaseUrl)
        : null,
    versions: detail.versions.map((version) => ({
      versionNumber: version.versionNumber,
      status: version.status,
      createdAt: version.createdAt.toISOString(),
      publishedAt: version.publishedAt?.toISOString() ?? null,
    })),
  };
}

export function buildFormEmbedSnippet(slug: string, appBaseUrl: string) {
  const origin = new URL(appBaseUrl).origin;
  return `<div data-magictrust-form="${slug}"></div>\n<script src="${origin}/embed.js" async></script>`;
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
    DRAFT_STALE:
      "This draft was updated elsewhere. Reload the page before saving your changes.",
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

function redirectEditor(
  request: Request,
  publicId: string,
  versionNumber: number,
  params: { success?: string; error?: string },
) {
  const url = new URL(
    `/admin/forms/${encodeURIComponent(publicId)}/versions/${versionNumber}/edit`,
    request.url,
  );
  if (params.success) url.searchParams.set("success", params.success);
  if (params.error) url.searchParams.set("error", params.error);
  return Response.redirect(url, 303);
}

function sourceSizeError(input: {
  html: string;
  css: string;
  javascript: string;
}) {
  const fields = [
    ["HTML", input.html, formSourceLimits.html],
    ["CSS", input.css, formSourceLimits.css],
    ["JavaScript", input.javascript, formSourceLimits.javascript],
  ] as const;
  const oversized = fields.find(
    ([, value, limit]) => Buffer.byteLength(value, "utf8") > limit,
  );
  return oversized ? `${oversized[0]} source must be 250 KB or less.` : null;
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
    getPublishedFormBySlug: missing,
    getPublishedFormSubmissionTargetBySlug: missing,
    updateDraftVersion: missing,
    publishFormVersion: missing,
    createDraftVersion: missing,
    archiveForm: missing,
  };
}
