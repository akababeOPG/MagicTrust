import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  listManagedAdminUsers: vi.fn(),
  noStore: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: mocks.noStore,
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: mocks.requireAdminRole,
}));

vi.mock("@/lib/admin-user-management", () => ({
  createAdminUserManagementDependencies: vi.fn(() => ({ kind: "deps" })),
  listManagedAdminUsers: mocks.listManagedAdminUsers,
}));

describe("admin users page access", () => {
  beforeEach(() => vi.clearAllMocks());

  test("ADMIN can access /admin/users", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce({
      adminUserId: "admin-1",
      role: "ADMIN",
      sessionId: "session-1",
    });
    mocks.listManagedAdminUsers.mockResolvedValueOnce({ ok: true, users: [] });
    const { default: AdminUsersPage } =
      await import("../../app/admin/users/page");

    const html = renderToStaticMarkup(
      await AdminUsersPage({ searchParams: Promise.resolve({}) }),
    );

    expect(html).toContain("Manage access to MagicTrust.");
    expect(html).toContain("Add user");
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(mocks.noStore).toHaveBeenCalled();
  });

  test.each(["OPERATOR", "VIEWER"] as const)(
    "%s cannot access /admin/users",
    async () => {
      mocks.requireAdminRole.mockResolvedValueOnce(
        new Response("Forbidden", { status: 403 }),
      );
      const { default: AdminUsersPage } =
        await import("../../app/admin/users/page");

      await expect(
        AdminUsersPage({ searchParams: Promise.resolve({}) }),
      ).rejects.toThrow("NOT_FOUND");
      expect(mocks.listManagedAdminUsers).not.toHaveBeenCalled();
    },
  );
});
