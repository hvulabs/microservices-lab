# Payment Lab

A learning payment system for exploring microservices, RabbitMQ delivery, and database race conditions. The React client talks to the NestJS API Gateway; it does not connect directly to service databases or RabbitMQ.

## Prerequisites

- Node.js 22
- pnpm 10
- Docker Desktop
- Docker-compatible container runtime; the Supabase CLI is installed in the workspace

## Local Setup

1. Copy `.env.example` to `.env` if you need to override local settings.
2. Make sure Docker Desktop is running.
3. Install packages with `pnpm install`.
4. Run `pnpm dev:all` to start Supabase on the host, then build and start RabbitMQ, Redis, all NestJS apps, and the web client with Docker Compose.

The Supabase CLI runs on the host because it needs the Docker CLI and daemon to launch its local services. The command still starts the complete development stack from one project command. Stop the app containers and Supabase with `pnpm stop:all`.

The web app is at `http://localhost:5173`, the API Gateway at `http://localhost:3000`, Supabase API at `http://127.0.0.1:5433`, Supabase Studio at `http://127.0.0.1:5434`, and RabbitMQ management at `http://127.0.0.1:15672`. Local RabbitMQ uses the default `guest` credentials. Postgres is available on port `5432`.

## Workspace Checks

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:int`
- `pnpm build:web`

The service flows, message topology, database migrations, and user-facing screens are added in later phases. Supabase Realtime is reserved for payment-status updates in the web client.
