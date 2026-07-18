# MagicTrust UX Principles

These principles capture stable product decisions from the approved Claude Design handoff. Use them together with the canonical [MagicTrust Design System](./design-system.md) for all frontend work.

## Guided Workflows

The interface should always explain the current situation, the next required step, and the primary action the user should take. Request state, progress, and next-step guidance must agree with domain behavior.

Normal operational workflows should present one clear primary action whenever possible. Secondary, destructive, and exceptional actions should remain available without competing with the current task.

## Progressive Disclosure

Show the information needed for the current decision first. Keep history, advanced controls, and exceptional actions available through deliberate disclosure instead of placing every capability in the primary workflow.

Technical implementation concepts must not leak into the normal operator experience. Translate backend enums and system terminology into concise natural-language labels. Keep mutable data, raw events, webhook internals, API clients, tokens, hashes, and storage details out of routine workflows.

## Workload Orientation

Request management should help operators understand what needs attention, what is waiting, and what is complete. Search, filters, status, age, progress, and next-step language should support that workload view without inventing state outside the request domain.

## Responsive And Accessible Behavior

Preserve task hierarchy and available information across desktop, tablet, and mobile layouts. Reflow controls and content without hiding required actions or creating horizontal overflow. Target WCAG 2.2 AA, use accessible labels and focus states, and never rely on color alone to communicate state.

## Role-Aware Experiences

ADMIN and OPERATOR experiences may expose authorized operational actions. VIEWER remains read-only and must not receive restricted requester information or mutation controls. Authorization is enforced server-side; visual differences reflect permissions but never replace access control.

Sensitive information stays in server components and server-side handlers. Decrypted PII, credentials, keys, tokens, hashes, ciphertext, and storage metadata must never be serialized into client-side JavaScript.
