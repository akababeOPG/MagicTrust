import React from "react";

import type { PublicSecureAccessData } from "./public-request-api";
import { PublicRequestTrackingView } from "./public-request-tracking-view";

export function PublicSecureAccessView(input: {
  publicId: string;
  access: PublicSecureAccessData | null;
}) {
  if (!input.access) {
    return (
      <main className="tracking-page">
        <section className="tracking-shell">
          <h1>Secure access unavailable</h1>
          <p>This secure access link is invalid, expired, or already used.</p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="secure-access-banner" role="status">
        Secure access verified
      </div>
      <PublicRequestTrackingView
        publicId={input.publicId}
        tracking={input.access}
        showAccessLinkRequest={false}
      />
      <main className="tracking-page secure-attachments-page">
        <section className="tracking-shell" aria-labelledby="attachments-title">
          <h2 id="attachments-title">Attachments</h2>
          {input.access.publicAttachments.length > 0 ? (
            <ol className="public-attachments">
              {input.access.publicAttachments.map((attachment) => (
                <li key={attachment.id}>
                  <div>
                    <p>
                      <strong>{attachment.fileName}</strong>
                    </p>
                    <p>
                      {attachment.mimeType} · {attachment.sizeBytes} bytes ·{" "}
                      {formatDate(attachment.createdAt)}
                    </p>
                  </div>
                  <a href={attachment.downloadUrl}>Download</a>
                </li>
              ))}
            </ol>
          ) : (
            <p>No public attachments yet.</p>
          )}
        </section>
      </main>
    </>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}
