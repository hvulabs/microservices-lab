# AGENTS.md — Rules for coding agents

This repository is **payment-lab**: a learning project that simulates a payment system to practice
**microservices**, **message queues**, and **race-condition handling**.

Read this file fully before every task. Then read the task file you were assigned (`tasks/phase-*.md`)
and every document listed in that task's **Context** section. If anything in a task conflicts with this
file, this file wins — stop and report the conflict instead of guessing.

---

## 1. Golden rules (never break these)

1. **Do only the assigned task.** No drive-by refactors, no features from later phases, no renaming of
   things you were not asked to touch. If you notice a problem outside scope, write it under
   `## Follow-ups` in your final report.
2. **Correctness lives in the database, not in application memory.** Never rely on an in-process mutex,
   a JS variable, or a "check then write" across two queries to protect shared state. Use the patterns
   in §6.
3. **Every message consumer is idempotent.** Assume every message can be delivered twice, late, or out
   of order. See §7.
4. **No cross-service database access.** A service only reads/writes its own Postgres schema. To get data
   from another service: call its HTTP API or consume its events.
5. **No dual writes.** Never "write to DB, then publish to RabbitMQ" as two independent steps. Publish
   through the **outbox** (§7.2).
6. **Money is an integer.** Amounts are integer minor units (VND has no minor unit → integer đồng).
   DB type `bigint`; TS type `number`, validated with `Number.isSafeInteger`. Never use floats for money.
7. **"Naive" code is intentional.** Phase 1 and Race Lab contain deliberately broken strategies named
   `naive*`. Do not "fix" them. They must stay broken and stay clearly labelled.
8. **Tests prove the claim.** Any code that claims to prevent a race condition must ship with a
   concurrency test that fails against the naive version and passes against the safe version.
9. **Never commit secrets.** Use `.env` (git-ignored) and keep `.env.example` up to date.
10. **Don't touch `docs/` or `AGENTS.md`** unless the task explicitly says so. If the spec is wrong,
    report it.

---

## 2. Tech stack (fixed — do not substitute)

| Area | Choice |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript 5 `strict: true` |
| Package manager | pnpm (workspace) |
| Backend | NestJS 11, Nest CLI monorepo (`apps/*`, `libs/*`) |
| DB | Supabase Postgres (local via `supabase start`), driver **`pg`** (no ORM) |
| Migrations | SQL files in `supabase/migrations/` (Supabase CLI) |
| Message queue | RabbitMQ 4 (management plugin), client `amqplib` + `amqp-connection-manager`, wrapped in `libs/messaging` |
| Cache / locks | Redis 7, client `ioredis` |
| Validation | `class-validator` + `class-transformer` for HTTP DTOs; `zod` for message payloads |
| Logging | `nestjs-pino` (JSON logs) |
| IDs | UUID v7 (`uuid` package, `v7()`) |
| Backend tests | Jest + `@nestjs/testing`; integration tests hit the real local Postgres/RabbitMQ |
| Load tests | k6 (`load-tests/`) |
| Frontend | React 19 + Vite + TypeScript, TanStack Query, React Router, Tailwind CSS, `@supabase/supabase-js` |
| Infra (local) | `docker-compose.yml` for RabbitMQ, Redis, all services. Supabase via CLI |

Do not add a new dependency unless the task allows it or it is clearly necessary. If you add one, list
it in your report with the reason.

---

## 3. Repository layout

```
payment-lab/
├── AGENTS.md / CLAUDE.md
├── docs/                    # specs — source of truth (read-only for agents)
├── tasks/                   # task specs per phase
├── apps/
│   ├── gateway/             # :3000 public API, auth, idempotency keys, lab runner
│   ├── order-service/       # :3001 products, stock, orders
│   ├── wallet-service/      # :3002 wallets, holds, ledger, Race Lab strategies
│   ├── payment-service/     # :3003 saga orchestrator, payment state machine, webhooks
│   ├── notification-service/# :3004 event consumer → user notifications
│   └── mock-psp/            # :3005 fake payment provider with chaos settings
├── libs/
│   ├── common/              # config, logger, correlation-id, errors, health
│   ├── database/            # pg pool, withTransaction, retry helpers
│   ├── contracts/           # zod schemas + TS types for events & commands
│   ├── messaging/           # RabbitMQ connection, publisher, consumer, topology
│   ├── outbox/              # outbox writer + relay
│   └── inbox/               # idempotent consumer helper
├── web/                     # React app
├── supabase/migrations/
├── load-tests/
├── scripts/                 # dev scripts (seed, reset, invariant check)
└── docker-compose.yml
```

Imports between libs use path aliases: `@lab/common`, `@lab/database`, `@lab/contracts`,
`@lab/messaging`, `@lab/outbox`, `@lab/inbox`. Apps must never import from another app.

---

## 4. Code conventions

- File names `kebab-case.ts`; classes `PascalCase`; Nest files follow `*.module.ts`, `*.controller.ts`,
  `*.service.ts`, `*.repository.ts`, `*.consumer.ts`.
- Per-service structure: `src/<feature>/{controller, service, repository, dto, consumers}`.
  - **Controller**: HTTP only (validation, mapping). No SQL.
  - **Service**: business logic, transaction boundaries.
  - **Repository**: the only place with SQL. Methods accept a `PoolClient`/`Queryable` so they can join
    the caller's transaction.
- SQL is always parameterized (`$1, $2`). Never interpolate values into SQL strings.
- Schema-qualify every table: `wallet_svc.wallets`, never just `wallets`.
- No `any`. Use `unknown` and narrow it.
- Errors: throw domain errors from `@lab/common` (`DomainError` subclasses with a stable `code`).
  A global filter maps them to HTTP status codes. Never leak raw pg errors to clients.
- Config only via `@lab/common` `ConfigModule` with validated env (zod). No `process.env` scattered.
- Every incoming HTTP request and every message carries a `correlationId`. Log it on every line.
- Comments explain **why**, especially around concurrency. Every lock or conditional update gets a
  one-line comment naming the race it prevents.

### HTTP API conventions
- JSON, camelCase fields. Money fields are named `amount`, `balance`, etc., always integer.
- Error body: `{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "...", "correlationId": "..." } }`
- Status codes: 400 validation, 401/403 auth, 404 not found, 409 concurrency/idempotency conflict,
  422 business rule violation, 503 dependency unavailable.
- Mutating public endpoints on the gateway require the `Idempotency-Key` header (see docs/ARCHITECTURE.md §5).

---

## 5. Database rules

- Each service has its own schema and its own DB role (`order_svc`, `wallet_svc`, `payment_svc`,
  `gateway_svc`, `notification_svc`). The role has privileges only on its schema.
- Connect through **direct connection / session mode (port 5432 or local 54322)**. Do **not** use the
  transaction-mode pooler (6543) — it breaks session state, advisory locks and prepared statements.
- Default isolation: `READ COMMITTED`. Use stronger isolation only where the task says so.
- Use `withTransaction(pool, fn, { isolation?, retries? })` from `@lab/database` for every transaction.
  It must retry on SQLSTATE `40001` (serialization_failure) and `40P01` (deadlock_detected) with jittered backoff.
- Keep transactions short. **Never call HTTP or publish to RabbitMQ inside a DB transaction.**
- DB constraints are the last line of defence and are mandatory: `CHECK (balance >= 0)`,
  `UNIQUE` on idempotency/dedup keys, FK inside the same schema.
- Migrations are append-only. Never edit a migration that has already been committed; add a new one.
- `SELECT *` is forbidden in repositories; list the columns.

---

## 6. Race-condition handling rules

Pick the **simplest** pattern that is correct, in this order of preference:

1. **Atomic conditional update**: `UPDATE ... SET x = x - $1 WHERE id = $2 AND x >= $1`, then check
   `rowCount`. Default for counters (balance, stock).
2. **Unique constraint + `ON CONFLICT`**: for "create once" semantics (idempotency, dedup, one payment per order).
3. **State-machine transition with an expected-state guard**:
   `UPDATE ... SET status = $new WHERE id = $id AND status = ANY($allowedFrom)`. Every status change goes
   through this. `rowCount = 0` means someone else got there first — handle it explicitly.
4. **Optimistic locking**: `version` column, `WHERE version = $expected`, bounded retry (max 5, jitter).
5. **Pessimistic locking**: `SELECT ... FOR UPDATE` (or `NOWAIT` / `SKIP LOCKED`) inside a short
   transaction, when several rows/reads must be consistent. Lock rows in a deterministic order (by id)
   to avoid deadlocks.
6. **Advisory lock**: `pg_advisory_xact_lock(hashtext(...))` for logical locks (e.g. single-runner jobs).
7. **Redis lock**: only when the resource is not in one DB. Always `SET key token NX PX ttl`, release
   with a compare-and-delete Lua script, and document what happens if the TTL expires.

Forbidden:
- Read a value, compute in JS, write it back without a guard (lost update).
- `findOne` then `insert` to enforce uniqueness.
- In-memory locks as the only protection.
- Retrying forever.

---

## 7. Messaging rules

### 7.1 Topology and envelope
- Exchanges, queues, routing keys and the message envelope are defined in `docs/CONTRACTS.md`. Do not
  invent new ones without a task saying so. Topology is declared in code by `libs/messaging` at startup
  (idempotent `assertExchange` / `assertQueue`).
- Every message is validated with its zod schema from `@lab/contracts` on publish **and** on consume.
  An invalid message goes straight to the parking queue (no retry).
- Publisher uses **publisher confirms**. Messages are `persistent: true`.

### 7.2 Outbox (producing)
- Business change + outbox row are written in the **same transaction** (`outbox.add(client, event)`).
- The relay polls `outbox` with `FOR UPDATE SKIP LOCKED`, publishes, waits for the confirm, then sets
  `published_at`. Several relay instances must be able to run at the same time without double-publishing
  in the normal case. (Duplicates after a crash are acceptable — consumers are idempotent.)

### 7.3 Inbox (consuming)
- Consumers use `prefetch` from config (default 10) and **manual ack**.
- Handler pattern:
  ```
  withTransaction(async tx => {
    inserted = INSERT INTO <svc>.processed_messages(consumer, message_id) ON CONFLICT DO NOTHING
    if (!inserted) return  // duplicate → ack and skip
    ...business logic using tx...
    ...outbox.add(tx, resultEvent)...
  })
  ack
  ```
- Error classification:
  - **Business outcome** (insufficient funds, out of stock): not an error. Emit a failure event, ack.
  - **Transient** (DB connection, timeout, serialization failure after retries): `nack(requeue=false)`
    → retry queue with delay. Increment `x-retry-count`. After `MAX_RETRIES` (5) → parking queue.
  - **Permanent** (schema invalid, unknown type): straight to parking queue.
- Never assume ordering. Handlers must check the current state (state-machine guard) and ignore events
  that are stale for that state.

---

## 8. Testing rules

- Unit tests: `*.spec.ts` next to the source. Integration tests: `test/**/*.int-spec.ts` per app,
  run against the local Supabase DB and RabbitMQ (`pnpm test:int`).
- Each integration test suite resets its own schema data (truncate tables). Never touch other schemas.
- **Concurrency tests** use `Promise.all` with N ≥ 50 parallel calls, using **separate pool connections**,
  and assert invariants (e.g. `balance >= 0`, `balance == SUM(ledger)`, exactly-once effects).
  Run each concurrency test at least 3 times in a loop to reduce flakiness hiding bugs.
- Frontend: type-check and build must pass (`pnpm --filter web build`). Component tests are optional.

---

## 9. Definition of Done (every task)

- [ ] All acceptance criteria in the task are met.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass; `pnpm test:int` passes for touched apps.
- [ ] New env vars added to `.env.example` and to the config schema.
- [ ] New endpoints/events documented in the app's `README.md` (endpoints) — contracts stay in `docs/`.
- [ ] No TODOs left without a matching entry in `## Follow-ups` of the report.
- [ ] Commit(s) follow Conventional Commits with the task id: `feat(wallet): T1.3 atomic withdraw strategy`.

## 10. Final report format

End every task with:

```
## Report — <task id>
### Done
- ...
### Files changed
- ...
### How to verify
- commands to run + expected output
### Decisions / deviations
- ... (anything not exactly as specified, and why)
### Follow-ups
- ...
```

## 11. When to stop and ask

Stop and ask (do not guess) if:
- the task depends on something that does not exist yet,
- the spec in `docs/` is ambiguous or contradicts the task,
- an acceptance criterion seems impossible as written,
- you would need to change a contract, a migration that already exists, or another service's code.