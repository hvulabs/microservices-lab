# Payment Lab Build Plan

## Goal

Build a learning payment system that makes two backend behaviors visible and repeatable from a React UI:

1. How a message moves through RabbitMQ, including retries and terminal outcomes.
2. How concurrent updates can race, and how database-enforced updates prevent invalid balances.

The browser is a control and observation surface. It must never implement payment correctness, connect directly to RabbitMQ, or access service databases.

## Fixed Technology

Use the stack in [AGENTS.md](AGENTS.md): Node.js 22, TypeScript 5 strict mode, pnpm, NestJS 11, React 19 with Vite, Supabase Postgres through `pg`, RabbitMQ 4, Redis 7, Jest, and k6. Do not add dependencies without a clear need and report the reason.

## Planned System

- `gateway`: public HTTP API, authentication, idempotency, and lab-run controls.
- `order-service`: products, stock, and orders.
- `wallet-service`: wallets, holds, ledger, and Race Lab strategies.
- `payment-service`: payment state machine and saga orchestration.
- `mock-psp`: controllable fake payment provider.
- `notification-service`: idempotent event consumer and user notifications.
- `libs/*`: shared contracts, database helpers, messaging, outbox, inbox, configuration, and common errors.
- `web`: React UI for payment activity, message traces, and race-condition experiments.
- Supabase Postgres stores service-owned data. Each service accesses only its own schema.
- RabbitMQ carries business messages. The outbox and inbox patterns protect against dual writes and duplicate delivery.

A message-trace API/read model is needed for the UI. Its ownership, event contract, and storage must be decided in the architecture/contracts specifications before implementation. Diagnostic telemetry must be best-effort and must never control business outcomes.

## Architecture Overview

The agreed high-level flow is:

1. The React client provides Shop/Checkout, Wallet, and Race Lab screens.
2. The client calls the NestJS API Gateway over HTTP. The gateway handles authentication and idempotency keys, then calls Order and Wallet services over HTTP/RPC.
3. Order and Wallet own their data and write outgoing events through their transactional outboxes.
4. RabbitMQ routes business events through the `payments.events` topic exchange, with dead-letter/dead-letter-queue handling defined by the approved contracts.
5. Payment Service consumes events and coordinates the saga with the Mock PSP over HTTP; the Mock PSP sends its result webhook back to Payment Service. Notification Service consumes events for user notifications.
6. The React client observes payment-status changes through Supabase Realtime.

This is a high-level flow, not a substitute for the authoritative message and API contracts. Queue bindings, event envelopes, retry policy, webhook authentication, and Realtime table permissions must be specified before those flows are implemented.

## Phase Order

| Phase | Task | Result |
|---|---|---|
| 1 | [Foundation](tasks/phase-1-foundation.md) | Workspace, local infrastructure, shared runtime/database foundations |
| 2 | [Wallet Race Lab](tasks/phase-2-race-lab.md) | Naive and safe withdrawal experiments with concurrency evidence |
| 3 | [Messaging](tasks/phase-3-messaging.md) | Validated contracts, outbox/inbox, retry and parking behavior |
| 4 | [Payment Flow](tasks/phase-4-payment-flow.md) | Order-to-payment saga with mock provider |
| 5 | [Observability and UI](tasks/phase-5-observability-ui.md) | React views for race runs and message lifecycle traces |
| 6 | [End-to-end Verification](tasks/phase-6-verification.md) | Repeatable demo scripts and required quality gates |

## Blocking Specification Prerequisite

The repository currently has `AGENTS.md` only. Before implementing message topology, event envelopes, or public endpoint contracts, create or approve the corresponding specifications (including `docs/CONTRACTS.md` and architecture/API decisions) in an explicitly authorized task. `AGENTS.md` says not to modify `docs/` unless asked, so these plan files do not create those contracts.

## Cross-Cutting Acceptance Criteria

- Money is integer-valued and validated with `Number.isSafeInteger`.
- Every message consumer is idempotent; events may be duplicated, delayed, or out of order.
- Business changes and outgoing messages use one database transaction with the outbox.
- Race protections are database-enforced, not in-memory.
- Every concurrency claim has a test using at least 50 concurrent calls, separate pool connections, and at least three repetitions.
- Each service uses only its own database schema. Cross-service data is obtained over HTTP or messages.
- Every UI operation can be correlated to backend activity without exposing secrets or direct database/broker access.
- Required checks from `AGENTS.md` pass for the touched scope.

## Local Development Flow

1. Ensure Docker Desktop is running and optionally copy `.env.example` to `.env` for local overrides.
2. Run `docker compose up --build` to start Supabase through its CLI helper, RabbitMQ, Redis, all NestJS apps, and the Vite client.
3. Apply migrations and seed demo data using repository scripts as those are added.
4. Run the Race Lab, inspect payment-status updates and message traces, and run automated tests.

Stop the Supabase containers with `docker compose run --rm --no-deps supabase stop --workdir /workspace`, then stop the Compose-managed services with `docker compose down`.

## Scope Boundaries

This plan does not authorize changing `AGENTS.md`, existing documentation, message contracts, or migrations. Each implementation phase must follow the matching task spec and stop for clarification if a required contract or dependency is missing or contradictory.
