# MagicTrust — Agent Instructions

MagicTrust is an internal OnPoint platform for receiving, verifying, tracking, auditing, and communicating consumer privacy and preference requests.

## Product Principles

- MagicTrust is the system of record for each consumer request.
- MagicTrust does not execute internal business processes.
- Internal OnPoint systems consume MagicTrust APIs to process requests.
- Every relevant mutation must generate an auditable event.
- The original submitted request payload must be immutable.
- Public comments are visible to the consumer.
- Internal comments are never visible to the consumer.
- Public files are never stored as publicly accessible files.
- Never store OTPs, magic links, API keys, or sensitive tokens in plain text.
- Do not log PII such as email, phone, address, or requester details.
- Store dates in UTC.
- Prefer simple, explicit code over premature abstraction.

## Initial Stack

- Next.js
- TypeScript
- Vercel
- Neon Postgres
- Drizzle ORM
- Zod
- Vitest
- Playwright
- pnpm
- Turborepo

## Initial Scope

Do not implement forms, OTP, email delivery, file upload, admin UI, or webhooks yet.

The first milestone is only project bootstrap:

- Monorepo structure
- Next.js app
- TypeScript config
- Linting
- Formatting
- Testing setup
- Drizzle setup
- Neon connection
- Health endpoint
- Basic documentation

## Naming

Use `MagicTrust` as the product name.

Use `privacy_request` or `request` as the core domain concept.

## Coding Rules

- Use TypeScript everywhere.
- Use Zod for input validation.
- Use Drizzle for database schema and migrations.
- Keep domain logic outside route handlers.
- Route handlers should validate input, call services, and return normalized responses.
- Do not introduce external services unless explicitly requested.
- Do not add authentication yet unless the task explicitly asks for it.
- Do not hardcode environment-specific values.