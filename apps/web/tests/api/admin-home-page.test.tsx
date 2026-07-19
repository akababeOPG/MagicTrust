import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdminSession: vi.fn(),
  getAdminHomeDashboard: vi.fn(),
  noStore: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: mocks.noStore,
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminSession: mocks.requireAdminSession,
}));

vi.mock("@/lib/admin-dashboard", () => ({
  createAdminDashboardDependencies: vi.fn(() => ({ kind: "dependencies" })),
  getAdminHomeDashboard: mocks.getAdminHomeDashboard,
}));

describe("admin home page access", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminHomeDashboard.mockResolvedValue({
      summary: {
        needsAttention: 0,
        myRequests: 0,
        unassigned: 0,
        overdue: 0,
        dueSoon: 0,
        completedRecently: 0,
      },
      recentRequests: [],
    });
  });

  test.each(["ADMIN", "OPERATOR", "VIEWER"] as const)(
    "renders the operational dashboard for authenticated %s users",
    async (role) => {
      const session = {
        adminUserId: "admin-user-1",
        role,
        sessionId: "session-1",
      };
      mocks.requireAdminSession.mockResolvedValueOnce(session);
      const { default: AdminHomePage } = await import("../../app/admin/page");

      const html = renderToStaticMarkup(await AdminHomePage());

      expect(html).toContain("Dashboard");
      expect(html).toContain("No requests need attention.");
      expect(html).toContain('aria-current="page" href="/admin"');
      expect(mocks.getAdminHomeDashboard).toHaveBeenCalledWith(
        session,
        expect.any(Object),
      );
      expect(mocks.noStore).toHaveBeenCalled();
    },
  );
});
