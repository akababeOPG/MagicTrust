import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { AdminShell, StatusBadge } from "../../lib/admin-ui";

describe("MagicTrust admin UI", () => {
  test.each([
    ["SUBMITTED", "Submitted"],
    ["PENDING_VERIFICATION", "Awaiting verification"],
    ["VERIFIED", "Verified"],
    ["PROCESSING", "In progress"],
    ["WAITING_FOR_REQUESTER", "Waiting on requester"],
    ["SUCCESS", "Completed"],
    ["REJECTED", "Rejected"],
    ["CANCELLED", "Cancelled"],
  ] as const)("renders the %s status with a natural label", (status, label) => {
    const html = renderToStaticMarkup(<StatusBadge status={status} />);

    expect(html).toContain(label);
    expect(html).toContain(`data-status="${status}"`);
    expect(html).toContain("mt-status-glyph");
  });

  test.each(["ADMIN", "OPERATOR", "VIEWER"] as const)(
    "renders the authenticated %s role and active Requests navigation",
    (role) => {
      const html = renderToStaticMarkup(
        <AdminShell
          session={{
            adminUserId: "admin-user-1",
            role,
            sessionId: "session-1",
          }}
        >
          <p>Dashboard content</p>
        </AdminShell>,
      );

      expect(html).toContain(role.charAt(0) + role.slice(1).toLowerCase());
      expect(html).toContain('aria-current="page"');
      expect(html).toContain("Dashboard content");
    },
  );

  test("removes Advanced tools from sidebar navigation", () => {
    expect(renderShell("ADMIN")).not.toContain("Advanced tools");
    expect(renderShell("OPERATOR")).not.toContain("Advanced tools");
    expect(renderShell("VIEWER")).not.toContain("Advanced tools");
  });

  test("shows Users navigation only to ADMIN users", () => {
    const admin = renderShell("ADMIN", "users");

    expect(admin).toContain('href="/admin/users"');
    expect(admin).toContain('aria-current="page"');
    expect(renderShell("OPERATOR")).not.toContain('href="/admin/users"');
    expect(renderShell("VIEWER")).not.toContain('href="/admin/users"');
  });

  test("shows Forms under Administration to ADMIN and OPERATOR only", () => {
    const admin = renderShell("ADMIN", "forms");
    const operator = renderShell("OPERATOR", "forms");

    expect(admin).toContain('href="/admin/forms"');
    expect(operator).toContain('href="/admin/forms"');
    expect(admin.indexOf("Administration")).toBeLessThan(
      admin.indexOf('href="/admin/forms"'),
    );
    expect(operator.indexOf("Administration")).toBeLessThan(
      operator.indexOf('href="/admin/forms"'),
    );
    expect(renderShell("VIEWER")).not.toContain('href="/admin/forms"');
  });

  test("shows the current user's display name and role without an internal id", () => {
    const html = renderToStaticMarkup(
      <AdminShell
        session={{
          adminUserId: "private-admin-id",
          displayName: "Agustin Kababe",
          email: "agustin.kababe@onpointglobal.com",
          role: "ADMIN",
          sessionId: "private-session-id",
        }}
      >
        <p>Dashboard content</p>
      </AdminShell>,
    );

    expect(html).toContain("Agustin Kababe");
    expect(html).toContain("Admin");
    expect(html).not.toContain("private-admin-id");
    expect(html).not.toContain("private-session-id");
  });

  test("falls back to the authenticated email when no display name is available", () => {
    const html = renderToStaticMarkup(
      <AdminShell
        session={{
          adminUserId: "admin-user-1",
          email: "admin+ops@onpointglobal.com",
          role: "OPERATOR",
          sessionId: "session-1",
        }}
      >
        <p>Dashboard content</p>
      </AdminShell>,
    );

    expect(html).toContain("admin+ops@onpointglobal.com");
    expect(html).toContain("Operator");
  });

  test("links the sidebar brand to the dashboard and omits secondary views", () => {
    const html = renderShell("ADMIN", "dashboard");

    expect(html).toContain(
      'class="mt-sidebar-brand-link" aria-label="MagicTrust dashboard" href="/admin"',
    );
    expect(html).not.toContain('<p class="mt-nav-label">Views</p>');
    expect(html).not.toContain("view=overdue");
    expect(html).not.toContain("view=my-requests");
  });
});

function renderShell(
  role: "ADMIN" | "OPERATOR" | "VIEWER",
  currentSection: "dashboard" | "requests" | "forms" | "users" = "requests",
) {
  return renderToStaticMarkup(
    <AdminShell
      session={{
        adminUserId: "admin-user-1",
        role,
        sessionId: "session-1",
      }}
      currentSection={currentSection}
    >
      <p>Dashboard content</p>
    </AdminShell>,
  );
}
