import type {
  RequestWorkflowProgressState,
  RequestWorkflowProgressStep,
} from "@magictrust/domain";
import React, { type CSSProperties } from "react";

export function RequestProgress({
  steps,
  interruption = null,
}: {
  steps: readonly RequestWorkflowProgressStep[];
  interruption?: RequestWorkflowProgressState["interruption"];
}) {
  return (
    <section className="request-progress-card" aria-label="Request progress">
      {interruption === "CLOSED_BEFORE_COMPLETION" ? (
        <span className="request-progress-interruption request-progress-terminal">
          Closed before completion
        </span>
      ) : interruption === "WAITING_FOR_REQUESTER" ? (
        <span className="request-progress-interruption">
          Waiting for requester
        </span>
      ) : null}
      <ol
        className="request-progress"
        style={
          {
            "--request-progress-step-count": steps.length,
          } as CSSProperties
        }
      >
        {steps.map((stage, index) => (
          <li
            key={stage.id}
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
