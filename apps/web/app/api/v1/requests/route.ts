import { createInternalRequestApi } from "@/lib/internal-request-api";
import { getInternalRequestApiDependencies } from "@/lib/internal-request-api-dependencies";

export async function POST(request: Request) {
  const api = createInternalRequestApi(getInternalRequestApiDependencies());

  return api.create(request);
}

export async function GET(request: Request) {
  const api = createInternalRequestApi(getInternalRequestApiDependencies());

  return api.list(request);
}
