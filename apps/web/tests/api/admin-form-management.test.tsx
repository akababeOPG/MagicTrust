import type {
  FormManagementStore,
  ManagedForm,
  ManagedFormDetail,
  ManagedFormVersion,
} from "@magictrust/database";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AdminFormDetail, AdminFormsList } from "../../lib/admin-form-view";
import {
  archiveAdminForm,
  createAdminForm,
  createAdminFormDraft,
  getAdminForm,
  listAdminForms,
  publishAdminFormVersion,
} from "../../lib/admin-form-management";

describe("form management foundation", () => {
  test("ADMIN creates a form and draft v1 transactionally", async () => {
    const dependencies = createDependencies();
    const response = await createAdminForm(
      formRequest("/admin/forms/create", {
        name: "Privacy Request",
        slug: " Privacy_Request ",
        description: "Consumer privacy intake.",
      }),
      session("ADMIN"),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.forms[0]).toMatchObject({
      name: "Privacy Request",
      slug: "privacy-request",
      status: "ACTIVE",
    });
    expect(dependencies.state.versions[0]).toMatchObject({
      versionNumber: 1,
      status: "DRAFT",
      html: "<form>\n  <!-- Form content -->\n</form>",
      css: "",
      javascript: "",
    });
    expect(dependencies.state.audits.map((event) => event.type)).toEqual([
      "FORM_CREATED",
      "FORM_VERSION_CREATED",
    ]);
    expect(JSON.stringify(dependencies.state.audits)).not.toContain("<form>");
  });

  test("duplicate normalized slug is rejected", async () => {
    const dependencies = createDependencies();
    await createForm(dependencies, "Privacy Request", "privacy-request");

    const response = await createAdminForm(
      formRequest("/admin/forms/create", {
        name: "Duplicate",
        slug: "PRIVACY REQUEST",
      }),
      session("ADMIN"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain(
      "form+with+this+slug+already+exists",
    );
    expect(dependencies.state.forms).toHaveLength(1);
  });

  test("publishes v1, copies it to v2, then archives v1 when v2 publishes", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Contact Us", "contact-us");
    const v1 = dependencies.state.versions[0]!;
    v1.html = "<form><button>Send</button></form>";
    v1.css = "button { color: red; }";
    v1.javascript = "window.__FORM_CODE_EXECUTED__ = true;";
    const originalV1 = structuredClone(v1);

    await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/1/publish`, {}),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );
    expect(v1.status).toBe("PUBLISHED");
    expect(
      dependencies.state.versions.filter((v) => v.status === "PUBLISHED"),
    ).toHaveLength(1);
    expect(
      dependencies.state.versions.filter((v) => v.status === "DRAFT"),
    ).toHaveLength(0);

    await createAdminFormDraft(
      formRequest(`/admin/forms/${form.publicId}/versions/new`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );
    const v2 = dependencies.state.versions.find((v) => v.versionNumber === 2)!;
    expect(v2).toMatchObject({
      status: "DRAFT",
      html: originalV1.html,
      css: originalV1.css,
      javascript: originalV1.javascript,
    });
    expect(
      dependencies.state.versions.filter((v) => v.status === "DRAFT"),
    ).toHaveLength(1);

    await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/2/publish`, {}),
      form.publicId,
      2,
      session("ADMIN"),
      dependencies,
    );
    expect(v1).toMatchObject({
      status: "ARCHIVED",
      html: originalV1.html,
      css: originalV1.css,
      javascript: originalV1.javascript,
    });
    expect(v2.status).toBe("PUBLISHED");
    expect(
      dependencies.state.versions.filter((v) => v.status === "PUBLISHED"),
    ).toHaveLength(1);
    expect(dependencies.state.audits.map((event) => event.type)).toEqual([
      "FORM_CREATED",
      "FORM_VERSION_CREATED",
      "FORM_VERSION_PUBLISHED",
      "FORM_VERSION_CREATED",
      "FORM_VERSION_PUBLISHED",
    ]);
  });

  test("only one draft can exist", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");

    const response = await createAdminFormDraft(
      formRequest(`/admin/forms/${form.publicId}/versions/new`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain("already+has+a+draft");
    expect(dependencies.state.versions).toHaveLength(1);
  });

  test("ADMIN archives a form and archived forms cannot publish", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");

    await archiveAdminForm(
      formRequest(`/admin/forms/${form.publicId}/archive`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );
    const publish = await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/1/publish`, {}),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );

    expect(form.status).toBe("ARCHIVED");
    expect(publish.headers.get("location")).toContain(
      "Archived+forms+cannot+be+changed",
    );
    expect(dependencies.state.versions[0]?.status).toBe("DRAFT");
    expect(dependencies.state.audits.at(-1)?.type).toBe("FORM_ARCHIVED");
  });

  test("admin views never render stored source or execute JavaScript", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Dangerous", "dangerous");
    dependencies.state.versions[0]!.javascript =
      "window.__FORM_CODE_EXECUTED__ = true;";
    dependencies.state.versions[0]!.html =
      "<script>window.__HTML_EXECUTED__ = true</script>";

    const list = await listAdminForms(dependencies);
    const detail = await getAdminForm(form.publicId, dependencies);
    const listHtml = renderToStaticMarkup(
      <AdminFormsList role="ADMIN" forms={list} />,
    );
    const detailHtml = renderToStaticMarkup(
      <AdminFormDetail role="ADMIN" form={detail!} />,
    );

    expect(listHtml + detailHtml).not.toContain("__FORM_CODE_EXECUTED__");
    expect(listHtml + detailHtml).not.toContain("__HTML_EXECUTED__");
    expect(detail).not.toHaveProperty("html");
    expect(detail?.versions[0]).not.toHaveProperty("javascript");
  });

  test("OPERATOR receives read-only UI", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");
    const list = await listAdminForms(dependencies);
    const detail = await getAdminForm(form.publicId, dependencies);
    const html = renderToStaticMarkup(
      <>
        <AdminFormsList role="OPERATOR" forms={list} />
        <AdminFormDetail role="OPERATOR" form={detail!} />
      </>,
    );

    expect(html).not.toContain("Create form");
    expect(html).not.toContain("Publish draft");
    expect(html).not.toContain("Archive form");
    expect(html).toContain("read-only for your role");
  });
});

type State = {
  forms: ManagedForm[];
  versions: ManagedFormVersion[];
  audits: Array<{ type: string; formId: string; versionNumber?: number }>;
  nextId: number;
  now: Date;
};

function createDependencies() {
  const state: State = {
    forms: [],
    versions: [],
    audits: [],
    nextId: 1,
    now: new Date("2026-07-18T12:00:00.000Z"),
  };
  return {
    state,
    now: () => state.now,
    generatePublicId: () => `frm_${state.nextId}`,
    store: createMemoryStore(state),
  };
}

async function createForm(
  dependencies: ReturnType<typeof createDependencies>,
  name: string,
  slug: string,
) {
  await createAdminForm(
    formRequest("/admin/forms/create", { name, slug }),
    session("ADMIN"),
    dependencies,
  );
  return dependencies.state.forms.at(-1)!;
}

function createMemoryStore(state: State): FormManagementStore {
  const detail = (form: ManagedForm): ManagedFormDetail => ({
    form,
    versions: state.versions
      .filter((v) => v.formId === form.id)
      .sort((a, b) => b.versionNumber - a.versionNumber),
  });
  return {
    async createForm(input) {
      if (state.forms.some((form) => form.slug === input.slug))
        return { ok: false, code: "SLUG_ALREADY_EXISTS" };
      const form: ManagedForm = {
        id: `form-${state.nextId++}`,
        publicId: input.publicId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        status: "ACTIVE",
        createdAt: input.now,
        updatedAt: input.now,
        createdByAdminUserId: input.actorAdminUserId,
      };
      const version: ManagedFormVersion = {
        id: `version-${state.nextId++}`,
        formId: form.id,
        versionNumber: 1,
        status: "DRAFT",
        html: "<form>\n  <!-- Form content -->\n</form>",
        css: "",
        javascript: "",
        createdAt: input.now,
        createdByAdminUserId: input.actorAdminUserId,
        publishedAt: null,
        publishedByAdminUserId: null,
      };
      state.forms.push(form);
      state.versions.push(version);
      state.audits.push(
        { type: "FORM_CREATED", formId: form.id },
        { type: "FORM_VERSION_CREATED", formId: form.id, versionNumber: 1 },
      );
      return { ok: true, detail: detail(form), changed: true };
    },
    async listForms() {
      return state.forms.map((form) => ({
        ...form,
        draftVersion:
          state.versions.find(
            (v) => v.formId === form.id && v.status === "DRAFT",
          ) ?? null,
        publishedVersion:
          state.versions.find(
            (v) => v.formId === form.id && v.status === "PUBLISHED",
          ) ?? null,
      }));
    },
    async getForm(publicId) {
      const form = state.forms.find((item) => item.publicId === publicId);
      return form ? detail(form) : null;
    },
    async publishFormVersion(input) {
      const form = state.forms.find((item) => item.publicId === input.publicId);
      if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
      if (form.status === "ARCHIVED")
        return { ok: false, code: "FORM_ARCHIVED" };
      const draft = state.versions.find(
        (v) =>
          v.formId === form.id &&
          v.versionNumber === input.versionNumber &&
          v.status === "DRAFT",
      );
      if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND" };
      const published = state.versions.find(
        (v) => v.formId === form.id && v.status === "PUBLISHED",
      );
      if (published) published.status = "ARCHIVED";
      draft.status = "PUBLISHED";
      draft.publishedAt = input.now;
      draft.publishedByAdminUserId = input.actorAdminUserId;
      state.audits.push({
        type: "FORM_VERSION_PUBLISHED",
        formId: form.id,
        versionNumber: draft.versionNumber,
      });
      return { ok: true, detail: detail(form), changed: true };
    },
    async createDraftVersion(input) {
      const form = state.forms.find((item) => item.publicId === input.publicId);
      if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
      if (form.status === "ARCHIVED")
        return { ok: false, code: "FORM_ARCHIVED" };
      if (
        state.versions.some((v) => v.formId === form.id && v.status === "DRAFT")
      )
        return { ok: false, code: "DRAFT_ALREADY_EXISTS" };
      const published = state.versions.find(
        (v) => v.formId === form.id && v.status === "PUBLISHED",
      );
      if (!published) return { ok: false, code: "NO_PUBLISHED_VERSION" };
      const versionNumber =
        Math.max(
          ...state.versions
            .filter((v) => v.formId === form.id)
            .map((v) => v.versionNumber),
        ) + 1;
      const draft = {
        ...published,
        id: `version-${state.nextId++}`,
        versionNumber,
        status: "DRAFT" as const,
        createdAt: input.now,
        createdByAdminUserId: input.actorAdminUserId,
        publishedAt: null,
        publishedByAdminUserId: null,
      };
      state.versions.push(draft);
      state.audits.push({
        type: "FORM_VERSION_CREATED",
        formId: form.id,
        versionNumber,
      });
      return { ok: true, detail: detail(form), changed: true };
    },
    async archiveForm(input) {
      const form = state.forms.find((item) => item.publicId === input.publicId);
      if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
      form.status = "ARCHIVED";
      state.audits.push({ type: "FORM_ARCHIVED", formId: form.id });
      return { ok: true, detail: detail(form), changed: true };
    },
  };
}

function session(role: "ADMIN" | "OPERATOR") {
  return { adminUserId: "admin-1", role, sessionId: "session-1" };
}
function formRequest(path: string, values: Record<string, string>) {
  return new Request(`https://magictrust.test${path}`, {
    method: "POST",
    headers: {
      origin: "https://magictrust.test",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values),
  });
}
