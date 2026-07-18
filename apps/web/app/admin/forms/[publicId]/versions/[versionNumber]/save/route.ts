import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminFormDependencies,
  saveAdminFormDraft,
} from "@/lib/admin-form-management";

export async function POST(
  request: Request,
  context: { params: Promise<{ publicId: string; versionNumber: string }> },
) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });
  if (session instanceof Response) return session;
  const { publicId, versionNumber } = await context.params;
  const parsedVersion = Number(versionNumber);
  if (!Number.isSafeInteger(parsedVersion) || parsedVersion < 1) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Version is invalid." } },
      { status: 400 },
    );
  }
  try {
    return await saveAdminFormDraft(
      request,
      publicId,
      parsedVersion,
      session,
      createAdminFormDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Draft could not be saved.",
        },
      },
      { status: 500 },
    );
  }
}
