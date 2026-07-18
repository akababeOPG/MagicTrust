import type { ReactNode } from "react";

import { requireAdminSession } from "@/lib/admin-auth";
import { AdminShell } from "../../../lib/admin-ui";

export default async function AdminRequestsLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  return <AdminShell session={session}>{children}</AdminShell>;
}
