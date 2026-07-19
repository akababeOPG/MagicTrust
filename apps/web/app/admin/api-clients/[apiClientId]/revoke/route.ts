import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminApiClientDependencies,
  revokeManagedApiClient,
} from "@/lib/admin-api-client-management";

export async function POST(
  request: Request,
  context: { params: Promise<{ apiClientId: string }> },
) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });
  if (session instanceof Response) return session;
  const { apiClientId } = await context.params;
  return revokeManagedApiClient(
    request,
    apiClientId,
    session,
    createAdminApiClientDependencies(),
  );
}
