import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import { AdminShell } from "@/lib/admin-ui";

export default async function AdminUsersLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminRole(["ADMIN"]);

  if (session instanceof Response) notFound();

  return (
    <AdminShell session={session} currentSection="users">
      {children}
    </AdminShell>
  );
}
