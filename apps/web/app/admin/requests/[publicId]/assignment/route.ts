import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  updateAdminRequestAssignment,
} from "@/lib/admin-dashboard";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminRole(["ADMIN", "OPERATOR"], {
    response: "json",
  });

  if (session instanceof Response) {
    return session;
  }

  const { publicId } = await context.params;

  try {
    return await updateAdminRequestAssignment(
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
          message: "Request assignment could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
