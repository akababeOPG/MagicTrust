import { createInternalRequestApi } from "@/lib/internal-request-api";
import { getInternalRequestApiDependencies } from "@/lib/internal-request-api-dependencies";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const api = createInternalRequestApi(getInternalRequestApiDependencies());

  return api.addComment(request, id);
}
