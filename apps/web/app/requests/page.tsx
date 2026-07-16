import { redirect } from "next/navigation";
import React from "react";

export default async function PublicRequestLookupPage(input: {
  searchParams?: Promise<{ publicId?: string }>;
}) {
  const searchParams = input.searchParams ? await input.searchParams : {};
  const publicId = searchParams.publicId?.trim();

  if (publicId) {
    redirect(`/requests/${encodeURIComponent(publicId)}`);
  }

  return (
    <main className="tracking-page">
      <section className="tracking-shell" aria-labelledby="lookup-title">
        <div className="form-heading">
          <h1 id="lookup-title">Track a Request</h1>
          <p>Enter the reference number from your MagicTrust request.</p>
        </div>

        <form className="privacy-form" method="get" action="/requests">
          <label>
            Reference number
            <input
              name="publicId"
              type="text"
              autoComplete="off"
              placeholder="req_example"
              required
            />
          </label>
          <button type="submit">Track request</button>
        </form>
      </section>
    </main>
  );
}
