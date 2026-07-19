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

## Frontend UI/UX Rules

- The approved MagicTrust design system and Claude Design specification are the source of truth for all frontend work.
- Before making any frontend change, read:
  - `docs/design-system.md`
  - Any related UX or design documentation in `docs`
- Reuse existing MagicTrust design tokens and components before creating new styles or components.
- New UI must visually and behaviorally align with the established MagicTrust design language.
- Do not introduce a different design system, visual language, component library, color palette, typography system, spacing system, or interaction pattern without explicit approval.
- Do not add one-off hardcoded colors or styling when an existing MagicTrust token can be used.
- Maintain consistency with the approved application shell, navigation, cards, buttons, forms, status badges, progress indicators, tables, feedback states, dialogs, and responsive behavior.
- Follow the established UX principle: "The interface should always explain the current situation, the next required step, and the primary action the user should take."
- Normal operational workflows should expose one clear primary action whenever possible.
- Technical implementation concepts must not leak into the normal operator UI.
- Internal concepts such as `mutableData`, custom events, webhook internals, API clients, raw event metadata, tokens, hashes, and storage implementation details must remain hidden unless explicitly designing an advanced administrative experience.
- Use natural-language labels instead of backend enum or technical names.
- Preserve the established role behavior for ADMIN, OPERATOR, and VIEWER.
- All frontend work must remain responsive and target WCAG 2.2 AA.
- Color must never be the only indicator of state.
- Prefer server components and server-side handling for sensitive information.
- Never expose decrypted PII, credentials, API keys, tokens, hashes, ciphertext, or internal storage metadata to client-side JavaScript.

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

## Codex Execution Efficiency

- For small, localized changes, prefer the smallest implementation that satisfies the request.
- Before starting a small task, identify the narrowest existing code path that owns the behavior and modify that path directly.
- Avoid unrelated refactors.
- Reuse existing abstractions before introducing new ones.
- Touch the minimum number of files necessary.
- Do not update documentation unless the change affects stable architecture, product behavior, or an existing documented contract.
- Run only directly affected tests for small changes.
- Do not run broad package suites or the full test suite unless explicitly requested, repository validation requires it, or focused tests indicate a broader regression.
- Prefer focused validation over exhaustive validation for localized changes.
- Do not run `db:generate` unless a schema change is required.
- Do not run migrations automatically.
- Optimize localized changes for fast execution. A typical small change should aim to complete in a few minutes.
- If the requested change appears to require a much broader refactor than expected, stop and explain why before expanding scope.
