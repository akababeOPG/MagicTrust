"use client";

import React from "react";
import { FormEvent, useState } from "react";

import { submitPrivacyRequestForm } from "../../../lib/privacy-request-form-submit";

const requestTypes = [
  "DATA_ACCESS",
  "DATA_DELETION",
  "DO_NOT_CONTACT",
  "UNSUBSCRIBE",
  "GENERAL_INQUIRY",
] as const;

type SubmissionState =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "error"; message: string }
  | {
      status: "success";
      publicId: string;
      requestStatus: string;
    };

export default function PrivacyRequestFormPage() {
  const [submission, setSubmission] = useState<SubmissionState>({
    status: "idle",
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    setSubmission({ status: "submitting" });

    const sourceUrl =
      typeof window === "undefined" ? undefined : window.location.href;
    const result = await submitPrivacyRequestForm(formData, sourceUrl, () =>
      form.reset(),
    );

    if (!result.ok) {
      setSubmission({
        status: "error",
        message: result.message,
      });
      return;
    }

    setSubmission({
      status: "success",
      publicId: result.publicId,
      requestStatus: result.requestStatus,
    });
  }

  return (
    <main className="form-page">
      <section className="form-shell" aria-labelledby="privacy-request-title">
        <div className="form-heading">
          <h1 id="privacy-request-title">Privacy Request</h1>
          <p>Submit a privacy or preference request to MagicTrust.</p>
        </div>

        {submission.status === "success" ? (
          <div className="confirmation" role="status">
            <h2>Request submitted</h2>
            <p>
              Reference number: <strong>{submission.publicId}</strong>
            </p>
            <p>Current status: {submission.requestStatus}</p>
            <p>Save this reference number for your records.</p>
          </div>
        ) : null}

        <form className="privacy-form" onSubmit={handleSubmit}>
          <label>
            Request type
            <select name="type" required defaultValue="DATA_ACCESS">
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {formatRequestType(type)}
                </option>
              ))}
            </select>
          </label>

          <div className="field-row">
            <label>
              First name
              <input
                name="firstName"
                type="text"
                autoComplete="given-name"
                required
              />
            </label>
            <label>
              Last name
              <input
                name="lastName"
                type="text"
                autoComplete="family-name"
                required
              />
            </label>
          </div>

          <label>
            Email
            <input name="email" type="email" autoComplete="email" required />
          </label>

          <label>
            Phone
            <input name="phone" type="tel" autoComplete="tel" />
          </label>

          <label>
            Message
            <textarea name="message" rows={5} />
          </label>

          <input
            aria-hidden="true"
            className="honeypot"
            name="website"
            tabIndex={-1}
            type="text"
            autoComplete="off"
          />

          {submission.status === "error" ? (
            <p className="form-error" role="alert">
              {submission.message}
            </p>
          ) : null}

          <button type="submit" disabled={submission.status === "submitting"}>
            {submission.status === "submitting"
              ? "Submitting..."
              : "Submit request"}
          </button>
        </form>
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
