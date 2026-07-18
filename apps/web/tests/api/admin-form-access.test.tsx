import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  listAdminForms: vi.fn(async () => []),
  createAdminForm: vi.fn(),
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
  createAdminForm: mocks.createAdminForm,
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
});
