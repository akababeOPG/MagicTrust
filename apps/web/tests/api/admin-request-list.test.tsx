import type { RequestStatus, RequestType } from "@magictrust/domain";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  AdminRequestListWorkspace,
  buildAdminListHref,
  formatRequestAge,
  formatRequestTypeLabel,
} from "../../lib/admin-request-list";

const requestTypes: RequestType[] = [
  "DATA_ACCESS",
  "DATA_DELETION",
  "DO_NOT_CONTACT",
  "UNSUBSCRIBE",
  "GENERAL_INQUIRY",
];
const requestStatuses: RequestStatus[] = [
  "SUBMITTED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "PROCESSING",
  "WAITING_FOR_REQUESTER",
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
];

describe("admin requests list UX", () => {
  test("renders unified search for ADMIN and preserves active filters", () => {
    const html = renderWorkspace({
      role: "ADMIN",
      params: new URLSearchParams({
        search: "req_one",
        type: "DATA_ACCESS",
        status: "VERIFIED",
      }),
    });

    expect(html).toContain("Search by request ID, email, or phone");
    expect(html).toContain("Email and phone searches use exact matching.");
    expect(html).toContain('name="type" value="DATA_ACCESS"');
    expect(html).toContain('name="status" value="VERIFIED"');
    expect(html).toContain("Clear search");
  });

  test("restricts VIEWER search and requester rendering", () => {
    const html = renderWorkspace({ role: "VIEWER" });

    expect(html).toContain("Search by request ID");
    expect(html).toContain("Requester search is restricted for your role");
    expect(html).not.toContain("Search by request ID, email, or phone");
    expect(html).toContain("Restricted");
    expect(html).not.toContain("John Doe");
    expect(html).not.toContain("j***n@example.com");
  });

  test("uses URL-derived workload views and marks the active view", () => {
    const html = renderWorkspace({
      params: new URLSearchParams({
        view: "in-progress",
        status: "PROCESSING",
        search: "req_one",
      }),
    });

    expect(html).toContain("Needs attention");
    expect(html).toContain("Overdue");
    expect(html).toContain("Due soon");
    expect(html).toContain("My requests");
    expect(html).toContain("Unassigned");
    expect(html).toContain("Waiting on requester");
    expect(html).toContain("In progress");
    expect(html).toContain("Completed");
    expect(html).toContain(
      'aria-current="page" href="/admin/requests?view=in-progress&amp;status=PROCESSING&amp;search=req_one"',
    );
    expect(html).toContain("search=req_one");
  });

  test("renders assignment in desktop and mobile results", () => {
    const html = renderWorkspace();

    expect(html.match(/Assigned to/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("You");
    expect(html).not.toContain("agustin@onpointglobal.com");
  });

  test("renders due state in desktop and mobile results", () => {
    const html = renderWorkspace();

    expect(html.match(/Due/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Jul 17");
    expect(html).toContain("Overdue by 1 day");
    expect(html).toContain('data-sla="OVERDUE"');
  });

  test("assignment filters follow role permissions", () => {
    const admin = renderWorkspace({ role: "ADMIN" });
    const operator = renderWorkspace({ role: "OPERATOR" });
    const viewer = renderWorkspace({ role: "VIEWER" });

    expect(admin).toContain('<option value="me">Me</option>');
    expect(admin).toContain("Agustin (Admin)");
    expect(operator).toContain('<option value="me">Me</option>');
    expect(operator).not.toContain("Agustin (Admin)");
    expect(viewer).not.toContain('<option value="me">Me</option>');
    expect(viewer).toContain('<option value="unassigned">Unassigned</option>');
    expect(viewer).toContain('<option value="overdue">Overdue</option>');
  });

  test("uses natural request type and next-step labels", () => {
    expect(requestTypes.map(formatRequestTypeLabel)).toEqual([
      "Data access",
      "Data deletion",
      "Do not contact",
      "Unsubscribe",
      "General inquiry",
    ]);

    const html = renderWorkspace();
    expect(html).toContain("Data access");
    expect(html).toContain("Start processing");
  });

  test.each([
    [new URLSearchParams(), "No requests yet"],
    [new URLSearchParams({ search: "req_missing" }), "No matching requests"],
    [
      new URLSearchParams({ view: "completed", status: "SUCCESS" }),
      "Nothing in this view",
    ],
  ])("renders the appropriate empty state", (params, title) => {
    const html = renderWorkspace({ params, empty: true });

    expect(html).toContain(title);
  });

  test("renders the mobile request-card representation", () => {
    const html = renderWorkspace();

    expect(html).toContain('class="request-mobile-list"');
    expect(html).toContain('class="request-mobile-card"');
    expect(html).toContain("View request");
    expect(html).toContain('aria-labelledby="mobile-request-request-one"');
  });

  test("preserves query parameters during cursor pagination", () => {
    const html = renderWorkspace({
      params: new URLSearchParams({
        search: "req_one",
        type: "DATA_ACCESS",
        view: "needs-attention",
        status: "VERIFIED",
        limit: "25",
        assignedTo: "me",
        due: "due-soon",
      }),
      nextCursor: "opaque-cursor",
    });

    expect(html).toContain("search=req_one");
    expect(html).toContain("type=DATA_ACCESS");
    expect(html).toContain("view=needs-attention");
    expect(html).toContain("status=VERIFIED");
    expect(html).toContain("assignedTo=me");
    expect(html).toContain("due=due-soon");
    expect(html).toContain("cursor=opaque-cursor");
    expect(html).not.toContain(">opaque-cursor<");
  });

  test("formats concise request ages", () => {
    expect(formatRequestAge(0)).toBe("Today");
    expect(formatRequestAge(1)).toBe("1 day");
    expect(formatRequestAge(3)).toBe("3 days");
    expect(formatRequestAge(14)).toBe("2 weeks");
  });

  test("query builder preserves parameters and replaces only requested values", () => {
    const href = buildAdminListHref(
      new URLSearchParams({ search: "req_one", type: "DATA_ACCESS" }),
      { set: { status: "PROCESSING" }, remove: ["cursor"] },
    );

    expect(href).toBe(
      "/admin/requests?search=req_one&type=DATA_ACCESS&status=PROCESSING",
    );
  });
});

function renderWorkspace({
  role = "ADMIN",
  params = new URLSearchParams(),
  empty = false,
  nextCursor,
}: {
  role?: "ADMIN" | "OPERATOR" | "VIEWER";
  params?: URLSearchParams;
  empty?: boolean;
  nextCursor?: string;
} = {}) {
  return renderToStaticMarkup(
    <AdminRequestListWorkspace
      role={role}
      params={params}
      result={{
        ok: true,
        data: {
          requests: empty
            ? []
            : [
                {
                  id: "request-one",
                  publicId: "req_one",
                  type: "DATA_ACCESS",
                  status: "VERIFIED",
                  source: {
                    channel: "FORM",
                    siteKey: "magictrust-hosted",
                    formKey: "privacy-request",
                  },
                  createdAt: "2026-07-18T10:00:00.000Z",
                  updatedAt: "2026-07-18T10:00:00.000Z",
                  completedAt: null,
                  requesterSummary: {
                    name: "John Doe",
                    contact: "j***n@example.com",
                  },
                  ageDays: 0,
                  nextStep: "Start processing",
                  assignment: {
                    displayName: "Agustin",
                    isCurrentUser: true,
                  },
                  due: {
                    dueAt: "2026-07-17T10:00:00.000Z",
                    state: "OVERDUE",
                    stateLabel: "Overdue",
                    dateLabel: "Jul 17, 2026",
                    shortDateLabel: "Jul 17",
                    relativeLabel: "Overdue by 1 day",
                  },
                },
              ],
          assignmentOptions: [
            {
              id: "11111111-1111-4111-8111-111111111111",
              displayName: "Agustin",
              role: "ADMIN",
            },
          ],
          pagination: {
            limit: 25,
            ...(nextCursor ? { nextCursor } : {}),
          },
        },
      }}
      requestTypes={requestTypes}
      requestStatuses={requestStatuses}
    />,
  );
}
