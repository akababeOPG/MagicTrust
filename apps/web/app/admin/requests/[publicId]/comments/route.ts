import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  createAdminRequestComment,
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
    return await createAdminRequestComment(
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
          message: "Comment could not be created.",
        },
      },
      { status: 500 },
    );
  }
}
