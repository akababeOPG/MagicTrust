# MagicTrust Design System

This document is the canonical frontend design reference for MagicTrust. All new UI and UX work must follow this specification unless an explicit product decision supersedes it.

The companion [MagicTrust UX Principles](./ux-principles.md) document captures the reusable workflow and interaction decisions derived from the approved Claude Design handoff. Read both documents before implementing or modifying frontend behavior.

MagicTrust uses a quiet operational design language: warm neutral surfaces, clear hierarchy, restrained accents, and semantic feedback. The token layer lives in `apps/web/app/globals.css` under the `--mt-*` namespace.

## Color

Core surfaces use `--mt-canvas`, `--mt-surface`, and `--mt-sunken`. Text and borders use the `--mt-ink`, `--mt-text-*`, and `--mt-border*` scales. The dark sidebar has its own `--mt-sidebar-*` variables so navigation contrast does not leak into the work surface.

Brown accent tokens identify focus, links, progress, and selected navigation. Accent is not the primary button color. Primary actions use `--mt-ink`; destructive actions use `--mt-danger`. Statuses use dedicated foreground, background, and border tokens rather than generic accent colors.

## Typography

The application uses `Helvetica, "Helvetica Neue", Arial, sans-serif` with a 14px body and 1.55 line height. Reusable `.mt-type-*` classes cover display, heading, large, body, small, extra-small, and label text. Compact labels are uppercase; headings are reserved for real page and section hierarchy.

## Spacing And Shape

Spacing tokens follow the approved 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, and 64px scale. Controls use a 10px radius, cards use 12px, and dialogs use 16px. Shadows remain subtle on cards and are stronger only for transient menus and dialogs.

## Components

- **Buttons:** Primary uses dark ink, secondary uses a white bordered surface, and destructive uses danger red. Primary action targets are at least 44px tall. Icon buttons are 38px square.
- **Cards:** White surfaces with a one-pixel neutral border, 12px radius, and subtle shadow.
- **Controls:** White inputs, selects, and textareas with strong neutral borders and a visible accent focus ring.
- **Status badges:** `StatusBadge` combines a natural-language label, glyph, and exact semantic status colors. Status never depends on color alone.
- **Wordmark:** `MagicTrustWordmark` uses the accent ring and dot with weighted text and supports the dark sidebar.
- **Feedback:** `.mt-feedback`, `.mt-feedback-success`, and `.mt-feedback-error` style static redirect feedback without a client-side toast dependency.
- **Dialogs:** `.mt-dialog-*` classes provide the surface, backdrop, action hierarchy, focus visibility, and destructive button treatment for confirmation flows.

## Admin Shell

`AdminShell`, `AdminSidebar`, `AdminTopbar`, and `AdminPageContainer` form the authenticated workspace. Desktop uses a fixed 246px sidebar, 60px topbar, and centered 1180px content area. Below 1024px, a keyboard-accessible compact navigation menu replaces the fixed sidebar. Advanced tools are visible only to the ADMIN role and remain outside the normal request workflow.

## Requests List

The requests workspace is ordered around operator intent: unified exact search, compact secondary filters, URL-derived workload views, results, and cursor pagination. Search preserves filters and pagination preserves the full active query. VIEWER users receive a request-ID-only search surface and never receive requester summaries.

Workload views are navigation shortcuts over existing status filters; they do not introduce stored workflow state or additional count queries. The active view is identified by text and an accent indicator with `aria-current`.

Desktop tables prioritize Request, Requester, Status, Next step, and View. Age is the first column removed as space tightens. On mobile, the table becomes stacked request cards containing the same operational identity, status, requester summary, received date, next step, and accessible View action. Actionable, waiting, and completed rows use restrained indicators without changing database ordering.

## Guided Request Detail

The DATA_ACCESS detail workspace follows operational priority: a compact breadcrumb and request identity, progress, the current next step, requester/response/notes work areas, then collapsed activity history. The public ID is the primary heading, with the status badge alongside it and secondary actions kept separate. The next-step card is the single strongest action surface. Desktop uses an approximately 64/36 requester-to-response layout; tablet and mobile stack Requester, Response, then Internal notes.

Progress maps Received, Verified, Processing, Response ready, and Completed on a compact horizontal track. Completed stages use checkmarks, the current stage uses a bordered dot, and upcoming stages retain their step numbers; stage state remains available semantically without repeating captions below each label. Waiting requests show an interruption treatment. Rejected and cancelled requests preserve stages reached before closure without marking the workflow completed.

Requester data and the original message are server-rendered only for ADMIN and OPERATOR roles. VIEWER receives a restricted state. Original submissions are presented as readable identity, message, submitted date, and source rather than technical JSON.

Response states distinguish no file, ready for delivery, failed delivery, and delivered successfully. Files remain private, and the UI avoids storage terminology and attachment identifiers. Internal notes never expose visibility controls or actor IDs. Activity history is collapsed by default and translates audit events into human-readable labels without rendering raw event payloads, provider identifiers, hashes, or tokens.

## Consumer Secure Access

The secure consumer request page uses a centered, narrow layout without the admin shell. Its hierarchy is branding and secure-access context, the current request outcome, available response files, request details, then non-empty public updates. For completed data access requests, the response download is the primary action and appears before request metadata.

Only PUBLIC attachments are rendered. File cards translate MIME types and byte counts into natural file descriptions and human-readable sizes, retain descriptive download labels, and use the existing secure consumer download route. Empty response and update sections remain hidden.

Consumer status, request type, events, and supporting copy use natural language instead of backend enums or raw JSON. The page never renders requester PII, internal events, actor identifiers, credentials, tokens, hashes, ciphertext, Blob URLs, or storage implementation details.

## Product Rules

- Present one clear primary action for the current task.
- Do not use accent brown as the primary-button color.
- Never communicate request status through color alone.
- Keep technical tools off the normal operator workflow.
- Preserve accessible labels, focus states, and minimum action target sizes.
