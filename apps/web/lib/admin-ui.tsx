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
}: {
  session: AdminSession;
  children: ReactNode;
  topbarSlot?: ReactNode;
}) {
  return (
    <div className="mt-admin-shell">
      <AdminSidebar session={session} />
      <div className="mt-admin-main">
        <AdminTopbar session={session} searchSlot={topbarSlot} />
        <AdminPageContainer>{children}</AdminPageContainer>
      </div>
    </div>
  );
}

export function AdminSidebar({ session }: { session: AdminSession }) {
  return (
    <aside className="mt-admin-sidebar" aria-label="Admin navigation">
      <div className="mt-sidebar-brand">
        <MagicTrustWordmark dark />
      </div>
      <AdminNavigation role={session.role} />
      <div className="mt-sidebar-footer">
        <div className="mt-user-summary">
          <span className="mt-user-avatar" aria-hidden="true">
            {session.role.slice(0, 1)}
          </span>
          <span>
            <strong>Signed in</strong>
            <small>{formatRole(session.role)}</small>
          </span>
        </div>
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
}: {
  session: AdminSession;
  searchSlot?: ReactNode;
}) {
  return (
    <header className="mt-admin-topbar">
      <details className="mt-mobile-nav">
        <summary aria-label="Open navigation">
          <MenuIcon />
        </summary>
        <div className="mt-mobile-nav-panel">
          <AdminNavigation role={session.role} />
          <div className="mt-mobile-account">
            <div className="mt-user-summary">
              <span className="mt-user-avatar" aria-hidden="true">
                {session.role.slice(0, 1)}
              </span>
              <span>
                <strong>Signed in</strong>
                <small>{formatRole(session.role)}</small>
              </span>
            </div>
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
        <strong>Requests</strong>
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

function AdminNavigation({ role }: { role: AdminSession["role"] }) {
  return (
    <nav className="mt-sidebar-nav" aria-label="Workspace">
      <div className="mt-nav-group">
        <p className="mt-nav-label">Workspace</p>
        <Link
          className="mt-nav-item mt-nav-item-active"
          href="/admin/requests"
          aria-current="page"
        >
          <InboxIcon />
          <span>Requests</span>
        </Link>
      </div>
      <div className="mt-nav-group">
        <p className="mt-nav-label">Views</p>
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=overdue&due=overdue"
        >
          Overdue
        </Link>
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=due-soon&due=due-soon"
        >
          Due soon
        </Link>
        {role !== "VIEWER" ? (
          <>
            <Link
              className="mt-nav-item"
              href="/admin/requests?view=my-requests&assignedTo=me"
            >
              My requests
            </Link>
            <Link
              className="mt-nav-item"
              href="/admin/requests?view=unassigned&assignedTo=unassigned"
            >
              Unassigned
            </Link>
          </>
        ) : null}
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=needs-attention&status=VERIFIED"
        >
          Needs attention
        </Link>
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=waiting-on-requester&status=WAITING_FOR_REQUESTER"
        >
          Waiting on requester
        </Link>
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=in-progress&status=PROCESSING"
        >
          In progress
        </Link>
        <Link
          className="mt-nav-item"
          href="/admin/requests?view=completed&status=SUCCESS"
        >
          Completed
        </Link>
      </div>
      {role === "ADMIN" ? (
        <div className="mt-nav-group mt-nav-group-advanced">
          <p className="mt-nav-label">Administration</p>
          <span className="mt-nav-item mt-nav-item-secondary">
            <SettingsIcon />
            <span>Advanced tools</span>
          </span>
        </div>
      ) : null}
    </nav>
  );
}

function formatRole(role: AdminSession["role"]): string {
  return role.charAt(0) + role.slice(1).toLowerCase();
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

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}
