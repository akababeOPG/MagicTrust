import { requireAdminSession } from "../../../lib/admin-auth";

export default async function AdminRequestsPage() {
  const session = await requireAdminSession();

  if (session instanceof Response) {
    return null;
  }

  return (
    <main className="page-shell">
      <section className="form-card">
        <h1>MagicTrust Internal</h1>
        <p>Authenticated admin role: {session.role}</p>
        <p>Request dashboard coming next</p>
        <form action="/api/admin/auth/logout" method="post">
          <button type="submit">Log out</button>
        </form>
      </section>
    </main>
  );
}
