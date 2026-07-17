import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  updateAdminMutableData,
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
    return await updateAdminMutableData(
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
          message: "Mutable data could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
