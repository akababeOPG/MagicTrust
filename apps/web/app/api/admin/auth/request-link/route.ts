import {
  createAdminAuthDependencies,
  createAdminAuthService,
} from "../../../../../lib/admin-auth";

export async function POST(request: Request) {
  const service = createAdminAuthService(createAdminAuthDependencies());

  return service.requestLoginLink(request);
}
