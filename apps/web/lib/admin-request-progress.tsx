import type { RequestStatus } from "@magictrust/domain";
import React from "react";

export type RequestProgressStageState = "completed" | "current" | "upcoming";

export type RequestProgressStage = {
  label: string;
  state: RequestProgressStageState;
};

const stageLabels = [
  "Received",
  "Verified",
  "Processing",
  "Response ready",
  "Completed",
] as const;

export function getDataAccessProgress({
  status,
  responseReady,
  verified = false,
  processingStarted = false,
}: {
  status: RequestStatus;
  responseReady: boolean;
  verified?: boolean;
  processingStarted?: boolean;
}): RequestProgressStage[] {
  if (status === "SUCCESS") {
    return stageLabels.map((label) => ({ label, state: "completed" }));
  }

  if (status === "REJECTED" || status === "CANCELLED") {
    const achievedIndex = responseReady
      ? 3
      : processingStarted
        ? 2
        : verified
          ? 1
          : 0;

    return stageLabels.map((label, index) => ({
      label,
      state: index <= achievedIndex ? "completed" : "upcoming",
    }));
  }

  if (status === "WAITING_FOR_REQUESTER") {
    const currentIndex = responseReady
      ? 3
      : processingStarted
        ? 2
        : verified
          ? 1
          : 0;

    return stagesWithCurrent(currentIndex);
  }

  if (status === "PENDING_VERIFICATION") return stagesWithCurrent(1);
  if (status === "VERIFIED") return stagesWithCurrent(2);
  if (status === "PROCESSING") return stagesWithCurrent(responseReady ? 3 : 2);

  return stagesWithCurrent(0);
}

export function RequestProgress({
  status,
  responseReady,
  verified,
  processingStarted,
}: {
  status: RequestStatus;
  responseReady: boolean;
  verified?: boolean;
  processingStarted?: boolean;
}) {
  const stages = getDataAccessProgress({
    status,
    responseReady,
    verified,
    processingStarted,
  });
  const terminal = status === "REJECTED" || status === "CANCELLED";
  const waiting = status === "WAITING_FOR_REQUESTER";

  return (
    <section className="request-progress-card" aria-label="Request progress">
      {terminal ? (
        <span className="request-progress-interruption request-progress-terminal">
          Closed before completion
        </span>
      ) : waiting ? (
        <span className="request-progress-interruption">
          Waiting for requester
        </span>
      ) : null}
      <ol className="request-progress">
        {stages.map((stage, index) => (
          <li
            key={stage.label}
            data-state={stage.state}
            aria-label={`${stage.label}: ${stage.state}`}
            aria-current={stage.state === "current" ? "step" : undefined}
          >
            <span className="request-progress-marker" aria-hidden="true">
              {stage.state === "completed" ? (
                <CheckIcon />
              ) : stage.state === "current" ? (
                <span className="request-progress-current-dot" />
              ) : (
                index + 1
              )}
            </span>
            <strong className="request-progress-label">{stage.label}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function stagesWithCurrent(currentIndex: number): RequestProgressStage[] {
  return stageLabels.map((label, index) => ({
    label,
    state:
      index < currentIndex
        ? "completed"
        : index === currentIndex
          ? "current"
          : "upcoming",
  }));
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
      <path
        d="m3.5 8 2.7 2.7 6.3-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
