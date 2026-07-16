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
   cp .env.example apps/web/.env.local
   ```

3. Set `DATABASE_URL` to a Neon Postgres connection string.

4. Start the app:

   ```sh
   pnpm dev
   ```

5. Check health:

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

The database package contains the Drizzle setup and a Neon HTTP connection helper. No application tables are defined yet. Drizzle loads local database settings from `apps/web/.env.local` during migration generation.

Generate migrations when schema is added:

```sh
pnpm db:generate
```
