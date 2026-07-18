# Architecture

MagicTrust starts as a pnpm and Turborepo monorepo.

## Packages

- `apps/web`: Next.js application and HTTP routes.
- `packages/config`: Shared Zod-based environment validation.
- `packages/database`: Drizzle ORM setup, Neon connection, and database health check.
- `packages/domain`: Request domain logic.
- `packages/privacy`: Application-level PII encryption and hashing helpers.

## PII Protection

Requester email and phone values are protected at the application layer before they are stored. Encrypted values are stored for future controlled use, and deterministic HMAC-SHA256 hashes are stored for lookup and dedupe workflows.

Original submitted request payloads are also protected at the application layer. New requests store the complete original payload in `submitted_data_encrypted`, store a deterministic HMAC in `submitted_data_hash`, set `encryption_version = 1`, and keep `submitted_data` as an immutable safe metadata snapshot only. Plaintext requester fields, source URL query parameters, free-text messages, and arbitrary submitted fields are not stored in `submitted_data`.

Communication recipients are stored in `recipient_encrypted` and `recipient_hash` with `encryption_version = 1`. The legacy `recipient` column remains nullable for migration compatibility and is left `null` for new rows. Internal API responses expose only `recipientMasked`.

Legacy rows are hardened with the explicit backfill command after migrations are applied:

```sh
pnpm pii:backfill --dry-run
pnpm pii:backfill --apply
```

The backfill prints counts only and never prints plaintext payloads, recipients, ciphertext, hashes, or keys.

`ENCRYPTION_KEY` must be kept secret. Rotating it requires careful planning because existing encrypted PII and hashes were produced with the previous key.

## Principles

- Keep domain logic outside route handlers.
- Validate inputs before calling services.
- Return normalized route responses.
- Keep the original submitted request payload immutable when request storage is later implemented.
- Emit auditable events for relevant future mutations.
- Do not log PII.

## Form Management Foundation

MagicTrust separates a logical `Form` from its immutable published
`FormVersion` artifacts. A form owns its stable name, slug, description, and
active or archived state. Each version owns the HTML, CSS, and JavaScript
source associated with one numbered revision.

The initial lifecycle is:

```text
Create Form -> Draft v1 -> Publish v1 -> Create Draft v2 -> Publish v2
                                                     |
                                                     -> v1 Archived
```

Only one draft and one published version may exist for a form at a time.
Publishing archives the previous published version transactionally. Published
source is never edited in place; creating the next draft copies the current
published source into a new version. Archiving a form preserves all historical
versions while preventing new lifecycle changes.

### Form Editor v1

ADMIN users may edit the HTML, CSS, and JavaScript source of the current draft
version. Saves update that draft in place and use its `updated_at` value as an
optimistic concurrency token, so a stale browser tab cannot silently overwrite
a newer edit. Each source field has a server-enforced 250 KB limit. Publishing
remains a separate, deliberate action; published and archived versions are
immutable.

The editor preview is validation tooling, not a production deployment. It runs
unsaved source in a `srcDoc` iframe with `sandbox="allow-scripts"`, without
same-origin privileges, and with a restrictive Content Security Policy that
blocks network connections, form submission, framing, and navigation. External
resources are therefore not guaranteed to load. Stored source is never
executed in the parent admin document, and refreshing the preview does not
persist changes.

Form Editor v1 does not provide public rendering, embeds, form submissions,
deployments, asset upload, or a visual form builder.

## Request Model and Workflow Architecture

MagicTrust keeps every privacy request in the same generic request model. A
request owns its requester, submitted and mutable data, assignment, due date,
attachments, comments, events, and communications. These capabilities are not
specialized by request type and do not require separate entities such as a data
access request or data deletion request.

The responsibilities are deliberately separate:

- **Request type** describes what the consumer is asking MagicTrust to do.
- **Workflow** describes how that request moves through processing stages.
- **Capabilities** such as attachments, comments, communications, assignment,
  SLA metadata, and events remain available to requests generally unless a true
  domain or security rule says otherwise.

Workflow definitions currently live in `@magictrust/domain` as framework-free,
code-defined models. The v1 resolution path is:

```text
request.type -> workflow resolver -> code-defined workflow
```

`DATA_ACCESS` resolves to `DATA_ACCESS_STANDARD`, and `DATA_DELETION` resolves
to `DATA_DELETION_STANDARD`. `DO_NOT_CONTACT` and `UNSUBSCRIBE` share the
`DIRECT_PROCESSING` workflow because they can move directly from submission to
processing without identity verification. `GENERAL_INQUIRY` resolves to the
reusable `CONVERSATIONAL_PROCESSING` workflow for requests that may cycle
between active processing and waiting for requester information. Consumers use
the resolver for stages, progress, next-step guidance, and allowed status
transitions instead of scattering request-type checks across routes and
components.

`CONVERSATIONAL_PROCESSING` follows Received, Processing, Waiting for
requester, and Completed. Its `PROCESSING` and `WAITING_FOR_REQUESTER` states
may repeat without adding workflow state outside the generic request. This
workflow exposes three guided actions: wait for the requester, resume
processing, and complete the request. Waiting requires one public message and a
successful secure email notification before status changes. Completion uses
the shared confirmation, optional internal note, consumer notification, and
delivery-before-success pattern. Failed sends leave the request in processing;
retries reuse the existing public message and communication instead of creating
duplicates. Requester reply ingestion remains manual in v1. Attachments,
comments, assignment, SLA data, events, and communications remain generic
request capabilities.

`DIRECT_PROCESSING` uses one shared guided completion path for all mapped
request types. From `PROCESSING`, an authorized operator confirms the internal
work, may save one internal completion note, may include zero or more public
response files, and notifies the requester before MagicTrust records
`SUCCESS`. Failed delivery leaves the request in `PROCESSING` for a retry
without duplicating successful completion history. Request-intent wording is
resolved separately in the consumer presentation layer.

`DATA_DELETION_STANDARD` guides a request through verification, processing,
optional response content or files, consumer notification, and completion. A
successful completion email must be delivered before the request moves from
`PROCESSING` to `SUCCESS`; a failed delivery leaves it in `PROCESSING` for a
safe retry. Attachments remain optional generic request resources and are not a
condition of deletion completion.

Request type continues to describe consumer intent, while workflow describes
the lifecycle. `DATA_DELETION_STANDARD` therefore does not introduce a distinct
deletion request entity, assignment model, SLA rule, or storage capability.

Workflow definitions are not database-backed or user-configurable in v1. A
future implementation can evolve the resolution path to:

```text
request.workflowId -> persisted workflow definition
```

That change will not require redesigning the generic request schema or its
capabilities.
