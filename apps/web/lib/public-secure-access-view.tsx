import type { RequestStatus, RequestType } from "@magictrust/domain";
import React from "react";

import { MagicTrustWordmark } from "./admin-ui";
import type { PublicSecureAccessData } from "./public-request-api";

export function PublicSecureAccessView(input: {
  publicId: string;
  access: PublicSecureAccessData | null;
}) {
  if (!input.access) {
    return (
      <main className="consumer-secure-page">
        <div className="consumer-secure-shell">
          <ConsumerSecureBrand />
          <section className="consumer-secure-unavailable">
            <p className="consumer-eyebrow">Your request</p>
            <h1>Secure access unavailable</h1>
            <p>This secure access link is invalid, expired, or already used.</p>
          </section>
        </div>
      </main>
    );
  }

  const hero = secureHeroCopy(input.access);
  const attachments = input.access.publicAttachments;
  const updates = secureUpdates(input.access);

  return (
    <main className="consumer-secure-page">
      <div className="consumer-secure-shell">
        <ConsumerSecureBrand />

        <header className="consumer-request-hero">
          <p className="consumer-eyebrow">Your request</p>
          <div className="consumer-request-title-row">
            <h1>{hero.title}</h1>
            <ConsumerStatusBadge status={input.access.status} />
          </div>
          <p className="consumer-request-description">{hero.description}</p>
          <p className="consumer-request-reference">
            Reference: <strong>{input.access.publicId}</strong>
          </p>
        </header>

        {attachments.length > 0 ? (
          <section
            className="consumer-response-section"
            aria-labelledby="consumer-response-heading"
          >
            <div className="consumer-section-heading">
              <h2 id="consumer-response-heading">
                {attachments.length === 1
                  ? "Your response"
                  : "Your response files"}
              </h2>
              <p>Your files are provided through a secure access link.</p>
            </div>
            <ol className="consumer-response-files">
              {attachments.map((attachment) => (
                <li className="consumer-response-file" key={attachment.id}>
                  <span className="consumer-file-kind" aria-hidden="true">
                    {fileKindLabel(attachment.mimeType)}
                  </span>
                  <div className="consumer-file-details">
                    <strong>{attachment.fileName}</strong>
                    <p>
                      {formatFileType(attachment.mimeType)} ·{" "}
                      {formatFileSize(attachment.sizeBytes)}
                    </p>
                    <time dateTime={attachment.createdAt}>
                      Available {formatDate(attachment.createdAt)}
                    </time>
                  </div>
                  <a
                    className="mt-button consumer-download-action"
                    href={attachment.downloadUrl}
                    aria-label={`Download ${attachment.fileName}`}
                  >
                    {attachments.length === 1
                      ? "Download response"
                      : "Download"}
                  </a>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <section
          className="consumer-request-details-section"
          aria-labelledby="consumer-request-details-heading"
        >
          <h2 id="consumer-request-details-heading">Request details</h2>
          <dl className="consumer-request-details">
            <div>
              <dt>Reference number</dt>
              <dd>{input.access.publicId}</dd>
            </div>
            <div>
              <dt>Request type</dt>
              <dd>{formatRequestType(input.access.type)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{formatRequestStatus(input.access.status)}</dd>
            </div>
            <div>
              <dt>Submitted</dt>
              <dd>{formatDate(input.access.createdAt)}</dd>
            </div>
            <div>
              <dt>Completed</dt>
              <dd>
                {input.access.completedAt
                  ? formatDate(input.access.completedAt)
                  : "Not completed"}
              </dd>
            </div>
          </dl>
        </section>

        {updates.length > 0 ? (
          <section
            className="consumer-updates-section"
            aria-labelledby="consumer-updates-heading"
          >
            <h2 id="consumer-updates-heading">Updates</h2>
            <ol className="consumer-updates-list">
              {updates.map((update) => (
                <li key={update.key}>
                  <div>
                    <strong>{update.label}</strong>
                    <time dateTime={update.createdAt}>
                      {formatDate(update.createdAt)}
                    </time>
                  </div>
                  {update.body ? <p>{update.body}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        ) : null}
      </div>
    </main>
  );
}

function ConsumerSecureBrand() {
  return (
    <div className="consumer-secure-brand">
      <MagicTrustWordmark />
      <span className="consumer-secure-indicator">
        <span aria-hidden="true" />
        Secure request access
      </span>
    </div>
  );
}

function ConsumerStatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className="mt-status-badge" data-status={status}>
      <span className="mt-status-glyph" aria-hidden="true" />
      {formatRequestStatus(status)}
    </span>
  );
}

function secureHeroCopy(access: PublicSecureAccessData): {
  title: string;
  description: string;
} {
  if (access.status === "SUCCESS" && access.publicAttachments.length > 0) {
    return {
      title: "Your response is ready",
      description:
        access.publicAttachments.length === 1
          ? "We've completed your request. You can securely download your response file below."
          : "We've completed your request. You can securely download your response files below.",
    };
  }

  switch (access.status) {
    case "PROCESSING":
      return {
        title: "Your request is being processed",
        description:
          "We're still working on your request. You'll receive an email when your response is ready.",
      };
    case "PENDING_VERIFICATION":
      return {
        title: "Verification required",
        description:
          "Please complete the email verification step before your request can be processed.",
      };
    case "VERIFIED":
      return {
        title: "Your request is ready for processing",
        description:
          "Your identity has been verified and your request is waiting to be processed.",
      };
    case "WAITING_FOR_REQUESTER":
      return {
        title: "We need more information",
        description:
          "Your request is waiting for additional information from you.",
      };
    case "REJECTED":
      return {
        title: "Your request could not be completed",
        description:
          latestPublicComment(access) ??
          "Review the updates below for available information about this outcome.",
      };
    case "CANCELLED":
      return {
        title: "Your request was cancelled",
        description:
          latestPublicComment(access) ??
          "Review the updates below for available information about this outcome.",
      };
    case "SUCCESS":
      return {
        title: "Your request is complete",
        description: "We've completed your request.",
      };
    case "SUBMITTED":
      return {
        title: "Your request has been received",
        description: "We'll review your request and keep you updated here.",
      };
  }
}

function latestPublicComment(access: PublicSecureAccessData): string | null {
  return (
    [...access.publicComments].sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    )[0]?.body ?? null
  );
}

function secureUpdates(access: PublicSecureAccessData) {
  return [
    ...access.publicComments.map((comment, index) => ({
      key: `comment:${comment.createdAt}:${index}`,
      label: "Message from MagicTrust",
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    ...access.publicEvents.map((event, index) => ({
      key: `event:${event.createdAt}:${index}`,
      label: formatNaturalName(event.type),
      body: null,
      createdAt: event.createdAt,
    })),
  ].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

const requestTypeLabels: Record<RequestType, string> = {
  DATA_ACCESS: "Data access",
  DATA_DELETION: "Data deletion",
  DO_NOT_CONTACT: "Do not contact",
  UNSUBSCRIBE: "Unsubscribe",
  GENERAL_INQUIRY: "General inquiry",
};

const requestStatusLabels: Record<RequestStatus, string> = {
  SUBMITTED: "Submitted",
  PENDING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  PROCESSING: "In progress",
  WAITING_FOR_REQUESTER: "Waiting on you",
  SUCCESS: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

function formatRequestType(type: RequestType): string {
  return requestTypeLabels[type];
}

function formatRequestStatus(status: RequestStatus): string {
  return requestStatusLabels[status];
}

const fileTypeLabels: Record<string, string> = {
  "application/pdf": "PDF document",
  "application/zip": "ZIP archive",
  "application/json": "JSON file",
  "text/csv": "CSV file",
  "text/plain": "Text file",
};

const fileKindLabels: Record<string, string> = {
  "application/pdf": "PDF",
  "application/zip": "ZIP",
  "application/json": "JSON",
  "text/csv": "CSV",
  "text/plain": "TXT",
};

function formatFileType(mimeType: string): string {
  return fileTypeLabels[mimeType] ?? "File";
}

function fileKindLabel(mimeType: string): string {
  return fileKindLabels[mimeType] ?? "FILE";
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return "Less than 1 KB";

  const units = ["KB", "MB", "GB"] as const;
  let value = sizeBytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const digits = value < 10 && !Number.isInteger(value) ? 1 : 0;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatNaturalName(value: string): string {
  return value
    .toLowerCase()
    .split("_")
    .filter(Boolean)
    .map((part, index) =>
      index === 0 ? part.charAt(0).toUpperCase() + part.slice(1) : part,
    )
    .join(" ");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
