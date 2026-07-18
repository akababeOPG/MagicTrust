import { requireAdminRole } from "@/lib/admin-auth";
import {
  archiveAdminForm,
  createAdminFormDependencies,
} from "@/lib/admin-form-management";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });
  if (session instanceof Response) return session;
  const { publicId } = await context.params;
  try {
    return await archiveAdminForm(
      request,
      publicId,
      session,
      createAdminFormDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Form could not be archived.",
        },
      },
      { status: 500 },
    );
  }
}
