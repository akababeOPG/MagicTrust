import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminFormDependencies,
  listAdminForms,
} from "@/lib/admin-form-management";
import { AdminFormsList } from "../../../lib/admin-form-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminFormsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"]);
  if (session instanceof Response) notFound();
  noStore();
  const messages = await searchParams;
  return (
    <AdminFormsList
      role={session.role}
      forms={await listAdminForms(createAdminFormDependencies())}
      errorMessage={first(messages?.error)}
    />
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
