import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdminRole: vi.fn(),
  updateAdminRequestStatus: vi.fn(),
  updateAdminRequestAssignment: vi.fn(),
  updateAdminRequestDueDate: vi.fn(),
  createAdminRequestComment: vi.fn(),
  uploadAdminRequestAttachment: vi.fn(),
  sendAdminConsumerNotification: vi.fn(),
  updateAdminMutableData: vi.fn(),
  createAdminCustomEvent: vi.fn(),
  resendAdminIdentityVerification: vi.fn(),
  sendAdminDataAccessResponse: vi.fn(),
  completeAdminGuidedRequest: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminRole: mocks.requireAdminRole,
}));

vi.mock("@/lib/admin-dashboard", () => ({
  createAdminDashboardDependencies: vi.fn(() => ({ kind: "dependencies" })),
  updateAdminRequestStatus: mocks.updateAdminRequestStatus,
  updateAdminRequestAssignment: mocks.updateAdminRequestAssignment,
  updateAdminRequestDueDate: mocks.updateAdminRequestDueDate,
  createAdminRequestComment: mocks.createAdminRequestComment,
  uploadAdminRequestAttachment: mocks.uploadAdminRequestAttachment,
  sendAdminConsumerNotification: mocks.sendAdminConsumerNotification,
  updateAdminMutableData: mocks.updateAdminMutableData,
  createAdminCustomEvent: mocks.createAdminCustomEvent,
  resendAdminIdentityVerification: mocks.resendAdminIdentityVerification,
  sendAdminDataAccessResponse: mocks.sendAdminDataAccessResponse,
  completeAdminGuidedRequest: mocks.completeAdminGuidedRequest,
}));

describe("admin action routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("unauthenticated mutation rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "UNAUTHORIZED",
            message: "Admin authentication is required.",
          },
        },
        { status: 401 },
      ),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/status/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/status", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.updateAdminRequestStatus).not.toHaveBeenCalled();
  });

  test("VIEWER mutation rejected with 403", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Admin role is not allowed to perform this action.",
          },
        },
        { status: 403 },
      ),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/comments/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/comments", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.createAdminRequestComment).not.toHaveBeenCalled();
  });

  test("authorized route derives actor from the admin session", async () => {
    const session = {
      adminUserId: "admin-user-1",
      role: "OPERATOR",
      sessionId: "session-1",
    };
    mocks.requireAdminRole.mockResolvedValueOnce(session);
    mocks.updateAdminRequestStatus.mockResolvedValueOnce(
      Response.redirect("https://magictrust.test/admin/requests/req_one", 303),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/status/route");
    const request = new Request(
      "https://magictrust.test/admin/requests/req_one/status",
      {
        method: "POST",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ publicId: "req_one" }),
    });

    expect(response.status).toBe(303);
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN", "OPERATOR"], {
      response: "json",
    });
    expect(mocks.updateAdminRequestStatus).toHaveBeenCalledWith(
      request,
      "req_one",
      session,
      { kind: "dependencies" },
    );
  });

  test("assignment route requires an authorized admin role", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/assignment/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/assignment", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN", "OPERATOR"], {
      response: "json",
    });
    expect(mocks.updateAdminRequestAssignment).not.toHaveBeenCalled();
  });

  test("due-date route requires an authorized admin role", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/due-date/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/due-date", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.requireAdminRole).toHaveBeenCalledWith(["ADMIN", "OPERATOR"], {
      response: "json",
    });
    expect(mocks.updateAdminRequestDueDate).not.toHaveBeenCalled();
  });

  test("unauthenticated upload rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/attachments/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/attachments",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.uploadAdminRequestAttachment).not.toHaveBeenCalled();
  });

  test("VIEWER upload rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/attachments/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/attachments",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.uploadAdminRequestAttachment).not.toHaveBeenCalled();
  });

  test("unauthenticated notification rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/notifications/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/notifications",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.sendAdminConsumerNotification).not.toHaveBeenCalled();
  });

  test("VIEWER notification rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/notifications/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/notifications",
        {
          method: "POST",
        },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.sendAdminConsumerNotification).not.toHaveBeenCalled();
  });

  test("unauthenticated mutable data update rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/data/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/data", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.updateAdminMutableData).not.toHaveBeenCalled();
  });

  test("VIEWER mutable data update rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/data/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/data", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.updateAdminMutableData).not.toHaveBeenCalled();
  });

  test("mutable data update returns its success response without a 500", async () => {
    const session = {
      adminUserId: "admin-user-1",
      role: "ADMIN",
      sessionId: "session-1",
    };
    mocks.requireAdminRole.mockResolvedValueOnce(session);
    mocks.updateAdminMutableData.mockResolvedValueOnce(
      Response.redirect(
        "https://magictrust.test/admin/requests/req_one?success=updated",
        303,
      ),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/data/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/data", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(303);
    expect(mocks.updateAdminMutableData).toHaveBeenCalledWith(
      expect.any(Request),
      "req_one",
      session,
      { kind: "dependencies" },
    );
  });

  test("unauthenticated custom event rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/events/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/events", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.createAdminCustomEvent).not.toHaveBeenCalled();
  });

  test("VIEWER custom event rejected", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/events/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_one/events", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.createAdminCustomEvent).not.toHaveBeenCalled();
  });

  test("guided verification resend requires an admin session", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/resend-verification/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/resend-verification",
        { method: "POST" },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(401);
    expect(mocks.resendAdminIdentityVerification).not.toHaveBeenCalled();
  });

  test("VIEWER cannot send a guided response", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/send-response/route");

    const response = await POST(
      new Request(
        "https://magictrust.test/admin/requests/req_one/send-response",
        { method: "POST" },
      ),
      { params: Promise.resolve({ publicId: "req_one" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.sendAdminDataAccessResponse).not.toHaveBeenCalled();
  });

  test("VIEWER cannot complete a guided request", async () => {
    mocks.requireAdminRole.mockResolvedValueOnce(
      Response.json({ error: { code: "FORBIDDEN" } }, { status: 403 }),
    );
    const { POST } =
      await import("../../app/admin/requests/[publicId]/complete/route");

    const response = await POST(
      new Request("https://magictrust.test/admin/requests/req_two/complete", {
        method: "POST",
      }),
      { params: Promise.resolve({ publicId: "req_two" }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.completeAdminGuidedRequest).not.toHaveBeenCalled();
  });
});
