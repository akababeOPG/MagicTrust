import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminForm,
  createAdminFormDependencies,
} from "@/lib/admin-form-management";

export async function POST(request: Request) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });
  if (session instanceof Response) return session;
  try {
    return await createAdminForm(
      request,
      session,
      createAdminFormDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Form could not be created.",
        },
      },
      { status: 500 },
    );
  }
}
