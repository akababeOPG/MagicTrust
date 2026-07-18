import { describe, expect, test } from "vitest";

import {
  canTransitionRequestWorkflow,
  directProcessingWorkflow,
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

  test("DATA_DELETION resolves to DATA_DELETION_STANDARD", () => {
    expect(
      getWorkflowDefinitionForRequest(request({ type: "DATA_DELETION" })).id,
    ).toBe("DATA_DELETION_STANDARD");
  });

  test.each<RequestType>(["DO_NOT_CONTACT", "UNSUBSCRIBE"])(
    "%s resolves to DIRECT_PROCESSING",
    (type) => {
      expect(getWorkflowDefinitionForRequest(request({ type }))).toBe(
        directProcessingWorkflow,
      );
    },
  );

  test("GENERAL_INQUIRY remains on GENERIC_REQUEST", () => {
    expect(
      getWorkflowDefinitionForRequest(request({ type: "GENERAL_INQUIRY" })).id,
    ).toBe("GENERIC_REQUEST");
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

  test("DIRECT_PROCESSING uses the expected shared three-stage workflow", () => {
    expect(directProcessingWorkflow.steps.map((step) => step.label)).toEqual([
      "Received",
      "Processing",
      "Completed",
    ]);
  });

  test.each([
    ["SUBMITTED", ["current", "upcoming", "upcoming"]],
    ["PROCESSING", ["completed", "current", "upcoming"]],
    ["SUCCESS", ["completed", "completed", "completed"]],
  ] as const)("maps DIRECT_PROCESSING %s progress", (status, states) => {
    expect(
      getRequestWorkflowProgress(
        request({ type: "DO_NOT_CONTACT", status }),
      ).steps.map((step) => step.state),
    ).toEqual(states);
  });

  test.each<RequestStatus>(["REJECTED", "CANCELLED"])(
    "DIRECT_PROCESSING %s closes without successful completion",
    (status) => {
      const progress = getRequestWorkflowProgress(
        request({ type: "UNSUBSCRIBE", status }),
      );

      expect(progress.interruption).toBe("CLOSED_BEFORE_COMPLETION");
      expect(progress.steps.at(-1)?.state).toBe("upcoming");
    },
  );

  test("DIRECT_PROCESSING exposes generic next-step metadata", () => {
    const direct = (status: RequestStatus) =>
      request({ type: "DO_NOT_CONTACT", status });

    expect(getRequestNextStep(direct("SUBMITTED"))).toMatchObject({
      title: "Ready to process",
      listLabel: "Start processing",
      actionType: "START_PROCESSING",
    });
    expect(getRequestNextStep(direct("PROCESSING"))).toMatchObject({
      title: "Complete request",
      description:
        "Complete the required internal action, add any relevant notes or response files, then notify the requester and complete the request.",
      listLabel: "Complete request",
      actionType: "COMPLETE_REQUEST",
    });
    expect(
      getRequestNextStep({
        ...direct("PROCESSING"),
        latestResponseDeliveryStatus: "FAILED",
      }),
    ).toMatchObject({
      title: "Completion notification could not be sent",
      listLabel: "Retry completion",
      actionType: "COMPLETE_REQUEST",
    });
    expect(getRequestNextStep(direct("SUCCESS"))).toMatchObject({
      title: "Request completed",
      description:
        "This request has been completed and the requester has been notified.",
      listLabel: "Completed",
      terminal: true,
    });
    expect(getRequestNextStep(direct("REJECTED")).listLabel).toBe("Rejected");
    expect(getRequestNextStep(direct("CANCELLED")).listLabel).toBe("Cancelled");
  });

  test("DIRECT_PROCESSING permits only its lifecycle and terminal alternatives", () => {
    const submitted = request({ type: "UNSUBSCRIBE", status: "SUBMITTED" });
    const processing = request({
      type: "UNSUBSCRIBE",
      status: "PROCESSING",
    });

    expect(getAllowedWorkflowTransitions(submitted)).toEqual([
      "PROCESSING",
      "REJECTED",
      "CANCELLED",
    ]);
    expect(getAllowedWorkflowTransitions(processing)).toEqual([
      "SUCCESS",
      "REJECTED",
      "CANCELLED",
    ]);
    expect(canTransitionRequestWorkflow(submitted, "PROCESSING")).toBe(true);
    expect(canTransitionRequestWorkflow(processing, "SUCCESS")).toBe(true);
    expect(canTransitionRequestWorkflow(submitted, "SUCCESS")).toBe(false);
  });

  test("DATA_DELETION uses the expected four-stage workflow", () => {
    expect(
      getWorkflowDefinitionForRequest(
        request({ type: "DATA_DELETION" }),
      ).steps.map((step) => step.label),
    ).toEqual(["Received", "Verified", "Processing", "Completed"]);
  });

  test.each([
    ["PENDING_VERIFICATION", ["completed", "current", "upcoming", "upcoming"]],
    ["VERIFIED", ["completed", "completed", "current", "upcoming"]],
    ["PROCESSING", ["completed", "completed", "current", "upcoming"]],
    ["SUCCESS", ["completed", "completed", "completed", "completed"]],
  ] as const)("maps DATA_DELETION %s progress", (status, states) => {
    expect(
      getRequestWorkflowProgress(
        request({ type: "DATA_DELETION", status }),
      ).steps.map((step) => step.state),
    ).toEqual(states);
  });

  test("DATA_DELETION next steps guide verification through completion", () => {
    const deletion = (status: RequestStatus) =>
      request({ type: "DATA_DELETION", status });

    expect(getRequestNextStep(deletion("PENDING_VERIFICATION"))).toMatchObject({
      title: "Waiting for requester verification",
      listLabel: "Waiting for verification",
      actionType: "RESEND_VERIFICATION",
    });
    expect(getRequestNextStep(deletion("VERIFIED"))).toMatchObject({
      title: "Ready to process",
      listLabel: "Start processing",
      actionType: "START_PROCESSING",
    });
    expect(getRequestNextStep(deletion("PROCESSING"))).toMatchObject({
      title: "Complete the deletion request",
      listLabel: "Complete request",
      actionType: "COMPLETE_REQUEST",
    });
    expect(getRequestNextStep(deletion("SUCCESS"))).toMatchObject({
      title: "Deletion request completed",
      listLabel: "Completed",
      terminal: true,
    });
  });

  test("DATA_DELETION workflow allows processing and completion", () => {
    expect(
      canTransitionRequestWorkflow(
        request({ type: "DATA_DELETION", status: "VERIFIED" }),
        "PROCESSING",
      ),
    ).toBe(true);
    expect(
      canTransitionRequestWorkflow(
        request({ type: "DATA_DELETION", status: "PROCESSING" }),
        "SUCCESS",
      ),
    ).toBe(true);
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
