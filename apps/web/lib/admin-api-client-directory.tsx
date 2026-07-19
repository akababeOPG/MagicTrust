import type { ManagedApiClient } from "@magictrust/database";
import React from "react";

import {
  AdminConfirmSubmitButton,
  AdminSubmitButton,
} from "./admin-request-action-forms";
import { apiClientScopeOptions } from "./admin-api-client-management";

export function AdminApiClientDirectory({
  clients,
  successMessage,
  errorMessage,
}: {
  clients: ManagedApiClient[];
  successMessage?: string;
  errorMessage?: string;
}) {
  return (
    <main className="admin-page admin-users-page">
      <header className="admin-header admin-users-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>API Clients</h1>
          <p>Manage system access to the Internal API.</p>
        </div>
        <details className="admin-add-user-disclosure">
          <summary className="mt-button">Create API client</summary>
          <div className="admin-add-user-panel">
            <div>
              <h2>Create API client</h2>
              <p>Select only the access this integration needs.</p>
            </div>
            <form
              className="admin-user-form"
              action="/admin/api-clients/create"
              method="post"
            >
              <label>
                Name
                <input name="name" maxLength={200} required />
              </label>
              <fieldset>
                <legend>Scopes</legend>
                {apiClientScopeOptions.map((scope) => (
                  <label key={scope.value}>
                    <input type="checkbox" name="scopes" value={scope.value} />{" "}
                    {scope.label}
                  </label>
                ))}
              </fieldset>
              <AdminSubmitButton>Create API client</AdminSubmitButton>
            </form>
          </div>
        </details>
      </header>
      {successMessage ? (
        <div className="mt-feedback mt-feedback-success" role="status">
          {successMessage}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          {errorMessage}
        </div>
      ) : null}
      <section
        className="admin-user-results"
        aria-labelledby="api-clients-heading"
      >
        <div className="admin-user-results-heading">
          <div>
            <h2 id="api-clients-heading">
              {clients.length} {clients.length === 1 ? "client" : "clients"}
            </h2>
            <p>Revoked clients can no longer authenticate.</p>
          </div>
        </div>
        <div className="admin-table-wrap admin-user-table-wrap">
          <table className="admin-table admin-user-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Scopes</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((client) => (
                <tr key={client.id}>
                  <td>
                    <strong>{client.name}</strong>
                  </td>
                  <td>
                    <span
                      className="admin-user-status"
                      data-active={client.active}
                    >
                      <span aria-hidden="true" />
                      {client.active ? "Active" : "Revoked"}
                    </span>
                  </td>
                  <td>{client.scopes.join(", ")}</td>
                  <td>{formatDate(client.createdAt)}</td>
                  <td>
                    {client.lastUsedAt
                      ? formatDate(client.lastUsedAt)
                      : "Never"}
                  </td>
                  <td>
                    {client.active ? (
                      <form
                        action={`/admin/api-clients/${encodeURIComponent(client.id)}/revoke`}
                        method="post"
                      >
                        <AdminConfirmSubmitButton
                          confirmation="Revoke API client? It will immediately lose API access."
                          variant="destructive"
                        >
                          Revoke
                        </AdminConfirmSubmitButton>
                      </form>
                    ) : (
                      <span className="table-secondary">No actions</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}
