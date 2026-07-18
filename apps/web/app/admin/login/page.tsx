import { AdminLoginForm } from "../../../lib/admin-login-form";
import { MagicTrustWordmark } from "../../../lib/admin-ui";

export default function AdminLoginPage() {
  return (
    <main className="page-shell">
      <section className="form-card">
        <MagicTrustWordmark />
        <h1>Internal admin</h1>
        <p>Sign in with your admin email address.</p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
