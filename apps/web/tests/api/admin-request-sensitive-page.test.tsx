import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  session: {
    adminUserId: "admin-user-1",
    role: "ADMIN" as "ADMIN" | "OPERATOR" | "VIEWER",
    sessionId: "session-1",
  },
  detail: {} as Record<string, unknown>,
  getAdminRequestDetail: vi.fn(),
  noStore: vi.fn(),
}));

vi.mock("next/cache", () => ({
  unstable_noStore: mocks.noStore,
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/lib/admin-auth", () => ({
  requireAdminSession: vi.fn(async () => mocks.session),
}));

vi.mock("@/lib/admin-dashboard", () => ({
  createAdminDashboardDependencies: vi.fn(() => ({ kind: "dependencies" })),
  getValidAdminStatusDestinations: vi.fn(() => []),
  getAdminRequestDetail: mocks.getAdminRequestDetail,
}));

vi.mock("@/lib/admin-request-action-forms", () => ({
  AdminSubmitButton: ({ children }: { children: string }) => children,
  AdminConfirmSubmitButton: ({ children }: { children: string }) => children,
}));

describe("admin sensitive request page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.session.role = "ADMIN";
    mocks.detail = requestDetail();
    mocks.getAdminRequestDetail.mockImplementation(async () => mocks.detail);
  });

  test("renders requester and escaped original submission for an ADMIN", async () => {
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");

    const page = await AdminRequestDetailPage({
      params: Promise.resolve({ publicId: "req_one" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Requester");
    expect(html).toContain("john@example.com");
    expect(html).toContain("Requester and request");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;unsafe&quot;)&lt;/script&gt;",
    );
    expect(html).not.toContain('<script>alert("unsafe")</script>');
    expect(html).not.toContain("ciphertext-value");
    expect(html).not.toContain("hash-value");
    expect(mocks.noStore).toHaveBeenCalledOnce();
    expect(mocks.getAdminRequestDetail).toHaveBeenCalledWith(
      "req_one",
      { kind: "dependencies" },
      expect.objectContaining({
        adminUserId: "admin-user-1",
        role: "ADMIN",
      }),
    );
  });

  test("VIEWER detail does not render requester or original submission", async () => {
    mocks.session.role = "VIEWER";
    mocks.detail = requestDetail({ includeSensitive: false });
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");

    const page = await AdminRequestDetailPage({
      params: Promise.resolve({ publicId: "req_one" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("john@example.com");
    expect(html).not.toContain("Original Submission");
    expect(html).toContain("Requester identity restricted");
    expect(mocks.getAdminRequestDetail).toHaveBeenCalledWith(
      "req_one",
      { kind: "dependencies" },
      expect.objectContaining({
        adminUserId: "admin-user-1",
        role: "VIEWER",
      }),
    );
  });

  test("due-date controls are compact and role-aware", async () => {
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");

    const admin = await renderPage(AdminRequestDetailPage);
    expect(admin).toContain("Due date");
    expect(admin).toContain("Jul 24, 2026");
    expect(admin).toContain("Due soon");
    expect(admin).toContain('type="datetime-local"');
    expect(admin).toContain("Times are stored and displayed in UTC.");

    mocks.session.role = "VIEWER";
    const viewer = await renderPage(AdminRequestDetailPage);
    expect(viewer).toContain("Jul 24, 2026");
    expect(viewer).not.toContain('action="/admin/requests/req_one/due-date"');

    mocks.session.role = "OPERATOR";
    mocks.detail.assignment = {
      displayName: "Agustin",
      isCurrentUser: false,
      assignedToAdminUserId: "another-admin",
      assignedAt: "2026-07-18T00:00:00.000Z",
      options: [],
    };
    const operatorAssignedElsewhere = await renderPage(AdminRequestDetailPage);
    expect(operatorAssignedElsewhere).not.toContain(
      'action="/admin/requests/req_one/due-date"',
    );
  });

  test("renders guided DATA_ACCESS actions for each workflow state", async () => {
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");

    mocks.detail = requestDetail();
    mocks.detail.status = "PENDING_VERIFICATION";
    expect(await renderPage(AdminRequestDetailPage)).toContain(
      "Resend verification email",
    );

    mocks.detail.status = "VERIFIED";
    const verified = await renderPage(AdminRequestDetailPage);
    expect(verified).toContain("Start processing");
    expect(verified).not.toContain("Status Update");

    mocks.detail.status = "PROCESSING";
    mocks.detail.attachments = [];
    expect(await renderPage(AdminRequestDetailPage)).toContain(
      "Upload response file",
    );

    mocks.detail.attachments = [
      {
        id: "attachment-1",
        fileName: "response.json",
        mimeType: "application/json",
        sizeBytes: 100,
        visibility: "PUBLIC",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
    ];
    expect(await renderPage(AdminRequestDetailPage)).toContain(
      "Send response and complete request",
    );

    mocks.detail.timeline = [
      {
        id: "event-delivery-failed",
        type: "CONSUMER_NOTIFICATION_FAILED",
        category: "BUILT_IN",
        actorType: "SYSTEM",
        actorId: null,
        createdAt: "2026-07-02T00:00:00.000Z",
        data: {
          notificationType: "FILE_AVAILABLE",
          communicationId: "communication-one",
        },
      },
    ];
    const failedDelivery = await renderPage(AdminRequestDetailPage);
    expect(failedDelivery).toContain("Response could not be sent");
    expect(failedDelivery).toContain("Retry sending response");

    mocks.detail.timeline = [];
    mocks.detail.status = "WAITING_FOR_REQUESTER";
    const waiting = await renderPage(AdminRequestDetailPage);
    expect(waiting).toContain("Waiting for requester");
    expect(waiting).toContain("Processing is paused");

    mocks.detail.status = "SUCCESS";
    mocks.detail.completedAt = "2026-07-03T00:00:00.000Z";
    const completed = await renderPage(AdminRequestDetailPage);
    expect(completed).toContain("Request completed");
    expect(completed).not.toContain("Upload response file");
    expect(completed).not.toContain("Notify Consumer");
  });

  test("DATA_ACCESS UI hides technical controls and client scripts", async () => {
    mocks.detail.status = "PROCESSING";
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).not.toContain("Edit Mutable Data");
    expect(html).not.toContain("Register Custom Event");
    expect(html).not.toContain("Add Comment");
    expect(html).not.toContain("Notify Consumer");
    expect(html).not.toContain("visibility");
    expect(html).not.toContain("Additional submitted information");
    expect(html).not.toContain("json-panel");
    expect(html).not.toMatch(/<script[^>]*>[^<]*john@example\.com/);
  });

  test("internal notes use a private composer without visibility controls", async () => {
    mocks.detail.status = "PROCESSING";
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).toContain("Notes are visible only to your internal team.");
    expect(html).toContain("Add a note about processing this request...");
    expect(html).toContain("Add note");
    expect(html).not.toContain('name="visibility"');
  });

  test("response upload avoids technical visibility terminology", async () => {
    mocks.detail.status = "PROCESSING";
    mocks.detail.attachments = [];
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).toContain("No response file yet");
    expect(html).toContain("This file will be securely available");
    expect(html).toContain("Upload response file");
    expect(html).not.toContain("PUBLIC");
  });

  test("delivered state renders masked safe metadata", async () => {
    mocks.detail.status = "SUCCESS";
    mocks.detail.completedAt = "2026-07-03T00:00:00.000Z";
    mocks.detail.attachments = [responseAttachment()];
    mocks.detail.timeline = [
      {
        id: "event-delivery",
        type: "CONSUMER_NOTIFICATION_SENT",
        category: "BUILT_IN",
        actorType: "SYSTEM",
        actorId: null,
        createdAt: "2026-07-03T00:00:00.000Z",
        data: {
          notificationType: "FILE_AVAILABLE",
          communicationId: "communication-one",
          providerMessageId: "must-not-render",
        },
      },
    ];
    mocks.detail.communications = [
      {
        id: "communication-one",
        status: "SENT",
        sentAt: "2026-07-03T00:00:00.000Z",
        recipientMasked: "j***n@example.com",
        provider: "resend",
      },
    ];
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).toContain("Delivered successfully");
    expect(html).toContain("response.json");
    expect(html).toContain("j***n@example.com");
    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("providerMessageId");
  });

  test("activity history is collapsed and translates events without raw data", async () => {
    mocks.detail.status = "PROCESSING";
    mocks.detail.timeline = [
      {
        id: "event-processing",
        type: "STATUS_CHANGED",
        category: "BUILT_IN",
        actorType: "ADMIN_USER",
        actorId: "admin-user-secret",
        createdAt: "2026-07-02T00:00:00.000Z",
        data: {
          newStatus: "PROCESSING",
          storageKey: "private/storage/key",
          token: "must-not-render",
        },
      },
    ];
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).toContain('<details class="activity-disclosure">');
    expect(html).toContain("View activity history");
    expect(html).toContain("Processing started");
    expect(html).not.toContain("admin-user-secret");
    expect(html).not.toContain("private/storage/key");
    expect(html).not.toContain("must-not-render");
  });

  test.each([
    ["REJECTED", "Request rejected"],
    ["CANCELLED", "Request cancelled"],
  ] as const)(
    "renders the %s terminal summary without More actions",
    async (status, title) => {
      mocks.detail.status = status;
      mocks.detail.timeline = [
        {
          id: "event-terminal",
          type: "STATUS_CHANGED",
          category: "BUILT_IN",
          actorType: "ADMIN_USER",
          actorId: "admin-user-1",
          createdAt: "2026-07-02T00:00:00.000Z",
          data: { newStatus: status, reason: "Safe closure reason." },
        },
      ];
      const { default: AdminRequestDetailPage } =
        await import("../../app/admin/requests/[publicId]/page");
      const html = await renderPage(AdminRequestDetailPage);

      expect(html).toContain(title);
      expect(html).toContain("Safe closure reason.");
      expect(html).not.toContain("More actions");
    },
  );

  test("More actions follows active workflow state", async () => {
    mocks.detail.status = "VERIFIED";
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);

    expect(html).toContain("More actions");
    expect(html).toContain("Reject request");
    expect(html).toContain("Cancel request");
  });

  test("uses the compact request identity hierarchy without changing actions", async () => {
    mocks.detail.status = "VERIFIED";
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);
    const headerStart = html.indexOf(
      '<header class="admin-header guided-request-header">',
    );
    const header = html.slice(
      headerStart,
      html.indexOf("</header>", headerStart),
    );

    expect(html).toContain(
      '<nav class="request-detail-breadcrumb" aria-label="Request breadcrumb"><a href="/admin/requests">Requests</a>',
    );
    expect(header).toContain(
      '<p class="guided-request-eyebrow">Data access request</p>',
    );
    expect(header).toContain("<h1>req_one</h1>");
    expect(header).toContain(
      '<span class="mt-status-badge" data-status="VERIFIED">',
    );
    expect(header).toContain("More actions");
    expect(header.indexOf("<h1>req_one</h1>")).toBeLessThan(
      header.indexOf('class="mt-status-badge"'),
    );
  });

  test("guided detail keeps the mobile semantic section order", async () => {
    mocks.detail.status = "PROCESSING";
    const { default: AdminRequestDetailPage } =
      await import("../../app/admin/requests/[publicId]/page");
    const html = await renderPage(AdminRequestDetailPage);
    const landmarks = [
      'class="admin-header guided-request-header"',
      'class="request-progress-card"',
      'class="admin-card next-step-card"',
      'class="admin-card requester-request-card"',
      'id="response"',
      'class="admin-card internal-notes-card"',
      'class="admin-card activity-history-card"',
    ];

    for (let index = 1; index < landmarks.length; index += 1) {
      expect(html.indexOf(landmarks[index]!)).toBeGreaterThan(
        html.indexOf(landmarks[index - 1]!),
      );
    }
  });

  test("admin request responses are private and not cacheable", async () => {
    const { default: nextConfig } = await import("../../next.config");
    const configuredHeaders = await nextConfig.headers?.();

    expect(configuredHeaders).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/admin/requests/:path*",
          headers: expect.arrayContaining([
            {
              key: "Cache-Control",
              value: "private, no-store, max-age=0",
            },
          ]),
        }),
      ]),
    );
  });
});

function requestDetail(options: { includeSensitive?: boolean } = {}) {
  const detail: Record<string, unknown> = {
    id: "request-one",
    publicId: "req_one",
    type: "DATA_ACCESS",
    status: "SUBMITTED",
    source: { channel: "FORM", siteKey: "site", formKey: "form" },
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    completedAt: null,
    assignment: {
      displayName: null,
      isCurrentUser: false,
      assignedToAdminUserId: null,
      assignedAt: null,
      options: [],
    },
    due: {
      dueAt: "2026-07-24T12:00:00.000Z",
      state: "DUE_SOON",
      stateLabel: "Due soon",
      dateLabel: "Jul 24, 2026",
      shortDateLabel: "Jul 24",
      relativeLabel: "Due tomorrow",
    },
    mutableData: {},
    timeline: [],
    comments: [],
    attachments: [],
    communications: [],
    emailEncrypted: "ciphertext-value",
    emailHash: "hash-value",
    encryptionVersion: 1,
  };

  if (options.includeSensitive !== false) {
    detail.requester = {
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: null,
    };
    detail.originalSubmission = {
      type: "DATA_ACCESS",
      source: {
        channel: "FORM",
        siteKey: "site",
        formKey: "form",
        sourceUrl: "https://example.com/privacy",
      },
      message: '<script>alert("unsafe")</script>',
      submittedData: { safe: true },
    };
  }

  return detail;
}

function responseAttachment() {
  return {
    id: "attachment-1",
    fileName: "response.json",
    mimeType: "application/json",
    sizeBytes: 100,
    visibility: "PUBLIC",
    createdAt: "2026-07-02T00:00:00.000Z",
  };
}

async function renderPage(
  Page: (input: {
    params: Promise<{ publicId: string }>;
    searchParams: Promise<Record<string, string>>;
  }) => Promise<React.ReactNode>,
) {
  return renderToStaticMarkup(
    await Page({
      params: Promise.resolve({ publicId: "req_one" }),
      searchParams: Promise.resolve({}),
    }),
  );
}
