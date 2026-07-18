import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  updateAdminRequestDueDate,
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
    return await updateAdminRequestDueDate(
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
          message: "Request due date could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
