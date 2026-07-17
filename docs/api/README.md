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

Production requirements: set `APP_ENV=production`, configure `APP_BASE_URL`, `RESEND_API_KEY`, `EMAIL_FROM`, and `ENCRYPTION_KEY`, and serve over HTTPS so secure cookies work correctly.

## Internal Requests Dashboard

The read-only admin dashboard is available at:

```text
GET /admin/requests
```

All admin dashboard pages and admin download routes require a valid admin session from `requireAdminSession()`. The browser never receives Internal API keys, API client keys, encryption keys, ciphertext, hashes, raw requester PII, storage keys, access tokens, sessions, or idempotency records.

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
```

Example:

```text
/admin/requests?status=PROCESSING&type=DATA_ACCESS&createdFrom=2026-07-01T00:00:00Z
```

Filters combine with `AND` and pagination uses the same stable ordering as the Internal API request list: `created_at DESC, id DESC`. The dashboard does not expose email or phone search in this version.

Request detail pages are available at:

```text
GET /admin/requests/:publicId
```

They display request summary, safe source metadata, mutable data, timeline, comments, attachment metadata, and communication metadata. Communications show `recipientMasked` only. Attachments include an admin-authenticated download action:

```text
GET /admin/requests/:publicId/attachments/:attachmentId/download
```

Admin downloads stream private storage through MagicTrust, verify that the attachment belongs to the request, and audit successful downloads with `ADMIN_ATTACHMENT_DOWNLOADED` using `actorType: ADMIN_USER`.

The dashboard list and detail views are read-only for `VIEWER` users. This version does not support attachment uploads, email sending, analytics, CSV exports, bulk actions, user management, API client management, or requester PII decryption/display.

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
```

These routes never call `/api/v1`, never use `x-api-key`, and never expose Internal API keys or API client keys to the browser. Actor identity is derived only from the secure admin session:

```text
actorType: ADMIN_USER
actorId: authenticated admin user id
```

Caller-submitted actor fields are ignored. Actions require same-origin POST submissions and the existing secure admin session cookie.

Status updates require a destination status and a trimmed reason of 1-2,000 characters. The dashboard offers transitions only while the request is non-terminal. Terminal statuses are:

```text
SUCCESS
REJECTED
CANCELLED
```

Status updates use the existing transactional request repository mutation, update `completedAt` consistently for terminal statuses, and create the existing `STATUS_CHANGED` audit event. No consumer email notification is sent automatically.

Comments require a visibility and a trimmed body of 1-5,000 characters. `INTERNAL` comments remain dashboard-only. `PUBLIC` comments appear in public tracking responses and pages. Comment audit events reference the comment id and visibility but do not duplicate the comment body in event data. Adding a comment does not automatically send a consumer email notification.

This version does not add dashboard attachment uploads, email notifications, bulk actions, mutable-data editing, custom event creation, admin user management, API client management, analytics, or requester PII display.

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
