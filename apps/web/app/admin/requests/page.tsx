import Link from "next/link";

import { requireAdminSession } from "@/lib/admin-auth";
import {
  buildAdminRequestListQuery,
  createAdminDashboardDependencies,
  listAdminRequests,
} from "@/lib/admin-dashboard";
import { requestStatuses, requestTypes } from "@magictrust/domain";

type PageProps = {
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

export default async function AdminRequestsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  const params = toUrlSearchParams(await searchParams);
  const result = await listAdminRequests(
    params,
    createAdminDashboardDependencies(),
  );

  return (
    <main className="admin-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">MagicTrust Internal</p>
          <h1>Requests</h1>
          <p>Authenticated role: {session.role}</p>
        </div>
        <form action="/api/admin/auth/logout" method="post">
          <button type="submit">Log out</button>
        </form>
      </header>

      <section className="admin-card" aria-labelledby="filters-heading">
        <div className="section-heading">
          <h2 id="filters-heading">Filters</h2>
          <Link href="/admin/requests">Clear Filters</Link>
        </div>
        <form className="admin-filter-form" method="get">
          <label>
            Public ID
            <input
              name="publicId"
              defaultValue={params.get("publicId") ?? ""}
              autoComplete="off"
            />
          </label>
          <label>
            Type
            <select name="type" defaultValue={params.get("type") ?? ""}>
              <option value="">Any type</option>
              {requestTypes.map((type) => (
                <option key={type} value={type}>
                  {formatEnumLabel(type)}
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
                  {statusLabels[status]}
                </option>
              ))}
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
          <input type="hidden" name="limit" value={params.get("limit") ?? 25} />
          <button type="submit">Apply Filters</button>
        </form>
      </section>

      {!result.ok ? (
        <section className="admin-card" role="alert">
          <h2>Validation</h2>
          <p>{result.message}</p>
        </section>
      ) : (
        <section className="admin-card" aria-labelledby="requests-heading">
          <div className="section-heading">
            <h2 id="requests-heading">Request List</h2>
            <p>Page size: {result.data.pagination.limit}</p>
          </div>
          {result.data.requests.length === 0 ? (
            <p>No requests match these filters.</p>
          ) : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th scope="col">Public ID</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col">Source channel</th>
                    <th scope="col">Created at</th>
                    <th scope="col">Updated at</th>
                    <th scope="col">Completed at</th>
                    <th scope="col">Open</th>
                  </tr>
                </thead>
                <tbody>
                  {result.data.requests.map((request) => (
                    <tr key={request.id}>
                      <td>{request.publicId}</td>
                      <td>{formatEnumLabel(request.type)}</td>
                      <td>
                        <span className={`status-badge ${request.status}`}>
                          {statusLabels[request.status]}
                        </span>
                      </td>
                      <td>{request.source?.channel ?? "Unknown"}</td>
                      <td>{formatDateTime(request.createdAt)}</td>
                      <td>{formatDateTime(request.updatedAt)}</td>
                      <td>{formatOptionalDateTime(request.completedAt)}</td>
                      <td>
                        <Link href={`/admin/requests/${request.publicId}`}>
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.data.pagination.nextCursor ? (
            <nav className="pagination-nav" aria-label="Request pagination">
              <Link
                href={`/admin/requests${buildAdminRequestListQuery(
                  params,
                  result.data.pagination.nextCursor,
                )}`}
              >
                Next page
              </Link>
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}

function toUrlSearchParams(
  searchParams: Record<string, string | string[] | undefined> | undefined,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params;
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
