import Link from "next/link";
import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminSession } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  getValidAdminStatusDestinations,
  getAdminRequestDetail,
} from "@/lib/admin-dashboard";
import { AdminSubmitButton } from "@/lib/admin-request-action-forms";
import { commentVisibilities } from "@magictrust/domain";

type PageProps = {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const statusLabels = {
  SUBMITTED: "Submitted",
  PENDING_VERIFICATION: "Pending verification",
  VERIFIED: "Verified",
  PROCESSING: "Processing",
  WAITING_FOR_REQUESTER: "Waiting for requester",
  SUCCESS: "Success",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
} as const;

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminRequestDetailPage({
  params,
  searchParams,
}: PageProps) {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  noStore();

  const { publicId } = await params;
  const messages = await searchParams;
  const request = await getAdminRequestDetail(
    publicId,
    createAdminDashboardDependencies(),
    session.role,
  );

  if (!request) {
    notFound();
  }

  const canMutate = session.role === "ADMIN" || session.role === "OPERATOR";
  const validStatuses = getValidAdminStatusDestinations(request.status);
  const successMessage = firstParam(messages?.success);
  const errorMessage = firstParam(messages?.error);

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">MagicTrust Internal</p>
          <h1>{request.publicId}</h1>
          <p>Authenticated role: {session.role}</p>
        </div>
        <div className="admin-actions">
          <Link href="/admin/requests">Back to requests</Link>
          <form action="/api/admin/auth/logout" method="post">
            <button type="submit">Log out</button>
          </form>
        </div>
      </header>

      {successMessage ? (
        <section className="admin-card success-message" role="status">
          <p>{successMessage}</p>
        </section>
      ) : null}

      {errorMessage ? (
        <section className="admin-card error-message" role="alert">
          <p>{errorMessage}</p>
        </section>
      ) : null}

      <section className="admin-card" aria-labelledby="summary-heading">
        <h2 id="summary-heading">Request Summary</h2>
        <dl className="detail-grid">
          <div>
            <dt>Public ID</dt>
            <dd>{request.publicId}</dd>
          </div>
          <div>
            <dt>Type</dt>
            <dd>{formatEnumLabel(request.type)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>
              <span className={`status-badge ${request.status}`}>
                {statusLabels[request.status]}
              </span>
            </dd>
          </div>
          <div>
            <dt>Created at</dt>
            <dd>{formatDateTime(request.createdAt)}</dd>
          </div>
          <div>
            <dt>Updated at</dt>
            <dd>{formatDateTime(request.updatedAt)}</dd>
          </div>
          <div>
            <dt>Completed at</dt>
            <dd>{formatOptionalDateTime(request.completedAt)}</dd>
          </div>
          <div>
            <dt>Source channel</dt>
            <dd>{request.source?.channel ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Site key</dt>
            <dd>{request.source?.siteKey ?? "Unknown"}</dd>
          </div>
          <div>
            <dt>Form key</dt>
            <dd>{request.source?.formKey ?? "Unknown"}</dd>
          </div>
        </dl>
      </section>

      {request.requester && request.originalSubmission ? (
        <>
          <section className="admin-card" aria-labelledby="requester-heading">
            <h2 id="requester-heading">Requester</h2>
            <dl className="detail-grid">
              <div>
                <dt>First name</dt>
                <dd>{request.requester.firstName ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Last name</dt>
                <dd>{request.requester.lastName ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{request.requester.email ?? "Not provided"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{request.requester.phone ?? "Not provided"}</dd>
              </div>
            </dl>
          </section>

          <section
            className="admin-card"
            aria-labelledby="original-submission-heading"
          >
            <h2 id="original-submission-heading">Original Submission</h2>
            <dl className="detail-grid">
              <div>
                <dt>Request type</dt>
                <dd>{formatEnumLabel(request.originalSubmission.type)}</dd>
              </div>
              <div>
                <dt>Source channel</dt>
                <dd>
                  {request.originalSubmission.source.channel ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Site key</dt>
                <dd>
                  {request.originalSubmission.source.siteKey ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Form key</dt>
                <dd>
                  {request.originalSubmission.source.formKey ?? "Not provided"}
                </dd>
              </div>
              <div>
                <dt>Source URL</dt>
                <dd>
                  {request.originalSubmission.source.sourceUrl ??
                    "Not provided"}
                </dd>
              </div>
            </dl>
            <h3>Message</h3>
            <p>{request.originalSubmission.message ?? "Not provided"}</p>
            <h3>Additional submitted data</h3>
            {Object.keys(request.originalSubmission.submittedData).length ===
            0 ? (
              <p>No additional submitted data was provided.</p>
            ) : (
              <pre className="json-panel">
                {JSON.stringify(
                  request.originalSubmission.submittedData,
                  null,
                  2,
                )}
              </pre>
            )}
          </section>
        </>
      ) : null}

      <section className="admin-card" aria-labelledby="actions-heading">
        <div>
          <h2 id="actions-heading">Request Actions</h2>
          <p>Current status: {statusLabels[request.status]}</p>
        </div>
        {!canMutate ? (
          <p>
            Your role is read-only. ADMIN and OPERATOR users can manage request
            status, comments, attachments, notifications, mutable data, and
            custom events.
          </p>
        ) : (
          <div className="admin-actions-grid">
            <section aria-labelledby="status-update-heading">
              <h3 id="status-update-heading">Status Update</h3>
              {validStatuses.length === 0 ? (
                <p>No status updates are available for this request.</p>
              ) : (
                <form
                  className="admin-action-form"
                  action={`/admin/requests/${request.publicId}/status`}
                  method="post"
                >
                  <label>
                    New status
                    <select name="newStatus" required>
                      {validStatuses.map((status) => (
                        <option key={status} value={status}>
                          {statusLabels[status]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Reason
                    <textarea
                      name="reason"
                      required
                      maxLength={2000}
                      rows={4}
                    />
                  </label>
                  <AdminSubmitButton>Update status</AdminSubmitButton>
                </form>
              )}
            </section>

            <section aria-labelledby="add-comment-heading">
              <h3 id="add-comment-heading">Add Comment</h3>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/comments`}
                method="post"
              >
                <label>
                  Visibility
                  <select name="visibility" required>
                    {commentVisibilities.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Body
                  <textarea name="body" required maxLength={5000} rows={5} />
                </label>
                <AdminSubmitButton>Add comment</AdminSubmitButton>
              </form>
            </section>

            <section aria-labelledby="upload-attachment-heading">
              <h3 id="upload-attachment-heading">Upload Attachment</h3>
              <p>
                Accepted: JSON, CSV, PDF, plain text, ZIP. Maximum size: 10 MB.
              </p>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/attachments`}
                method="post"
                encType="multipart/form-data"
              >
                <label>
                  File
                  <input
                    name="file"
                    type="file"
                    required
                    accept="application/json,text/csv,application/pdf,text/plain,application/zip"
                  />
                </label>
                <label>
                  Visibility
                  <select name="visibility" required>
                    {commentVisibilities.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility}
                      </option>
                    ))}
                  </select>
                </label>
                <AdminSubmitButton>Upload attachment</AdminSubmitButton>
              </form>
            </section>

            <section aria-labelledby="notify-consumer-heading">
              <h3 id="notify-consumer-heading">Notify Consumer</h3>
              <p>This sends an email to the requester.</p>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/notifications`}
                method="post"
              >
                <label>
                  Notification type
                  <select name="type" required>
                    <option value="">Choose notification</option>
                    <option value="REQUEST_UPDATED">Request updated</option>
                    <option value="REQUEST_COMPLETED">Request completed</option>
                    <option value="REQUEST_REJECTED">Request rejected</option>
                    <option value="FILE_AVAILABLE">File available</option>
                  </select>
                </label>
                <label>
                  Message
                  <textarea name="message" maxLength={2000} rows={4} />
                </label>
                <label>
                  Public attachment for file notifications
                  <select name="attachmentId">
                    <option value="">No attachment selected</option>
                    {request.attachments
                      .filter(
                        (attachment) => attachment.visibility === "PUBLIC",
                      )
                      .map((attachment) => (
                        <option key={attachment.id} value={attachment.id}>
                          {attachment.fileName}
                        </option>
                      ))}
                  </select>
                </label>
                <AdminSubmitButton>Send notification</AdminSubmitButton>
              </form>
            </section>

            <section aria-labelledby="edit-mutable-data-heading">
              <h3 id="edit-mutable-data-heading">Edit Mutable Data</h3>
              <p>
                Submitted request data is immutable. This merges the JSON object
                below into mutable data and preserves omitted keys.
              </p>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/data`}
                method="post"
              >
                <label>
                  Mutable data JSON
                  <textarea
                    name="data"
                    required
                    rows={10}
                    defaultValue={JSON.stringify(request.mutableData, null, 2)}
                  />
                </label>
                <label>
                  Reason
                  <textarea name="reason" required maxLength={2000} rows={3} />
                </label>
                <AdminSubmitButton>Update mutable data</AdminSubmitButton>
              </form>
            </section>

            <section aria-labelledby="custom-event-heading">
              <h3 id="custom-event-heading">Register Custom Event</h3>
              <p>
                PUBLIC custom events appear in consumer tracking. INTERNAL
                custom events remain dashboard-only.
              </p>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/events`}
                method="post"
              >
                <label>
                  Event type
                  <input
                    name="type"
                    required
                    pattern="[A-Z][A-Z0-9_]{2,79}"
                    maxLength={80}
                    autoComplete="off"
                  />
                </label>
                <label>
                  Visibility
                  <select name="visibility" required defaultValue="INTERNAL">
                    {commentVisibilities.map((visibility) => (
                      <option key={visibility} value={visibility}>
                        {visibility}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Event data JSON
                  <textarea name="data" rows={6} placeholder="{}" />
                </label>
                <AdminSubmitButton>Record custom event</AdminSubmitButton>
              </form>
            </section>
          </div>
        )}
      </section>

      <section className="admin-card" aria-labelledby="mutable-data-heading">
        <h2 id="mutable-data-heading">Mutable Data</h2>
        {Object.keys(request.mutableData).length === 0 ? (
          <p>No mutable data has been recorded.</p>
        ) : (
          <pre className="json-panel">
            {JSON.stringify(request.mutableData, null, 2)}
          </pre>
        )}
      </section>

      <section className="admin-card" aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">Timeline</h2>
        {request.timeline.length === 0 ? (
          <p>No events have been recorded.</p>
        ) : (
          <ol className="timeline-list">
            {request.timeline.map((event) => (
              <li key={event.id}>
                <div className="section-heading">
                  <div>
                    <strong>{event.type}</strong>
                    <p>{formatDateTime(event.createdAt)}</p>
                  </div>
                  <span>{event.visibility}</span>
                </div>
                <dl className="compact-grid">
                  <div>
                    <dt>Category</dt>
                    <dd>{event.category}</dd>
                  </div>
                  <div>
                    <dt>Actor type</dt>
                    <dd>{event.actorType}</dd>
                  </div>
                  <div>
                    <dt>Actor id</dt>
                    <dd>{event.actorId ?? "None"}</dd>
                  </div>
                </dl>
                <pre className="json-panel">
                  {JSON.stringify(event.data, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="admin-card" aria-labelledby="comments-heading">
        <h2 id="comments-heading">Comments</h2>
        {request.comments.length === 0 ? (
          <p>No comments have been recorded.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Visibility</th>
                  <th scope="col">Body</th>
                  <th scope="col">Actor</th>
                  <th scope="col">Created at</th>
                </tr>
              </thead>
              <tbody>
                {request.comments.map((comment) => (
                  <tr key={comment.id}>
                    <td>{comment.visibility}</td>
                    <td>{comment.body}</td>
                    <td>
                      {comment.actorType}
                      {comment.actorId ? ` / ${comment.actorId}` : ""}
                    </td>
                    <td>{formatDateTime(comment.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card" aria-labelledby="attachments-heading">
        <h2 id="attachments-heading">Attachments</h2>
        {request.attachments.length === 0 ? (
          <p>No attachments have been recorded.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">File name</th>
                  <th scope="col">MIME type</th>
                  <th scope="col">Size</th>
                  <th scope="col">Visibility</th>
                  <th scope="col">Created at</th>
                  <th scope="col">Download</th>
                </tr>
              </thead>
              <tbody>
                {request.attachments.map((attachment) => (
                  <tr key={attachment.id}>
                    <td>{attachment.fileName}</td>
                    <td>{attachment.mimeType}</td>
                    <td>{formatBytes(attachment.sizeBytes)}</td>
                    <td>{attachment.visibility}</td>
                    <td>{formatDateTime(attachment.createdAt)}</td>
                    <td>
                      <Link
                        href={`/admin/requests/${request.publicId}/attachments/${attachment.id}/download`}
                      >
                        Download
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="admin-card" aria-labelledby="communications-heading">
        <h2 id="communications-heading">Communications</h2>
        {request.communications.length === 0 ? (
          <p>No communications have been recorded.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th scope="col">Channel</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Recipient</th>
                  <th scope="col">Subject</th>
                  <th scope="col">Provider</th>
                  <th scope="col">Status</th>
                  <th scope="col">Created at</th>
                  <th scope="col">Sent at</th>
                  <th scope="col">Error</th>
                </tr>
              </thead>
              <tbody>
                {request.communications.map((communication) => (
                  <tr key={communication.id}>
                    <td>{communication.channel}</td>
                    <td>{communication.direction}</td>
                    <td>{communication.recipientMasked ?? "Unavailable"}</td>
                    <td>{communication.subject}</td>
                    <td>{communication.provider}</td>
                    <td>{communication.status}</td>
                    <td>{formatDateTime(communication.createdAt)}</td>
                    <td>{formatOptionalDateTime(communication.sentAt)}</td>
                    <td>{communication.errorMessage ?? "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function formatEnumLabel(value: string): string {
  return value
    .split("_")
    .map((part) => (part ? part[0] + part.slice(1).toLowerCase() : ""))
    .join(" ");
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatOptionalDateTime(value: string | null): string {
  return value ? formatDateTime(value) : "Not completed";
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat("en", {
    style: "unit",
    unit: "byte",
    unitDisplay: "short",
  }).format(value);
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
