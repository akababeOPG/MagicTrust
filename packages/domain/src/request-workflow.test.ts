import { describe, expect, test } from "vitest";

import {
  canTransitionRequestWorkflow,
  getAllowedWorkflowTransitions,
  getRequestNextStep,
  getRequestWorkflowProgress,
  getWorkflowDefinitionForRequest,
  type RequestWorkflowContext,
} from "./request-workflow";
import type { RequestStatus, RequestType } from "./types";

describe("request workflow definitions", () => {
  test("DATA_ACCESS resolves to DATA_ACCESS_STANDARD", () => {
    expect(getWorkflowDefinitionForRequest(request()).id).toBe(
      "DATA_ACCESS_STANDARD",
    );
  });

  test.each<RequestType>([
    "DATA_DELETION",
    "DO_NOT_CONTACT",
    "UNSUBSCRIBE",
    "GENERAL_INQUIRY",
  ])("%s resolves to GENERIC_REQUEST", (type) => {
    expect(getWorkflowDefinitionForRequest(request({ type })).id).toBe(
      "GENERIC_REQUEST",
    );
  });

  test("DATA_ACCESS stages preserve the approved workflow", () => {
    expect(
      getWorkflowDefinitionForRequest(request()).steps.map((step) => ({
        id: step.id,
        label: step.label,
        terminal: step.terminal ?? false,
      })),
    ).toEqual([
      { id: "received", label: "Received", terminal: false },
      { id: "verified", label: "Verified", terminal: false },
      { id: "processing", label: "Processing", terminal: false },
      { id: "response-ready", label: "Response ready", terminal: false },
      { id: "completed", label: "Completed", terminal: true },
    ]);
  });

  test("generic requests use a safe three-stage workflow", () => {
    expect(
      getWorkflowDefinitionForRequest(
        request({ type: "GENERAL_INQUIRY" }),
      ).steps.map((step) => step.label),
    ).toEqual(["Received", "Processing", "Completed"]);
  });

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
    "preserves DATA_ACCESS progress for %s with attachment=%s",
    (status, hasPublicAttachments, states) => {
      expect(
        getRequestWorkflowProgress(
          request({ status, hasPublicAttachments }),
        ).steps.map((step) => step.state),
      ).toEqual(states);
    },
  );

  test("generic progress uses its variable three-step definition", () => {
    expect(
      getRequestWorkflowProgress(
        request({ type: "GENERAL_INQUIRY", status: "PROCESSING" }),
      ).steps.map((step) => `${step.label}:${step.state}`),
    ).toEqual([
      "Received:completed",
      "Processing:current",
      "Completed:upcoming",
    ]);
  });

  test("workflow next steps preserve DATA_ACCESS guidance", () => {
    expect(getRequestNextStep(request({ status: "VERIFIED" }))).toMatchObject({
      title: "Ready to process",
      listLabel: "Start processing",
      actionType: "START_PROCESSING",
    });
    expect(
      getRequestNextStep(
        request({ status: "PROCESSING", hasPublicAttachments: true }),
      ),
    ).toMatchObject({
      title: "Response ready to send",
      listLabel: "Send response",
      actionType: "SEND_RESPONSE",
    });
  });

  test("DATA_ACCESS completion guidance supports zero or many files", () => {
    expect(
      getRequestNextStep(
        request({ status: "PROCESSING", hasPublicAttachments: false }),
      ),
    ).toMatchObject({
      title: "Prepare the response",
      actionType: "SEND_RESPONSE",
    });
    expect(
      getRequestNextStep(
        request({ status: "PROCESSING", hasPublicAttachments: true }),
      ).actionType,
    ).toBe("SEND_RESPONSE");
  });

  test("allowed transitions preserve existing non-terminal behavior", () => {
    const allowed = getAllowedWorkflowTransitions(
      request({ status: "PROCESSING" }),
    );

    expect(allowed).toContain("WAITING_FOR_REQUESTER");
    expect(allowed).toContain("SUCCESS");
    expect(allowed).toContain("REJECTED");
    expect(allowed).not.toContain("PROCESSING");
    expect(
      canTransitionRequestWorkflow(
        request({ status: "VERIFIED" }),
        "PROCESSING",
      ),
    ).toBe(true);
  });

  test.each<RequestStatus>(["SUCCESS", "REJECTED", "CANCELLED"])(
    "%s remains terminal",
    (status) => {
      expect(getAllowedWorkflowTransitions(request({ status }))).toEqual([]);
      expect(
        canTransitionRequestWorkflow(request({ status }), "PROCESSING"),
      ).toBe(false);
    },
  );
});

function request(
  overrides: Partial<RequestWorkflowContext> = {},
): RequestWorkflowContext {
  return {
    type: "DATA_ACCESS",
    status: "SUBMITTED",
    hasPublicAttachments: false,
    latestResponseDeliveryStatus: null,
    verified: false,
    processingStarted: false,
    ...overrides,
  };
}
