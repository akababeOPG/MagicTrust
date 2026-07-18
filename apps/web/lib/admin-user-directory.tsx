import type { AdminRole } from "@magictrust/database";
import Link from "next/link";
import React from "react";

import type { AdminSession } from "./admin-auth";
import {
  AdminConfirmSubmitButton,
  AdminSubmitButton,
} from "./admin-request-action-forms";
import type {
  AdminUserListItem,
  AdminUserListResult,
} from "./admin-user-management";

const roleOptions: Array<{ value: AdminRole; label: string }> = [
  { value: "ADMIN", label: "Admin" },
  { value: "OPERATOR", label: "Operator" },
  { value: "VIEWER", label: "Viewer" },
];

export function AdminUserDirectory({
  session,
  params,
  result,
  successMessage,
  errorMessage,
}: {
  session: AdminSession;
  params: URLSearchParams;
  result: AdminUserListResult;
  successMessage?: string;
  errorMessage?: string;
}) {
  return (
    <main className="admin-page admin-users-page">
      <header className="admin-header admin-users-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Users</h1>
          <p>Manage access to MagicTrust.</p>
        </div>
        <details className="admin-add-user-disclosure">
          <summary className="mt-button">Add user</summary>
          <div className="admin-add-user-panel">
            <div>
              <h2>Add user</h2>
              <p>Create access through the existing magic-link sign-in.</p>
            </div>
            <form
              className="admin-user-form"
              action="/admin/users/create"
              method="post"
            >
              <label>
                Email
                <input
                  type="email"
                  name="email"
                  autoComplete="email"
                  maxLength={320}
                  required
                />
              </label>
              <label>
                Role
                <select name="role" defaultValue="OPERATOR" required>
                  {roleOptions.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </label>
              <AdminSubmitButton>Add user</AdminSubmitButton>
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

      <section className="admin-user-filters" aria-labelledby="user-filters">
        <div>
          <h2 id="user-filters">Filter users</h2>
          <p>Refine the directory by role or access status.</p>
        </div>
        <form method="get">
          <label>
            Role
            <select name="role" defaultValue={params.get("role") ?? ""}>
              <option value="">All roles</option>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Status
            <select name="status" defaultValue={params.get("status") ?? ""}>
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
            </select>
          </label>
          <div className="admin-user-filter-actions">
            <button type="submit">Apply filters</button>
            {params.has("role") || params.has("status") ? (
              <Link
                className="mt-button mt-button-secondary"
                href="/admin/users"
              >
                Clear filters
              </Link>
            ) : null}
          </div>
        </form>
      </section>

      {!result.ok ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          <strong>Check your filters.</strong>
          <p>{result.message}</p>
        </div>
      ) : (
        <AdminUserResults
          users={result.users}
          currentAdminUserId={session.adminUserId}
        />
      )}
    </main>
  );
}

function AdminUserResults({
  users,
  currentAdminUserId,
}: {
  users: AdminUserListItem[];
  currentAdminUserId: string;
}) {
  return (
    <section className="admin-user-results" aria-labelledby="users-heading">
      <div className="admin-user-results-heading">
        <div>
          <h2 id="users-heading">
            {users.length} {users.length === 1 ? "user" : "users"}
          </h2>
          <p>Active users can sign in with a MagicTrust login link.</p>
        </div>
      </div>

      {users.length === 0 ? (
        <div className="admin-user-empty">
          <h3>No users found</h3>
          <p>Adjust the selected filters to view more users.</p>
        </div>
      ) : (
        <>
          <div className="admin-table-wrap admin-user-table-wrap">
            <table className="admin-table admin-user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong className="admin-user-email">{user.email}</strong>
                      {user.id === currentAdminUserId ? (
                        <span className="table-secondary">Current account</span>
                      ) : null}
                    </td>
                    <td>{formatRole(user.role)}</td>
                    <td>
                      <AdminUserStatusBadge active={user.active} />
                    </td>
                    <td>{formatCreatedAt(user.createdAt)}</td>
                    <td>
                      <AdminUserActions
                        user={user}
                        isCurrentUser={user.id === currentAdminUserId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-user-mobile-list" aria-label="Users">
            {users.map((user) => (
              <article className="admin-user-mobile-card" key={user.id}>
                <div className="admin-user-mobile-heading">
                  <div>
                    <h3>{user.email}</h3>
                    {user.id === currentAdminUserId ? (
                      <p>Current account</p>
                    ) : null}
                  </div>
                  <AdminUserStatusBadge active={user.active} />
                </div>
                <dl className="admin-user-mobile-meta">
                  <div>
                    <dt>Role</dt>
                    <dd>{formatRole(user.role)}</dd>
                  </div>
                  <div>
                    <dt>Created</dt>
                    <dd>{formatCreatedAt(user.createdAt)}</dd>
                  </div>
                </dl>
                <AdminUserActions
                  user={user}
                  isCurrentUser={user.id === currentAdminUserId}
                />
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function AdminUserActions({
  user,
  isCurrentUser,
}: {
  user: AdminUserListItem;
  isCurrentUser: boolean;
}) {
  if (isCurrentUser) {
    return (
      <span className="admin-user-current-notice">
        Your account is protected
      </span>
    );
  }

  return (
    <details className="admin-user-actions-menu">
      <summary>Manage</summary>
      <div className="admin-user-actions-panel">
        <form
          action={`/admin/users/${encodeURIComponent(user.id)}/role`}
          method="post"
        >
          <label>
            Change role
            <select name="role" defaultValue={user.role}>
              {roleOptions.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
          </label>
          {user.role === "ADMIN" ? (
            <AdminConfirmSubmitButton
              confirmation="Change Admin role? This user will lose administrative access."
              variant="secondary"
            >
              Update role
            </AdminConfirmSubmitButton>
          ) : (
            <AdminSubmitButton variant="secondary">
              Update role
            </AdminSubmitButton>
          )}
        </form>
        <form
          action={`/admin/users/${encodeURIComponent(user.id)}/status`}
          method="post"
        >
          <input
            type="hidden"
            name="action"
            value={user.active ? "deactivate" : "activate"}
          />
          {user.active ? (
            <AdminConfirmSubmitButton
              confirmation="Deactivate user? This user will no longer be able to access MagicTrust."
              variant="destructive"
            >
              Deactivate
            </AdminConfirmSubmitButton>
          ) : (
            <AdminSubmitButton variant="secondary">Activate</AdminSubmitButton>
          )}
        </form>
      </div>
    </details>
  );
}

function AdminUserStatusBadge({ active }: { active: boolean }) {
  return (
    <span className="admin-user-status" data-active={active}>
      <span aria-hidden="true" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}

function formatRole(role: AdminRole): string {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function formatCreatedAt(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
