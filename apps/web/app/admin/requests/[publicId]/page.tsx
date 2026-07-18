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
import { RequestProgress } from "../../../../lib/admin-request-progress";
import { StatusBadge } from "../../../../lib/admin-ui";
import { commentVisibilities } from "@magictrust/domain";

type PageProps = {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const statusLabels = {
  SUBMITTED: "Submitted",
  PENDING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  PROCESSING: "In progress",
  WAITING_FOR_REQUESTER: "Waiting on requester",
  SUCCESS: "Completed",
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
    session,
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
          <p className="eyebrow">Request detail</p>
          <h1>{request.publicId}</h1>
        </div>
        <div className="admin-actions">
          <Link href="/admin/requests">Back to requests</Link>
        </div>
      </header>

      <RequestOperationalMetadata request={request} role={session.role} />

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
              <StatusBadge status={request.status} />
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
  const terminalEvent = request.timeline.find(
    (event) =>
      event.type === "STATUS_CHANGED" &&
      event.data.newStatus === request.status,
  );
  const verified =
    request.status === "VERIFIED" ||
    request.status === "PROCESSING" ||
    request.status === "WAITING_FOR_REQUESTER" ||
    request.status === "SUCCESS" ||
    request.timeline.some(
      (event) =>
        event.type === "IDENTITY_VERIFIED" ||
        (event.type === "STATUS_CHANGED" &&
          event.data.newStatus === "VERIFIED"),
    );
  const processingStarted =
    request.status === "PROCESSING" ||
    request.status === "WAITING_FOR_REQUESTER" ||
    request.status === "SUCCESS" ||
    request.timeline.some(
      (event) =>
        event.type === "STATUS_CHANGED" &&
        event.data.newStatus === "PROCESSING",
    );

  return (
    <main className="admin-page guided-request-page">
      <nav
        className="request-detail-breadcrumb"
        aria-label="Request breadcrumb"
      >
        <Link href="/admin/requests">Requests</Link>
        <span aria-hidden="true">/</span>
        <span>{request.publicId}</span>
      </nav>

      <header className="admin-header guided-request-header">
        <div className="guided-request-identity">
          <p className="guided-request-eyebrow">Data access request</p>
          <div className="guided-request-title-row">
            <h1>{request.publicId}</h1>
            <StatusBadge status={request.status} />
          </div>
          <p className="guided-request-meta">
            Received {formatDateTime(request.createdAt)} ·{" "}
            {formatRequestAge(ageDays)}
          </p>
          <RequestOperationalMetadata request={request} role={role} />
        </div>
        <div className="request-header-actions">
          {canAct && !isTerminalStatus(request.status) ? (
            <DataAccessMoreActions publicId={request.publicId} />
          ) : null}
        </div>
      </header>

      {successMessage ? (
        <div className="mt-feedback mt-feedback-success" role="status">
          {friendlyFeedback(successMessage, "success")}
        </div>
      ) : null}
      {errorMessage ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          {friendlyFeedback(errorMessage, "error")}
        </div>
      ) : null}

      <RequestProgress
        status={request.status}
        responseReady={responseFile !== null}
        verified={verified}
        processingStarted={processingStarted}
      />

      <section
        className="admin-card next-step-card"
        aria-labelledby="next-step-heading"
      >
        <p className="eyebrow">Next step</p>
        <div className="next-step-content">
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
        </div>
      </section>

      <div className="data-access-workspace">
        <section
          className="admin-card requester-request-card"
          aria-labelledby="request-details-heading"
        >
          <div className="guided-section-heading">
            <div>
              <h2 id="request-details-heading">Requester and request</h2>
              <p>
                Identity and the original request submitted by the consumer.
              </p>
            </div>
          </div>
          {request.requester && request.originalSubmission ? (
            <>
              <dl className="requester-identity-grid">
                <div>
                  <dt>Name</dt>
                  <dd>
                    {[request.requester.firstName, request.requester.lastName]
                      .filter(Boolean)
                      .join(" ") || "Not provided"}
                  </dd>
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
              <div className="original-request-block">
                <div className="original-request-message">
                  <span>Message</span>
                  <p>
                    {request.originalSubmission.message ??
                      "No message was provided."}
                  </p>
                </div>
                <dl className="original-request-meta">
                  <div>
                    <dt>Submitted</dt>
                    <dd>{formatDateTime(request.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>
                      <strong>
                        {formatSubmissionSource(
                          request.originalSubmission.source.channel,
                        )}
                      </strong>
                      <span>
                        {request.originalSubmission.source.siteKey ??
                          "Source unavailable"}
                      </span>
                    </dd>
                  </div>
                </dl>
              </div>
            </>
          ) : (
            <div className="restricted-requester" role="note">
              <strong>Requester identity restricted</strong>
              <p>
                Your role can review workflow progress but cannot view requester
                identity or the original submission.
              </p>
            </div>
          )}
        </section>

        <section
          id="response"
          className="admin-card response-card"
          aria-labelledby="response-heading"
        >
          <div className="guided-section-heading">
            <div>
              <h2 id="response-heading">Response</h2>
              <p>
                Files are stored privately and delivered through secure access.
              </p>
            </div>
          </div>
          {publicAttachments.length === 0 ? (
            <div className="response-empty-state">
              <span className="response-file-icon" aria-hidden="true">
                <FileIcon />
              </span>
              <h3>No response file yet</h3>
              <p>
                Upload the completed response file when it is ready to be
                securely delivered to the requester.
              </p>
              {canAct && request.status === "PROCESSING" ? (
                <ResponseUploadForm publicId={request.publicId} />
              ) : null}
            </div>
          ) : (
            <div className="response-file-list">
              {publicAttachments.map((attachment, index) => (
                <article
                  className="response-file-card"
                  data-selected={index === 0 ? "true" : undefined}
                  key={attachment.id}
                >
                  <span className="response-file-icon" aria-hidden="true">
                    <FileIcon />
                  </span>
                  <div>
                    <strong>{attachment.fileName}</strong>
                    <span>
                      {attachment.mimeType} ·{" "}
                      {formatBytes(attachment.sizeBytes)}
                    </span>
                    <small>
                      Uploaded {formatDateTime(attachment.createdAt)}
                    </small>
                  </div>
                  <Link
                    className="mt-button mt-button-secondary request-file-action"
                    href={`/admin/requests/${request.publicId}/attachments/${attachment.id}/download`}
                  >
                    Download
                  </Link>
                </article>
              ))}
            </div>
          )}
          {request.status === "SUCCESS" ? (
            <div className="delivery-state delivery-state-success">
              <strong>Delivered successfully</strong>
              <dl>
                <div>
                  <dt>Delivered file</dt>
                  <dd>{responseFile?.fileName ?? "Unavailable"}</dd>
                </div>
                <div>
                  <dt>Sent</dt>
                  <dd>
                    {formatOptionalDateTime(
                      deliveryCommunication?.sentAt ?? null,
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Recipient</dt>
                  <dd>
                    {deliveryCommunication?.recipientMasked ?? "Unavailable"}
                  </dd>
                </div>
              </dl>
            </div>
          ) : deliveryFailed ? (
            <div className="delivery-state delivery-state-error" role="alert">
              <strong>Delivery failed</strong>
              <p>
                The response could not be delivered. Review the next step and
                try again.
              </p>
              <small>
                Last attempted{" "}
                {formatOptionalDateTime(latestDeliveryEvent?.createdAt ?? null)}
              </small>
            </div>
          ) : responseFile ? (
            <div className="delivery-state delivery-state-ready">
              <strong>Ready for secure delivery</strong>
              <p>Select the response file in the next step and send it.</p>
            </div>
          ) : null}
          {role === "ADMIN" && internalAttachments.length > 0 ? (
            <details className="internal-files-disclosure">
              <summary>Internal files</summary>
              <p>These files are not shared with the requester.</p>
              <ul>
                {internalAttachments.map((attachment) => (
                  <li key={attachment.id}>{attachment.fileName}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>

        <section
          className="admin-card internal-notes-card"
          aria-labelledby="internal-notes-heading"
        >
          <div className="guided-section-heading">
            <div>
              <h2 id="internal-notes-heading">Internal notes</h2>
              <p>Notes are visible only to your internal team.</p>
            </div>
          </div>
          {internalNotes.length === 0 ? (
            <div className="notes-empty-state">
              <p>No internal notes yet.</p>
            </div>
          ) : (
            <ol className="internal-note-feed">
              {internalNotes.map((note) => (
                <li key={note.id}>
                  <div>
                    <strong>{actorCategory(note.actorType)}</strong>
                    <time dateTime={note.createdAt}>
                      {formatDateTime(note.createdAt)}
                    </time>
                  </div>
                  <p>{note.body}</p>
                </li>
              ))}
            </ol>
          )}
          {canAct && request.status === "PROCESSING" ? (
            <form
              className="admin-action-form internal-note-composer"
              action={`/admin/requests/${request.publicId}/internal-notes`}
              method="post"
            >
              <label>
                Add internal note
                <textarea
                  name="body"
                  required
                  maxLength={5000}
                  rows={4}
                  placeholder="Add a note about processing this request..."
                />
              </label>
              <AdminSubmitButton>Add note</AdminSubmitButton>
            </form>
          ) : null}
        </section>
      </div>

      <section className="admin-card activity-history-card">
        <details className="activity-disclosure">
          <summary id="activity-heading">
            <span>
              <strong>View activity history</strong>
              <small>{request.timeline.length} recorded events</small>
            </span>
          </summary>
          {request.timeline.length === 0 ? (
            <p>No activity has been recorded.</p>
          ) : (
            <ol
              className="activity-timeline"
              aria-labelledby="activity-heading"
            >
              {request.timeline.map((event) => (
                <li key={event.id} data-category={event.category}>
                  <span className="activity-marker" aria-hidden="true" />
                  <div>
                    <strong>{activityLabel(event)}</strong>
                    <p>
                      {actorCategory(event.actorType)} ·{" "}
                      <time dateTime={event.createdAt}>
                        {formatDateTime(event.createdAt)}
                      </time>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </details>
      </section>
    </main>
  );
}

function RequestOperationalMetadata({
  request,
  role,
}: {
  request: AdminRequestDetailView;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}) {
  return (
    <div className="request-operational-metadata">
      <RequestAssignmentControl request={request} role={role} />
      <RequestDueDateControl request={request} role={role} />
    </div>
  );
}

function RequestAssignmentControl({
  request,
  role,
}: {
  request: AdminRequestDetailView;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}) {
  const assignment = request.assignment ?? {
    displayName: null,
    isCurrentUser: false,
    assignedToAdminUserId: null,
    assignedAt: null,
    options: [],
  };
  const assignedToCurrentUser = assignment.isCurrentUser;
  const isAssigned = assignment.assignedToAdminUserId !== null;
  const displayName = assignedToCurrentUser
    ? "You"
    : (assignment.displayName ?? "Unassigned");

  return (
    <div className="request-assignment" aria-label="Request assignment">
      <div className="request-assignment-summary">
        <span>Assigned to</span>
        <strong>{displayName}</strong>
      </div>

      {role === "ADMIN" ? (
        <details className="request-assignment-menu">
          <summary>{isAssigned ? "Manage" : "Assign"}</summary>
          <div className="request-assignment-panel">
            <form
              action={`/admin/requests/${request.publicId}/assignment`}
              method="post"
            >
              <input type="hidden" name="action" value="assign" />
              <label>
                Assign to
                <select
                  name="assigneeId"
                  required
                  defaultValue={
                    assignment.options.some(
                      (option) =>
                        option.id === assignment.assignedToAdminUserId,
                    )
                      ? (assignment.assignedToAdminUserId ?? "")
                      : ""
                  }
                >
                  <option value="">Select a user</option>
                  {assignment.options.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.displayName} ({formatAdminRole(option.role)})
                    </option>
                  ))}
                </select>
              </label>
              <AdminSubmitButton>
                {isAssigned ? "Reassign" : "Assign"}
              </AdminSubmitButton>
            </form>
            {isAssigned ? (
              <form
                action={`/admin/requests/${request.publicId}/assignment`}
                method="post"
              >
                <input type="hidden" name="action" value="unassign" />
                <AdminSubmitButton variant="secondary">
                  Unassign
                </AdminSubmitButton>
              </form>
            ) : null}
          </div>
        </details>
      ) : role === "OPERATOR" && !isAssigned ? (
        <form
          action={`/admin/requests/${request.publicId}/assignment`}
          method="post"
        >
          <input type="hidden" name="action" value="assign" />
          <AdminSubmitButton variant="secondary">
            Assign to me
          </AdminSubmitButton>
        </form>
      ) : role === "OPERATOR" && assignedToCurrentUser ? (
        <form
          action={`/admin/requests/${request.publicId}/assignment`}
          method="post"
        >
          <input type="hidden" name="action" value="unassign" />
          <AdminSubmitButton variant="secondary">Unassign</AdminSubmitButton>
        </form>
      ) : null}
    </div>
  );
}

function RequestDueDateControl({
  request,
  role,
}: {
  request: AdminRequestDetailView;
  role: "ADMIN" | "OPERATOR" | "VIEWER";
}) {
  const due = request.due ?? {
    dueAt: null,
    state: "NO_DUE_DATE" as const,
    stateLabel: "No due date",
    dateLabel: "No due date",
    shortDateLabel: "—",
    relativeLabel: null,
  };
  const canManage =
    role === "ADMIN" ||
    (role === "OPERATOR" &&
      (request.assignment?.assignedToAdminUserId === null ||
        request.assignment?.assignedToAdminUserId === undefined ||
        request.assignment?.isCurrentUser));

  return (
    <div className="request-due-date" aria-label="Request due date">
      <div className="request-due-date-summary">
        <span>Due date</span>
        <strong>{due.dateLabel}</strong>
        {due.state !== "NO_DUE_DATE" ? (
          <span className="request-sla-state" data-sla={due.state}>
            {due.stateLabel}
          </span>
        ) : null}
      </div>

      {canManage ? (
        <details className="request-due-date-menu">
          <summary>{due.dueAt ? "Edit" : "Set due date"}</summary>
          <div className="request-due-date-panel">
            <form
              action={`/admin/requests/${request.publicId}/due-date`}
              method="post"
            >
              <input type="hidden" name="action" value="set" />
              <label>
                Due date and time
                <input
                  type="datetime-local"
                  name="dueAt"
                  required
                  defaultValue={due.dueAt?.slice(0, 16) ?? ""}
                />
                <small>Times are stored and displayed in UTC.</small>
              </label>
              <AdminSubmitButton>
                {due.dueAt ? "Save due date" : "Set due date"}
              </AdminSubmitButton>
            </form>
            {due.dueAt ? (
              <form
                action={`/admin/requests/${request.publicId}/due-date`}
                method="post"
              >
                <input type="hidden" name="action" value="clear" />
                <AdminSubmitButton variant="secondary">
                  Clear due date
                </AdminSubmitButton>
              </form>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function DataAccessMoreActions({ publicId }: { publicId: string }) {
  return (
    <details className="request-more-actions">
      <summary>
        <span>More actions</span>
      </summary>
      <div className="request-more-actions-panel">
        <form
          className="admin-action-form"
          action={`/admin/requests/${publicId}/status`}
          method="post"
        >
          <h3>Reject request</h3>
          <p>Close this request because it cannot be fulfilled.</p>
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
          action={`/admin/requests/${publicId}/status`}
          method="post"
        >
          <h3>Cancel request</h3>
          <p>Close a withdrawn, administrative, or abandoned request.</p>
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
          <p className="next-step-context">
            Most recent verification email:{" "}
            {formatDateTime(latestVerificationAt)}
          </p>
        ) : null}
        {canAct ? (
          <form
            className="next-step-action"
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
            className="next-step-action"
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
        {canAct ? (
          <a className="mt-button next-step-action" href="#response">
            Upload response file
          </a>
        ) : null}
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
              <small>
                This message will be included in the delivery email.
              </small>
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
        <dl className="next-step-completion-meta">
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
        <p className="next-step-context">
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
      <label>
        Response file
        <input
          name="file"
          type="file"
          required
          accept="application/json,text/csv,application/pdf,text/plain,application/zip"
        />
        <small>This file will be securely available to the requester.</small>
      </label>
      <AdminSubmitButton>Upload response file</AdminSubmitButton>
    </form>
  );
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
function activityLabel(event: AdminRequestDetailView["timeline"][number]) {
  if (
    event.type === "STATUS_CHANGED" &&
    event.data.newStatus === "PROCESSING"
  ) {
    return "Processing started";
  }

  const labels: Record<string, string> = {
    REQUEST_CREATED: "Request submitted",
    IDENTITY_VERIFICATION_SENT: "Verification email sent",
    IDENTITY_VERIFIED: "Requester identity verified",
    STATUS_CHANGED: "Status updated",
    INTERNAL_COMMENT_ADDED: "Internal note added",
    PUBLIC_ATTACHMENT_ADDED: "Response file uploaded",
    CONSUMER_NOTIFICATION_SENT: "Response email sent",
    CONSUMER_NOTIFICATION_FAILED: "Response delivery failed",
    CONSUMER_ATTACHMENT_DOWNLOADED: "Requester downloaded response",
    ADMIN_ATTACHMENT_DOWNLOADED: "Response file downloaded by operator",
    REQUEST_DATA_UPDATED: "Internal processing metadata updated",
  };
  return (
    labels[event.type] ??
    (event.category === "CUSTOM"
      ? formatEnumLabel(event.type)
      : "Request activity recorded")
  );
}

function friendlyFeedback(message: string, kind: "success" | "error"): string {
  const safeMessages = new Set([
    "Verification email sent.",
    "Verification email was already sent.",
    "Processing started.",
    "Processing has already started.",
    "Internal note added.",
    "Internal note already recorded.",
    "Attachment uploaded.",
    "Attachment upload was already recorded.",
    "Response sent and request completed.",
    "This request is already completed.",
    "Status updated.",
    "Request assigned.",
    "Request unassigned.",
    "Request is already assigned to that user.",
    "Request is already unassigned.",
    "The selected assignee is not available.",
    "Due date saved.",
    "Due date cleared.",
    "Due date is already set to that time.",
    "Request already has no due date.",
    "Enter a valid due date and time in UTC.",
    "Verification email could not be sent.",
    "The response email could not be sent. The request remains in processing.",
    "Select a response file before sending.",
    "Select a valid response file.",
    "This request is not ready for response delivery.",
    "This request is not ready to process.",
    "Internal note is required.",
    "File is required.",
    "File is too large.",
    "File MIME type is not supported.",
  ]);

  if (safeMessages.has(message)) return message;
  return kind === "success"
    ? "Request updated."
    : "The request could not be updated. Try again.";
}

function formatRequestAge(ageDays: number): string {
  if (ageDays <= 0) return "received today";
  if (ageDays === 1) return "1 day old";
  if (ageDays < 14) return `${ageDays} days old`;

  const weeks = Math.floor(ageDays / 7);
  return weeks === 1 ? "1 week old" : `${weeks} weeks old`;
}

function formatSubmissionSource(channel: string | null): string {
  if (channel === "FORM") return "Hosted privacy form";
  if (channel === "API") return "Internal API";
  return channel ? formatEnumLabel(channel) : "Source unavailable";
}

function formatAdminRole(role: "ADMIN" | "OPERATOR"): string {
  return role === "ADMIN" ? "Admin" : "Operator";
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

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M6 3h8l4 4v14H6zM14 3v5h4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
