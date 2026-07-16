import React from "react";

export function PrivacyRequestConfirmation(input: {
  publicId: string;
  requestStatus: string;
}) {
  return (
    <div className="confirmation" role="status">
      <h2>Request submitted</h2>
      <p>
        Reference number: <strong>{input.publicId}</strong>
      </p>
      <p>Current status: {input.requestStatus}</p>
      <p>Save this reference number for your records.</p>
      <p>
        <a href={`/requests/${input.publicId}`}>Track this request</a>
      </p>
    </div>
  );
}
