import { unstable_noStore as noStore } from "next/cache";
import React from "react";

import { requireAdminSession } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  getAdminHomeDashboard,
} from "@/lib/admin-dashboard";
import { AdminHome } from "../../lib/admin-home";
import { AdminShell } from "../../lib/admin-ui";

export default async function AdminHomePage() {
  noStore();
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  const dashboard = await getAdminHomeDashboard(
    session,
    createAdminDashboardDependencies(),
  );

  return (
    <AdminShell session={session} currentSection="dashboard">
      <AdminHome role={session.role} dashboard={dashboard} />
    </AdminShell>
  );
}
