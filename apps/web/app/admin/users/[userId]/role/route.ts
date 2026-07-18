import { requireAdminRole } from "@/lib/admin-auth";
import {
  changeManagedAdminUserRole,
  createAdminUserManagementDependencies,
} from "@/lib/admin-user-management";

export async function POST(
  request: Request,
  context: { params: Promise<{ userId: string }> },
) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });

  if (session instanceof Response) return session;

  const { userId } = await context.params;

  try {
    return await changeManagedAdminUserRole(
      request,
      userId,
      session,
      createAdminUserManagementDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "User role could not be updated.",
        },
      },
      { status: 500 },
    );
  }
}
