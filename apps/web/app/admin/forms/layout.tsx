import { notFound } from "next/navigation";
import React, { type ReactNode } from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import { AdminShell } from "@/lib/admin-ui";

export default async function AdminFormsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"]);
  if (session instanceof Response) notFound();
  return (
    <AdminShell session={session} currentSection="forms">
      {children}
    </AdminShell>
  );
}
