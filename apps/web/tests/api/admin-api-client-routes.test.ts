import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  create: vi.fn(),
  revoke: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: mocks.requireAdminRole,
}));
vi.mock("@/lib/admin-api-client-management", () => ({
  createAdminApiClientDependencies: vi.fn(() => ({ kind: "deps" })),
  createManagedApiClient: mocks.create,
  revokeManagedApiClient: mocks.revoke,
}));

describe("admin API client routes", () => {
  beforeEach(() => vi.clearAllMocks());

  test.each(["OPERATOR", "VIEWER"])(
    "%s cannot create API clients",
    async () => {
      mocks.requireAdminRole.mockResolvedValueOnce(
        Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
      );
      const { POST } = await import("../../app/admin/api-clients/create/route");
      const response = await POST(
        new Request("https://magictrust.test/admin/api-clients/create", {
          method: "POST",
        }),
      );
      expect(response.status).toBe(403);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );

  test("ADMIN revoke derives the actor from the session", async () => {
    const session = {
      adminUserId: "admin-1",
      role: "ADMIN",
      sessionId: "session-1",
    };
    mocks.requireAdminRole.mockResolvedValueOnce(session);
    mocks.revoke.mockResolvedValueOnce(
      Response.redirect("https://magictrust.test/admin/api-clients", 303),
    );
    const { POST } =
      await import("../../app/admin/api-clients/[apiClientId]/revoke/route");
    const request = new Request(
      "https://magictrust.test/admin/api-clients/client-1/revoke",
      { method: "POST" },
    );
    const response = await POST(request, {
      params: Promise.resolve({ apiClientId: "client-1" }),
    });
    expect(response.status).toBe(303);
    expect(mocks.revoke).toHaveBeenCalledWith(request, "client-1", session, {
      kind: "deps",
    });
  });
});
