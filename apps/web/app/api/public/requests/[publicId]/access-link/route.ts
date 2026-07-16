import { createPublicRequestApi } from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";

export async function POST(
  _request: Request,
  context: { params: Promise<{ publicId: string }> },
) {
  const { publicId } = await context.params;
  const api = createPublicRequestApi(getPublicRequestApiDependencies());

  return api.requestAccessLink(publicId);
}
