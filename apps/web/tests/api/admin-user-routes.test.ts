import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  createManagedAdminUser: vi.fn(),
  changeManagedAdminUserRole: vi.fn(),
  changeManagedAdminUserStatus: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: mocks.requireAdminRole,
}));

vi.mock("@/lib/admin-user-management", () => ({
  createAdminUserManagementDependencies: vi.fn(() => ({ kind: "deps" })),
  createManagedAdminUser: mocks.createManagedAdminUser,
  changeManagedAdminUserRole: mocks.changeManagedAdminUserRole,
  changeManagedAdminUserStatus: mocks.changeManagedAdminUserStatus,
}));

describe("admin user routes", () => {
  beforeEach(() => vi.clearAllMocks());

  test.each(["OPERATOR", "VIEWER"] as const)(
    "%s cannot create users",
    async () => {
      mocks.requireAdminRole.mockResolvedValueOnce(
        Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
      );
      const { POST } = await import("../../app/admin/users/create/route");

      const response = await POST(
        new Request("https://magictrust.test/admin/users/create", {
          method: "POST",
        }),
      );

      expect(response.status).toBe(403);
      expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN"], {
        response: "json",
      });
      expect(mocks.createManagedAdminUser).not.toHaveBeenCalled();
    },
  );

  test("ADMIN role mutation derives actor from the session", async () => {
    const session = {
      adminUserId: "admin-actor",
      role: "ADMIN",
      sessionId: "session-1",
    };
    mocks.requireAdminRole.mockResolvedValueOnce(session);
    mocks.changeManagedAdminUserRole.mockResolvedValueOnce(
      Response.redirect("https://magictrust.test/admin/users", 303),
    );
    const { POST } = await import("../../app/admin/users/[userId]/role/route");
    const request = new Request(
      "https://magictrust.test/admin/users/admin-target/role",
      { method: "POST" },
    );

    const response = await POST(request, {
      params: Promise.resolve({ userId: "admin-target" }),
    });

    expect(response.status).toBe(303);
    expect(mocks.changeManagedAdminUserRole).toHaveBeenCalledWith(
      request,
      "admin-target",
      session,
      { kind: "deps" },
    );
  });

  test("non-ADMIN status mutation is rejected server-side", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/users/[userId]/status/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/users/admin-target/status", {
        method: "POST",
      }),
      { params: Promise.resolve({ userId: "admin-target" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.changeManagedAdminUserStatus).not.toHaveBeenCalled();
  });
});
