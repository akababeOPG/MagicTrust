import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminApiClientDependencies,
  createManagedApiClient,
} from "@/lib/admin-api-client-management";

export async function POST(request: Request) {
  const session = await requireAdminRole(["ADMIN"], { response: "json" });
  if (session instanceof Response) return session;
  return createManagedApiClient(
    request,
    session,
    createAdminApiClientDependencies(),
  );
}
