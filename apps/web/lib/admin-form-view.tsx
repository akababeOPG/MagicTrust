import Link from "next/link";
import React from "react";

import type { AdminSession } from "./admin-auth";
import {
  AdminConfirmSubmitButton,
  AdminSubmitButton,
} from "./admin-request-action-forms";
import type {
  AdminFormDetailView,
  AdminFormListItem,
} from "./admin-form-management";

export function AdminFormsList({
  role,
  forms,
  errorMessage,
}: {
  role: AdminSession["role"];
  forms: AdminFormListItem[];
  errorMessage?: string;
}) {
  return (
    <main className="admin-page admin-forms-page">
      <header className="admin-header admin-forms-header">
        <div>
          <p className="eyebrow">Administration</p>
          <h1>Forms</h1>
          <p>Manage forms used to collect requests.</p>
        </div>
        {role === "ADMIN" ? (
          <details className="admin-create-form-disclosure">
            <summary className="mt-button">Create form</summary>
            <div className="admin-create-form-panel">
              <div>
                <h2>Create form</h2>
                <p>Start with a safe, empty draft.</p>
              </div>
              <form action="/admin/forms/create" method="post">
                <label>
                  Name
                  <input name="name" maxLength={160} required />
                </label>
                <label>
                  Slug
                  <input name="slug" maxLength={120} required />
                  <small>Lowercase letters, numbers, and hyphens.</small>
                </label>
                <label>
                  Description <span>Optional</span>
                  <textarea name="description" maxLength={2000} rows={3} />
                </label>
                <AdminSubmitButton>Create form</AdminSubmitButton>
              </form>
            </div>
          </details>
        ) : null}
      </header>

      {errorMessage ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          {errorMessage}
        </div>
      ) : null}

      <section className="admin-form-results" aria-labelledby="forms-heading">
        <div>
          <h2 id="forms-heading">
            {forms.length} {forms.length === 1 ? "form" : "forms"}
          </h2>
          <p>Published versions remain unchanged as new drafts are created.</p>
        </div>
        {forms.length === 0 ? (
          <div className="admin-form-empty">
            <h3>No forms yet</h3>
            <p>
              {role === "ADMIN"
                ? "Create the first form to begin drafting."
                : "An Admin has not created any forms yet."}
            </p>
          </div>
        ) : (
          <>
            <div className="admin-table-wrap admin-form-table-wrap">
              <table className="admin-table admin-form-table">
                <thead>
                  <tr>
                    <th>Form</th>
                    <th>Status</th>
                    <th>Published version</th>
                    <th>Draft</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {forms.map((form) => (
                    <tr key={form.publicId}>
                      <td>
                        <strong>{form.name}</strong>
                        <span className="table-secondary">/{form.slug}</span>
                      </td>
                      <td>
                        <FormStatus status={form.status} />
                      </td>
                      <td>
                        {versionLabel(
                          form.publishedVersionNumber,
                          "Not published",
                        )}
                      </td>
                      <td>
                        {versionLabel(form.draftVersionNumber, "—", " Draft")}
                      </td>
                      <td>{formatDate(form.updatedAt)}</td>
                      <td>
                        <Link
                          className="mt-button mt-button-secondary admin-form-open"
                          href={`/admin/forms/${encodeURIComponent(form.publicId)}`}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-form-mobile-list" aria-label="Forms">
              {forms.map((form) => (
                <article className="admin-form-mobile-card" key={form.publicId}>
                  <div className="admin-form-mobile-heading">
                    <div>
                      <h3>{form.name}</h3>
                      <p>/{form.slug}</p>
                    </div>
                    <FormStatus status={form.status} />
                  </div>
                  <dl>
                    <div>
                      <dt>Published</dt>
                      <dd>
                        {versionLabel(
                          form.publishedVersionNumber,
                          "Not published",
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Draft</dt>
                      <dd>
                        {versionLabel(form.draftVersionNumber, "—", " Draft")}
                      </dd>
                    </div>
                    <div>
                      <dt>Updated</dt>
                      <dd>{formatDate(form.updatedAt)}</dd>
                    </div>
                  </dl>
                  <Link
                    className="mt-button mt-button-secondary"
                    href={`/admin/forms/${encodeURIComponent(form.publicId)}`}
                  >
                    Open form
                  </Link>
                </article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  );
}

export function AdminFormDetail({
  role,
  form,
  successMessage,
  errorMessage,
}: {
  role: AdminSession["role"];
  form: AdminFormDetailView;
  successMessage?: string;
  errorMessage?: string;
}) {
  const active = form.status === "ACTIVE";
  return (
    <main className="admin-page admin-form-detail-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Form detail</p>
          <h1>{form.name}</h1>
          <p>/{form.slug}</p>
        </div>
        <Link href="/admin/forms">Back to forms</Link>
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
        className="admin-form-summary"
        aria-labelledby="form-summary-heading"
      >
        <div>
          <h2 id="form-summary-heading">Form summary</h2>
          <p>{form.description ?? "No description provided."}</p>
        </div>
        <dl>
          <div>
            <dt>Status</dt>
            <dd>
              <FormStatus status={form.status} />
            </dd>
          </div>
          <div>
            <dt>Published version</dt>
            <dd>
              {versionLabel(form.publishedVersionNumber, "Not published")}
            </dd>
          </div>
          <div>
            <dt>Current draft</dt>
            <dd>
              {versionLabel(form.draftVersionNumber, "No draft", " Draft")}
            </dd>
          </div>
          <div>
            <dt>Updated</dt>
            <dd>{formatDate(form.updatedAt)}</dd>
          </div>
        </dl>
      </section>

      {role === "ADMIN" && active ? (
        <section
          className="admin-form-next-step"
          aria-labelledby="form-next-step-heading"
        >
          <div>
            <p className="eyebrow">Next step</p>
            <h2 id="form-next-step-heading">
              {form.draftVersionNumber
                ? "Draft ready to publish"
                : "Create the next version"}
            </h2>
            <p>
              {form.draftVersionNumber
                ? `Review draft v${form.draftVersionNumber} metadata, then publish when ready.`
                : "Create a draft copied from the current published version."}
            </p>
          </div>
          {form.draftVersionNumber ? (
            <div className="admin-form-next-step-actions">
              <Link className="mt-button mt-button-secondary" href="#draft">
                View draft metadata
              </Link>
              <form
                action={`/admin/forms/${encodeURIComponent(form.publicId)}/versions/${form.draftVersionNumber}/publish`}
                method="post"
              >
                <AdminSubmitButton>Publish draft</AdminSubmitButton>
              </form>
            </div>
          ) : (
            <form
              action={`/admin/forms/${encodeURIComponent(form.publicId)}/versions/new`}
              method="post"
            >
              <AdminSubmitButton>Create new version</AdminSubmitButton>
            </form>
          )}
        </section>
      ) : null}

      <section
        className="admin-form-history"
        aria-labelledby="version-history-heading"
      >
        <div>
          <h2 id="version-history-heading">Version history</h2>
          <p>Newest versions appear first.</p>
        </div>
        <div className="admin-table-wrap admin-form-version-table-wrap">
          <table className="admin-table admin-form-version-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Status</th>
                <th>Created</th>
                <th>Published</th>
              </tr>
            </thead>
            <tbody>
              {form.versions.map((version) => (
                <tr
                  key={version.versionNumber}
                  id={version.status === "DRAFT" ? "draft" : undefined}
                >
                  <td>
                    <strong>v{version.versionNumber}</strong>
                  </td>
                  <td>
                    <VersionStatus status={version.status} />
                  </td>
                  <td>{formatDate(version.createdAt)}</td>
                  <td>
                    {version.publishedAt
                      ? formatDate(version.publishedAt)
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {role === "ADMIN" && active ? (
        <section className="admin-form-archive">
          <div>
            <h2>Archive form</h2>
            <p>
              Preserve this form and all version history while preventing future
              deployments.
            </p>
          </div>
          <form
            action={`/admin/forms/${encodeURIComponent(form.publicId)}/archive`}
            method="post"
          >
            <AdminConfirmSubmitButton
              confirmation="Archive form? This form will no longer be available for new deployments. Existing version history will be preserved."
              variant="destructive"
            >
              Archive form
            </AdminConfirmSubmitButton>
          </form>
        </section>
      ) : null}
      {role === "OPERATOR" ? (
        <p className="admin-form-readonly">
          Form management is read-only for your role.
        </p>
      ) : null}
    </main>
  );
}

function FormStatus({ status }: { status: AdminFormListItem["status"] }) {
  return (
    <span className="admin-form-status" data-status={status}>
      <span aria-hidden="true" />
      {status === "ACTIVE" ? "Active" : "Archived"}
    </span>
  );
}

function VersionStatus({
  status,
}: {
  status: AdminFormDetailView["versions"][number]["status"];
}) {
  const label =
    status === "DRAFT"
      ? "Draft"
      : status === "PUBLISHED"
        ? "Published"
        : "Archived";
  return (
    <span className="admin-version-status" data-status={status}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function versionLabel(value: number | null, empty: string, suffix = "") {
  return value === null ? empty : `v${value}${suffix}`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value));
}
