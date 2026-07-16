# MagicTrust

MagicTrust is OnPoint's internal system of record for receiving, verifying, tracking, auditing, and communicating consumer privacy and preference requests.

This repository is currently bootstrapped only. It does not implement request intake, forms, authentication, email delivery, file upload, OTP, webhooks, or an admin UI.

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

For local Internal API v1 curl tests, load the root API key into your shell:

```sh
API_KEY=$(grep '^INTERNAL_API_KEY=' .env.local | cut -d= -f2- | tr -d '"')
```

Then pass it on requests:

```sh
-H "x-api-key: $API_KEY"
```

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
