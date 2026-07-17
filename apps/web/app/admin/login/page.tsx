import { AdminLoginForm } from "../../../lib/admin-login-form";

export default function AdminLoginPage() {
  return (
    <main className="page-shell">
      <section className="form-card">
        <h1>MagicTrust Internal</h1>
        <p>Sign in with your admin email address.</p>
        <AdminLoginForm />
      </section>
    </main>
  );
}
