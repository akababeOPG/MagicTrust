"use client";

import type { ManagedApiClient } from "@magictrust/database";
import React, { useReducer, useState } from "react";

import { AdminConfirmSubmitButton } from "./admin-request-action-forms";

type ClientView = Omit<ManagedApiClient, "createdAt" | "lastUsedAt"> & {
  createdAt: Date | string;
  lastUsedAt: Date | string | null;
};

type CreatedClient = { client: ClientView; apiKey: string };
export type ApiClientCreationState = {
  createOpen: boolean;
  created: CreatedClient | null;
  clients: ClientView[];
};
type CreationAction =
  | { type: "OPEN_CREATE" }
  | { type: "CANCEL_CREATE" }
  | { type: "CREATED"; value: CreatedClient }
  | { type: "DONE" };

export function reduceApiClientCreationState(
  state: ApiClientCreationState,
  action: CreationAction,
): ApiClientCreationState {
  if (action.type === "OPEN_CREATE") return { ...state, createOpen: true };
  if (action.type === "CANCEL_CREATE") return { ...state, createOpen: false };
  if (action.type === "DONE") return { ...state, created: null };
  return {
    createOpen: false,
    created: action.value,
    clients: [action.value.client, ...state.clients],
  };
}

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
  { label: "Attachments", scopes: ["attachments:read", "attachments:write"] },
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
  scopeOptions,
  successMessage,
  errorMessage,
}: {
  clients: ManagedApiClient[];
  scopeOptions: Array<{ value: string; label: string }>;
  successMessage?: string;
  errorMessage?: string;
}) {
  const [state, dispatch] = useReducer(reduceApiClientCreationState, {
    createOpen: false,
    created: null,
    clients,
  });
  const [submitting, setSubmitting] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submitCreate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setSubmitting(true);
    setCreateError(null);
    try {
      const response = await fetch("/admin/api-clients/create", {
        method: "POST",
        body: new FormData(form),
      });
      const body = (await response.json()) as CreatedClient & {
        error?: { message?: string };
      };
      if (!response.ok) {
        setCreateError(
          body.error?.message ?? "API client could not be created.",
        );
        return;
      }
      form.reset();
      setCopied(false);
      dispatch({ type: "CREATED", value: body });
    } catch {
      setCreateError("API client could not be created.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="admin-page admin-users-page">
      <header className="admin-header admin-users-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>API Clients</h1>
          <p>Manage system access to the Internal API.</p>
        </div>
        <button type="button" onClick={() => dispatch({ type: "OPEN_CREATE" })}>
          Create API client
        </button>
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
      <ClientTable clients={state.clients} />

      {state.createOpen ? (
        <div className="mt-dialog-backdrop">
          <div
            className="mt-dialog admin-api-client-create-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="create-api-client-title"
          >
            <div>
              <h2 id="create-api-client-title">Create API client</h2>
              <p>Select only the access this integration needs.</p>
            </div>
            {createError ? (
              <div className="mt-feedback mt-feedback-error" role="alert">
                {createError}
              </div>
            ) : null}
            <form className="admin-user-form" onSubmit={submitCreate}>
              <label>
                Name
                <input name="name" maxLength={200} required autoFocus />
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
                      const scope = scopeOptions.find(
                        (option) => option.value === value,
                      );
                      return scope ? (
                        <label className="admin-api-client-scope" key={value}>
                          <input type="checkbox" name="scopes" value={value} />
                          <span>
                            <strong>{scope.label}</strong>
                            <small>{scopeDescriptions[value]}</small>
                          </span>
                        </label>
                      ) : null;
                    })}
                  </div>
                ))}
              </fieldset>
              <div className="mt-dialog-actions">
                <button
                  className="mt-button-secondary"
                  type="button"
                  onClick={() => dispatch({ type: "CANCEL_CREATE" })}
                >
                  Cancel
                </button>
                <button type="submit" disabled={submitting}>
                  {submitting ? "Creating..." : "Create API client"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {state.created ? (
        <div className="mt-dialog-backdrop">
          <div
            className="mt-dialog admin-api-client-success"
            role="dialog"
            aria-modal="true"
            aria-labelledby="api-client-created-title"
          >
            <div>
              <p className="eyebrow">API client created</p>
              <h2 id="api-client-created-title">{state.created.client.name}</h2>
            </div>
            <div className="mt-feedback mt-feedback-success" role="status">
              <strong>
                Copy this API key now. You won&apos;t be able to see it again.
              </strong>
            </div>
            <label>
              API key
              <input
                className="admin-api-client-secret"
                value={state.created.apiKey}
                readOnly
              />
            </label>
            <div className="mt-dialog-actions">
              <button
                className="mt-button-secondary"
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(state.created!.apiKey);
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy"}
              </button>
              <button type="button" onClick={() => dispatch({ type: "DONE" })}>
                Done
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ClientTable({ clients }: { clients: ClientView[] }) {
  return (
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
                  {client.lastUsedAt ? formatDate(client.lastUsedAt) : "Never"}
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
  );
}

function ScopeSummary({ scopes }: { scopes: string[] }) {
  const visible = scopes.slice(0, 3);
  const remaining = scopes.length - visible.length;
  return (
    <div className="admin-api-client-scope-summary" title={scopes.join(", ")}>
      {visible.map((scope) => (
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

function formatDate(value: Date | string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
