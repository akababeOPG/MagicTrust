import React from "react";

import { PublicAccessLinkRequestForm } from "./public-access-link-request-form";
import type { PublicRequestTrackingData } from "./public-request-api";

export function PublicRequestTrackingView(input: {
  publicId: string;
  tracking: PublicRequestTrackingData | null;
  showAccessLinkRequest?: boolean;
}) {
  if (!input.tracking) {
    return (
      <main className="tracking-page">
        <section className="tracking-shell">
          <h1>Request not found</h1>
          <p>No public request was found for {input.publicId}.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="tracking-page">
      <section className="tracking-shell" aria-labelledby="tracking-title">
        <div className="form-heading">
          <h1 id="tracking-title">Request Status</h1>
          <p>
            Reference number: <strong>{input.tracking.publicId}</strong>
          </p>
        </div>

        <dl className="tracking-summary">
          <div>
            <dt>Request type</dt>
            <dd>{formatRequestType(input.tracking.type)}</dd>
          </div>
          <div>
            <dt>Current status</dt>
            <dd>{formatRequestStatus(input.tracking.status)}</dd>
          </div>
          <div>
            <dt>Created</dt>
            <dd>{formatDate(input.tracking.createdAt)}</dd>
          </div>
          {input.tracking.completedAt ? (
            <div>
              <dt>Completed</dt>
              <dd>{formatDate(input.tracking.completedAt)}</dd>
            </div>
          ) : null}
        </dl>

        {input.showAccessLinkRequest === false ? null : (
          <PublicAccessLinkRequestForm publicId={input.tracking.publicId} />
        )}

        <section className="public-comments" aria-labelledby="comments-title">
          <h2 id="comments-title">Public Comments</h2>
          {input.tracking.publicComments.length > 0 ? (
            <ol>
              {input.tracking.publicComments.map((comment) => (
                <li key={`${comment.createdAt}:${comment.body}`}>
                  <p>{comment.body}</p>
                  <time dateTime={comment.createdAt}>
                    {formatDate(comment.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>No public comments yet.</p>
          )}
        </section>

        <section className="public-events" aria-labelledby="events-title">
          <h2 id="events-title">Public Updates</h2>
          {input.tracking.publicEvents.length > 0 ? (
            <ol>
              {input.tracking.publicEvents.map((event) => (
                <li key={`${event.createdAt}:${event.type}`}>
                  <p>{formatRequestType(event.type)}</p>
                  <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  <time dateTime={event.createdAt}>
                    {formatDate(event.createdAt)}
                  </time>
                </li>
              ))}
            </ol>
          ) : (
            <p>No public updates yet.</p>
          )}
        </section>
      </section>
    </main>
  );
}

function formatRequestType(type: string): string {
  return type
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRequestStatus(status: string): string {
  return formatRequestType(status);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
