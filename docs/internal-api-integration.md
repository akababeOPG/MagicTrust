# MagicTrust Internal Processing Integration

## Purpose

MagicTrust receives consumer requests through Forms, creates the Request system
of record, manages its workflow and status, and gives operators visibility into
its history. The normal processing integration starts from Requests already in
MagicTrust; creating Requests through the Internal API is supported, but is not
the primary flow described here.

The internal processing service retrieves eligible Requests, performs the
actual downstream privacy operation outside MagicTrust, and reports the result
back. MagicTrust does not need to know how that downstream operation is
implemented.

```text
Consumer
  -> MagicTrust Form
  -> MagicTrust Request
  -> Internal Processing Service
  -> External or internal processing
  -> MagicTrust processing result
  -> MagicTrust workflow completion and consumer communication
```

## Requests to Process

Use `GET /api/v1/requests` with a database-backed API client key in the
`x-api-key` header. The client needs the `requests:read` scope. There is no
single universal ready status because the request types use different
workflows.

Run these as separate queries:

```http
GET /api/v1/requests?type=DATA_ACCESS,DATA_DELETION&status=VERIFIED&limit=25
x-api-key: mt_live_<api-client-secret>
```

`DATA_ACCESS` and `DATA_DELETION` require consumer email verification. Their
public intake status is initially `PENDING_VERIFICATION`; they become ready for
processing at `VERIFIED`.

```http
GET /api/v1/requests?type=UNSUBSCRIBE,DO_NOT_CONTACT&status=SUBMITTED&limit=25
x-api-key: mt_live_<api-client-secret>
```

`UNSUBSCRIBE` and `DO_NOT_CONTACT` use direct processing and are ready at
`SUBMITTED`.

Do not combine all four types and both statuses in one request. Type and status
filters combine with AND, but values within each filter are independent lists;
the resulting cross-pairs could include an unverified access or deletion
Request.

Results are ordered by `createdAt DESC`, then `id DESC`. The default limit is
25 and the allowed range is 1–100. When `pagination.nextCursor` is present,
repeat the same filters and add the returned opaque cursor:

```http
GET /api/v1/requests?type=DATA_ACCESS,DATA_DELETION&status=VERIFIED&limit=25&cursor=<nextCursor>
```

## Recommended Processing Loop

1. Query both ready queues and follow each cursor until no `nextCursor` is
   returned.
2. Fetch requester identity and the immutable original submission for each
   Request from `GET /api/v1/requests/{id}/processing-data`. Use the returned
   `publicId` as the stable integration reference; Request routes accept either
   `publicId` or the internal request `id`.
3. Optionally mark the Request `PROCESSING` with the existing status endpoint
   appropriate for the worker lifecycle.
4. Perform the privacy operation outside MagicTrust.
5. POST the `SUCCESS` or `REJECTED` business outcome to
   `/api/v1/requests/{id}/processing-result`.
6. MagicTrust completes the workflow and handles consumer-facing completion
   behavior.

The processing-data endpoint requires `requests:processing-data:read` and is
the authorized source for decrypted requester fields and the complete original
submission:

```http
GET /api/v1/requests/req_example/processing-data
x-api-key: mt_live_<api-client-secret>
```

Its response includes the request identifiers, type, current status, requester
first name, last name, email, and phone, the original submitted data object,
and available managed-form provenance. The response is private and not
cacheable. Reading it does not change request status, assignment, events, SLA,
or communications.

The processor owns the downstream operation. MagicTrust owns final workflow
completion, final status, and consumer completion communication.

The status endpoint currently validates that a status is supported, but does
not enforce workflow transition rules. Integrations should follow the expected
lifecycles:

```text
DATA_ACCESS / DATA_DELETION: VERIFIED -> PROCESSING -> processing result
UNSUBSCRIBE / DO_NOT_CONTACT: SUBMITTED -> PROCESSING -> processing result
```

`REJECTED` and `CANCELLED` are terminal alternatives. Other supported statuses
and their complete schemas are documented in Swagger.

## Starting Processing

Use `POST /api/v1/requests/{id}/status` with the `requests:update` scope:

```http
POST /api/v1/requests/req_example/status
x-api-key: mt_live_<api-client-secret>
Idempotency-Key: req_example-processing-001
Content-Type: application/json

{
  "status": "PROCESSING",
  "actor": {
    "type": "API_CLIENT"
  },
  "reason": "Processing started"
}
```

For `API_CLIENT` actors, MagicTrust derives the audit actor ID from the
authenticated API client. A caller-provided actor ID is not used.

## Reporting the Processing Result

Use `POST /api/v1/requests/{id}/processing-result` with the
`requests:processing-result:write` scope:

```http
POST /api/v1/requests/req_example/processing-result
x-api-key: mt_live_<api-client-secret>
Idempotency-Key: req_example-success-001
Content-Type: application/json

{
  "outcome": "SUCCESS",
  "reason": "Downstream privacy operation completed"
}
```

MagicTrust resolves the request workflow, sends the centralized completion
notification, and changes the request to `SUCCESS` only after successful
delivery. `DATA_ACCESS` may complete with zero public files; when public files
already exist, the completion communication provides secure access as it does
for operator completion. `DATA_DELETION`, `UNSUBSCRIBE`, and `DO_NOT_CONTACT`
use the existing centralized completion wording.

If required completion delivery fails, the endpoint returns a normalized error
and leaves the request non-`SUCCESS`. Retry the same payload with the same
`Idempotency-Key`; MagicTrust reuses failed completion artifacts so it does not
duplicate communications, public comments, access tokens, or completion
history.

## Rejecting a Request

Use the processing-result endpoint with `REJECTED`:

```http
POST /api/v1/requests/req_example/processing-result
x-api-key: mt_live_<api-client-secret>
Idempotency-Key: req_example-rejected-001
Content-Type: application/json

{
  "outcome": "REJECTED",
  "reason": "Request could not be fulfilled"
}
```

`reason` is optional and is stored in the
`STATUS_CHANGED` event. `REJECTED` is terminal and sets `completedAt`.
No success communication is sent.

`POST /api/v1/requests/{id}/status` remains available as a lower-level status
mutation capability for advanced integrations and for optionally setting
`PROCESSING`; it is not the preferred processor completion API.

## Idempotency and Retries

Every mutating Internal API v1 route requires `Idempotency-Key`; GET routes do
not. Idempotency records are retained for 24 hours for each API client.

- Retrying the same method, route, and payload with the same key returns the
  original response and `Idempotency-Replayed: true` without repeating the
  mutation.
- A processing-result completion delivery failure is retryable with the same
  key and is not stored as the final idempotent response; completion artifacts
  are reused until delivery succeeds.
- Reusing a key with a different request returns `409` with
  `IDEMPOTENCY_KEY_REUSED`.
- Use a distinct stable key for each lifecycle operation, such as starting,
  completing, or rejecting a specific Request.

## Authentication and Scopes

The primary processing loop needs only:

- `requests:read` to search and retrieve Requests.
- `requests:processing-data:read` to retrieve decrypted requester identity and
  the immutable original submission.
- `requests:update` to update status.
- `requests:processing-result:write` to report the terminal processor outcome.

Send the database-backed API client key as:

```http
x-api-key: mt_live_<api-client-secret>
```

These routes do not use the standard `Authorization` header. The complete
scope matrix and API-client behavior are available in Swagger.

## Contact Us / `GENERAL_INQUIRY`

`GENERAL_INQUIRY` Requests are currently intended for manual MagicTrust
operator handling and should normally be excluded from the automated privacy
processing loop.

## Secondary API Capabilities

The Internal API also supports direct Request creation, mutable Request data,
custom events, comments, attachment metadata and private files, outbound email
communications, and consumer notifications. Use these capabilities only when
the integration needs them; their complete contracts are maintained in:

- Swagger UI: `/api/docs`
- OpenAPI: `/api/openapi.json`

## Integration Rollout

The internal service can initially consume and update MagicTrust Requests in
parallel with the existing OneTrust process. Keep ownership of each processed
Request clear during rollout so the same consumer operation is not executed by
both paths.

## Current Integration Gaps

The list/status API does not provide an atomic worker claim or conditional
status transition; idempotency prevents replay of the same API mutation but
does not coordinate separate workers using different keys.
