import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  updateAdminRequestStatus,
} from "@/lib/admin-dashboard";

const mutationRoles = ["ADMIN", "OPERATOR"] as const;

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminRole(mutationRoles, { response: "json" });

  if (session instanceof Response) {
    return session;
  }

  const { publicId } = await context.params;

  try {
    return await updateAdminRequestStatus(
      request,
      publicId,
      session,
      createAdminDashboardDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Status could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
