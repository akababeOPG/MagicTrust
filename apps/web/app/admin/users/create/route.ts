import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminUserManagementDependencies,
  createManagedAdminUser,
} from "@/lib/admin-user-management";

export async function POST(request: Request) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });

  if (session instanceof Response) return session;

  try {
    return await createManagedAdminUser(
      request,
      session,
      createAdminUserManagementDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "User could not be created.",
        },
      },
      { status: 500 },
    );
  }
}
