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
    expect(html).toContain("Original Submission");
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
      "ADMIN",
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
    expect(mocks.getAdminRequestDetail).toHaveBeenCalledWith(
      "req_one",
      { kind: "dependencies" },
      "VIEWER",
    );
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
