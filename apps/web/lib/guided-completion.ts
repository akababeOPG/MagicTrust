import type { RequestWorkflowId } from "@magictrust/domain";

export type GuidedCompletionConfig = {
  confirmationError: string;
  subject: string;
  messageWithoutFiles: string;
  messageWithFiles: string;
  includeSecureAccessLink: boolean;
  statusReason: string;
  successMessage: string;
};

export function guidedCompletionConfig(
  workflowId: RequestWorkflowId,
): GuidedCompletionConfig | null {
  if (workflowId === "DATA_DELETION_STANDARD") {
    return {
      confirmationError:
        "Confirm that the deletion request has been processed.",
      subject: "Your data deletion request has been completed",
      messageWithoutFiles: "Your data deletion request has been completed.",
      messageWithFiles:
        "Your data deletion request has been completed.\n\nResponse files are available securely.",
      includeSecureAccessLink: false,
      statusReason: "Deletion request completed from admin dashboard",
      successMessage: "Deletion request completed.",
    };
  }

  if (workflowId === "DIRECT_PROCESSING") {
    return {
      confirmationError: "Confirm that this request has been processed.",
      subject: "Your request has been completed",
      messageWithoutFiles: "Your request has been completed.",
      messageWithFiles:
        "Your request has been completed.\n\nResponse files are available securely.",
      includeSecureAccessLink: false,
      statusReason: "Request completed from admin dashboard",
      successMessage: "Request completed.",
    };
  }

  if (workflowId === "CONVERSATIONAL_PROCESSING") {
    return {
      confirmationError: "Confirm that this request has been processed.",
      subject: "Your request has been completed",
      messageWithoutFiles: "Your request has been completed.",
      messageWithFiles:
        "Your request has been completed.\n\nResponse files are available securely.",
      includeSecureAccessLink: true,
      statusReason: "Request completed from admin dashboard",
      successMessage: "Request completed.",
    };
  }

  return null;
}
