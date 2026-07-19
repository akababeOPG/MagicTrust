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
  AdminFormEditor,
  buildSandboxedPreviewDocument,
} from "../../lib/admin-form-editor";
import {
  archiveAdminForm,
  createAdminForm,
  createAdminFormDraft,
  getAdminForm,
  getAdminFormDraftEditor,
  listAdminForms,
  publishAdminFormVersion,
  saveAdminFormDraft,
} from "../../lib/admin-form-management";
import { getPublicFormRuntime } from "../../lib/public-form-rendering";

describe("form management foundation", () => {
  test("ADMIN creates a form and draft v1 transactionally", async () => {
    const dependencies = createDependencies();
    const response = await createAdminForm(
      formRequest("/admin/forms/create", {
        name: "Privacy Request",
        slug: " Privacy_Request ",
        description: "Consumer privacy intake.",
        requestType: "DATA_ACCESS",
      }),
      session("ADMIN"),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(dependencies.state.forms[0]).toMatchObject({
      name: "Privacy Request",
      slug: "privacy-request",
      requestType: "DATA_ACCESS",
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
        requestType: "GENERAL_INQUIRY",
      }),
      session("ADMIN"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain(
      "form+with+this+slug+already+exists",
    );
    expect(dependencies.state.forms).toHaveLength(1);
  });

  test("form creation requires a request type and presents it naturally", async () => {
    const dependencies = createDependencies();
    const rejected = await createAdminForm(
      formRequest("/admin/forms/create", {
        name: "Missing type",
        slug: "missing-type",
      }),
      session("ADMIN"),
      dependencies,
    );

    expect(rejected.headers.get("location")).toContain(
      "valid+name%2C+slug%2C+and+request+type",
    );
    expect(dependencies.state.forms).toHaveLength(0);

    const form = await createForm(
      dependencies,
      "Deletion request",
      "deletion-request",
      "DATA_DELETION",
    );
    const list = await listAdminForms(dependencies);
    const detail = await getAdminForm(form.publicId, dependencies);
    const html = renderToStaticMarkup(
      <>
        <AdminFormsList role="ADMIN" forms={list} />
        <AdminFormDetail role="OPERATOR" form={detail!} />
      </>,
    );

    expect(form.requestType).toBe("DATA_DELETION");
    expect(html).toContain("Data deletion");
    expect(html).not.toContain(">DATA_DELETION<");
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

  test("public rendering resolves only the active form's current published version", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Contact Us", "contact-us");
    const v1 = dependencies.state.versions[0]!;
    v1.html = "<main>Published v1</main>";
    v1.css = "main { color: blue; }";
    v1.javascript = "window.__publishedVersion = 1;";

    expect(await getPublicFormRuntime("contact-us", dependencies)).toBeNull();
    expect(await getPublicFormRuntime("unknown", dependencies)).toBeNull();

    await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/1/publish`, {}),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );
    const v1Snippet = (await getAdminForm(form.publicId, dependencies))
      ?.embedSnippet;
    expect(await getPublicFormRuntime("contact-us", dependencies)).toEqual({
      html: "<main>Published v1</main>",
      css: "main { color: blue; }",
      javascript: "window.__publishedVersion = 1;",
    });

    await createAdminFormDraft(
      formRequest(`/admin/forms/${form.publicId}/versions/new`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );
    const v2 = dependencies.state.versions.find(
      (version) => version.versionNumber === 2,
    )!;
    v2.html = "<main>Draft v2 must stay private</main>";
    v2.css = "main { color: red; }";
    v2.javascript = "window.__draftVersion = 2;";
    expect(
      JSON.stringify(await getPublicFormRuntime("contact-us", dependencies)),
    ).not.toContain("Draft v2");
    expect((await getPublicFormRuntime("contact-us", dependencies))?.html).toBe(
      "<main>Published v1</main>",
    );

    await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/2/publish`, {}),
      form.publicId,
      2,
      session("ADMIN"),
      dependencies,
    );
    expect(v1.status).toBe("ARCHIVED");
    expect(await getPublicFormRuntime("contact-us", dependencies)).toEqual({
      html: "<main>Draft v2 must stay private</main>",
      css: "main { color: red; }",
      javascript: "window.__draftVersion = 2;",
    });
    expect(
      (await getAdminForm(form.publicId, dependencies))?.embedSnippet,
    ).toBe(v1Snippet);

    await archiveAdminForm(
      formRequest(`/admin/forms/${form.publicId}/archive`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );
    expect(await getPublicFormRuntime("contact-us", dependencies)).toBeNull();
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

  test("admin detail links to the public form only while a version is published", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Contact Us", "contact-us");
    const beforePublish = await getAdminForm(form.publicId, dependencies);
    expect(
      renderToStaticMarkup(
        <AdminFormDetail role="ADMIN" form={beforePublish!} />,
      ),
    ).not.toContain("Open public form");

    await publishAdminFormVersion(
      formRequest(`/admin/forms/${form.publicId}/versions/1/publish`, {}),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );
    const published = await getAdminForm(form.publicId, dependencies);
    const publishedHtml = renderToStaticMarkup(
      <AdminFormDetail role="OPERATOR" form={published!} />,
    );
    expect(publishedHtml).toContain("Open public form");
    expect(publishedHtml).toContain('href="/forms/contact-us"');
    expect(publishedHtml).toContain('target="_blank"');
    expect(published?.embedSnippet).toBe(
      '<div data-magictrust-form="contact-us"></div>\n<script src="https://magictrust.test/embed.js" async></script>',
    );
    expect(published?.embedSnippet).not.toContain(form.publicId);
    expect(published?.embedSnippet).not.toContain("version");
    expect(publishedHtml).toContain("Embed form");
    expect(publishedHtml).toContain("Copy snippet");
    expect(
      renderToStaticMarkup(<AdminFormDetail role="ADMIN" form={published!} />),
    ).toContain("Copy snippet");

    await archiveAdminForm(
      formRequest(`/admin/forms/${form.publicId}/archive`, {}),
      form.publicId,
      session("ADMIN"),
      dependencies,
    );
    const archived = await getAdminForm(form.publicId, dependencies);
    expect(
      renderToStaticMarkup(<AdminFormDetail role="ADMIN" form={archived!} />),
    ).not.toContain("Open public form");
    expect(archived?.embedSnippet).toBeNull();
  });

  test("ADMIN opens the current draft editor without persisting preview state", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");
    const auditCount = dependencies.state.audits.length;
    const draft = await getAdminFormDraftEditor(form.publicId, 1, dependencies);

    expect(draft).toMatchObject({
      publicId: form.publicId,
      versionNumber: 1,
      html: "<form>\n  <!-- Form content -->\n</form>",
    });
    const html = renderToStaticMarkup(<AdminFormEditor draft={draft!} />);
    expect(html).toContain("Refresh preview");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).not.toContain("allow-same-origin");
    expect(dependencies.state.audits).toHaveLength(auditCount);
  });

  test("ADMIN saves HTML, CSS, and JavaScript together and audits no source", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");
    const expectedUpdatedAt = dependencies.state.versions[0]!.updatedAt;
    dependencies.state.now = new Date("2026-07-18T12:05:00.000Z");

    const response = await saveAdminFormDraft(
      formRequest(
        `/admin/forms/${form.publicId}/versions/1/save`,
        draftValues(expectedUpdatedAt, {
          html: "<main>Updated</main>",
          css: "main { color: green; }",
          javascript: "document.body.dataset.ready = 'true';",
        }),
      ),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("Draft+saved");
    expect(dependencies.state.versions[0]).toMatchObject({
      html: "<main>Updated</main>",
      css: "main { color: green; }",
      javascript: "document.body.dataset.ready = 'true';",
      updatedAt: dependencies.state.now,
    });
    expect(dependencies.state.audits.at(-1)).toEqual({
      type: "FORM_VERSION_UPDATED",
      formId: form.id,
      versionNumber: 1,
    });
    expect(JSON.stringify(dependencies.state.audits)).not.toContain("Updated");
    expect(JSON.stringify(dependencies.state.audits)).not.toContain("color");
  });

  test("stale draft writes are rejected without overwriting newer source", async () => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");
    const staleUpdatedAt = dependencies.state.versions[0]!.updatedAt;
    dependencies.state.versions[0]!.html = "<main>Newer edit</main>";
    dependencies.state.versions[0]!.updatedAt = new Date(
      "2026-07-18T12:04:00.000Z",
    );

    const response = await saveAdminFormDraft(
      formRequest(
        `/admin/forms/${form.publicId}/versions/1/save`,
        draftValues(staleUpdatedAt, { html: "<main>Stale edit</main>" }),
      ),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain(
      "This+draft+was+updated+elsewhere",
    );
    expect(dependencies.state.versions[0]!.html).toBe(
      "<main>Newer edit</main>",
    );
    expect(dependencies.state.audits.at(-1)?.type).not.toBe(
      "FORM_VERSION_UPDATED",
    );
  });

  test("published and archived versions cannot be edited", async () => {
    const publishedDependencies = createDependencies();
    const publishedForm = await createForm(
      publishedDependencies,
      "Published",
      "published",
    );
    const publishedUpdatedAt =
      publishedDependencies.state.versions[0]!.updatedAt;
    await publishAdminFormVersion(
      formRequest(
        `/admin/forms/${publishedForm.publicId}/versions/1/publish`,
        {},
      ),
      publishedForm.publicId,
      1,
      session("ADMIN"),
      publishedDependencies,
    );
    expect(
      await getAdminFormDraftEditor(
        publishedForm.publicId,
        1,
        publishedDependencies,
      ),
    ).toBeNull();
    const publishedSave = await saveAdminFormDraft(
      formRequest(
        `/admin/forms/${publishedForm.publicId}/versions/1/save`,
        draftValues(publishedUpdatedAt),
      ),
      publishedForm.publicId,
      1,
      session("ADMIN"),
      publishedDependencies,
    );
    expect(publishedSave.headers.get("location")).toContain(
      "Draft+version+could+not+be+found",
    );

    const archivedDependencies = createDependencies();
    const archivedForm = await createForm(
      archivedDependencies,
      "Archived",
      "archived",
    );
    const archivedUpdatedAt = archivedDependencies.state.versions[0]!.updatedAt;
    await archiveAdminForm(
      formRequest(`/admin/forms/${archivedForm.publicId}/archive`, {}),
      archivedForm.publicId,
      session("ADMIN"),
      archivedDependencies,
    );
    expect(
      await getAdminFormDraftEditor(
        archivedForm.publicId,
        1,
        archivedDependencies,
      ),
    ).toBeNull();
    const archivedSave = await saveAdminFormDraft(
      formRequest(
        `/admin/forms/${archivedForm.publicId}/versions/1/save`,
        draftValues(archivedUpdatedAt),
      ),
      archivedForm.publicId,
      1,
      session("ADMIN"),
      archivedDependencies,
    );
    expect(archivedSave.headers.get("location")).toContain(
      "Archived+forms+cannot+be+changed",
    );
  });

  test.each([
    ["html", "HTML"],
    ["css", "CSS"],
    ["javascript", "JavaScript"],
  ] as const)("rejects %s source larger than 250 KB", async (field, label) => {
    const dependencies = createDependencies();
    const form = await createForm(dependencies, "Privacy", "privacy");
    const before = structuredClone(dependencies.state.versions[0]);
    const response = await saveAdminFormDraft(
      formRequest(
        `/admin/forms/${form.publicId}/versions/1/save`,
        draftValues(before!.updatedAt, { [field]: "x".repeat(250 * 1024 + 1) }),
      ),
      form.publicId,
      1,
      session("ADMIN"),
      dependencies,
    );

    expect(response.headers.get("location")).toContain(
      `${label}+source+must+be+250+KB+or+less`,
    );
    expect(dependencies.state.versions[0]).toEqual(before);
  });

  test("preview keeps JavaScript in a network-isolated iframe document", () => {
    const preview = buildSandboxedPreviewDocument({
      html: '<button onclick="window.parent.document.body.remove()">Try</button>',
      css: "button { display: block; }",
      javascript: "fetch('https://example.com/private');",
    });

    expect(preview).toContain("connect-src 'none'");
    expect(preview).toContain("navigate-to 'none'");
    expect(preview).toContain("form-action 'none'");
    expect(preview).toContain("<script>fetch(");
    const markup = renderToStaticMarkup(
      <AdminFormEditor
        draft={{
          publicId: "frm_1",
          formName: "Privacy",
          versionNumber: 1,
          html: "<script>window.parent.__escaped = false</script>",
          css: "",
          javascript: "window.parent.__escaped = false;",
          updatedAt: "2026-07-18T12:00:00.000Z",
        }}
      />,
    );
    expect(markup).toContain('sandbox="allow-scripts"');
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain(
      "<script>window.parent.__escaped = false</script>",
    );
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
    appBaseUrl: "https://magictrust.test",
    store: createMemoryStore(state),
  };
}

async function createForm(
  dependencies: ReturnType<typeof createDependencies>,
  name: string,
  slug: string,
  requestType: ManagedForm["requestType"] = "GENERAL_INQUIRY",
) {
  await createAdminForm(
    formRequest("/admin/forms/create", { name, slug, requestType }),
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
        requestType: input.requestType,
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
        updatedAt: input.now,
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
    async getPublishedFormBySlug(slug) {
      const form = state.forms.find(
        (item) => item.slug === slug && item.status === "ACTIVE",
      );
      if (!form) return null;
      const published = state.versions.find(
        (version) =>
          version.formId === form.id && version.status === "PUBLISHED",
      );
      return published
        ? {
            html: published.html,
            css: published.css,
            javascript: published.javascript,
          }
        : null;
    },
    async getPublishedFormSubmissionTargetBySlug(slug) {
      const form = state.forms.find(
        (item) => item.slug === slug && item.status === "ACTIVE",
      );
      if (!form) return null;
      const published = state.versions.find(
        (version) =>
          version.formId === form.id && version.status === "PUBLISHED",
      );
      return published
        ? {
            publicId: form.publicId,
            slug: form.slug,
            requestType: form.requestType,
            versionNumber: published.versionNumber,
          }
        : null;
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
      if (published) {
        published.status = "ARCHIVED";
        published.updatedAt = input.now;
      }
      draft.status = "PUBLISHED";
      draft.updatedAt = input.now;
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
        updatedAt: input.now,
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
    async updateDraftVersion(input) {
      const form = state.forms.find((item) => item.publicId === input.publicId);
      if (!form) return { ok: false, code: "FORM_NOT_FOUND" };
      if (form.status === "ARCHIVED") {
        return { ok: false, code: "FORM_ARCHIVED" };
      }
      const draft = state.versions.find(
        (version) =>
          version.formId === form.id &&
          version.versionNumber === input.versionNumber &&
          version.status === "DRAFT",
      );
      if (!draft) return { ok: false, code: "DRAFT_NOT_FOUND" };
      if (draft.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) {
        return { ok: false, code: "DRAFT_STALE" };
      }
      draft.html = input.html;
      draft.css = input.css;
      draft.javascript = input.javascript;
      draft.updatedAt = input.now;
      form.updatedAt = input.now;
      state.audits.push({
        type: "FORM_VERSION_UPDATED",
        formId: form.id,
        versionNumber: draft.versionNumber,
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

function draftValues(
  expectedUpdatedAt: Date,
  overrides: Partial<Record<"html" | "css" | "javascript", string>> = {},
) {
  return {
    html: "<main>Draft</main>",
    css: "main { display: block; }",
    javascript: "document.body.dataset.preview = 'ready';",
    expectedUpdatedAt: expectedUpdatedAt.toISOString(),
    ...overrides,
  };
}
