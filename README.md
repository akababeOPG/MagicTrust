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

2. Create a local environment file:

   ```sh
   cp .env.example .env.local
   ```

3. Set `DATABASE_URL` to the pooled Neon Postgres connection string used by the app.

4. Set `DATABASE_URL_UNPOOLED` to the unpooled Neon Postgres connection string used for migrations.

5. Start the app:

   ```sh
   pnpm dev
   ```

6. Check health:

   ```sh
   curl http://localhost:3000/api/health
   ```

Without `DATABASE_URL`, the health endpoint returns `degraded` with database status `not_configured`.

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

Local database environment variables belong in the root `.env.local` file:

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
