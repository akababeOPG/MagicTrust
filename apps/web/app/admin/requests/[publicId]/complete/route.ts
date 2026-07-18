import { requireAdminRole } from "@/lib/admin-auth";
import {
  completeAdminDeletionRequest,
  createAdminDashboardDependencies,
} from "@/lib/admin-dashboard";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"], {
    response: "json",
  });

  if (session instanceof Response) return session;

  return completeAdminDeletionRequest(
    request,
    (await context.params).publicId,
    session,
    createAdminDashboardDependencies(),
  );
}
