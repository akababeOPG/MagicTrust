import { createPublicRequestApi } from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";

export async function POST(request: Request) {
  const api = createPublicRequestApi(getPublicRequestApiDependencies());

  return api.create(request);
}
