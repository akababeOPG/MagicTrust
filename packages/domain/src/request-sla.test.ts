import { describe, expect, test } from "vitest";

import {
  deriveRequestSlaState,
  formatDueDate,
  formatDueRelative,
  requestDueSoonWindowMs,
} from "./request-sla";

const now = new Date("2026-07-18T12:00:00.000Z");

describe("request SLA", () => {
  test("derives no due date", () => {
    expect(
      deriveRequestSlaState({ status: "PROCESSING", dueAt: null, now }),
    ).toBe("NO_DUE_DATE");
  });

  test("derives on track beyond the due-soon window", () => {
    expect(
      deriveRequestSlaState({
        status: "PROCESSING",
        dueAt: new Date(now.getTime() + requestDueSoonWindowMs + 1),
        now,
      }),
    ).toBe("ON_TRACK");
  });

  test("derives due soon through the inclusive 48-hour boundary", () => {
    expect(
      deriveRequestSlaState({
        status: "PROCESSING",
        dueAt: new Date(now.getTime() + requestDueSoonWindowMs),
        now,
      }),
    ).toBe("DUE_SOON");
  });

  test("derives overdue", () => {
    expect(
      deriveRequestSlaState({
        status: "PROCESSING",
        dueAt: new Date(now.getTime() - 1),
        now,
      }),
    ).toBe("OVERDUE");
  });

  test.each(["SUCCESS", "REJECTED", "CANCELLED"] as const)(
    "%s derives completed and never overdue",
    (status) => {
      expect(
        deriveRequestSlaState({
          status,
          dueAt: new Date(now.getTime() - requestDueSoonWindowMs),
          now,
        }),
      ).toBe("COMPLETED");
    },
  );

  test("formats UTC due dates and relative copy consistently", () => {
    expect(formatDueDate(new Date("2026-07-24T03:00:00.000Z"))).toBe(
      "Jul 24, 2026",
    );
    expect(formatDueRelative(new Date("2026-07-18T13:00:00.000Z"), now)).toBe(
      "Due today",
    );
    expect(formatDueRelative(new Date("2026-07-19T09:00:00.000Z"), now)).toBe(
      "Due tomorrow",
    );
    expect(formatDueRelative(new Date("2026-07-16T12:00:00.000Z"), now)).toBe(
      "Overdue by 2 days",
    );
  });
});
