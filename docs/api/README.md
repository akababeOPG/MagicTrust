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

## `POST /api/v1/requests/:id/attachments/upload`

Uploads a private file to Vercel Blob and creates attachment metadata for an existing request. The request id may be the internal id or `publicId`.

```sh
curl -X POST "http://localhost:3000/api/v1/requests/req_example/attachments/upload" \
  -H "x-api-key: $INTERNAL_API_KEY" \
  -F "file=@./data-export.json;type=application/json" \
  -F "visibility=PUBLIC" \
  -F "actorType=API_CLIENT" \
  -F "actorId=privacy-processor"
```

The response includes attachment metadata only. It does not include a public URL or download URL.
