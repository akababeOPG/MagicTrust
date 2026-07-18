import { requestStatuses, type RequestStatus, type RequestType } from "./types";

export const requestWorkflowIds = [
  "DATA_ACCESS_STANDARD",
  "DATA_DELETION_STANDARD",
  "GENERIC_REQUEST",
] as const;

export type RequestWorkflowId = (typeof requestWorkflowIds)[number];

export type RequestWorkflowStepDefinition = {
  id: string;
  label: string;
  statusMapping: readonly RequestStatus[];
  terminal?: boolean;
};

export type RequestWorkflowProgressStep = RequestWorkflowStepDefinition & {
  state: "completed" | "current" | "upcoming";
};

export type RequestWorkflowProgressState = {
  steps: RequestWorkflowProgressStep[];
  interruption: "WAITING_FOR_REQUESTER" | "CLOSED_BEFORE_COMPLETION" | null;
};

export type RequestWorkflowActionType =
  | "RESEND_VERIFICATION"
  | "START_PROCESSING"
  | "SEND_RESPONSE"
  | "COMPLETE_REQUEST"
  | "WAIT_FOR_REQUESTER"
  | "REVIEW_REQUEST"
  | "NONE";

export type RequestWorkflowNextStep = {
  key: string;
  title: string;
  description: string;
  listLabel: string;
  actionType: RequestWorkflowActionType;
  actionLabel: string | null;
  terminal: boolean;
};

export type RequestWorkflowContext = {
  type: RequestType;
  status: RequestStatus;
  hasPublicAttachments?: boolean;
  latestResponseDeliveryStatus?: "SENT" | "FAILED" | null;
  verified?: boolean;
  processingStarted?: boolean;
};

export type RequestWorkflowDefinition = {
  id: RequestWorkflowId;
  name: string;
  steps: readonly RequestWorkflowStepDefinition[];
  getCurrentStep(
    request: RequestWorkflowContext,
  ): RequestWorkflowStepDefinition | null;
  getAllowedTransitions(request: RequestWorkflowContext): RequestStatus[];
  getNextStep(request: RequestWorkflowContext): RequestWorkflowNextStep;
  getProgressState(
    request: RequestWorkflowContext,
  ): RequestWorkflowProgressState;
};

const terminalStatuses = new Set<RequestStatus>([
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
]);

const dataAccessSteps = [
  { id: "received", label: "Received", statusMapping: ["SUBMITTED"] },
  {
    id: "verified",
    label: "Verified",
    statusMapping: ["PENDING_VERIFICATION"],
  },
  {
    id: "processing",
    label: "Processing",
    statusMapping: ["VERIFIED", "PROCESSING", "WAITING_FOR_REQUESTER"],
  },
  { id: "response-ready", label: "Response ready", statusMapping: [] },
  {
    id: "completed",
    label: "Completed",
    statusMapping: ["SUCCESS"],
    terminal: true,
  },
] satisfies readonly RequestWorkflowStepDefinition[];

const dataDeletionSteps = [
  { id: "received", label: "Received", statusMapping: ["SUBMITTED"] },
  {
    id: "verified",
    label: "Verified",
    statusMapping: ["PENDING_VERIFICATION"],
  },
  {
    id: "processing",
    label: "Processing",
    statusMapping: ["VERIFIED", "PROCESSING", "WAITING_FOR_REQUESTER"],
  },
  {
    id: "completed",
    label: "Completed",
    statusMapping: ["SUCCESS"],
    terminal: true,
  },
] satisfies readonly RequestWorkflowStepDefinition[];

const genericSteps = [
  {
    id: "received",
    label: "Received",
    statusMapping: ["SUBMITTED", "PENDING_VERIFICATION"],
  },
  {
    id: "processing",
    label: "Processing",
    statusMapping: ["VERIFIED", "PROCESSING", "WAITING_FOR_REQUESTER"],
  },
  {
    id: "completed",
    label: "Completed",
    statusMapping: ["SUCCESS"],
    terminal: true,
  },
] satisfies readonly RequestWorkflowStepDefinition[];

export const dataAccessStandardWorkflow: RequestWorkflowDefinition =
  createWorkflowDefinition({
    id: "DATA_ACCESS_STANDARD",
    name: "Data access standard",
    steps: dataAccessSteps,
    getProgressState: getDataAccessProgressState,
    getNextStep: getDataAccessNextStep,
  });

export const dataDeletionStandardWorkflow: RequestWorkflowDefinition =
  createWorkflowDefinition({
    id: "DATA_DELETION_STANDARD",
    name: "Data deletion standard",
    steps: dataDeletionSteps,
    getProgressState: getDataDeletionProgressState,
    getNextStep: getDataDeletionNextStep,
  });

export const genericRequestWorkflow: RequestWorkflowDefinition =
  createWorkflowDefinition({
    id: "GENERIC_REQUEST",
    name: "Generic request",
    steps: genericSteps,
    getProgressState: getGenericProgressState,
    getNextStep: getGenericNextStep,
  });

export function getWorkflowDefinitionForRequest(
  request: Pick<RequestWorkflowContext, "type">,
): RequestWorkflowDefinition {
  switch (request.type) {
    case "DATA_ACCESS":
      return dataAccessStandardWorkflow;
    case "DATA_DELETION":
      return dataDeletionStandardWorkflow;
    default:
      return genericRequestWorkflow;
  }
}

export function getRequestWorkflowProgress(
  request: RequestWorkflowContext,
): RequestWorkflowProgressState {
  return getWorkflowDefinitionForRequest(request).getProgressState(request);
}

export function getRequestNextStep(
  request: RequestWorkflowContext,
): RequestWorkflowNextStep {
  return getWorkflowDefinitionForRequest(request).getNextStep(request);
}

export function getAllowedWorkflowTransitions(
  request: RequestWorkflowContext,
): RequestStatus[] {
  return getWorkflowDefinitionForRequest(request).getAllowedTransitions(
    request,
  );
}

export function canTransitionRequestWorkflow(
  request: RequestWorkflowContext,
  destination: RequestStatus,
): boolean {
  return getAllowedWorkflowTransitions(request).includes(destination);
}

export function isTerminalRequestStatus(status: RequestStatus): boolean {
  return terminalStatuses.has(status);
}

function createWorkflowDefinition(input: {
  id: RequestWorkflowId;
  name: string;
  steps: readonly RequestWorkflowStepDefinition[];
  getProgressState(
    request: RequestWorkflowContext,
  ): RequestWorkflowProgressState;
  getNextStep(request: RequestWorkflowContext): RequestWorkflowNextStep;
}): RequestWorkflowDefinition {
  const definition: RequestWorkflowDefinition = {
    ...input,
    getCurrentStep(request) {
      const progress = input.getProgressState(request);
      const current = progress.steps.find((step) => step.state === "current");
      const reached = [...progress.steps]
        .reverse()
        .find((step) => step.state === "completed");
      const step = current ?? reached;
      return step
        ? (input.steps.find((candidate) => candidate.id === step.id) ?? null)
        : null;
    },
    getAllowedTransitions(request) {
      if (isTerminalRequestStatus(request.status)) return [];
      return requestStatuses.filter((status) => status !== request.status);
    },
  };

  return definition;
}

function getDataAccessProgressState(
  request: RequestWorkflowContext,
): RequestWorkflowProgressState {
  if (request.status === "SUCCESS") {
    return progressState(dataAccessSteps, dataAccessSteps.length);
  }

  const verified = request.verified ?? false;
  const processingStarted = request.processingStarted ?? false;
  const responseReady = request.hasPublicAttachments ?? false;

  if (request.status === "REJECTED" || request.status === "CANCELLED") {
    const achievedIndex = responseReady
      ? 3
      : processingStarted
        ? 2
        : verified
          ? 1
          : 0;

    return progressState(dataAccessSteps, achievedIndex + 1, null, true);
  }

  if (request.status === "WAITING_FOR_REQUESTER") {
    const currentIndex = responseReady
      ? 3
      : processingStarted
        ? 2
        : verified
          ? 1
          : 0;

    return progressState(
      dataAccessSteps,
      currentIndex,
      "WAITING_FOR_REQUESTER",
    );
  }

  if (request.status === "PENDING_VERIFICATION") {
    return progressState(dataAccessSteps, 1);
  }
  if (request.status === "VERIFIED") {
    return progressState(dataAccessSteps, 2);
  }
  if (request.status === "PROCESSING") {
    return progressState(dataAccessSteps, responseReady ? 3 : 2);
  }

  return progressState(dataAccessSteps, 0);
}

function getGenericProgressState(
  request: RequestWorkflowContext,
): RequestWorkflowProgressState {
  if (request.status === "SUCCESS") {
    return progressState(genericSteps, genericSteps.length);
  }

  if (request.status === "REJECTED" || request.status === "CANCELLED") {
    const achievedCount = request.processingStarted ? 2 : 1;
    return progressState(genericSteps, achievedCount, null, true);
  }

  if (request.status === "WAITING_FOR_REQUESTER") {
    return progressState(genericSteps, 1, "WAITING_FOR_REQUESTER");
  }

  if (request.status === "VERIFIED" || request.status === "PROCESSING") {
    return progressState(genericSteps, 1);
  }

  return progressState(genericSteps, 0);
}

function getDataDeletionProgressState(
  request: RequestWorkflowContext,
): RequestWorkflowProgressState {
  if (request.status === "SUCCESS") {
    return progressState(dataDeletionSteps, dataDeletionSteps.length);
  }

  const verified = request.verified ?? false;
  const processingStarted = request.processingStarted ?? false;

  if (request.status === "REJECTED" || request.status === "CANCELLED") {
    const achievedIndex = processingStarted ? 2 : verified ? 1 : 0;
    return progressState(dataDeletionSteps, achievedIndex + 1, null, true);
  }

  if (request.status === "WAITING_FOR_REQUESTER") {
    const currentIndex = processingStarted ? 2 : verified ? 1 : 0;
    return progressState(
      dataDeletionSteps,
      currentIndex,
      "WAITING_FOR_REQUESTER",
    );
  }

  if (request.status === "PENDING_VERIFICATION") {
    return progressState(dataDeletionSteps, 1);
  }
  if (request.status === "VERIFIED" || request.status === "PROCESSING") {
    return progressState(dataDeletionSteps, 2);
  }

  return progressState(dataDeletionSteps, 0);
}

function progressState(
  steps: readonly RequestWorkflowStepDefinition[],
  currentIndex: number,
  interruption: RequestWorkflowProgressState["interruption"] = null,
  completedOnly = false,
): RequestWorkflowProgressState {
  return {
    interruption: completedOnly ? "CLOSED_BEFORE_COMPLETION" : interruption,
    steps: steps.map((step, index) => ({
      ...step,
      state: completedOnly
        ? index < currentIndex
          ? "completed"
          : "upcoming"
        : currentIndex >= steps.length || index < currentIndex
          ? "completed"
          : index === currentIndex
            ? "current"
            : "upcoming",
    })),
  };
}

function getDataAccessNextStep(
  request: RequestWorkflowContext,
): RequestWorkflowNextStep {
  switch (request.status) {
    case "PENDING_VERIFICATION":
      return nextStep({
        key: "await-verification",
        title: "Waiting for requester verification",
        description:
          "The requester must verify their email before this request can be processed.",
        listLabel: "Waiting for verification",
        actionType: "RESEND_VERIFICATION",
        actionLabel: "Resend verification email",
      });
    case "VERIFIED":
      return nextStep({
        key: "start-processing",
        title: "Ready to process",
        description:
          "The requester's identity has been verified. Review the request and begin fulfillment.",
        listLabel: "Start processing",
        actionType: "START_PROCESSING",
        actionLabel: "Start processing",
      });
    case "PROCESSING":
      if (request.latestResponseDeliveryStatus === "FAILED") {
        return nextStep({
          key: "retry-response",
          title: "Response could not be sent",
          description:
            "The response is ready, but the email delivery failed. Review the error and try again.",
          listLabel: "Retry sending response",
          actionType: "SEND_RESPONSE",
          actionLabel: "Retry sending response",
        });
      }

      if (request.hasPublicAttachments) {
        return nextStep({
          key: "send-response",
          title: "Response ready to send",
          description:
            "The response is ready to be delivered securely to the requester.",
          listLabel:
            request.latestResponseDeliveryStatus === "SENT"
              ? "Complete request"
              : "Send response",
          actionType: "SEND_RESPONSE",
          actionLabel: "Send response and complete request",
        });
      }

      return nextStep({
        key: "prepare-response",
        title: "Prepare the response",
        description:
          "Review the requester's information and prepare the response. A file is optional.",
        listLabel: "Upload response file",
        actionType: "SEND_RESPONSE",
        actionLabel: "Send response and complete request",
      });
    case "WAITING_FOR_REQUESTER":
      return nextStep({
        key: "wait-for-requester",
        title: "Waiting for requester",
        description:
          "Processing is paused until the requester provides the required information.",
        listLabel: "Waiting for requester",
        actionType: "WAIT_FOR_REQUESTER",
      });
    case "SUCCESS":
      return nextStep({
        key: "completed",
        title: "Request completed",
        description: request.hasPublicAttachments
          ? "The response was delivered securely to the requester."
          : "The requester was notified that the request is complete.",
        listLabel: "Completed",
        terminal: true,
      });
    case "REJECTED":
      return nextStep({
        key: "rejected",
        title: "Request rejected",
        description: "This request is closed.",
        listLabel: "Rejected",
        terminal: true,
      });
    case "CANCELLED":
      return nextStep({
        key: "cancelled",
        title: "Request cancelled",
        description: "This request is closed.",
        listLabel: "Cancelled",
        terminal: true,
      });
    case "SUBMITTED":
      return nextStep({
        key: "review-request",
        title: "Review request",
        description:
          "Review the request details and determine the appropriate next step.",
        listLabel: "Review request",
        actionType: "REVIEW_REQUEST",
      });
  }
}

function getGenericNextStep(
  request: RequestWorkflowContext,
): RequestWorkflowNextStep {
  switch (request.status) {
    case "SUBMITTED":
    case "PENDING_VERIFICATION":
      return nextStep({
        key: "review-request",
        title: "Review request",
        description:
          "Review the request details and determine the appropriate next step.",
        listLabel: "Submitted",
        actionType: "REVIEW_REQUEST",
      });
    case "VERIFIED":
      return nextStep({
        key: "ready-to-process",
        title: "Ready to process",
        description: "This request is ready for processing.",
        listLabel: "Ready to process",
        actionType: "NONE",
      });
    case "PROCESSING":
      return nextStep({
        key: "in-progress",
        title: "Request in progress",
        description: "This request is currently being processed.",
        listLabel: "In progress",
        actionType: "NONE",
      });
    case "WAITING_FOR_REQUESTER":
      return nextStep({
        key: "wait-for-requester",
        title: "Waiting for requester",
        description:
          "Processing is paused until the requester provides the required information.",
        listLabel: "Waiting for requester",
        actionType: "WAIT_FOR_REQUESTER",
      });
    case "SUCCESS":
      return nextStep({
        key: "completed",
        title: "Request completed",
        description: "This request has been completed.",
        listLabel: "Completed",
        terminal: true,
      });
    case "REJECTED":
      return nextStep({
        key: "rejected",
        title: "Request rejected",
        description: "This request is closed.",
        listLabel: "Rejected",
        terminal: true,
      });
    case "CANCELLED":
      return nextStep({
        key: "cancelled",
        title: "Request cancelled",
        description: "This request is closed.",
        listLabel: "Cancelled",
        terminal: true,
      });
  }
}

function getDataDeletionNextStep(
  request: RequestWorkflowContext,
): RequestWorkflowNextStep {
  switch (request.status) {
    case "PENDING_VERIFICATION":
      return nextStep({
        key: "await-verification",
        title: "Waiting for requester verification",
        description:
          "The requester must verify their email address before this request can be processed.",
        listLabel: "Waiting for verification",
        actionType: "RESEND_VERIFICATION",
        actionLabel: "Resend verification email",
      });
    case "VERIFIED":
      return nextStep({
        key: "start-processing",
        title: "Ready to process",
        description:
          "The requester has verified their identity. Start processing the deletion request when you are ready.",
        listLabel: "Start processing",
        actionType: "START_PROCESSING",
        actionLabel: "Start processing",
      });
    case "PROCESSING":
      if (request.latestResponseDeliveryStatus === "FAILED") {
        return nextStep({
          key: "retry-completion",
          title: "Completion notification could not be sent",
          description:
            "The request remains in processing. Confirm the completed work and retry the notification.",
          listLabel: "Retry completion",
          actionType: "COMPLETE_REQUEST",
          actionLabel: "Retry completion",
        });
      }

      return nextStep({
        key: "complete-deletion",
        title: "Complete the deletion request",
        description:
          "Complete the required deletion work, add any relevant internal notes or response files, then notify the requester and complete the request.",
        listLabel: "Complete request",
        actionType: "COMPLETE_REQUEST",
        actionLabel: "Complete request",
      });
    case "WAITING_FOR_REQUESTER":
      return nextStep({
        key: "wait-for-requester",
        title: "Waiting for requester",
        description:
          "Processing is paused until the requester provides the required information.",
        listLabel: "Waiting for requester",
        actionType: "WAIT_FOR_REQUESTER",
      });
    case "SUCCESS":
      return nextStep({
        key: "completed",
        title: "Deletion request completed",
        description:
          "The deletion request has been completed and the requester has been notified.",
        listLabel: "Completed",
        terminal: true,
      });
    case "REJECTED":
      return nextStep({
        key: "rejected",
        title: "Deletion request rejected",
        description: "This deletion request is closed.",
        listLabel: "Rejected",
        terminal: true,
      });
    case "CANCELLED":
      return nextStep({
        key: "cancelled",
        title: "Deletion request cancelled",
        description: "This deletion request is closed.",
        listLabel: "Cancelled",
        terminal: true,
      });
    case "SUBMITTED":
      return nextStep({
        key: "review-request",
        title: "Review request",
        description:
          "Review the request details and determine the appropriate next step.",
        listLabel: "Review request",
        actionType: "REVIEW_REQUEST",
      });
  }
}

function nextStep(
  input: Omit<
    RequestWorkflowNextStep,
    "actionLabel" | "actionType" | "terminal"
  > &
    Partial<
      Pick<RequestWorkflowNextStep, "actionLabel" | "actionType" | "terminal">
    >,
): RequestWorkflowNextStep {
  return {
    actionLabel: null,
    actionType: "NONE",
    terminal: false,
    ...input,
  };
}
