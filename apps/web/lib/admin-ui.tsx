import type { RequestStatus } from "@magictrust/domain";
import Link from "next/link";
import React, { type ReactNode } from "react";

import type { AdminSession } from "./admin-auth";

const statusLabels: Record<RequestStatus, string> = {
  SUBMITTED: "Submitted",
  PENDING_VERIFICATION: "Awaiting verification",
  VERIFIED: "Verified",
  PROCESSING: "In progress",
  WAITING_FOR_REQUESTER: "Waiting on requester",
  SUCCESS: "Completed",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export function StatusBadge({ status }: { status: RequestStatus }) {
  return (
    <span className="mt-status-badge" data-status={status}>
      <span className="mt-status-glyph" aria-hidden="true" />
      {statusLabels[status]}
    </span>
  );
}

export function MagicTrustWordmark({ dark = false }: { dark?: boolean }) {
  return (
    <span className={`mt-wordmark${dark ? " mt-wordmark-dark" : ""}`}>
      <span className="mt-wordmark-mark" aria-hidden="true">
        <span />
      </span>
      <span className="mt-wordmark-text">
        <strong>Magic</strong>Trust
      </span>
    </span>
  );
}

export function AdminShell({
  session,
  children,
  topbarSlot,
  currentSection = "requests",
}: {
  session: AdminSession;
  children: ReactNode;
  topbarSlot?: ReactNode;
  currentSection?: "dashboard" | "requests" | "forms" | "users";
}) {
  return (
    <div className="mt-admin-shell">
      <AdminSidebar session={session} currentSection={currentSection} />
      <div className="mt-admin-main">
        <AdminTopbar
          session={session}
          searchSlot={topbarSlot}
          currentSection={currentSection}
        />
        <AdminPageContainer>{children}</AdminPageContainer>
      </div>
    </div>
  );
}

export function AdminSidebar({
  session,
  currentSection = "requests",
}: {
  session: AdminSession;
  currentSection?: "dashboard" | "requests" | "forms" | "users";
}) {
  return (
    <aside className="mt-admin-sidebar" aria-label="Admin navigation">
      <div className="mt-sidebar-brand">
        <Link
          className="mt-sidebar-brand-link"
          href="/admin"
          aria-label="MagicTrust dashboard"
        >
          <MagicTrustWordmark dark />
        </Link>
      </div>
      <AdminNavigation role={session.role} currentSection={currentSection} />
      <div className="mt-sidebar-footer">
        <AdminAccountSummary session={session} />
        <form action="/api/admin/auth/logout" method="post">
          <button className="mt-sidebar-logout" type="submit">
            Log out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function AdminTopbar({
  session,
  searchSlot,
  currentSection = "requests",
}: {
  session: AdminSession;
  searchSlot?: ReactNode;
  currentSection?: "dashboard" | "requests" | "forms" | "users";
}) {
  return (
    <header className="mt-admin-topbar">
      <details className="mt-mobile-nav">
        <summary aria-label="Open navigation">
          <MenuIcon />
        </summary>
        <div className="mt-mobile-nav-panel">
          <AdminNavigation
            role={session.role}
            currentSection={currentSection}
          />
          <div className="mt-mobile-account">
            <AdminAccountSummary session={session} />
            <form action="/api/admin/auth/logout" method="post">
              <button className="mt-sidebar-logout" type="submit">
                Log out
              </button>
            </form>
          </div>
        </div>
      </details>
      <nav className="mt-breadcrumbs" aria-label="Breadcrumb">
        <span>Workspace</span>
        <span aria-hidden="true">/</span>
        <strong>
          {currentSection === "dashboard"
            ? "Dashboard"
            : currentSection === "users"
              ? "Users"
              : currentSection === "forms"
                ? "Forms"
                : "Requests"}
        </strong>
      </nav>
      {searchSlot ? <div className="mt-topbar-search">{searchSlot}</div> : null}
      <span className="mt-topbar-spacer" />
      <button
        className="mt-icon-button"
        type="button"
        title="Help"
        aria-label="Help"
      >
        <HelpIcon />
      </button>
    </header>
  );
}

export function AdminPageContainer({ children }: { children: ReactNode }) {
  return <div className="mt-admin-page-container">{children}</div>;
}

function AdminNavigation({
  role,
  currentSection,
}: {
  role: AdminSession["role"];
  currentSection: "dashboard" | "requests" | "forms" | "users";
}) {
  return (
    <nav className="mt-sidebar-nav" aria-label="Workspace">
      <div className="mt-nav-group">
        <p className="mt-nav-label">Workspace</p>
        <Link
          className={`mt-nav-item${
            currentSection === "dashboard" ? " mt-nav-item-active" : ""
          }`}
          href="/admin"
          aria-current={currentSection === "dashboard" ? "page" : undefined}
        >
          <DashboardIcon />
          <span>Dashboard</span>
        </Link>
        <Link
          className={`mt-nav-item${
            currentSection === "requests" ? " mt-nav-item-active" : ""
          }`}
          href="/admin/requests"
          aria-current={currentSection === "requests" ? "page" : undefined}
        >
          <InboxIcon />
          <span>Requests</span>
        </Link>
      </div>
      {role !== "VIEWER" ? (
        <div className="mt-nav-group mt-nav-group-advanced">
          <p className="mt-nav-label">Administration</p>
          <Link
            className={`mt-nav-item${
              currentSection === "forms" ? " mt-nav-item-active" : ""
            }`}
            href="/admin/forms"
            aria-current={currentSection === "forms" ? "page" : undefined}
          >
            <FormsIcon />
            <span>Forms</span>
          </Link>
          {role === "ADMIN" ? (
            <Link
              className={`mt-nav-item${
                currentSection === "users" ? " mt-nav-item-active" : ""
              }`}
              href="/admin/users"
              aria-current={currentSection === "users" ? "page" : undefined}
            >
              <UserIcon />
              <span>Users</span>
            </Link>
          ) : null}
        </div>
      ) : null}
    </nav>
  );
}

function formatRole(role: AdminSession["role"]): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
}

function AdminAccountSummary({ session }: { session: AdminSession }) {
  const accountName = session.displayName || session.email || "Signed in";

  return (
    <div className="mt-user-summary">
      <span className="mt-user-avatar" aria-hidden="true">
        {accountName.slice(0, 1).toUpperCase()}
      </span>
      <span>
        <strong>{accountName}</strong>
        <small>{formatRole(session.role)}</small>
      </span>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M4 7h16M4 12h16M4 17h16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M9.8 9.2a2.4 2.4 0 1 1 3.5 2.1c-.8.5-1.3 1-1.3 2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 5h16v13H4zM4 14h5l1.5 2h3L15 14h5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DashboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle
        cx="12"
        cy="8"
        r="3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M5.5 20c.6-3.5 2.8-5.5 6.5-5.5s5.9 2 6.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function FormsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path
        d="M6 3.5h9l3 3V20.5H6zM15 3.5v3h3M9 11h6M9 15h6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
