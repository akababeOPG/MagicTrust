import { requireAdminSession } from "@/lib/admin-auth";
import {
  createAdminDashboardDependencies,
  downloadAdminAttachment,
} from "@/lib/admin-dashboard";

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicId: string; attachmentId: string }> },
) {
  const session = await requireAdminSession({ response: "json" });

  if (session instanceof Response) {
    return session;
  }

  const { publicId, attachmentId } = await context.params;

  try {
    return await downloadAdminAttachment(
      publicId,
      attachmentId,
      session,
      createAdminDashboardDependencies(),
    );
  } catch {
    return Response.json(
      {
        error: {
          code: "INTERNAL_ERROR",
          message: "Attachment could not be downloaded.",
        },
      },
      { status: 500 },
    );
  }
}
