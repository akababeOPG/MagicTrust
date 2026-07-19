import React from "react";

export function AdminLoginForm({
  returnTo,
  showInvalidCredentials,
}: {
  returnTo: string;
  showInvalidCredentials: boolean;
}) {
  return (
    <form action="/api/admin/auth/login" className="admin-form" method="post">
      <input name="returnTo" type="hidden" value={returnTo} />
      <label>
        Email
        <input autoComplete="username" name="email" required type="email" />
      </label>
      <label>
        Password
        <input
          autoComplete="current-password"
          minLength={10}
          name="password"
          required
          type="password"
        />
      </label>
      <button type="submit">Sign in</button>
      {showInvalidCredentials ? (
        <p className="admin-message admin-message-error" role="alert">
          Invalid email or password.
        </p>
      ) : null}
    </form>
  );
}
