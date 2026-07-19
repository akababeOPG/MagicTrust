import Link from "next/link";
import React, { type ReactNode } from "react";

import type { AdminSession } from "./admin-auth";
import type { AdminHomeView, AdminRequestListItem } from "./admin-dashboard";
import {
  AssignmentLabel,
  formatRequestTypeLabel,
  ReceivedDate,
  RequesterSummary,
} from "./admin-request-list";
import { StatusBadge } from "./admin-ui";

export function AdminHome({
  role,
  dashboard,
}: {
  role: AdminSession["role"];
  dashboard: AdminHomeView;
}) {
  const { summary, recentRequests } = dashboard;

  return (
    <main className="admin-page admin-home-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Workspace</p>
          <h1>Dashboard</h1>
          <p>An overview of requests that may need your attention.</p>
        </div>
      </header>

      <section
        className="admin-card admin-home-attention"
        aria-labelledby="needs-attention-heading"
      >
        <div className="admin-home-attention-copy">
          <p className="eyebrow">Current workload</p>
          <h2 id="needs-attention-heading">Needs attention</h2>
          <p>
            {summary.needsAttention === 0
              ? "No requests need attention."
              : "Active requests that are overdue, due soon, or unassigned."}
          </p>
        </div>
        <strong className="admin-home-attention-count">
          {summary.needsAttention}
          <span>active requests</span>
        </strong>
        <nav
          className="admin-home-attention-links"
          aria-label="Needs attention"
        >
          <Link href="/admin/requests?view=overdue&due=overdue">Overdue</Link>
          <Link href="/admin/requests?view=due-soon&due=due-soon">
            Due soon
          </Link>
          <Link href="/admin/requests?view=unassigned&assignedTo=unassigned">
            Unassigned
          </Link>
        </nav>
      </section>

      <section
        className="admin-home-summary-grid"
        aria-label="Operational summary"
      >
        <SummaryCard
          label="My requests"
          count={summary.myRequests}
          description={
            summary.myRequests === 0
              ? "You have no active assigned requests."
              : "Active requests assigned to you."
          }
          href={
            role === "VIEWER"
              ? undefined
              : "/admin/requests?view=my-requests&assignedTo=me"
          }
        />
        <SummaryCard
          label="Unassigned"
          count={summary.unassigned}
          description="Active requests without an owner."
          href="/admin/requests?view=unassigned&assignedTo=unassigned"
        />
        <SummaryCard
          label="Overdue"
          count={summary.overdue}
          description="Active requests past their due date."
          href="/admin/requests?view=overdue&due=overdue"
        />
        <SummaryCard
          label="Due soon"
          count={summary.dueSoon}
          description="Active requests due within 48 hours."
          href="/admin/requests?view=due-soon&due=due-soon"
        />
        <SummaryCard
          label="Completed recently"
          count={summary.completedRecently}
          description="Completed successfully in the last 7 days."
        />
      </section>

      <section
        className="admin-card admin-home-recent"
        aria-labelledby="recent-requests-heading"
      >
        <div className="admin-home-section-heading">
          <div>
            <h2 id="recent-requests-heading">Recent requests</h2>
            <p>The newest requests received by MagicTrust.</p>
          </div>
          <Link href="/admin/requests">View all requests</Link>
        </div>
        {recentRequests.length === 0 ? (
          <div className="admin-home-empty">
            <h3>No recent requests</h3>
            <p>New requests will appear here when they arrive.</p>
          </div>
        ) : (
          <>
            <RecentRequestsTable requests={recentRequests} role={role} />
            <RecentRequestCards requests={recentRequests} role={role} />
          </>
        )}
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  count,
  description,
  href,
}: {
  label: string;
  count: number;
  description: string;
  href?: string;
}) {
  const content = (
    <>
      <span>{label}</span>
      <strong>{count}</strong>
      <p>{description}</p>
      {href ? <small>View requests</small> : null}
    </>
  );

  return href ? (
    <Link className="admin-home-summary-card" href={href}>
      {content}
    </Link>
  ) : (
    <article className="admin-home-summary-card">{content}</article>
  );
}

function RecentRequestsTable({
  requests,
  role,
}: {
  requests: AdminRequestListItem[];
  role: AdminSession["role"];
}) {
  return (
    <div className="admin-table-wrap admin-home-table-wrap">
      <table className="admin-table admin-home-table">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Requester</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Created</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr key={request.id}>
              <td>
                <Link
                  className="request-public-id"
                  href={`/admin/requests/${encodeURIComponent(request.publicId)}`}
                >
                  {request.publicId}
                </Link>
              </td>
              <td>{formatRequestTypeLabel(request.type)}</td>
              <td>
                <StatusBadge status={request.status} />
              </td>
              <td>
                <RequesterSummary request={request} role={role} />
              </td>
              <td>
                <AssignmentLabel request={request} />
              </td>
              <td>
                <ReceivedDate value={request.createdAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RecentRequestCards({
  requests,
  role,
}: {
  requests: AdminRequestListItem[];
  role: AdminSession["role"];
}) {
  return (
    <div className="admin-home-recent-mobile" aria-label="Recent requests">
      {requests.map((request) => (
        <article key={request.id}>
          <div className="admin-home-recent-mobile-heading">
            <div>
              <Link
                href={`/admin/requests/${encodeURIComponent(request.publicId)}`}
              >
                {request.publicId}
              </Link>
              <p>{formatRequestTypeLabel(request.type)}</p>
            </div>
            <StatusBadge status={request.status} />
          </div>
          <dl>
            <RecentRequestDetail label="Requester">
              <RequesterSummary request={request} role={role} />
            </RecentRequestDetail>
            <RecentRequestDetail label="Assigned to">
              <AssignmentLabel request={request} />
            </RecentRequestDetail>
            <RecentRequestDetail label="Created">
              <ReceivedDate value={request.createdAt} />
            </RecentRequestDetail>
          </dl>
        </article>
      ))}
    </div>
  );
}

function RecentRequestDetail({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
