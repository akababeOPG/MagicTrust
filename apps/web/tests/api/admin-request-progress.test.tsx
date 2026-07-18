import type { RequestStatus } from "@magictrust/domain";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  getDataAccessProgress,
  RequestProgress,
} from "../../lib/admin-request-progress";

describe("DATA_ACCESS request progress", () => {
  test.each([
    [
      "PENDING_VERIFICATION",
      false,
      ["completed", "current", "upcoming", "upcoming", "upcoming"],
    ],
    [
      "VERIFIED",
      false,
      ["completed", "completed", "current", "upcoming", "upcoming"],
    ],
    [
      "PROCESSING",
      false,
      ["completed", "completed", "current", "upcoming", "upcoming"],
    ],
    [
      "PROCESSING",
      true,
      ["completed", "completed", "completed", "current", "upcoming"],
    ],
    [
      "SUCCESS",
      true,
      ["completed", "completed", "completed", "completed", "completed"],
    ],
  ] as const)(
    "maps %s with responseReady=%s",
    (status, responseReady, states) => {
      expect(
        getDataAccessProgress({ status, responseReady }).map(
          (stage) => stage.state,
        ),
      ).toEqual(states);
    },
  );

  test.each(["REJECTED", "CANCELLED"] as const)(
    "%s preserves achieved progress without implying completion",
    (status) => {
      const stages = getDataAccessProgress({
        status,
        responseReady: false,
        verified: true,
        processingStarted: true,
      });

      expect(stages.map((stage) => stage.state)).toEqual([
        "completed",
        "completed",
        "completed",
        "upcoming",
        "upcoming",
      ]);
      expect(stages[4]?.state).not.toBe("completed");
    },
  );

  test("waiting state identifies the interruption and current stage semantically", () => {
    const html = renderToStaticMarkup(
      <RequestProgress
        status={"WAITING_FOR_REQUESTER" as RequestStatus}
        responseReady={false}
        verified
        processingStarted
      />,
    );

    expect(html).toContain("Waiting for requester");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Processing: current"');
  });

  test("renders one label per stage without repeated completion captions", () => {
    const html = renderToStaticMarkup(
      <RequestProgress
        status={"SUCCESS" as RequestStatus}
        responseReady
        verified
        processingStarted
      />,
    );

    expect(html).not.toContain("Request progress</h2>");
    expect(html.match(/>Completed<\/strong>/g)).toHaveLength(1);
    expect(html).not.toContain("<small>");
    expect(html).toContain('aria-label="Received: completed"');
  });
});
