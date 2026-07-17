import Link from "next/link";
import { notFound } from "next/navigation";

import { requireAdminSession } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  getAdminRequestDetail,
} from "@/lib/admin-dashboard";

type PageProps = {
  params: Promise<{ publicId: string }>;
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

export default async function AdminRequestDetailPage({ params }: PageProps) {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  const { publicId } = await params;
  const request = await getAdminRequestDetail(
    publicId,
    createAdminDashboardDependencies(),
  );

  if (!request) {
    notFound();
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
