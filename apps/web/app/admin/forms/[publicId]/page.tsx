import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminFormDependencies,
  getAdminForm,
} from "@/lib/admin-form-management";
import { AdminFormDetail } from "../../../../lib/admin-form-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminFormPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"]);
  if (session instanceof Response) notFound();
  noStore();
  const { publicId } = await params;
  const form = await getAdminForm(publicId, createAdminFormDependencies());
  if (!form) notFound();
  const messages = await searchParams;
  return (
    <AdminFormDetail
      role={session.role}
      form={form}
      successMessage={first(messages?.success)}
      errorMessage={first(messages?.error)}
    />
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
