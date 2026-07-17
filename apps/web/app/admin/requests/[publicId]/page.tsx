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
import type { AdminRequestDetailView } from "@/lib/admin-dashboard";
import {
  AdminConfirmSubmitButton,
  AdminSubmitButton,
} from "@/lib/admin-request-action-forms";
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

  if (request.type === "DATA_ACCESS") {
    return (
      <DataAccessRequestDetail
        request={request}
        role={session.role}
        successMessage={successMessage}
        errorMessage={errorMessage}
      />
    );
  }

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

function DataAccessRequestDetail({
  request,
  role,
  successMessage,
  errorMessage,
}: {
  request: AdminRequestDetailView;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
  successMessage?: string;
  errorMessage?: string;
}) {
  const canAct = role === "ADMIN" || role === "OPERATOR";
  const publicAttachments = request.attachments
    .filter((attachment) => attachment.visibility === "PUBLIC")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const responseFile = publicAttachments[0] ?? null;
  const latestDeliveryEvent = request.timeline.find(
    (event) =>
      (event.type === "CONSUMER_NOTIFICATION_SENT" ||
        event.type === "CONSUMER_NOTIFICATION_FAILED") &&
      event.data.notificationType === "FILE_AVAILABLE",
  );
  const deliveryCommunicationId =
    typeof latestDeliveryEvent?.data.communicationId === "string"
      ? latestDeliveryEvent.data.communicationId
      : null;
  const deliveryCommunication = deliveryCommunicationId
    ? (request.communications.find(
        (communication) => communication.id === deliveryCommunicationId,
      ) ?? null)
    : null;
  const deliveryFailed =
    latestDeliveryEvent?.type === "CONSUMER_NOTIFICATION_FAILED";
  const latestVerification = request.timeline.find(
    (event) => event.type === "IDENTITY_VERIFICATION_SENT",
  );
  const internalNotes = request.comments.filter(
    (comment) => comment.visibility === "INTERNAL",
  );
  const internalAttachments = request.attachments.filter(
    (attachment) => attachment.visibility === "INTERNAL",
  );
  const ageDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(request.createdAt).getTime()) /
        (24 * 60 * 60 * 1000),
    ),
  );
  const statusLabel = dataAccessStatusLabel(request.status);
  const terminalEvent = request.timeline.find(
    (event) =>
      event.type === "STATUS_CHANGED" &&
      event.data.newStatus === request.status,
  );

  return (
    <main className="admin-page guided-request-page">
      <header className="admin-header guided-request-header">
        <div>
          <p className="eyebrow">Data access request</p>
          <h1>{request.publicId}</h1>
          <p>
            {statusLabel} · Received {formatDateTime(request.createdAt)} ·{" "}
            {ageDays === 1 ? "1 day old" : `${ageDays} days old`}
          </p>
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

      <DataAccessProgress
        status={request.status}
        responseReady={responseFile !== null}
      />

      <section
        className="admin-card next-step-card"
        aria-labelledby="next-step-heading"
      >
        <p className="eyebrow">Next step</p>
        <DataAccessNextStep
          request={request}
          canAct={canAct}
          responseFile={responseFile}
          publicAttachments={publicAttachments}
          deliveryFailed={deliveryFailed}
          latestVerificationAt={latestVerification?.createdAt ?? null}
          terminalEvent={terminalEvent}
          deliveryCommunication={deliveryCommunication}
        />
      </section>

      {!canAct ? (
        <section className="admin-card" role="note">
          <h2>Read-only access</h2>
          <p>
            VIEWER users can review request progress but cannot view requester
            identity or perform workflow actions.
          </p>
        </section>
      ) : null}

      {request.requester && request.originalSubmission ? (
        <section
          className="admin-card"
          aria-labelledby="request-details-heading"
        >
          <h2 id="request-details-heading">Requester and original request</h2>
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
            <div>
              <dt>Submitted</dt>
              <dd>{formatDateTime(request.createdAt)}</dd>
            </div>
            <div>
              <dt>Source</dt>
              <dd>
                {request.originalSubmission.source.channel ?? "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Site</dt>
              <dd>
                {request.originalSubmission.source.siteKey ?? "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Form</dt>
              <dd>
                {request.originalSubmission.source.formKey ?? "Not provided"}
              </dd>
            </div>
          </dl>
          <h3>Original message</h3>
          <p>
            {request.originalSubmission.message ?? "No message was provided."}
          </p>
          {Object.keys(request.originalSubmission.submittedData).length > 0 ? (
            <details>
              <summary>Additional submitted information</summary>
              <pre className="json-panel">
                {JSON.stringify(
                  request.originalSubmission.submittedData,
                  null,
                  2,
                )}
              </pre>
            </details>
          ) : null}
        </section>
      ) : null}

      <section className="admin-card" aria-labelledby="workspace-heading">
        <h2 id="workspace-heading">Processing workspace</h2>
        <h3>Internal notes</h3>
        {internalNotes.length === 0 ? (
          <p>No internal notes yet.</p>
        ) : (
          <ol className="timeline-list">
            {internalNotes.map((note) => (
              <li key={note.id}>
                <p>{note.body}</p>
                <small>
                  {actorCategory(note.actorType)} ·{" "}
                  {formatDateTime(note.createdAt)}
                </small>
              </li>
            ))}
          </ol>
        )}
        {canAct && request.status === "PROCESSING" ? (
          <form
            className="admin-action-form"
            action={`/admin/requests/${request.publicId}/internal-notes`}
            method="post"
          >
            <label>
              New internal note
              <textarea name="body" required maxLength={5000} rows={4} />
            </label>
            <AdminSubmitButton>Add internal note</AdminSubmitButton>
          </form>
        ) : null}
      </section>

      <section className="admin-card" aria-labelledby="response-heading">
        <h2 id="response-heading">Response and secure delivery</h2>
        {publicAttachments.length === 0 ? (
          <p>No response file has been uploaded.</p>
        ) : (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>File</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Uploaded</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {publicAttachments.map((attachment) => (
                  <tr key={attachment.id}>
                    <td>{attachment.fileName}</td>
                    <td>{attachment.mimeType}</td>
                    <td>{formatBytes(attachment.sizeBytes)}</td>
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
        {role === "ADMIN" && internalAttachments.length > 0 ? (
          <details>
            <summary>Internal evidence attachments</summary>
            <ul>
              {internalAttachments.map((attachment) => (
                <li key={attachment.id}>{attachment.fileName}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="admin-card" aria-labelledby="activity-heading">
        <details>
          <summary id="activity-heading">Activity history</summary>
          {request.timeline.length === 0 ? (
            <p>No activity has been recorded.</p>
          ) : (
            <ol className="timeline-list">
              {request.timeline.map((event) => (
                <li key={event.id}>
                  <strong>{activityLabel(event.type)}</strong>
                  <p>
                    {actorCategory(event.actorType)} ·{" "}
                    {formatDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>

      {canAct && !isTerminalStatus(request.status) ? (
        <section className="admin-card" aria-labelledby="more-actions-heading">
          <details>
            <summary id="more-actions-heading">More actions</summary>
            <div className="admin-actions-grid">
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/status`}
                method="post"
              >
                <h3>Reject request</h3>
                <p>
                  Use when the request is invalid, duplicated, fraudulent,
                  unsupported, or cannot be fulfilled.
                </p>
                <input type="hidden" name="newStatus" value="REJECTED" />
                <label>
                  Reason
                  <textarea name="reason" required maxLength={2000} rows={3} />
                </label>
                <AdminConfirmSubmitButton confirmation="Reject this request?">
                  Reject request
                </AdminConfirmSubmitButton>
              </form>
              <form
                className="admin-action-form"
                action={`/admin/requests/${request.publicId}/status`}
                method="post"
              >
                <h3>Cancel request</h3>
                <p>
                  Use when the request is withdrawn, administratively closed, or
                  abandoned without a fulfillment decision.
                </p>
                <input type="hidden" name="newStatus" value="CANCELLED" />
                <label>
                  Reason
                  <textarea name="reason" required maxLength={2000} rows={3} />
                </label>
                <AdminConfirmSubmitButton confirmation="Cancel this request?">
                  Cancel request
                </AdminConfirmSubmitButton>
              </form>
            </div>
          </details>
        </section>
      ) : null}
    </main>
  );
}

function DataAccessNextStep({
  request,
  canAct,
  responseFile,
  publicAttachments,
  deliveryFailed,
  latestVerificationAt,
  terminalEvent,
  deliveryCommunication,
}: {
  request: AdminRequestDetailView;
  canAct: boolean;
  responseFile: AdminRequestDetailView["attachments"][number] | null;
  publicAttachments: AdminRequestDetailView["attachments"];
  deliveryFailed: boolean;
  latestVerificationAt: string | null;
  terminalEvent: AdminRequestDetailView["timeline"][number] | undefined;
  deliveryCommunication:
    AdminRequestDetailView["communications"][number] | null;
}) {
  if (request.status === "PENDING_VERIFICATION")
    return (
      <>
        <h2 id="next-step-heading">Waiting for requester verification</h2>
        <p>
          The requester must verify their email before this request can be
          processed.
        </p>
        {latestVerificationAt ? (
          <p>
            Most recent verification email:{" "}
            {formatDateTime(latestVerificationAt)}
          </p>
        ) : null}
        {canAct ? (
          <form
            action={`/admin/requests/${request.publicId}/resend-verification`}
            method="post"
          >
            <AdminSubmitButton>Resend verification email</AdminSubmitButton>
          </form>
        ) : null}
      </>
    );
  if (request.status === "VERIFIED")
    return (
      <>
        <h2 id="next-step-heading">Ready to process</h2>
        <p>
          The requester’s identity has been verified. Review the request and
          begin fulfillment.
        </p>
        {canAct ? (
          <form
            action={`/admin/requests/${request.publicId}/start-processing`}
            method="post"
          >
            <AdminSubmitButton>Start processing</AdminSubmitButton>
          </form>
        ) : null}
      </>
    );
  if (request.status === "PROCESSING" && !responseFile)
    return (
      <>
        <h2 id="next-step-heading">Prepare the response</h2>
        <p>
          Review the requester’s information, locate their data in the relevant
          systems, and prepare the response file.
        </p>
        {canAct ? <ResponseUploadForm publicId={request.publicId} /> : null}
      </>
    );
  if (request.status === "PROCESSING" && responseFile)
    return (
      <>
        <h2 id="next-step-heading">
          {deliveryFailed
            ? "Response could not be sent"
            : "Response ready to send"}
        </h2>
        <p>
          {deliveryFailed
            ? "The response file is ready, but the email delivery failed. Review the error and try again."
            : "The response file is ready to be delivered securely to the requester."}
        </p>
        {deliveryFailed ? (
          <p role="alert">
            The email provider could not deliver the response message.
          </p>
        ) : null}
        {canAct ? (
          <form
            className="admin-action-form"
            action={`/admin/requests/${request.publicId}/send-response`}
            method="post"
          >
            <label>
              Response file
              <select
                name="attachmentId"
                required
                defaultValue={responseFile.id}
              >
                {publicAttachments.map((attachment) => (
                  <option key={attachment.id} value={attachment.id}>
                    {attachment.fileName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Message to requester (optional)
              <textarea name="message" maxLength={2000} rows={4} />
            </label>
            <AdminSubmitButton>
              {deliveryFailed
                ? "Retry sending response"
                : "Send response and complete request"}
            </AdminSubmitButton>
          </form>
        ) : null}
      </>
    );
  if (request.status === "SUCCESS")
    return (
      <>
        <h2 id="next-step-heading">Request completed</h2>
        <p>The response was delivered securely to the requester.</p>
        <dl className="detail-grid">
          <div>
            <dt>Completed</dt>
            <dd>{formatOptionalDateTime(request.completedAt)}</dd>
          </div>
          {responseFile ? (
            <div>
              <dt>Delivered file</dt>
              <dd>{responseFile.fileName}</dd>
            </div>
          ) : null}
          <div>
            <dt>Delivery status</dt>
            <dd>
              {deliveryCommunication?.status === "SENT"
                ? "Delivered"
                : "Completed"}
            </dd>
          </div>
          <div>
            <dt>Sent</dt>
            <dd>
              {formatOptionalDateTime(deliveryCommunication?.sentAt ?? null)}
            </dd>
          </div>
          <div>
            <dt>Recipient</dt>
            <dd>{deliveryCommunication?.recipientMasked ?? "Unavailable"}</dd>
          </div>
        </dl>
      </>
    );
  if (request.status === "REJECTED" || request.status === "CANCELLED")
    return (
      <>
        <h2 id="next-step-heading">
          Request {request.status === "REJECTED" ? "rejected" : "cancelled"}
        </h2>
        <p>
          {typeof terminalEvent?.data.reason === "string"
            ? terminalEvent.data.reason
            : "This request is closed."}
        </p>
        <p>
          {terminalEvent
            ? `${actorCategory(terminalEvent.actorType)} · ${formatDateTime(terminalEvent.createdAt)}`
            : null}
        </p>
      </>
    );
  if (request.status === "WAITING_FOR_REQUESTER")
    return (
      <>
        <h2 id="next-step-heading">Waiting for requester</h2>
        <p>
          Processing is paused until the requester provides the required
          information.
        </p>
      </>
    );
  return (
    <>
      <h2 id="next-step-heading">Review request</h2>
      <p>Review the request details and determine the appropriate next step.</p>
    </>
  );
}

function ResponseUploadForm({ publicId }: { publicId: string }) {
  return (
    <form
      className="admin-action-form"
      action={`/admin/requests/${publicId}/response-file`}
      method="post"
      encType="multipart/form-data"
    >
      <p>
        The response file will be delivered securely to the requester. Uploading
        does not send it automatically.
      </p>
      <label>
        Response file
        <input
          name="file"
          type="file"
          required
          accept="application/json,text/csv,application/pdf,text/plain,application/zip"
        />
      </label>
      <AdminSubmitButton>Upload response file</AdminSubmitButton>
    </form>
  );
}

function DataAccessProgress({
  status,
  responseReady,
}: {
  status: AdminRequestDetailView["status"];
  responseReady: boolean;
}) {
  const stages = [
    "Received",
    "Verified",
    "Processing",
    "Response ready",
    "Completed",
  ];
  const current =
    status === "PENDING_VERIFICATION" || status === "SUBMITTED"
      ? 0
      : status === "VERIFIED"
        ? 1
        : status === "PROCESSING"
          ? responseReady
            ? 3
            : 2
          : status === "SUCCESS"
            ? 4
            : 0;
  const terminal = status === "REJECTED" || status === "CANCELLED";
  return (
    <section className="admin-card" aria-labelledby="progress-heading">
      <h2 id="progress-heading">Progress</h2>
      {terminal ? (
        <p>
          This request was {status.toLowerCase()} and did not complete the
          standard fulfillment flow.
        </p>
      ) : null}
      <ol className="request-progress">
        {stages.map((stage, index) => {
          const state =
            !terminal && index < current
              ? "Completed"
              : !terminal && index === current
                ? "Current"
                : "Upcoming";
          return (
            <li key={stage} data-state={state.toLowerCase()}>
              <span aria-hidden="true">
                {state === "Completed" ? "✓" : state === "Current" ? "●" : "○"}
              </span>
              <strong>{stage}</strong>
              <small>{state}</small>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function dataAccessStatusLabel(status: AdminRequestDetailView["status"]) {
  return status === "PENDING_VERIFICATION"
    ? "Waiting for verification"
    : status === "VERIFIED"
      ? "Ready to process"
      : status === "PROCESSING"
        ? "In progress"
        : status === "SUCCESS"
          ? "Completed"
          : status === "WAITING_FOR_REQUESTER"
            ? "Waiting for requester"
            : status === "REJECTED"
              ? "Rejected"
              : status === "CANCELLED"
                ? "Cancelled"
                : "Received";
}
function isTerminalStatus(status: AdminRequestDetailView["status"]) {
  return (
    status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED"
  );
}
function actorCategory(actorType: string) {
  return actorType === "CONSUMER"
    ? "Requester"
    : actorType === "ADMIN_USER" || actorType === "INTERNAL_USER"
      ? "Operator"
      : actorType === "SYSTEM"
        ? "System"
        : "Integration";
}
function activityLabel(type: string) {
  const labels: Record<string, string> = {
    REQUEST_CREATED: "Request received",
    IDENTITY_VERIFICATION_SENT: "Verification email sent",
    IDENTITY_VERIFIED: "Requester verified",
    STATUS_CHANGED: "Status updated",
    INTERNAL_COMMENT_ADDED: "Internal note added",
    PUBLIC_ATTACHMENT_ADDED: "Response file uploaded",
    CONSUMER_NOTIFICATION_SENT: "Response delivered",
    CONSUMER_NOTIFICATION_FAILED: "Response delivery failed",
    ADMIN_ATTACHMENT_DOWNLOADED: "Attachment downloaded",
  };
  return labels[type] ?? "Request activity recorded";
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
