import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";

import { AdminApiClientDirectory } from "@/lib/admin-api-client-directory";
import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminApiClientDependencies,
  listManagedApiClients,
} from "@/lib/admin-api-client-management";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminApiClientsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminRole(["ADMIN"]);
  if (session instanceof Response) notFound();
  noStore();
  const params = await searchParams;
  return (
    <AdminApiClientDirectory
      clients={await listManagedApiClients(createAdminApiClientDependencies())}
      successMessage={first(params?.success)}
      errorMessage={first(params?.error)}
    />
  );
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
