import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  listAdminForms: vi.fn(async () => []),
  getAdminFormDraftEditor: vi.fn(),
  createAdminForm: vi.fn(),
  saveAdminFormDraft: vi.fn(),
  noStore: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({ unstable_noStore: mocks.noStore }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: mocks.requireAdminRole,
}));
vi.mock("@/lib/admin-form-management", () => ({
  createAdminFormDependencies: vi.fn(() => ({ kind: "deps" })),
  listAdminForms: mocks.listAdminForms,
  getAdminFormDraftEditor: mocks.getAdminFormDraftEditor,
  createAdminForm: mocks.createAdminForm,
  saveAdminFormDraft: mocks.saveAdminFormDraft,
}));

describe("admin form access", () => {
  beforeEach(() => vi.clearAllMocks());

  test.each(["ADMIN", "OPERATOR"] as const)(
    "%s accesses Forms",
    async (role) => {
      mocks.requireAdminRole.mockResolvedValueOnce({
        adminUserId: "admin-1",
        role,
        sessionId: "session-1",
      });
      const { default: AdminFormsPage } =
        await import("../../app/admin/forms/page");
      const html = renderToStaticMarkup(
        await AdminFormsPage({ searchParams: Promise.resolve({}) }),
      );
      expect(html).toContain("Manage forms used to collect requests.");
      expect(mocks.requireAdminRole).toHaveBeenCalledWith([
        "ADMIN",
        "OPERATOR",
      ]);
      if (role === "ADMIN") expect(html).toContain("Create form");
      else expect(html).not.toContain("Create form");
    },
  );

  test("VIEWER is denied Forms", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }),
    );
    const { default: AdminFormsPage } =
      await import("../../app/admin/forms/page");
    await expect(
      AdminFormsPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow("NOT_FOUND");
    expect(mocks.listAdminForms).not.toHaveBeenCalled();
  });

  test("OPERATOR cannot create a form", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } = await import("../../app/admin/forms/create/route");
    const response = await POST(
      new Request("https://magictrust.test/admin/forms/create", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(403);
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN"], {
      response: "json",
    });
    expect(mocks.createAdminForm).not.toHaveBeenCalled();
  });

  test("ADMIN opens the draft editor", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce({
      adminUserId: "admin-1",
      role: "ADMIN",
      sessionId: "session-1",
    });
    mocks.getAdminFormDraftEditor.mockResolvedValueOnce({
      publicId: "frm_1",
      formName: "Privacy Request",
      versionNumber: 2,
      html: "<main>Draft</main>",
      css: "main { display: block; }",
      javascript: "document.body.dataset.ready = 'true';",
      updatedAt: "2026-07-18T12:00:00.000Z",
    });
    const { default: AdminFormEditorPage } =
      await import("../../app/admin/forms/[publicId]/versions/[versionNumber]/edit/page");
    const html = renderToStaticMarkup(
      await AdminFormEditorPage({
        params: Promise.resolve({ publicId: "frm_1", versionNumber: "2" }),
        searchParams: Promise.resolve({}),
      }),
    );

    expect(html).toContain("Edit Privacy Request");
    expect(html).toContain("HTML source");
    expect(html).toContain('sandbox="allow-scripts"');
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN"]);
  });

  test.each(["OPERATOR", "VIEWER"])(
    "%s cannot open the draft editor",
    async () => {
      mocks.requireAdminRole.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 }),
      );
      const { default: AdminFormEditorPage } =
        await import("../../app/admin/forms/[publicId]/versions/[versionNumber]/edit/page");

      await expect(
        AdminFormEditorPage({
          params: Promise.resolve({ publicId: "frm_1", versionNumber: "1" }),
          searchParams: Promise.resolve({}),
        }),
      ).rejects.toThrow("NOT_FOUND");
      expect(mocks.getAdminFormDraftEditor).not.toHaveBeenCalled();
    },
  );

  test.each(["OPERATOR", "VIEWER"])("%s cannot save draft source", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/forms/[publicId]/versions/[versionNumber]/save/route");
    const response = await POST(
      new Request("https://magictrust.test/admin/forms/frm_1/versions/1/save", {
        method: "POST",
      }),
      {
        params: Promise.resolve({ publicId: "frm_1", versionNumber: "1" }),
      },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN"], {
      response: "json",
    });
    expect(mocks.saveAdminFormDraft).not.toHaveBeenCalled();
  });
});
