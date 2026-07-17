import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  resendAdminIdentityVerification,
} from "@/lib/admin-dashboard";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"], {
    response: "json",
  });

  if (session instanceof Response) return session;

  return resendAdminIdentityVerification(
    request,
    (await context.params).publicId,
    session,
    createAdminDashboardDependencies(),
  );
}
