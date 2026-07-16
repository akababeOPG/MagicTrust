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
    </>
  );
}
