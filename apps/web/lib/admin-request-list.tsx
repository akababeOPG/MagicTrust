import type { RequestStatus, RequestType } from "@magictrust/domain";
import Link from "next/link";
import React from "react";

import type { AdminSession } from "./admin-auth";
import type {
  AdminRequestListItem,
  AdminRequestListView,
} from "./admin-dashboard";
import { StatusBadge } from "./admin-ui";

type AdminRequestListResult =
  { ok: true; data: AdminRequestListView } | { ok: false; message: string };

type WorkloadView = {
  id: string;
  label: string;
  status?: RequestStatus;
  assignedTo?: "me" | "unassigned";
};

const workloadViews: WorkloadView[] = [
  { id: "needs-attention", label: "Needs attention", status: "VERIFIED" },
  {
    id: "waiting-on-requester",
    label: "Waiting on requester",
    status: "WAITING_FOR_REQUESTER",
  },
  { id: "in-progress", label: "In progress", status: "PROCESSING" },
  { id: "completed", label: "Completed", status: "SUCCESS" },
];

const requestTypeLabels: Record<RequestType, string> = {
  DATA_ACCESS: "Data access",
  DATA_DELETION: "Data deletion",
  DO_NOT_CONTACT: "Do not contact",
  UNSUBSCRIBE: "Unsubscribe",
  GENERAL_INQUIRY: "General inquiry",
};

const fallbackNextStepLabels: Record<RequestStatus, string> = {
  SUBMITTED: "Review request",
  PENDING_VERIFICATION: "Waiting for verification",
  VERIFIED: "Start processing",
  PROCESSING: "In progress",
  WAITING_FOR_REQUESTER: "Waiting for requester",
  SUCCESS: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

const preservedSearchFilterKeys = [
  "type",
  "status",
  "createdFrom",
  "createdTo",
  "view",
  "assignedTo",
  "limit",
] as const;

export function AdminRequestListWorkspace({
  role,
  params,
  result,
  requestTypes,
  requestStatuses,
}: {
  role: AdminSession["role"];
  params: URLSearchParams;
  result: AdminRequestListResult;
  requestTypes: readonly RequestType[];
  requestStatuses: readonly RequestStatus[];
}) {
  const search = params.get("search") ?? "";
  const activeView = params.get("view");
  const activeFilterCount = countActiveFilters(params);
  const hasSearch = search.trim().length > 0;
  const hasFilters = activeFilterCount > 0;
  const assignmentOptions = result.ok ? result.data.assignmentOptions : [];
  const visibleWorkloadViews: WorkloadView[] = [
    ...(role === "VIEWER"
      ? []
      : ([
          { id: "my-requests", label: "My requests", assignedTo: "me" },
          {
            id: "unassigned",
            label: "Unassigned",
            assignedTo: "unassigned",
          },
        ] satisfies WorkloadView[])),
    ...workloadViews,
  ];

  return (
    <main className="admin-page requests-list-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Request workspace</p>
          <h1>Requests</h1>
          <p>Review, search, and process privacy requests.</p>
        </div>
      </header>

      <section
        className="admin-card request-search-card"
        aria-labelledby="search-heading"
      >
        <div className="request-section-heading">
          <div>
            <h2 id="search-heading">Search requests</h2>
            <p>Find one request using an exact identifier.</p>
          </div>
          {hasSearch ? (
            <Link
              className="request-clear-link"
              href={buildAdminListHref(params, {
                remove: ["search", "publicId", "cursor"],
              })}
            >
              Clear search
            </Link>
          ) : null}
        </div>
        <form className="request-search-form" method="get">
          {preservedSearchFilterKeys.map((key) => (
            <PreservedQueryInput key={key} name={key} params={params} />
          ))}
          <label className="request-search-input">
            <span>Search</span>
            <input
              name="search"
              defaultValue={search}
              placeholder={
                role === "VIEWER"
                  ? "Search by request ID"
                  : "Search by request ID, email, or phone"
              }
              autoComplete="off"
            />
            <small>
              {role === "VIEWER"
                ? "Requester search is restricted for your role. Use a public request ID."
                : "Email and phone searches use exact matching."}
            </small>
          </label>
          <button type="submit">Search</button>
        </form>
      </section>

      <section
        className="admin-card request-filter-card"
        aria-labelledby="filters-heading"
      >
        <details
          className="request-filter-disclosure"
          open={activeFilterCount > 0}
        >
          <summary id="filters-heading">
            <span>Filters</span>
            {activeFilterCount > 0 ? (
              <span className="request-filter-count">
                {activeFilterCount} active
              </span>
            ) : null}
          </summary>
          <form className="request-filter-form" method="get">
            {hasSearch ? (
              <input type="hidden" name="search" value={search} />
            ) : null}
            <input
              type="hidden"
              name="limit"
              value={params.get("limit") ?? 25}
            />
            <label>
              Request type
              <select name="type" defaultValue={params.get("type") ?? ""}>
                <option value="">Any type</option>
                {requestTypes.map((type) => (
                  <option key={type} value={type}>
                    {formatRequestTypeLabel(type)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={params.get("status") ?? ""}>
                <option value="">Any status</option>
                {requestStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatStatusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Assigned to
              <select
                name="assignedTo"
                defaultValue={params.get("assignedTo") ?? ""}
              >
                <option value="">Anyone</option>
                {role !== "VIEWER" ? <option value="me">Me</option> : null}
                <option value="unassigned">Unassigned</option>
                {role === "ADMIN"
                  ? assignmentOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.displayName} ({formatRoleLabel(option.role)})
                      </option>
                    ))
                  : null}
              </select>
            </label>
            <label>
              Created from
              <input
                name="createdFrom"
                defaultValue={params.get("createdFrom") ?? ""}
                placeholder="2026-07-01T00:00:00Z"
              />
            </label>
            <label>
              Created to
              <input
                name="createdTo"
                defaultValue={params.get("createdTo") ?? ""}
                placeholder="2026-08-01T00:00:00Z"
              />
            </label>
            <div className="request-filter-actions">
              <button type="submit">Apply filters</button>
              {hasFilters ? (
                <Link
                  className="mt-button mt-button-secondary"
                  href={buildAdminListHref(params, {
                    remove: [
                      "type",
                      "status",
                      "createdFrom",
                      "createdTo",
                      "assignedTo",
                      "view",
                      "cursor",
                    ],
                  })}
                >
                  Clear filters
                </Link>
              ) : null}
            </div>
          </form>
        </details>
      </section>

      <nav className="workload-views" aria-label="Request workload views">
        <Link
          className="workload-view-link"
          href={buildAdminListHref(params, {
            remove: ["view", "status", "assignedTo", "cursor"],
          })}
          aria-current={!activeView ? "page" : undefined}
        >
          All requests
        </Link>
        {visibleWorkloadViews.map((view) => (
          <Link
            key={view.id}
            className="workload-view-link"
            href={buildAdminListHref(params, {
              set: {
                view: view.id,
                status: view.status,
                assignedTo: view.assignedTo,
              },
              remove: [
                "cursor",
                ...(view.status ? ["assignedTo"] : ["status"]),
              ],
            })}
            aria-current={activeView === view.id ? "page" : undefined}
          >
            {view.label}
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          <strong>Check your search or filters.</strong>
          <p>{result.message}</p>
        </div>
      ) : (
        <RequestResults
          data={result.data}
          params={params}
          hasSearch={hasSearch}
          hasFilters={hasFilters}
          activeView={activeView}
          role={role}
        />
      )}
    </main>
  );
}

function RequestResults({
  data,
  params,
  hasSearch,
  hasFilters,
  activeView,
  role,
}: {
  data: AdminRequestListView;
  params: URLSearchParams;
  hasSearch: boolean;
  hasFilters: boolean;
  activeView: string | null;
  role: AdminSession["role"];
}) {
  const matching = hasSearch || hasFilters;
  const count = data.requests.length;

  return (
    <section
      className="admin-card request-results"
      aria-labelledby="requests-heading"
    >
      <div className="request-results-summary">
        <h2 id="requests-heading">
          {count} {matching ? "matching " : ""}
          {count === 1 ? "request" : "requests"}
        </h2>
        <p>Newest requests appear first.</p>
      </div>

      {count === 0 ? (
        <RequestEmptyState
          hasSearch={hasSearch}
          hasFilters={hasFilters}
          activeView={activeView}
        />
      ) : (
        <>
          <RequestDesktopTable requests={data.requests} role={role} />
          <RequestMobileCards requests={data.requests} role={role} />
        </>
      )}

      {data.pagination.nextCursor ? (
        <nav className="pagination-nav" aria-label="Request pagination">
          <span>
            Showing {count} {count === 1 ? "request" : "requests"}
          </span>
          <Link
            className="mt-button mt-button-secondary"
            href={buildAdminListHref(params, {
              set: { cursor: data.pagination.nextCursor },
            })}
          >
            Next
          </Link>
        </nav>
      ) : null}
    </section>
  );
}

function RequestDesktopTable({
  requests,
  role,
}: {
  requests: AdminRequestListItem[];
  role: AdminSession["role"];
}) {
  return (
    <div className="admin-table-wrap request-table-wrap">
      <table className="admin-table request-table">
        <thead>
          <tr>
            <th scope="col">Request</th>
            <th scope="col">Requester</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Assigned to</th>
            <th scope="col">Received</th>
            <th className="request-age-column" scope="col">
              Age
            </th>
            <th scope="col">Next step</th>
            <th scope="col">Open</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((request) => (
            <tr
              key={request.id}
              data-priority={requestPriority(request.status)}
            >
              <td>
                <strong className="request-public-id">
                  {request.publicId}
                </strong>
                {request.source?.channel ? (
                  <span className="table-secondary">
                    {formatSourceLabel(request.source.channel)}
                  </span>
                ) : null}
              </td>
              <td>
                <RequesterSummary request={request} role={role} />
              </td>
              <td>{formatRequestTypeLabel(request.type)}</td>
              <td>
                <StatusBadge status={request.status} />
              </td>
              <td>
                <AssignmentLabel request={request} />
              </td>
              <td>
                <ReceivedDate value={request.createdAt} />
              </td>
              <td className="request-age-column">
                {formatRequestAge(request.ageDays ?? 0)}
              </td>
              <td>
                <span className="request-next-step">
                  {request.nextStep ?? fallbackNextStepLabels[request.status]}
                </span>
              </td>
              <td>
                <Link
                  className="mt-button mt-button-secondary request-view-action"
                  href={`/admin/requests/${request.publicId}`}
                >
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RequestMobileCards({
  requests,
  role,
}: {
  requests: AdminRequestListItem[];
  role: AdminSession["role"];
}) {
  return (
    <div className="request-mobile-list" aria-label="Requests">
      {requests.map((request) => {
        const headingId = `mobile-request-${request.id}`;

        return (
          <article
            className="request-mobile-card"
            data-priority={requestPriority(request.status)}
            key={request.id}
            aria-labelledby={headingId}
          >
            <div className="request-mobile-card-heading">
              <div>
                <h3 id={headingId}>{request.publicId}</h3>
                <p>{formatRequestTypeLabel(request.type)}</p>
              </div>
              <StatusBadge status={request.status} />
            </div>
            <div className="request-mobile-meta">
              <div>
                <span>Requester</span>
                <RequesterSummary request={request} role={role} />
              </div>
              <div>
                <span>Received</span>
                <ReceivedDate value={request.createdAt} />
              </div>
              <div>
                <span>Assigned to</span>
                <AssignmentLabel request={request} />
              </div>
              <div>
                <span>Next step</span>
                <strong>
                  {request.nextStep ?? fallbackNextStepLabels[request.status]}
                </strong>
              </div>
            </div>
            <Link
              className="mt-button mt-button-secondary"
              href={`/admin/requests/${request.publicId}`}
            >
              View request
            </Link>
          </article>
        );
      })}
    </div>
  );
}

function RequesterSummary({
  request,
  role,
}: {
  request: AdminRequestListItem;
  role: AdminSession["role"];
}) {
  if (role === "VIEWER") {
    return <strong>Restricted</strong>;
  }

  return (
    <>
      <strong>{request.requesterSummary?.name ?? "Restricted"}</strong>
      {request.requesterSummary?.contact ? (
        <span className="table-secondary">
          {request.requesterSummary.contact}
        </span>
      ) : null}
    </>
  );
}

function AssignmentLabel({ request }: { request: AdminRequestListItem }) {
  if (request.assignment.isCurrentUser) {
    return <strong>You</strong>;
  }

  return (
    <span
      className={request.assignment.displayName ? undefined : "table-secondary"}
    >
      {request.assignment.displayName ?? "Unassigned"}
    </span>
  );
}

function ReceivedDate({ value }: { value: string }) {
  const date = new Date(value);

  return (
    <span className="request-received-date">
      <span>
        {new Intl.DateTimeFormat("en", {
          dateStyle: "medium",
          timeZone: "UTC",
        }).format(date)}
      </span>
      <small>
        {new Intl.DateTimeFormat("en", {
          timeStyle: "short",
          timeZone: "UTC",
        }).format(date)}{" "}
        UTC
      </small>
    </span>
  );
}

function RequestEmptyState({
  hasSearch,
  hasFilters,
  activeView,
}: {
  hasSearch: boolean;
  hasFilters: boolean;
  activeView: string | null;
}) {
  const content = activeView
    ? {
        title: "Nothing in this view",
        description:
          "There are currently no requests that match this workload view.",
      }
    : hasSearch || hasFilters
      ? {
          title: "No matching requests",
          description:
            "Try a different request ID, email, phone number, or filter.",
        }
      : {
          title: "No requests yet",
          description:
            "New privacy requests will appear here when they are submitted.",
        };

  return (
    <div className="request-empty-state">
      <span className="request-empty-icon" aria-hidden="true">
        <SearchIcon />
      </span>
      <h3>{content.title}</h3>
      <p>{content.description}</p>
      {hasSearch || hasFilters ? (
        <Link className="mt-button mt-button-secondary" href="/admin/requests">
          Clear search and filters
        </Link>
      ) : null}
    </div>
  );
}

function PreservedQueryInput({
  name,
  params,
}: {
  name: string;
  params: URLSearchParams;
}) {
  const value = params.get(name);

  return value ? <input type="hidden" name={name} value={value} /> : null;
}

export function formatRequestTypeLabel(type: RequestType): string {
  return requestTypeLabels[type];
}

export function formatRequestAge(ageDays: number): string {
  if (ageDays <= 0) return "Today";
  if (ageDays === 1) return "1 day";
  if (ageDays < 14) return `${ageDays} days`;

  const weeks = Math.floor(ageDays / 7);
  return weeks === 1 ? "1 week" : `${weeks} weeks`;
}

function formatStatusLabel(status: RequestStatus): string {
  return status === "PENDING_VERIFICATION"
    ? "Awaiting verification"
    : status === "PROCESSING"
      ? "In progress"
      : status === "WAITING_FOR_REQUESTER"
        ? "Waiting on requester"
        : status === "SUCCESS"
          ? "Completed"
          : status.charAt(0) + status.slice(1).toLowerCase();
}

function formatSourceLabel(channel: string): string {
  return channel.charAt(0) + channel.slice(1).toLowerCase();
}

function formatRoleLabel(role: "ADMIN" | "OPERATOR"): string {
  return role === "ADMIN" ? "Admin" : "Operator";
}

function requestPriority(
  status: RequestStatus,
): "actionable" | "waiting" | "completed" {
  if (status === "PENDING_VERIFICATION" || status === "WAITING_FOR_REQUESTER") {
    return "waiting";
  }

  if (status === "SUCCESS" || status === "REJECTED" || status === "CANCELLED") {
    return "completed";
  }

  return "actionable";
}

export function countActiveFilters(params: URLSearchParams): number {
  const standardFilters = [
    "type",
    "createdFrom",
    "createdTo",
    "assignedTo",
  ].filter((key) => Boolean(params.get(key))).length;

  const workloadFilter = params.get("view")
    ? params.get("assignedTo")
      ? 0
      : 1
    : params.get("status")
      ? 1
      : 0;

  return standardFilters + workloadFilter;
}

export function buildAdminListHref(
  params: URLSearchParams,
  changes: {
    set?: Record<string, string | undefined>;
    remove?: string[];
  },
): string {
  const query = new URLSearchParams(params);

  for (const key of changes.remove ?? []) query.delete(key);
  for (const [key, value] of Object.entries(changes.set ?? {})) {
    if (value) query.set(key, value);
    else query.delete(key);
  }

  const value = query.toString();
  return value ? `/admin/requests?${value}` : "/admin/requests";
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
      <circle
        cx="10.5"
        cy="10.5"
        r="6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m15.5 15.5 4 4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
