import { and, desc, eq } from "drizzle-orm";
import type { RequestType } from "@magictrust/domain";

import type { createDatabase } from "./index";
import type { AdminAuditEventType } from "./admin-user-management-store";
import { adminAuditEvents, adminUsers, forms, formVersions } from "./schema";

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type FormStatus = "ACTIVE" | "ARCHIVED";
export type FormVersionStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export const formRequestTypeModes = ["FIXED", "USER_SELECTED"] as const;
export type FormRequestTypeMode = (typeof formRequestTypeModes)[number];

export type FormRequestTypeConfiguration =
  | {
      requestTypeMode: "FIXED";
      fixedRequestType: RequestType;
      allowedRequestTypes: [];
    }
  | {
      requestTypeMode: "USER_SELECTED";
      fixedRequestType: null;
      allowedRequestTypes: RequestType[];
    };

export type ManagedForm = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  description: string | null;
  requestTypeMode: FormRequestTypeMode;
  fixedRequestType: RequestType | null;
  allowedRequestTypes: RequestType[];
  status: FormStatus;
  createdAt: Date;
  updatedAt: Date;
  createdByAdminUserId: string;
};

export type ManagedFormVersion = {
  id: string;
  formId: string;
  versionNumber: number;
  status: FormVersionStatus;
  html: string;
  css: string;
  javascript: string;
  createdAt: Date;
  updatedAt: Date;
  createdByAdminUserId: string;
  publishedAt: Date | null;
  publishedByAdminUserId: string | null;
};

export type ManagedFormSummary = ManagedForm & {
  draftVersion: Pick<ManagedFormVersion, "id" | "versionNumber"> | null;
  publishedVersion: Pick<ManagedFormVersion, "id" | "versionNumber"> | null;
};

export type ManagedFormDetail = {
  form: ManagedForm;
  versions: ManagedFormVersion[];
};

export type PublishedFormRuntime = {
  html: string;
  css: string;
  javascript: string;
};

export type PublishedFormSubmissionTarget = {
  publicId: string;
  slug: string;
  requestTypeMode: FormRequestTypeMode;
  fixedRequestType: RequestType | null;
  allowedRequestTypes: RequestType[];
  versionNumber: number;
};

export type FormManagementErrorCode =
  | "ACTOR_NOT_AUTHORIZED"
  | "DRAFT_ALREADY_EXISTS"
  | "DRAFT_NOT_FOUND"
  | "DRAFT_STALE"
  | "FORM_ARCHIVED"
  | "FORM_NOT_FOUND"
  | "NO_PUBLISHED_VERSION"
  | "SLUG_ALREADY_EXISTS";

export type FormMutationResult =
  | { ok: true; detail: ManagedFormDetail; changed: boolean }
  | { ok: false; code: FormManagementErrorCode };

export type FormManagementStore = {
  createForm(
    input: {
      publicId: string;
      name: string;
      slug: string;
      description?: string;
      actorAdminUserId: string;
      now: Date;
    } & FormRequestTypeConfiguration,
  ): Promise<FormMutationResult>;
  listForms(): Promise<ManagedFormSummary[]>;
  getForm(publicId: string): Promise<ManagedFormDetail | null>;
  getPublishedFormBySlug(slug: string): Promise<PublishedFormRuntime | null>;
  getPublishedFormSubmissionTargetBySlug(
    slug: string,
  ): Promise<PublishedFormSubmissionTarget | null>;
  updateDraftVersion(input: {
    publicId: string;
    versionNumber: number;
    html: string;
    css: string;
    javascript: string;
    expectedUpdatedAt: Date;
    actorAdminUserId: string;
    now: Date;
  }): Promise<FormMutationResult>;
  publishFormVersion(input: {
    publicId: string;
    versionNumber: number;
    actorAdminUserId: string;
    now: Date;
  }): Promise<FormMutationResult>;
  createDraftVersion(input: {
    publicId: string;
    actorAdminUserId: string;
    now: Date;
  }): Promise<FormMutationResult>;
  archiveForm(input: {
    publicId: string;
    actorAdminUserId: string;
    now: Date;
  }): Promise<FormMutationResult>;
};

export function createFormManagementStore(db: Database): FormManagementStore {
  return {
    async createForm(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }

        const [form] = await tx
          .insert(forms)
          .values({
            publicId: input.publicId,
            name: input.name,
            slug: input.slug,
            description: input.description,
            requestTypeMode: input.requestTypeMode,
            fixedRequestType: input.fixedRequestType,
            allowedRequestTypes: input.allowedRequestTypes,
            createdAt: input.now,
            updatedAt: input.now,
            createdByAdminUserId: input.actorAdminUserId,
          })
          .onConflictDoNothing({ target: forms.slug })
          .returning(formSelection);

        if (!form) return { ok: false, code: "SLUG_ALREADY_EXISTS" };

        const [version] = await tx
          .insert(formVersions)
          .values({
            formId: form.id,
            versionNumber: 1,
            status: "DRAFT",
            html: "<form>\n  <!-- Form content -->\n</form>",
            css: "",
            javascript: "",
            createdAt: input.now,
            updatedAt: input.now,
            createdByAdminUserId: input.actorAdminUserId,
          })
          .returning(formVersionSelection);

        await audit(
          tx,
          "FORM_CREATED",
          form.id,
          input.actorAdminUserId,
          {
            formId: form.id,
          },
          input.now,
        );
        await audit(
          tx,
          "FORM_VERSION_CREATED",
          form.id,
          input.actorAdminUserId,
          { formId: form.id, versionId: version.id, versionNumber: 1 },
          input.now,
        );

        return {
          ok: true,
          detail: { form, versions: [version] },
          changed: true,
        };
      });
    },
    async listForms() {
      const rows = await db
        .select({ form: formSelection, version: formVersionSelection })
        .from(forms)
        .leftJoin(formVersions, eq(formVersions.formId, forms.id))
        .orderBy(desc(forms.updatedAt), desc(forms.id));
      const byId = new Map<string, ManagedFormSummary>();

      for (const row of rows) {
        const summary = byId.get(row.form.id) ?? {
          ...row.form,
          draftVersion: null,
          publishedVersion: null,
        };
        if (row.version?.status === "DRAFT") {
          summary.draftVersion = pickVersion(row.version);
        } else if (row.version?.status === "PUBLISHED") {
          summary.publishedVersion = pickVersion(row.version);
        }
        byId.set(row.form.id, summary);
      }

      return [...byId.values()];
    },
    async getForm(publicId) {
      return getFormDetail(db, publicId);
    },
    async getPublishedFormBySlug(slug) {
      const [runtime] = await db
        .select({
          html: formVersions.html,
          css: formVersions.css,
          javascript: formVersions.javascript,
        })
        .from(forms)
        .innerJoin(
          formVersions,
          and(
            eq(formVersions.formId, forms.id),
            eq(formVersions.status, "PUBLISHED"),
          ),
        )
        .where(and(eq(forms.slug, slug), eq(forms.status, "ACTIVE")))
        .limit(1);
      return runtime ?? null;
    },
    async getPublishedFormSubmissionTargetBySlug(slug) {
      const [target] = await db
        .select({
          publicId: forms.publicId,
          slug: forms.slug,
          requestTypeMode: forms.requestTypeMode,
          fixedRequestType: forms.fixedRequestType,
          allowedRequestTypes: forms.allowedRequestTypes,
          versionNumber: formVersions.versionNumber,
        })
        .from(forms)
        .innerJoin(
          formVersions,
          and(
            eq(formVersions.formId, forms.id),
            eq(formVersions.status, "PUBLISHED"),
          ),
        )
        .where(and(eq(forms.slug, slug), eq(forms.status, "ACTIVE")))
        .limit(1);
      return target ?? null;
    },
    async updateDraftVersion(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }
        const form = await lockForm(tx, input.publicId);
        if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
        if (form.status !== "ACTIVE") {
          return { ok: false, code: "FORM_ARCHIVED" };
        }
        const versions = await lockVersions(tx, form.id);
        const draft = versions.find(
          (version) =>
            version.versionNumber === input.versionNumber &&
            version.status === "DRAFT",
        );
        if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND" };
        if (draft.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
          return { ok: false, code: "DRAFT_STALE" };
        }

        await tx
          .update(formVersions)
          .set({
            html: input.html,
            css: input.css,
            javascript: input.javascript,
            updatedAt: input.now,
          })
          .where(eq(formVersions.id, draft.id));
        await tx
          .update(forms)
          .set({ updatedAt: input.now })
          .where(eq(forms.id, form.id));
        await audit(
          tx,
          "FORM_VERSION_UPDATED",
          form.id,
          input.actorAdminUserId,
          {
            formId: form.id,
            versionId: draft.id,
            versionNumber: draft.versionNumber,
          },
          input.now,
        );

        return {
          ok: true,
          detail: (await getFormDetail(tx, input.publicId))!,
          changed: true,
        };
      });
    },
    async publishFormVersion(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }
        const form = await lockForm(tx, input.publicId);
        if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
        if (form.status !== "ACTIVE")
          return { ok: false, code: "FORM_ARCHIVED" };

        const versions = await lockVersions(tx, form.id);
        const draft = versions.find(
          (version) =>
            version.versionNumber === input.versionNumber &&
            version.status === "DRAFT",
        );
        if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND" };

        const published = versions.find(
          (version) => version.status === "PUBLISHED",
        );
        if (published) {
          await tx
            .update(formVersions)
            .set({ status: "ARCHIVED", updatedAt: input.now })
            .where(eq(formVersions.id, published.id));
        }
        await tx
          .update(formVersions)
          .set({
            status: "PUBLISHED",
            publishedAt: input.now,
            publishedByAdminUserId: input.actorAdminUserId,
            updatedAt: input.now,
          })
          .where(eq(formVersions.id, draft.id));
        await tx
          .update(forms)
          .set({ updatedAt: input.now })
          .where(eq(forms.id, form.id));
        await audit(
          tx,
          "FORM_VERSION_PUBLISHED",
          form.id,
          input.actorAdminUserId,
          {
            formId: form.id,
            versionId: draft.id,
            versionNumber: draft.versionNumber,
          },
          input.now,
        );

        return {
          ok: true,
          detail: (await getFormDetail(tx, input.publicId))!,
          changed: true,
        };
      });
    },
    async createDraftVersion(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }
        const form = await lockForm(tx, input.publicId);
        if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
        if (form.status !== "ACTIVE")
          return { ok: false, code: "FORM_ARCHIVED" };

        const versions = await lockVersions(tx, form.id);
        if (versions.some((version) => version.status === "DRAFT")) {
          return { ok: false, code: "DRAFT_ALREADY_EXISTS" };
        }
        const published = versions.find(
          (version) => version.status === "PUBLISHED",
        );
        if (!published) return { ok: false, code: "NO_PUBLISHED_VERSION" };
        const versionNumber =
          Math.max(...versions.map((version) => version.versionNumber)) + 1;
        const [draft] = await tx
          .insert(formVersions)
          .values({
            formId: form.id,
            versionNumber,
            status: "DRAFT",
            html: published.html,
            css: published.css,
            javascript: published.javascript,
            createdAt: input.now,
            updatedAt: input.now,
            createdByAdminUserId: input.actorAdminUserId,
          })
          .returning(formVersionSelection);
        await tx
          .update(forms)
          .set({ updatedAt: input.now })
          .where(eq(forms.id, form.id));
        await audit(
          tx,
          "FORM_VERSION_CREATED",
          form.id,
          input.actorAdminUserId,
          { formId: form.id, versionId: draft.id, versionNumber },
          input.now,
        );

        return {
          ok: true,
          detail: (await getFormDetail(tx, input.publicId))!,
          changed: true,
        };
      });
    },
    async archiveForm(input) {
      return db.transaction(async (tx) => {
        if (!(await isActiveAdmin(tx, input.actorAdminUserId))) {
          return { ok: false, code: "ACTOR_NOT_AUTHORIZED" };
        }
        const form = await lockForm(tx, input.publicId);
        if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
        if (form.status === "ARCHIVED") {
          return {
            ok: true,
            detail: (await getFormDetail(tx, input.publicId))!,
            changed: false,
          };
        }
        await tx
          .update(forms)
          .set({ status: "ARCHIVED", updatedAt: input.now })
          .where(eq(forms.id, form.id));
        await audit(
          tx,
          "FORM_ARCHIVED",
          form.id,
          input.actorAdminUserId,
          {
            formId: form.id,
          },
          input.now,
        );
        return {
          ok: true,
          detail: (await getFormDetail(tx, input.publicId))!,
          changed: true,
        };
      });
    },
  };
}

async function isActiveAdmin(tx: Transaction, id: string): Promise<boolean> {
  const [actor] = await tx
    .select({ id: adminUsers.id })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.id, id),
        eq(adminUsers.role, "ADMIN"),
        eq(adminUsers.active, true),
      ),
    )
    .limit(1)
    .for("update");
  return Boolean(actor);
}

async function lockForm(tx: Transaction, publicId: string) {
  const [form] = await tx
    .select(formSelection)
    .from(forms)
    .where(eq(forms.publicId, publicId))
    .limit(1)
    .for("update");
  return form ?? null;
}

async function lockVersions(tx: Transaction, formId: string) {
  return tx
    .select(formVersionSelection)
    .from(formVersions)
    .where(eq(formVersions.formId, formId))
    .orderBy(desc(formVersions.versionNumber))
    .for("update");
}

async function getFormDetail(db: Database | Transaction, publicId: string) {
  const [form] = await db
    .select(formSelection)
    .from(forms)
    .where(eq(forms.publicId, publicId))
    .limit(1);
  if (!form) return null;
  const versions = await db
    .select(formVersionSelection)
    .from(formVersions)
    .where(eq(formVersions.formId, form.id))
    .orderBy(desc(formVersions.versionNumber));
  return { form, versions };
}

async function audit(
  tx: Transaction,
  type: AdminAuditEventType,
  formId: string,
  actorAdminUserId: string,
  data: Record<string, string | number>,
  createdAt: Date,
) {
  await tx.insert(adminAuditEvents).values({
    type,
    targetAdminUserId: null,
    formId,
    actorAdminUserId,
    data,
    createdAt,
  });
}

function pickVersion(version: ManagedFormVersion) {
  return { id: version.id, versionNumber: version.versionNumber };
}

const formSelection = {
  id: forms.id,
  publicId: forms.publicId,
  name: forms.name,
  slug: forms.slug,
  description: forms.description,
  requestTypeMode: forms.requestTypeMode,
  fixedRequestType: forms.fixedRequestType,
  allowedRequestTypes: forms.allowedRequestTypes,
  status: forms.status,
  createdAt: forms.createdAt,
  updatedAt: forms.updatedAt,
  createdByAdminUserId: forms.createdByAdminUserId,
};

const formVersionSelection = {
  id: formVersions.id,
  formId: formVersions.formId,
  versionNumber: formVersions.versionNumber,
  status: formVersions.status,
  html: formVersions.html,
  css: formVersions.css,
  javascript: formVersions.javascript,
  createdAt: formVersions.createdAt,
  updatedAt: formVersions.updatedAt,
  createdByAdminUserId: formVersions.createdByAdminUserId,
  publishedAt: formVersions.publishedAt,
  publishedByAdminUserId: formVersions.publishedByAdminUserId,
};
