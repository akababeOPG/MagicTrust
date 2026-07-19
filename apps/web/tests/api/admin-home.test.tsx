import { deriveRequestSlaState } from "@magictrust/domain";
import type { RequestStatus } from "@magictrust/domain";
import type {
  AdminHomeSummary,
  RequestListFilters,
  RequestRepository,
  RequestSummary,
} from "@magictrust/database";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { getAdminHomeDashboard } from "../../lib/admin-dashboard";
import { AdminHome } from "../../lib/admin-home";

const now = new Date("2026-07-19T12:00:00.000Z");
const currentAdminUserId = "11111111-1111-4111-8111-111111111111";
const otherAdminUserId = "22222222-2222-4222-8222-222222222222";

describe("admin operational home", () => {
  test("counts active work, current ownership, SLA states, and unique attention requests", async () => {
    const dependencies = dashboardDependencies();
    const dashboard = await getAdminHomeDashboard(
      session("ADMIN"),
      dependencies,
    );

    expect(dashboard.summary).toEqual({
      needsAttention: 3,
      myRequests: 1,
      unassigned: 2,
      overdue: 1,
      dueSoon: 1,
      completedRecently: 1,
    });
    expect(
      dependencies.requestRepository.getAdminHomeSummary,
    ).toHaveBeenCalledWith({
      adminUserId: currentAdminUserId,
      now,
    });
  });

  test("orders recent requests newest first", async () => {
    const dashboard = await getAdminHomeDashboard(
      session("OPERATOR"),
      dashboardDependencies(),
    );

    expect(dashboard.recentRequests.map((request) => request.publicId)).toEqual(
      [
        "req_active_other",
        "req_rejected",
        "req_completed",
        "req_unassigned",
        "req_due_soon",
        "req_overdue",
      ],
    );
  });

  test("renders operational links to existing request views", async () => {
    const dashboard = await getAdminHomeDashboard(
      session("ADMIN"),
      dashboardDependencies(),
    );
    const html = renderToStaticMarkup(
      <AdminHome role="ADMIN" dashboard={dashboard} />,
    );

    expect(html).toContain("Dashboard");
    expect(html).toContain("Needs attention");
    expect(html).toContain(
      'href="/admin/requests?view=my-requests&amp;assignedTo=me"',
    );
    expect(html).toContain(
      'href="/admin/requests?view=unassigned&amp;assignedTo=unassigned"',
    );
    expect(html).toContain(
      'href="/admin/requests?view=overdue&amp;due=overdue"',
    );
    expect(html).toContain(
      'href="/admin/requests?view=due-soon&amp;due=due-soon"',
    );
    expect(html).toContain('href="/admin/requests/req_active_other"');
  });

  test("keeps VIEWER requester data restricted and offers no unavailable My requests link", async () => {
    const dashboard = await getAdminHomeDashboard(
      session("VIEWER"),
      dashboardDependencies(),
    );
    const html = renderToStaticMarkup(
      <AdminHome role="VIEWER" dashboard={dashboard} />,
    );

    expect(html).toContain("Restricted");
    expect(html).not.toContain("john@example.com");
    expect(html).not.toContain(
      'href="/admin/requests?view=my-requests&amp;assignedTo=me"',
    );
  });
});

function dashboardDependencies() {
  const requests = dashboardRequests();
  const assignments = new Map([
    ["request-due-soon", currentAdminUserId],
    ["request-active-other", otherAdminUserId],
  ]);

  const getAdminHomeSummary = vi.fn(
    async ({
      adminUserId,
      now: currentTime,
    }: {
      adminUserId: string;
      now: Date;
    }): Promise<AdminHomeSummary> => {
      const active = requests.filter((request) => !isTerminal(request.status));
      const overdue = active.filter(
        (request) => slaState(request, currentTime) === "OVERDUE",
      );
      const dueSoon = active.filter(
        (request) => slaState(request, currentTime) === "DUE_SOON",
      );
      const unassigned = active.filter(
        (request) => !assignments.has(request.id),
      );
      const completedSince = new Date(
        currentTime.getTime() - 7 * 24 * 60 * 60 * 1000,
      );

      return {
        needsAttention: new Set(
          [...overdue, ...dueSoon, ...unassigned].map((request) => request.id),
        ).size,
        myRequests: active.filter(
          (request) => assignments.get(request.id) === adminUserId,
        ).length,
        unassigned: unassigned.length,
        overdue: overdue.length,
        dueSoon: dueSoon.length,
        completedRecently: requests.filter(
          (request) =>
            request.status === "SUCCESS" &&
            request.completedAt !== null &&
            request.completedAt >= completedSince &&
            request.completedAt <= currentTime,
        ).length,
      };
    },
  );

  const requestRepository = {
    getAdminHomeSummary,
    async list(filters: RequestListFilters) {
      const ordered = [...requests].sort(
        (left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id),
      );
      return {
        requests: ordered.slice(0, filters.limit),
        nextCursor: null,
      };
    },
    async listActiveAssignableAdminUsers() {
      return [];
    },
    async findAdminUsersByIds() {
      return [];
    },
    async findAdminListWorkflowData(requestIds: string[]) {
      return requestIds.map((requestId) => ({
        requestId,
        requesterEmailEncrypted: null,
        requesterPhoneEncrypted: null,
        requesterNameEncrypted: null,
        submittedDataEncrypted: null,
        hasPublicAttachment: false,
        latestResponseDeliveryStatus: null,
      }));
    },
  } as unknown as RequestRepository;

  return {
    requestRepository,
    now: () => now,
  };
}

function dashboardRequests(): RequestSummary[] {
  return [
    request("overdue", "SUBMITTED", "2026-07-14T00:00:00.000Z", {
      dueAt: new Date("2026-07-18T12:00:00.000Z"),
    }),
    request("due_soon", "PROCESSING", "2026-07-15T00:00:00.000Z", {
      dueAt: new Date("2026-07-20T12:00:00.000Z"),
      assignedToAdminUserId: currentAdminUserId,
    }),
    request("unassigned", "VERIFIED", "2026-07-16T00:00:00.000Z"),
    request("completed", "SUCCESS", "2026-07-17T00:00:00.000Z", {
      completedAt: new Date("2026-07-18T00:00:00.000Z"),
      dueAt: new Date("2026-07-10T00:00:00.000Z"),
    }),
    request("rejected", "REJECTED", "2026-07-18T00:00:00.000Z", {
      completedAt: new Date("2026-07-18T00:00:00.000Z"),
      dueAt: new Date("2026-07-20T00:00:00.000Z"),
    }),
    request(
      "active_other",
      "WAITING_FOR_REQUESTER",
      "2026-07-19T00:00:00.000Z",
      {
        assignedToAdminUserId: otherAdminUserId,
        dueAt: new Date("2026-07-25T00:00:00.000Z"),
      },
    ),
  ];
}

function request(
  suffix: string,
  status: RequestStatus,
  createdAt: string,
  overrides: Partial<RequestSummary> = {},
): RequestSummary {
  const date = new Date(createdAt);
  return {
    id: `request-${suffix.replaceAll("_", "-")}`,
    publicId: `req_${suffix}`,
    requesterId: `requester-${suffix}`,
    type: "DATA_ACCESS",
    status,
    source: { channel: "FORM", siteKey: null, formKey: null },
    completedAt: null,
    createdAt: date,
    updatedAt: date,
    assignedToAdminUserId: null,
    dueAt: null,
    ...overrides,
  };
}

function slaState(request: RequestSummary, currentTime: Date) {
  return deriveRequestSlaState({
    status: request.status,
    dueAt: request.dueAt ?? null,
    now: currentTime,
  });
}

function isTerminal(status: RequestStatus) {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}

function session(role: "ADMIN" | "OPERATOR" | "VIEWER") {
  return {
    adminUserId: currentAdminUserId,
    role,
    sessionId: "session-1",
  };
}
