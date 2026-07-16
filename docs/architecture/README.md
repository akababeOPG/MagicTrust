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

`ENCRYPTION_KEY` must be kept secret. Rotating it requires careful planning because existing encrypted PII and hashes were produced with the previous key.

## Principles

- Keep domain logic outside route handlers.
- Validate inputs before calling services.
- Return normalized route responses.
- Keep the original submitted request payload immutable when request storage is later implemented.
- Emit auditable events for relevant future mutations.
- Do not log PII.
