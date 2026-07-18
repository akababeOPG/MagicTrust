import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminUserManagementDependencies,
  listManagedAdminUsers,
} from "@/lib/admin-user-management";
import { AdminUserDirectory } from "../../../lib/admin-user-directory";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminUsersPage({ searchParams }: PageProps) {
  const session = await requireAdminRole(["ADMIN"]);

  if (session instanceof Response) notFound();

  noStore();

  const values = await searchParams;
  const params = toUrlSearchParams(values);
  const result = await listManagedAdminUsers(
    params,
    createAdminUserManagementDependencies(),
  );

  return (
    <AdminUserDirectory
      session={session}
      params={params}
      result={result}
      successMessage={firstParam(values?.success)}
      errorMessage={firstParam(values?.error)}
    />
  );
}

function toUrlSearchParams(
  values: Record<string, string | string[] | undefined> | undefined,
): URLSearchParams {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(values ?? {})) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, item);
    } else if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params;
}

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
