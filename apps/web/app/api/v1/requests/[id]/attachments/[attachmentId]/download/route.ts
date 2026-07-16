import { createInternalRequestApi } from "@/lib/internal-request-api";
import { getInternalRequestApiDependencies } from "@/lib/internal-request-api-dependencies";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const { id, attachmentId } = await context.params;
  const api = createInternalRequestApi(getInternalRequestApiDependencies());

  return api.downloadAttachment(request, id, attachmentId);
}
