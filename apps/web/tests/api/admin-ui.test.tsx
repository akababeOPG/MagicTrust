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

  test("shows Advanced tools only to ADMIN users", () => {
    expect(renderShell("ADMIN")).toContain("Advanced tools");
    expect(renderShell("OPERATOR")).not.toContain("Advanced tools");
    expect(renderShell("VIEWER")).not.toContain("Advanced tools");
  });
});

function renderShell(role: "ADMIN" | "OPERATOR" | "VIEWER") {
  return renderToStaticMarkup(
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
}
