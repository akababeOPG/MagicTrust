import { createInternalRequestApi } from "@/lib/internal-request-api";
import { getInternalRequestApiDependencies } from "@/lib/internal-request-api-dependencies";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const api = createInternalRequestApi(getInternalRequestApiDependencies());

  return api.get(request, id);
}
