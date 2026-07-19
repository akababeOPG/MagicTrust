import type { ManagedApiClient } from "@magictrust/database";
import Link from "next/link";
import React from "react";

import {
  AdminConfirmSubmitButton,
  AdminSubmitButton,
} from "./admin-request-action-forms";
import { apiClientScopeOptions } from "./admin-api-client-management";

const scopeDescriptions: Record<string, string> = {
  "requests:read": "Read and search privacy requests",
  "requests:processing-data:read": "Read data needed for downstream processing",
  "requests:create": "Create privacy requests",
  "requests:update": "Update request status and processing data",
  "requests:processing-result:write":
    "Report successful or rejected processing outcomes",
  "comments:write": "Add request comments",
  "attachments:write": "Add request attachments",
  "attachments:read": "Download request attachments",
  "communications:write": "Send outbound email communications",
  "notifications:write": "Send consumer notifications",
  "events:write": "Record custom request events",
};

const scopeGroups = [
  {
    label: "Requests",
    scopes: ["requests:read", "requests:create", "requests:update"],
  },
  {
    label: "Processing",
    scopes: [
      "requests:processing-data:read",
      "requests:processing-result:write",
    ],
  },
  {
    label: "Attachments",
    scopes: ["attachments:read", "attachments:write"],
  },
  {
    label: "Communications and activity",
    scopes: [
      "communications:write",
      "notifications:write",
      "comments:write",
      "events:write",
    ],
  },
];

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
        <details className="admin-add-user-disclosure admin-api-client-create">
          <summary className="mt-button">Create API client</summary>
          <div className="mt-dialog admin-api-client-create-panel">
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
              <fieldset className="admin-api-client-scopes">
                <legend>Scopes</legend>
                {scopeGroups.map((group) => (
                  <div
                    className="admin-api-client-scope-group"
                    key={group.label}
                  >
                    <h3>{group.label}</h3>
                    {group.scopes.map((value) => {
                      const scope = apiClientScopeOptions.find(
                        (option) => option.value === value,
                      );
                      if (!scope) return null;
                      return (
                        <label className="admin-api-client-scope" key={value}>
                          <input type="checkbox" name="scopes" value={value} />
                          <span>
                            <strong>{scope.label}</strong>
                            <small>{scopeDescriptions[value]}</small>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ))}
              </fieldset>
              <div className="mt-dialog-actions">
                <Link
                  className="mt-button mt-button-secondary"
                  href="/admin/api-clients"
                >
                  Cancel
                </Link>
                <AdminSubmitButton>Create API client</AdminSubmitButton>
              </div>
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
                  <td>
                    <ScopeSummary scopes={client.scopes} />
                  </td>
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

function ScopeSummary({ scopes }: { scopes: string[] }) {
  const visibleScopes = scopes.slice(0, 3);
  const remaining = scopes.length - visibleScopes.length;
  return (
    <div className="admin-api-client-scope-summary" title={scopes.join(", ")}>
      {visibleScopes.map((scope) => (
        <span className="admin-api-client-scope-chip" key={scope}>
          {scope}
        </span>
      ))}
      {remaining > 0 ? (
        <span className="admin-api-client-scope-more">+{remaining} more</span>
      ) : null}
    </div>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(value);
}
