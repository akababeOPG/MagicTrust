# API

## `GET /api/health`

Returns application health and database connectivity status.

Example response when the database is configured and reachable:

```json
{
  "app": "MagicTrust",
  "status": "ok",
  "database": {
    "ok": true,
    "status": "connected"
  },
  "checkedAt": "2026-07-16T00:00:00.000Z"
}
```

Example response when `DATABASE_URL` is missing:

```json
{
  "app": "MagicTrust",
  "status": "degraded",
  "database": {
    "ok": false,
    "status": "not_configured",
    "message": "DATABASE_URL is not configured."
  },
  "checkedAt": "2026-07-16T00:00:00.000Z"
}
```

## Hosted Privacy Request Form

The hosted public intake form is available at:

```text
http://localhost:3000/forms/privacy-request
```

It submits to `POST /api/public/requests` and does not require `x-api-key`.

Consumers can track a submitted request at:

```text
http://localhost:3000/requests/req_example
```

## `POST /api/public/requests`

Creates a public privacy request from hosted form intake.
Successful public intake sends a plain-text receipt email to the requester with the public reference number and tracking link. The public response does not include communication metadata.

```sh
curl -X POST "http://localhost:3000/api/public/requests" \
  -H "content-type: application/json" \
  -d '{
    "type": "DATA_ACCESS",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+13055551234",
    "message": "I want to access my data.",
    "sourceUrl": "https://example.com/privacy",
    "website": ""
  }'
```

Example response:

```json
{
  "request": {
    "publicId": "req_example",
    "type": "DATA_ACCESS",
    "status": "SUBMITTED",
    "createdAt": "2026-07-16T00:00:00.000Z"
  }
}
```

## `POST /api/public/forms/:slug/submissions`

Creates a request from an active managed Form's current published version. The
endpoint is public and does not require `x-api-key`. The Form's fixed request
type determines the request lifecycle; a caller-supplied field cannot override
it.

```sh
curl -X POST "http://localhost:3000/api/public/forms/privacy-question/submissions" \
  -H "content-type: application/json" \
  -H "Idempotency-Key: browser-submit-123" \
  -d '{
    "data": {
      "firstName": "John",
      "lastName": "Doe",
      "email": "john@example.com",
      "phone": "+13055551234",
      "message": "Please review my request.",
      "preferences": {
        "newsletters": false
      }
    }
  }'
```

Successful responses contain only the generated public request reference:

```json
{
  "publicId": "req_example"
}
```

`email` is required. `firstName`, `lastName`, and `phone` are recognized as
requester identity fields when present; all remaining JSON-safe fields are
preserved as original submitted data. Submission data is limited to 256 KB and
12 levels of nesting. The complete original payload is encrypted through the
existing PII-hardened request creation service, while plaintext storage is
limited to safe Form provenance: the Form public ID, slug, and published
version number. Database IDs, hashes, ciphertext, communications, and events
are never returned.

Only active Forms with a published version accept submissions. Unknown,
archived, and unpublished Forms return the same normalized `404` response and
create no request or communication side effects.

`Idempotency-Key` is optional. Repeating the same key and payload for the same
Form replays the original safe response without creating duplicate requests,
communications, or events. Reusing the key with different data returns `409`
with code `IDEMPOTENCY_KEY_REUSED`.

Published Forms call this endpoint automatically through the isolated
MagicTrust runtime. Form authors provide normal HTML controls with `name`
attributes; no custom fetch code is needed. Common requester names are
`email`, `firstName`, `lastName`, and `phone`. Repeated names serialize as
arrays, and the Form's configured request type cannot be overridden by runtime
fields. Admin editor preview submissions are simulated and never call this
endpoint.

## `GET /api/public/requests/:publicId`

Returns public-safe tracking data for a request. This endpoint does not require `x-api-key` and only looks up requests by `publicId`.

```sh
curl -X GET "http://localhost:3000/api/public/requests/req_example"
```

Example response:

```json
{
  "request": {
    "publicId": "req_example",
    "type": "DATA_ACCESS",
    "status": "PROCESSING",
    "createdAt": "2026-07-16T00:00:00.000Z",
    "completedAt": null,
    "publicComments": [
      {
        "body": "Your request is being processed.",
        "createdAt": "2026-07-16T01:00:00.000Z"
      }
    ]
  }
}
```

The public tracking API and `/requests/:publicId` page expose only public-safe request status and public comments. They do not expose requester details, internal ids, internal comments, attachments, communications, storage keys, or event timelines.

## `POST /api/public/requests/:publicId/access-link`

Requests a single-use secure access link for a public request. This endpoint does not require `x-api-key` and always returns the same generic success response to avoid revealing whether a request exists.

```sh
curl -X POST "http://localhost:3000/api/public/requests/req_example/access-link"
```

Example response:

```json
{
  "ok": true,
  "message": "If the request exists, an access link will be sent."
}
```

When the request exists, MagicTrust sends the requester a secure link:

```text
http://localhost:3000/requests/req_example/access?token=...
```

Opening the link exchanges the single-use access token for a temporary secure session, sets an `httpOnly` cookie scoped to the request path, and redirects to:

```text
http://localhost:3000/requests/req_example/secure
```

Access tokens and session tokens are stored only as hashes. Tokens are single-use and sessions expire after 30 minutes.

The secure page shows verified request status, public comments, and PUBLIC attachment metadata with download links. INTERNAL attachments are never exposed to consumers.

## `GET /requests/:publicId/secure/attachments/:attachmentId/download`

Downloads a PUBLIC attachment for a request after the consumer secure session cookie has been validated. The file remains private in storage; MagicTrust streams it through this route and never exposes Blob URLs, storage keys, checksums, storage provider internals, actor fields, or requester details.

```sh
curl -L "http://localhost:3000/requests/req_example/secure/attachments/attachment_example/download" \
  -b "magictrust_consumer_access_session=..."
```

Downloads require a valid consumer secure session and are audited with `CONSUMER_ATTACHMENT_DOWNLOADED`.

## `POST /api/v1/requests/:id/attachments/upload`

Uploads a private file to Vercel Blob and creates attachment metadata for an existing request. The request id may be the internal id or `publicId`.

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/attachments/upload" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: upload-data-export-req_example" \
  -F "file=@./data-export.json;type=application/json" \
  -F "visibility=PUBLIC" \
  -F "actorType=API_CLIENT" \
  -F "actorId=privacy-processor"
```

The response includes attachment metadata only. It does not include a public URL or download URL.

## `GET /api/v1/requests/:requestId/attachments/:attachmentId/download`

Downloads a private attachment for an existing request. The request id may be the internal id or `publicId`. The response body is the file content; no Blob URL is returned.

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X GET "http://localhost:3000/api/v1/requests/req_example/attachments/attachment_example/download?actorId=privacy-processor" \
  -H "x-api-key: $API_KEY" \
  -o data-export.json
```

## `POST /api/v1/requests/:id/communications/email`

Sends a basic outbound email for an existing request. The request id may be the internal id or `publicId`.

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/communications/email" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: email-update-req_example-001" \
  -d '{
    "to": "john@example.com",
    "subject": "Your MagicTrust request was updated",
    "body": "Your request has been updated.",
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    }
  }'
```

The response includes communication metadata only. It returns `recipientMasked` instead of the plaintext recipient and does not include provider secrets, encrypted recipient values, or recipient hashes.

## `POST /api/v1/requests/:id/notifications`

Sends an explicit consumer notification for an existing request. The request id may be the internal id or `publicId`.

The email always includes the request reference number, current status, the provided public message, and the public tracking link. `FILE_AVAILABLE` notifications also include a new secure access link that expires after 30 minutes; files are not attached to the email.

### `REQUEST_UPDATED`

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/notifications" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: notify-update-req_example-001" \
  -d '{
    "type": "REQUEST_UPDATED",
    "message": "Your request is currently being processed.",
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    }
  }'
```

### `FILE_AVAILABLE`

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/notifications" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: notify-file-req_example-001" \
  -d '{
    "type": "FILE_AVAILABLE",
    "message": "A file is available for your request.",
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    }
  }'
```

The response includes communication metadata only. Notification audit events never include the recipient email or email body.

## Internal API Authentication

Internal API v1 routes require `x-api-key`. Preferred keys are database-backed API client keys in this format:

```text
mt_live_<random-secret>
```

Create a client and one key with scoped access:

```sh
pnpm api-client:create --name "Privacy Processor" --scopes "requests:read,requests:create,requests:update,comments:write,attachments:write,attachments:read,communications:write,notifications:write,events:write"
```

The raw API key is displayed exactly once. MagicTrust stores only the key hash and a short key prefix used for lookup.

Scopes:

```text
requests:read          GET request list/detail
requests:create        POST /api/v1/requests
requests:update        status and mutable data updates
comments:write         request comments
attachments:write      attachment metadata and upload
attachments:read       internal attachment download
communications:write   internal email communications
notifications:write    explicit consumer notifications
events:write           custom request events
```

If a valid API client key lacks the required scope, MagicTrust returns `403` with code `FORBIDDEN`.

`INTERNAL_API_KEY` remains as a deprecated development fallback only when `APP_ENV` is not `production`. Production rejects the fallback key.

Key rotation expectation: create a replacement client/key or key row, update the caller to use the new secret, then deactivate the old key. Raw keys are not recoverable from MagicTrust after creation.

## Internal Admin Authentication

Create the first admin user from the server environment:

```sh
pnpm admin:user:create --email "user@onpointglobal.com" --role ADMIN
```

Allowed roles are `ADMIN`, `OPERATOR`, and `VIEWER`. Admin email addresses are normalized, encrypted, and hashed before storage. The CLI rejects duplicate normalized emails and never prints plaintext email, ciphertext, hashes, or keys.

Admin login page:

```text
GET /admin/login
```

Request a passwordless login link:

```sh
curl -X POST "http://localhost:3000/api/admin/auth/request-link" \
  -H "content-type: application/json" \
  -d '{"email":"user@onpointglobal.com"}'
```

The response is always generic and does not reveal whether an admin user exists. Active admin users receive a Resend email with:

```text
/admin/auth/verify?token=...
```

Login tokens expire after 15 minutes, are single-use, and are stored only as hashes. A valid token creates an 8-hour admin session, stores only the session token hash, sets an `httpOnly`, `sameSite=lax` cookie, and redirects to `/admin/requests`.

Logout:

```text
POST /api/admin/auth/logout
```

Logout revokes the current admin session, clears the cookie, and redirects to `/admin/login`.

Production requirements: set `APP_ENV=production`, configure `APP_BASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `ENCRYPTION_KEY`, and serve over HTTPS so secure cookies work correctly. `EMAIL_FROM` must use a sender identity from a domain verified in Resend; `onboarding@resend.dev` is not suitable for sending login links to arbitrary production admin users.

## Internal Requests Dashboard

The read-only admin dashboard is available at:

```text
GET /admin/requests
```

All admin dashboard pages and admin download routes require a valid admin session from `requireAdminSession()`. The browser never receives Internal API keys, API client keys, encryption keys, ciphertext, hashes, storage keys, access tokens, sessions, or idempotency records. Requester identity and original submission data are available only on the request detail page to authenticated `ADMIN` and `OPERATOR` users.

Allowed roles:

```text
ADMIN
OPERATOR
VIEWER
```

Supported list filters:

```text
publicId      exact public reference
type          one request type
status        one request status
createdFrom   inclusive ISO-8601 datetime
createdTo     exclusive ISO-8601 datetime
assignedTo    me, unassigned, or an active user id for ADMIN
due           overdue, due-soon, on-track, or no-due-date
```

Example:

```text
/admin/requests?status=PROCESSING&type=DATA_ACCESS&createdFrom=2026-07-01T00:00:00Z
```

Filters combine with `AND` and pagination uses the same stable ordering as the Internal API request list: `created_at DESC, id DESC`. The dashboard does not expose email or phone search in this version.

The request list also includes assignment ownership. `ADMIN` users can filter by themselves, unassigned requests, or any active `ADMIN`/`OPERATOR`. `OPERATOR` users can filter by themselves or unassigned requests, while `VIEWER` users can filter only by unassigned state. The URL-derived **My requests** and **Unassigned** workload views do not create separate stored state, and assignment filters survive pagination.

Due dates are manual operational deadlines stored in UTC. The dashboard derives SLA state at request time: terminal requests are **Completed**, active requests without a deadline have **No due date**, past deadlines are **Overdue**, deadlines within the next 48 hours are **Due soon**, and later deadlines are **On track**. The URL-derived **Overdue** and **Due soon** views use these same rules, and due filters survive search and pagination.

Request detail pages are available at:

```text
GET /admin/requests/:publicId
```

They display request summary, safe source metadata, mutable data, timeline, comments, attachment metadata, and communication metadata. For `ADMIN` and `OPERATOR`, the detail page also displays a Requester section and a sanitized Original Submission section so authorized staff can process the request. Communications show `recipientMasked` only. Attachments include an admin-authenticated download action:

```text
GET /admin/requests/:publicId/attachments/:attachmentId/download
```

Admin downloads stream private storage through MagicTrust, verify that the attachment belongs to the request, and audit successful downloads with `ADMIN_ATTACHMENT_DOWNLOADED` using `actorType: ADMIN_USER`.

Requester email, phone, and the encrypted original payload are decrypted exclusively in server-only code after role authorization. `VIEWER` users never trigger the sensitive-data query or decryption and never receive requester identity or original submission content. The Original Submission section removes requester/contact duplicates, dangerous object keys, tokens, cookies, credentials, encryption metadata, hashes, and internal database fields from additional JSON. Source URL query parameters and fragments are removed.

Admin request detail responses are dynamic and use `Cache-Control: private, no-store, max-age=0`. Consumer-provided text is rendered as text, never interpreted as HTML. Ciphertext, hashes, encryption versions, and encryption keys are never rendered.

The dashboard list and detail views remain read-only for `VIEWER` users. This version does not support requester data editing or exports, attachment deletion, bulk uploads, analytics, CSV exports, bulk actions, user management, or API client management.

## Admin Request Actions

Authenticated `ADMIN` and `OPERATOR` users can manage an individual request from:

```text
GET /admin/requests/:publicId
```

`VIEWER` users remain read-only. Mutation controls are hidden for `VIEWER`, and the server still rejects mutation submissions with `403 FORBIDDEN`.

Dashboard request actions use admin-authenticated server-side route handlers:

```text
POST /admin/requests/:publicId/status
POST /admin/requests/:publicId/comments
POST /admin/requests/:publicId/attachments
POST /admin/requests/:publicId/notifications
POST /admin/requests/:publicId/data
POST /admin/requests/:publicId/events
POST /admin/requests/:publicId/assignment
POST /admin/requests/:publicId/due-date
```

These routes never call `/api/v1`, never use `x-api-key`, and never expose Internal API keys or API client keys to the browser. Actor identity is derived only from the secure admin session:

```text
actorType: ADMIN_USER
actorId: authenticated admin user id
```

Caller-submitted actor fields are ignored. Actions require same-origin POST submissions and the existing secure admin session cookie.

Request assignment is optional operational metadata and does not alter workflow status, require assignment before processing, create a comment, or notify the consumer. `ADMIN` may assign or reassign a request to any active `ADMIN` or `OPERATOR`, and may unassign it. `OPERATOR` may claim an unassigned request for themselves and may unassign their own request, but cannot assign another user or take ownership from someone else. `VIEWER` remains read-only.

Assignment changes are atomic and create `REQUEST_ASSIGNED` or `REQUEST_UNASSIGNED` audit events with `ADMIN_USER` actor identity. Event and webhook data contains only the relevant admin user ids; it never contains admin email, requester PII, encrypted values, or hashes. Historical assignment remains visible when a user later becomes inactive, while new assignments target active users only.

`ADMIN` users may set, change, or clear any request due date. `OPERATOR` users may do so only when a request is unassigned or assigned to themselves. `VIEWER` remains read-only. Due-date changes are atomic and create `REQUEST_DUE_DATE_SET`, `REQUEST_DUE_DATE_UPDATED`, or `REQUEST_DUE_DATE_CLEARED` with ISO-8601 dates and authenticated `ADMIN_USER` actor identity. They do not change request status, assignment, comments, or communications.

Terminal requests preserve their historical `dueAt`, but derive **Completed** and never appear overdue. MagicTrust does not assign default deadlines, calculate business days, apply request-type SLA policies, send reminders, or run escalation jobs in this version.

Status updates require a destination status and a trimmed reason of 1-2,000 characters. The dashboard offers transitions only while the request is non-terminal. Terminal statuses are:

```text
SUCCESS
REJECTED
CANCELLED
```

Status updates use the existing transactional request repository mutation, update `completedAt` consistently for terminal statuses, and create the existing `STATUS_CHANGED` audit event. No consumer email notification is sent automatically.

Comments require a visibility and a trimmed body of 1-5,000 characters. `INTERNAL` comments remain dashboard-only. `PUBLIC` comments appear in public tracking responses and pages. Comment audit events reference the comment id and visibility but do not duplicate the comment body in event data. Adding a comment does not automatically send a consumer email notification.

Attachment uploads store private files through Vercel Blob and create attachment metadata. Visibility may be `INTERNAL` or `PUBLIC`. Uploads are limited to 10 MB and these MIME types:

```text
application/json
text/csv
application/pdf
text/plain
application/zip
```

Uploading an attachment creates the existing attachment audit event with `ADMIN_USER` actor identity. Uploading a file never sends an email and never changes request status. Blob tokens, storage credentials, storage keys, checksums, and Blob URLs are not exposed in the dashboard.

Consumer notifications are explicit email actions. Supported types are:

```text
REQUEST_UPDATED
REQUEST_COMPLETED
REQUEST_REJECTED
FILE_AVAILABLE
```

Sending a notification creates an encrypted-recipient communication record and either `CONSUMER_NOTIFICATION_SENT` or `CONSUMER_NOTIFICATION_FAILED`. Notification events include safe metadata such as notification type and communication id; they do not include email addresses, message bodies, tokens, storage keys, or provider secrets.

`FILE_AVAILABLE` requires selecting a `PUBLIC` attachment that belongs to the request. MagicTrust creates a new secure consumer access link and includes that link in the email. The file is not attached to the email, and Blob URLs or storage keys are never exposed.

Upload and notification are separate actions: uploading a file does not notify the consumer, and sending a notification does not change request status or add comments automatically.

Mutable data updates require a JSON object and a trimmed reason of 1-2,000 characters. The operation merges incoming keys into `mutable_data` and preserves omitted keys. It does not replace the entire object and does not delete keys. The original submitted request payload remains immutable. Authorized `ADMIN` and `OPERATOR` users may view its sanitized decrypted content, but the dashboard never edits it or exposes `submitted_data_encrypted`, hashes, ciphertext, or encryption metadata.

Mutable data JSON must be an object, not an array, cannot contain `__proto__`, `prototype`, or `constructor` anywhere in the structure, and is limited to 32 KB when serialized. The `REQUEST_DATA_UPDATED` audit event contains only `changedKeys`, the safe reason, and `ADMIN_USER` actor metadata. It does not store previous values, new values, requester PII, encrypted values, tokens, cookies, hashes, or API keys.

Custom events require an event type, visibility, and optional JSON object data. Event names must start with a letter, contain only uppercase letters, numbers, and underscores, be 3-80 characters long, and cannot use built-in MagicTrust event names. Event data defaults to `{}`, must be a JSON object, cannot contain dangerous keys, and is limited to 16 KB.

`INTERNAL` custom events are visible only in internal/admin timelines. `PUBLIC` custom events may appear in public tracking and secure consumer pages, but public output includes only `type`, `data`, and `createdAt`; it never includes admin user ids, actor metadata, encrypted data, hashes, tokens, or internal metadata.

Mutable data updates and custom events use minimal duplicate-submission protection for identical browser retries. They do not change request status, create comments, or send consumer email notifications automatically.

This version does not add deleting mutable data keys, replacing the full mutable data object, submitted data editing, requester data editing or exports, attachment deletion, bulk uploads, SMS, automatic workflows, email template UI, admin user management, API client management, or analytics.

## Guided DATA_ACCESS Workflow

The admin request list uses one exact-match search field for request ID, email, or phone. Values beginning with `req_` are matched to `publicId`; values containing `@` use the normalized requester email hash; other values use the normalized phone hash. `ADMIN` and `OPERATOR` may use all three forms. `VIEWER` may search by request ID only. Email and phone values, normalized values, and hashes are never logged or audited.

Authorized list rows show the requester name with a masked email or phone. `VIEWER` rows show `Restricted` and do not decrypt requester data. DATA_ACCESS rows derive their next step from current request state, public response attachments, and response-delivery events:

- Waiting for verification
- Start processing
- Upload response file
- Send response
- Retry sending response
- Waiting for requester
- Completed, rejected, or cancelled

DATA_ACCESS detail pages use natural-language statuses and a guided sequence: request header, progress, one next action, requester/original request, processing workspace, secure response delivery, collapsed activity history, and exceptional actions. The normal workflow hides generic status, comment visibility, attachment visibility, notification type, mutable-data JSON, custom-event, and raw event controls. Their existing backend routes and services remain available for other internal integrations.

While waiting for verification, `ADMIN` or `OPERATOR` can resend a verification email. This supersedes prior unused verification tokens, creates a new single-use token valid for 24 hours, stores it hashed, records encrypted-recipient communication metadata, and creates the existing verification-sent audit event. Resending does not change request status.

After verification, Start processing changes `VERIFIED` to `PROCESSING` with the authenticated admin user as actor. Internal notes always create `INTERNAL` comments. Guided response uploads always create `PUBLIC` attachments and do not send email or change status.

Sending a response creates a temporary secure consumer link and sends the selected public file through the existing secure-access email flow; the file is never attached directly. MagicTrust changes the request to `SUCCESS` only after successful email delivery. A failed delivery leaves the request in `PROCESSING` and presents a safe retry action.

Reject request is for invalid, duplicate, fraudulent, unsupported, or unfulfillable requests. Cancel request is for administrative closure, requester withdrawal, or abandonment without a fulfillment decision. Both require an explicit reason and confirmation. Neither occurs automatically based on age.

`VIEWER` remains read-only, cannot perform PII search, does not trigger requester decryption, and receives no guided mutation controls.

## Guided DATA_DELETION Workflow

`DATA_DELETION` remains a generic request resource and resolves through the
shared workflow layer to `DATA_DELETION_STANDARD`. Its guided stages are
Received, Verified, Processing, and Completed. Public intake continues to start
deletion requests in `PENDING_VERIFICATION` and uses the shared email identity
verification flow before an operator can start processing.

During processing, response files are optional. An `ADMIN` or `OPERATOR` may
confirm the deletion work, add an optional internal-only completion note, and
complete the request with zero or more public response files. Completion sends
the requester a data-deletion completion email and changes the request to
`SUCCESS` only after delivery succeeds. A failed notification leaves the
request in `PROCESSING` and allows a retry without duplicating the completion
note or successful completion history.

Assignment and due-date metadata remain independent generic capabilities: the
workflow does not assign a user, set a deadline, or clear either value. The
consumer secure page uses deletion-specific status language, shows public files
through the existing secure download flow when present, and never exposes
internal notes, assignment, SLA details, workflow IDs, or storage metadata.

## `GET /api/v1/requests`

Lists Internal API request summaries. Requires `x-api-key` with `requests:read`.

Supported filters combine with `AND`:

```text
publicId      exact public reference
type          comma-separated request types
status        comma-separated request statuses
email         exact email lookup using requester email_hash
phone         exact phone lookup using requester phone_hash
createdFrom   inclusive ISO-8601 datetime
createdTo     exclusive ISO-8601 datetime
updatedFrom   inclusive ISO-8601 datetime
updatedTo     exclusive ISO-8601 datetime
limit         1-100, default 25
cursor        opaque pagination cursor from the previous response
```

Examples:

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X GET "http://localhost:3000/api/v1/requests?status=VERIFIED,PROCESSING&type=DATA_ACCESS" \
  -H "x-api-key: $API_KEY"

curl -X GET "http://localhost:3000/api/v1/requests?email=user@example.com" \
  -H "x-api-key: $API_KEY"

curl -X GET "http://localhost:3000/api/v1/requests?createdFrom=2026-07-01T00:00:00Z&limit=25" \
  -H "x-api-key: $API_KEY"
```

Response:

```json
{
  "requests": [
    {
      "id": "...",
      "publicId": "req_example",
      "type": "DATA_ACCESS",
      "status": "VERIFIED",
      "requesterId": "...",
      "createdAt": "2026-07-16T00:00:00.000Z",
      "updatedAt": "2026-07-16T00:05:00.000Z",
      "completedAt": null,
      "source": {
        "channel": "FORM",
        "siteKey": "magictrust-hosted",
        "formKey": "privacy-request"
      }
    }
  ],
  "pagination": {
    "limit": 25,
    "nextCursor": "..."
  }
}
```

`nextCursor` is omitted when there are no more records. Pagination is ordered by `createdAt DESC, id DESC`.

Email and phone filters are normalized and searched through deterministic HMAC hashes. MagicTrust does not decrypt requester records for list searches and never returns requester email, phone, encrypted values, hash values, full submitted payloads, or mutable data in this response. The `source` object contains only safe metadata from sanitized `submitted_data`.

## `POST /api/v1/requests/:id/events`

Records a custom business event for an existing request. The request id may be the internal id or `publicId`.

Custom event names must start with a letter, use only uppercase letters, numbers, and underscores, and be 3-80 characters long. Built-in MagicTrust event names are reserved. Event data must be a JSON object and is limited to 16 KB.

### Internal Custom Event

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/events" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: event-export-generated-req_example-001" \
  -d '{
    "type": "DATA_EXPORT_GENERATED",
    "visibility": "INTERNAL",
    "data": {
      "system": "Vector",
      "processorReference": "job-99999"
    },
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    }
  }'
```

### Public Custom Event

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/events" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: event-export-ready-req_example-001" \
  -d '{
    "type": "DATA_EXPORT_READY",
    "visibility": "PUBLIC",
    "data": {
      "message": "Your data export is ready."
    },
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    }
  }'
```

Internal request detail includes all custom events. Public tracking and secure consumer pages expose only `PUBLIC` custom events, and never include actor identifiers.

## Internal API Idempotency

Mutating Internal API v1 routes require an `Idempotency-Key` header. This applies to request creation, status updates, comments, attachment metadata, attachment upload, email communications, consumer notifications, mutable request data updates, and custom events. GET routes and public APIs do not require this header.

Use a stable unique key for each operation:

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/status" \
  -H "content-type: application/json" \
  -H "x-api-key: $API_KEY" \
  -H "Idempotency-Key: status-processing-req_example-001" \
  -d '{
    "status": "PROCESSING",
    "actor": {
      "type": "API_CLIENT",
      "id": "privacy-processor"
    },
    "reason": "Request picked up for processing"
  }'
```

Retry the exact same request with the same `Idempotency-Key` to receive the original stored response without creating duplicate records or audit events. Replayed responses include:

```text
Idempotency-Replayed: true
```

If the same `Idempotency-Key` is reused with a different method, route, or payload, MagicTrust returns:

```json
{
  "error": {
    "code": "IDEMPOTENCY_KEY_REUSED",
    "message": "Idempotency-Key was already used for a different request."
  }
}
```

Idempotency records are retained for 24 hours. For multipart uploads, MagicTrust hashes safe file metadata plus a file checksum for comparison; it does not store file contents in idempotency records.

## Outbound Webhooks

Outbound webhooks notify trusted internal systems when subscribed request events occur. Endpoint URLs and signing secrets are encrypted at rest and are never exposed to browser code, existing APIs, CLI logs, or webhook payloads.

Create an endpoint from the server environment:

```sh
pnpm webhook:create \
  --name "Privacy Processor" \
  --url "https://processor.example.com/webhooks/magictrust" \
  --events "REQUEST_CREATED,STATUS_CHANGED,REQUEST_DATA_UPDATED"
```

The URL must use HTTPS, must not include URL credentials, and must not target localhost, loopback, private IP literals, or common local hostnames. The command prints the generated signing secret exactly once and only prints the safe URL hostname afterward.

Subscriptions use the effective event name:

```text
REQUEST_CREATED
STATUS_CHANGED
REQUEST_DATA_UPDATED
PUBLIC_COMMENT_ADDED
INTERNAL_COMMENT_ADDED
PUBLIC_ATTACHMENT_ADDED
INTERNAL_ATTACHMENT_ADDED
EMAIL_SENT
EMAIL_FAILED
CONSUMER_NOTIFICATION_SENT
CONSUMER_NOTIFICATION_FAILED
...
```

Custom events are subscribed by their custom event type, for example `DATA_EXPORT_GENERATED`, not by `CUSTOM_EVENT`.

Webhook delivery records are enqueued transactionally with request event creation. HTTP delivery happens later, outside the request mutation transaction, so webhook failures never fail the original MagicTrust operation.

Payload schema:

```json
{
  "version": "1",
  "deliveryId": "delivery-id",
  "event": {
    "id": "event-id",
    "type": "STATUS_CHANGED",
    "occurredAt": "2026-07-17T00:00:00.000Z",
    "visibility": "INTERNAL"
  },
  "request": {
    "id": "request-id",
    "publicId": "req_example",
    "type": "DATA_ACCESS",
    "status": "PROCESSING",
    "createdAt": "2026-07-16T00:00:00.000Z",
    "updatedAt": "2026-07-17T00:00:00.000Z"
  },
  "actor": {
    "type": "ADMIN_USER",
    "id": "admin-user-id"
  },
  "data": {}
}
```

Payloads never include requester name, email, phone, address, requester id, encrypted fields, hashes, original submitted payload, mutable data values, comment bodies, communication recipients, storage keys, Blob URLs, checksums, tokens, session identifiers, API keys, encryption keys, or raw database event data. Built-in event payload data is produced from explicit safe allowlists. Custom event data is integration-visible and must never contain requester PII or secrets.

Delivery requests use deterministic JSON serialization and include:

```text
Content-Type: application/json
User-Agent: MagicTrust-Webhooks/1.0
X-MagicTrust-Event: effective event name
X-MagicTrust-Delivery-Id: delivery id
X-MagicTrust-Timestamp: Unix timestamp
X-MagicTrust-Signature: v1=<hex HMAC-SHA256>
```

Signature input:

```text
<timestamp>.<raw-request-body>
```

The same delivery id is reused across retries so consumers can deduplicate.

Run the manual delivery worker:

```sh
pnpm webhook:deliver --limit 50
```

The worker claims due `PENDING` and `RETRYING` deliveries with row locking, decrypts endpoint details only immediately before delivery, sends with a 10-second timeout, does not follow redirects, and stores only response status, safe error code, and attempt timestamps. It prints counts only:

```text
claimed=0
delivered=0
retrying=0
dead=0
```

Retryable outcomes are network failures, timeouts, `408`, `425`, `429`, and `5xx`. Non-retryable `4xx` responses are marked `DEAD`. MagicTrust makes at most 5 attempts with this schedule:

```text
1 minute
5 minutes
30 minutes
2 hours
12 hours
```
