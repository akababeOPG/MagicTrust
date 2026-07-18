import {
  getRequestWorkflowProgress,
  type RequestStatus,
  type RequestType,
} from "@magictrust/domain";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { RequestProgress } from "../../lib/admin-request-progress";

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
        progress({ status, hasPublicAttachments: responseReady }).steps.map(
          (stage) => stage.state,
        ),
      ).toEqual(states);
    },
  );

  test.each(["REJECTED", "CANCELLED"] as const)(
    "%s preserves achieved progress without implying completion",
    (status) => {
      const stages = progress({
        status,
        hasPublicAttachments: false,
        verified: true,
        processingStarted: true,
      }).steps;

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
    const workflowProgress = progress({
      status: "WAITING_FOR_REQUESTER",
      verified: true,
      processingStarted: true,
    });
    const html = renderToStaticMarkup(
      <RequestProgress
        steps={workflowProgress.steps}
        interruption={workflowProgress.interruption}
      />,
    );

    expect(html).toContain("Waiting for requester");
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('aria-label="Processing: current"');
  });

  test("renders one label per stage without repeated completion captions", () => {
    const workflowProgress = progress({ status: "SUCCESS" });
    const html = renderToStaticMarkup(
      <RequestProgress
        steps={workflowProgress.steps}
        interruption={workflowProgress.interruption}
      />,
    );

    expect(html).not.toContain("Request progress</h2>");
    expect(html.match(/>Completed<\/strong>/g)).toHaveLength(1);
    expect(html).not.toContain("<small>");
    expect(html).toContain('aria-label="Received: completed"');
  });

  test("supports a configurable number of workflow stages", () => {
    const workflowProgress = progress({
      type: "GENERAL_INQUIRY",
      status: "PROCESSING",
    });
    const html = renderToStaticMarkup(
      <RequestProgress
        steps={workflowProgress.steps}
        interruption={workflowProgress.interruption}
      />,
    );

    expect(workflowProgress.steps).toHaveLength(3);
    expect(html).toContain("--request-progress-step-count:3");
    expect(html).toContain("Received");
    expect(html).toContain("Processing");
    expect(html).toContain("Completed");
    expect(html).not.toContain("Response ready");
  });
});

function progress(
  overrides: {
    type?: RequestType;
    status?: RequestStatus;
    hasPublicAttachments?: boolean;
    verified?: boolean;
    processingStarted?: boolean;
  } = {},
) {
  return getRequestWorkflowProgress({
    type: overrides.type ?? "DATA_ACCESS",
    status: overrides.status ?? "SUBMITTED",
    hasPublicAttachments: overrides.hasPublicAttachments ?? false,
    verified: overrides.verified ?? false,
    processingStarted: overrides.processingStarted ?? false,
  });
}
