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
