"use client";

import { useState } from "react";

export function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    const response = await fetch("/api/admin/auth/request-link", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ email }),
    });
    const body = (await response.json()) as { message?: string };

    setIsSubmitting(false);
    setMessage(
      body.message ??
        "If an active admin user exists, a login link will be sent.",
    );
  }

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      <label>
        Email
        <input
          autoComplete="email"
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <button disabled={isSubmitting} type="submit">
        {isSubmitting ? "Sending..." : "Send login link"}
      </button>
      {message ? <p className="admin-message">{message}</p> : null}
    </form>
  );
}
