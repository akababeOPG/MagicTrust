import { AdminLoginForm } from "../../../lib/admin-login-form";
import { normalizeAdminReturnTo } from "../../../lib/admin-auth";
import { MagicTrustWordmark } from "../../../lib/admin-ui";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; returnTo?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="page-shell">
      <section className="form-card">
        <MagicTrustWordmark />
        <h1>Internal admin</h1>
        <p>Sign in with your admin email and password.</p>
        <AdminLoginForm
          returnTo={normalizeAdminReturnTo(params.returnTo)}
          showInvalidCredentials={params.error === "invalid_credentials"}
        />
      </section>
    </main>
  );
}
