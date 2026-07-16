"use client";

import React, { useState } from "react";

export function PublicAccessLinkRequestForm(input: { publicId: string }) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "submitting" }
    | { status: "success"; message: string }
  >({ status: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setState({ status: "submitting" });

    const response = await fetch(
      `/api/public/requests/${encodeURIComponent(input.publicId)}/access-link`,
      {
        method: "POST",
      },
    );
    const body = (await response.json()) as { message?: string };

    setState({
      status: "success",
      message:
        body.message ?? "If the request exists, an access link will be sent.",
    });
  }

  return (
    <form className="access-link-form" onSubmit={handleSubmit}>
      <button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting"
          ? "Sending..."
          : "Send me a secure access link"}
      </button>
      {state.status === "success" ? <p role="status">{state.message}</p> : null}
    </form>
  );
}
