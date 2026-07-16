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

Access tokens are stored only as hashes, expire after 30 minutes, and can be used once. The secure access page currently shows verified request status and public comments only. It does not expose attachments or download links yet; it is the foundation for future secure consumer file downloads.

## `POST /api/v1/requests/:id/attachments/upload`

Uploads a private file to Vercel Blob and creates attachment metadata for an existing request. The request id may be the internal id or `publicId`.

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')

curl -X POST "http://localhost:3000/api/v1/requests/req_example/attachments/upload" \
  -H "x-api-key: $API_KEY" \
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

The response includes communication metadata only. It does not include provider secrets.
