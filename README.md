# MagicTrust

MagicTrust is OnPoint's internal system of record for receiving, verifying, tracking, auditing, and communicating consumer privacy and preference requests.

MagicTrust currently includes public intake, public tracking, secure consumer sessions, private attachment storage, internal communications, request audit events, and Internal API v1.

## Stack

- Next.js
- TypeScript
- pnpm
- Turborepo
- Drizzle ORM
- Neon Postgres
- Zod
- Vitest
- Playwright
- ESLint
- Prettier

## Repository Structure

```text
apps/web              Next.js application
packages/config       Shared environment validation
packages/database     Drizzle schema, Neon connection, health check
packages/email        Resend email provider
packages/storage      Private file storage provider
packages/domain       Placeholder for future domain logic
docs/product          Product notes
docs/architecture     Architecture notes
docs/api              API notes
```

## Local Setup

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Create the local environment file at the repository root:

   ```sh
   cp .env.example .env.local
   ```

   Root `.env.local` is the single source of truth for local development. Do not create or rely on `apps/web/.env.local`.

3. Fill in the required variables:

   ```text
   DATABASE_URL             Pooled Neon Postgres URL used by the app
   DATABASE_URL_UNPOOLED    Unpooled Neon Postgres URL used by migrations
   INTERNAL_API_KEY         Shared secret for Internal API v1 curl/API calls
   ENCRYPTION_KEY           Secret key for application-level PII encryption and hashing
   BLOB_READ_WRITE_TOKEN    Vercel Blob token for private attachment upload/download
   RESEND_API_KEY           Resend API key for internal email communications
   EMAIL_FROM               Sender address for internal email communications
   APP_BASE_URL             Base URL used for public tracking links in emails
   APP_ENV                  App environment, for example development or production
   NEXT_PUBLIC_APP_NAME     Public app name, usually MagicTrust
   ```

4. Start the app:

   ```sh
   pnpm dev
   ```

5. Check health:

   ```sh
   curl http://localhost:3000/api/health
   ```

Without `DATABASE_URL`, the health endpoint returns `degraded` with database status `not_configured`.

## Curl API Key

For local Internal API v1 curl tests with the deprecated development fallback, load the root API key into your shell:

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')
```

Then pass it on requests:

```sh
-H "x-api-key: $API_KEY"
```

`INTERNAL_API_KEY` is a development fallback only. It is rejected when `APP_ENV=production`. Prefer database-backed API client keys created with `pnpm api-client:create`.

## Internal API Clients

Create an Internal API client and one scoped API key:

```sh
pnpm api-client:create --name "Privacy Processor" --scopes "requests:read,requests:create,requests:update,comments:write,attachments:write,attachments:read,communications:write,notifications:write,events:write"
```

The command stores only the key hash and prints the raw `mt_live_...` key exactly once. Store it securely. To rotate a key, create a new key/client, deploy the replacement secret to the caller, then deactivate the old key in the database.

Available scopes:

```text
requests:read
requests:create
requests:update
comments:write
attachments:write
attachments:read
communications:write
notifications:write
events:write
```

## Internal Admin Access

Create the first admin user after applying migrations:

```sh
pnpm admin:user:create --email "user@onpointglobal.com" --role ADMIN
```

Admin email addresses are encrypted and hashed before storage. The command rejects duplicate normalized emails and never prints ciphertext, hashes, or keys.

Admin login is passwordless:

```text
http://localhost:3000/admin/login
```

Submitting an email always returns the same generic response. Active admin users receive a Resend magic link that expires after 15 minutes and can only be used once. A valid link creates an `httpOnly`, `sameSite=lax` admin session cookie for 8 hours and redirects to `/admin/requests`.

Production requirements:

```text
APP_ENV=production
APP_BASE_URL=https://your-production-domain.example
RESEND_API_KEY=...
EMAIL_FROM=...
ENCRYPTION_KEY=...
```

In production, admin session cookies are marked `secure`.

The request workspace at `/admin/requests` includes optional request assignment. `ADMIN` users can assign active administrators or operators; `OPERATOR` users can claim unassigned requests for themselves; `VIEWER` users remain read-only. **My requests** and **Unassigned** are URL-based workload views. Assignment is operational metadata only and never changes request status or sends a consumer notification.

Requests may also have a manually managed UTC due date. **Overdue** and **Due soon** are URL-based workload views derived from the deadline, terminal status, and current time. ADMIN can manage every deadline; OPERATOR can manage deadlines for unassigned or self-assigned requests; VIEWER is read-only. No automatic SLA policies, reminders, escalations, or scheduled jobs are included.

## Public Intake

The hosted public privacy request form runs at:

```text
http://localhost:3000/forms/privacy-request
```

The form submits to `POST /api/public/requests`. This public endpoint does not require `x-api-key`, sends a plain-text receipt email with a tracking link, and only returns the public request reference.

Consumers can track a submitted request by reference number at:

```text
http://localhost:3000/requests
http://localhost:3000/requests/req_example
```

Public tracking only exposes public-safe status data and public comments.

Consumers can request a single-use secure access link from the tracking page or by calling:

```text
POST /api/public/requests/req_example/access-link
```

MagicTrust sends the link to the encrypted requester email on file. Access tokens are stored only as hashes, expire after 30 minutes, and are the foundation for future secure consumer downloads.
Opening the link exchanges the single-use token for a temporary `httpOnly` secure session cookie and redirects to `/requests/req_example/secure`. Sessions also expire after 30 minutes.
The secure page lists PUBLIC attachments only. Consumer downloads require the valid secure session and never expose INTERNAL attachments, storage keys, Blob URLs, checksums, actor fields, or requester details.

## Verification

```sh
pnpm typecheck
pnpm lint
pnpm format
pnpm test
pnpm test:e2e
```

## Database

The database package contains the Drizzle setup, generated SQL migrations, and a Neon HTTP connection helper.

Local database environment variables belong in the root `.env.local` file. `apps/web` does not require its own `.env.local`.

```sh
DATABASE_URL="postgres://..."
DATABASE_URL_UNPOOLED="postgres://..."
```

Use `DATABASE_URL` for application connectivity. Use `DATABASE_URL_UNPOOLED` for migrations so Drizzle applies schema changes through Neon's direct database connection.

Generate a migration after changing the Drizzle schema:

```sh
pnpm db:generate
```

Apply existing migrations to Neon:

```sh
pnpm db:migrate
```

`db:generate` creates SQL files in `packages/database/drizzle`. `db:migrate` applies those existing SQL files to the database configured by `DATABASE_URL_UNPOOLED`.

## PII Backfill

New request submissions store the complete original payload encrypted, with only a safe metadata snapshot in `submitted_data`. New communication rows store recipients encrypted and return only `recipientMasked` through Internal API responses.

After applying the PII storage hardening migration, backfill legacy rows explicitly:

```sh
pnpm pii:backfill --dry-run
pnpm pii:backfill --apply
```

The backfill requires `ENCRYPTION_KEY`, is idempotent, processes records in batches, and prints counts only.
