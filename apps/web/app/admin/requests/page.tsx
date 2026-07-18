import { requireAdminSession } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  listAdminRequests,
} from "@/lib/admin-dashboard";
import { AdminRequestListWorkspace } from "../../../lib/admin-request-list";
import { requestStatuses, requestTypes } from "@magictrust/domain";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminRequestsPage({ searchParams }: PageProps) {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  const params = toUrlSearchParams(await searchParams);
  const result = await listAdminRequests(
    params,
    createAdminDashboardDependencies(),
    session.role,
  );

  return (
    <AdminRequestListWorkspace
      role={session.role}
      params={params}
      result={result}
      requestTypes={requestTypes}
      requestStatuses={requestStatuses}
    />
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
