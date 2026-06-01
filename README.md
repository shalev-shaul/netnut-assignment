# Netnut Scraper – Backend Home Assignment

A **NestJS monorepo** of three services that accept URL scraping jobs over a REST
API, validate and queue them, fetch the target asynchronously (optionally through
a proxy), and return the resulting HTML.

> **Assignment:** build a Nest.js monorepo with three services — **API**, **Job
> Manager**, **Scraper**. The API receives scrape jobs and returns HTML; the Job
> Manager validates, persists and enqueues; the Scraper consumes the queue,
> fetches the URL and returns the HTML. Bonus: proxy option + Kubernetes manifests.
> Both bonuses are implemented.

---

## Table of Contents
- [Architecture](#architecture)
- [Why these tools?](#why-these-tools)
- [Data model](#data-model)
- [Design details worth noticing](#design-details-worth-noticing)
- [Services](#services)
- [Tech stack](#tech-stack)
- [Running locally](#running-locally)
- [API reference](#api-reference)
- [Proxy support](#proxy-support)
- [Kubernetes deployment](#kubernetes-deployment)
- [Production considerations](#production-considerations)
- [Project structure](#project-structure)

---

## Architecture

The diagram lives in **`architecture.drawio`** (open at
[app.diagrams.net](https://app.diagrams.net)). ASCII summary:

```
┌──────────┐    HTTP REST     ┌──────────────────────┐
│  Client  │ ───────────────► │   API Service :3000  │   stateless gateway
└──────────┘   POST /scrape   │  POST /scrape        │   (owns no datastore)
               GET /scrape/:id │  GET  /scrape/:id    │
                               │  GET  /health        │
                               └──────────┬───────────┘
                                          │  ① sync request/response
                                          │     NestJS TCP microservice
                                          ▼
                               ┌──────────────────────┐        ┌────────────┐
                               │  Job Manager :3001   │ ─────► │ PostgreSQL │
                               │  • validate (DTO)    │  persist└────────────┘
                               │  • persist job (PG)  │
                               │  • enqueue job       │ ─────► ┌────────────┐
                               └──────────────────────┘  ②     │   Redis    │
                                                  async BullMQ │  (BullMQ)  │
                                          ┌──────────────┐     └─────┬──────┘
                                          │   Scraper    │ ◄─────────┘ consume
                                          │  (2 workers) │
                                          │ • URL check  │
                                          │ • fetch URL  │ ──► (optional proxy) ──► target
                                          │ • store HTML │ ─────► PostgreSQL
                                          └──────────────┘
```

### The key architectural decision: two communication channels

The system deliberately uses **two different transports**, each chosen for the
shape of the interaction:

| Hop | Transport | Why |
|---|---|---|
| **① API → Job Manager** | **Sync RPC** over NestJS **TCP microservice** | The client is waiting on the HTTP request; it needs an immediate answer ("job accepted, here's the id" / "not found"). A request/response transport models that correctly, with a 5s timeout so a stuck Job Manager surfaces as `503` rather than a hung connection. |
| **② Job Manager → Scraper** | **Async** **BullMQ** queue over Redis | Scraping is slow and unbounded (network I/O, large pages). Decoupling it behind a durable queue means the API stays responsive, work survives restarts, and we scale throughput simply by adding Scraper replicas. |

The guiding principle: **the transport follows the interaction** — request/response
where a caller is waiting on the result, a durable queue where the work is slow and
must survive failure.

---

## Why these tools?

The assignment allowed any architecture; the reasoning behind each choice, briefly:

- **NestJS** (mandated) — its **opinionated, modular structure** (modules + DI)
  keeps the three services and the shared library cleanly organized and wired with
  the same conventions; plus first-class monorepo support, a built-in **TCP
  microservice transport** for the sync hop (no extra broker), and decorator-based
  validation pipes / exception filters that keep cross-cutting concerns in one place.
- **PostgreSQL + TypeORM** — an ACID store is the right default for source-of-truth
  job records. (HTML is stored inline for now — see [Data model](#data-model) for
  the S3 offload path.)
- **Redis + BullMQ** — the Job-Manager→Scraper hop needs a **durable, retryable
  queue**: at-least-once delivery, retries with exponential backoff, and horizontal
  scaling of consumers for free. Overkill brokers (Kafka/RabbitMQ) aren't needed for
  a simple work-queue.
- **http/https-proxy-agent** — the proxy agent is picked by **target scheme**
  (`https` → CONNECT tunnel, `http` → absolute-URI request) so both are proxied
  correctly. See [Proxy support](#proxy-support).
- **Tinyproxy** — a zero-config forward proxy Docker image so `useProxy: true` can
  be demoed end-to-end with no external account. Production uses a real gateway via a Secret.
- **Zod** — env validated at **boot** (fail-fast with a clear message), chosen over
  Joi for TypeScript-native inference.

---

## Data model

A single table, **`scrape_jobs`**, is the source of truth for every job's
lifecycle (`libs/shared/src/entities/job.entity.ts`). It's intentionally simple:
one row per submitted job, mutated in place as the job moves through its states.

| Column | Type | Null | Notes |
|---|---|---|---|
| `id` | `uuid` (PK) | no | Server-generated. Returned to the client and used to poll `GET /scrape/:id`. A UUID (not a serial) avoids leaking volume and is safe to expose. |
| `url` | `varchar` | no | The validated target URL (`@IsUrl` http/https). |
| `useProxy` | `boolean` (default `false`) | no | The client's **intent** to route through the operator proxy — *not* a proxy URL. See below. |
| `status` | `enum` (`pending`/`processing`/`done`/`failed`) | no | Job lifecycle. Defaults to `pending` on insert. |
| `html` | `text` | yes | The fetched HTML. `null` until the job reaches `done`. **See the storage note below.** |
| `errorMessage` | `varchar` | yes | Populated on `failed` (e.g. invalid URL, fetch timeout/error). `null` otherwise. |
| `createdAt` | `timestamptz` | no | `@CreateDateColumn`. |
| `updatedAt` | `timestamptz` | no | `@UpdateDateColumn`, bumped on every status transition. |

**Lifecycle:** insert as `pending` (Job Manager) → `processing` (Scraper picks it
up) → `done` (HTML stored) **or** `failed` (`errorMessage` stored). The status
column is what the client polls on.

**`useProxy` stores intent, not a URL.** The proxy connection string lives in
config (a k8s Secret) and is **never persisted** — so secrets stay out of the DB
entirely. Full rationale in [Proxy support](#proxy-support).

### ⚠️ Storage note: HTML belongs in object storage (S3), not Postgres
HTML is stored inline in the `html` column — fine for the assignment, but **in
production the best practice is to offload the body to S3/GCS and keep only a
reference** (`htmlS3Key` + size + hash) on the row. Inline blobs bloat the hot
table (slower scans/backups/replication), and large immutable objects are exactly
what object storage is for (cheaper, lifecycle-managed). The schema is shaped so
this is a drop-in change: swap `html` for `htmlS3Key` and have the Scraper
`PutObject` before updating the row.

---

## Design details worth noticing

These are the "small things" that make the solution production-minded rather than
a happy-path demo.

**🧱 Persistence behind a generic service + factory** (`libs/shared/src/repositories/`)
— the services depend on an **abstraction**, not on TypeORM directly: all CRUD goes
through one generic `DbOperationsService<T>` (the only file that touches TypeORM's
`Repository` API), handed out by an injectable `DbOperationsFactoryService`. A
service binds it to an entity in one line: `this.jobs =
this.dbFactory.getService<Job>(Job)`. Because the data access sits behind that single
seam, a datastore change is localized (write a sibling service + new connection) and
services can be unit-tested against an in-memory fake — no DB.

**🧩 Reusable dynamic modules** (`libs/shared/src/{database,queue}/`) — infra wiring
is packaged as `TypeOrmConnectionModule.forRoot([Job])` (DB connection + persistence
factory) and `BullConnectionModule.forRoot([SCRAPE_QUEUE])` (Redis/BullMQ + queue
registration). Adding an entity or queue is one line at the importing module, not
duplicated `forRootAsync` boilerplate.

**🧩 Domain errors that survive the TCP boundary** (`libs/shared/src/filters/`) —
NestJS microservices replace a thrown non-`RpcException` with a generic "Internal
server error", dropping the class. `DomainRpcExceptionFilter` (JM side) re-emits a
structured `{ code, message }`; `RpcHttpExceptionFilter` (API side) maps it back to
HTTP (`NOT_FOUND` → 404, rxjs `TimeoutError` → 503). Services stay HTTP-agnostic;
we match on `code` since `instanceof` doesn't survive the wire.

**♻️ Retry semantics tuned to failure type** (`scraper.processor.ts`) — BullMQ
retries when the processor **throws**, completes when it **returns**. Transient
failures throw → retried (`attempts: 3`, exponential backoff); a permanent
`UnsafeUrlError` is recorded `failed` and returns → never retried.

**🔗 URL validation** (`url-safety.ts`) — `assertUrlIsSafe()` rejects malformed URLs
(permanent `UnsafeUrlError`); the DTO also enforces `@IsUrl({ protocols:
['http','https'] })`. *Not full SSRF protection* — it doesn't block internal
targets; see [Production considerations](#production-considerations).

**🔑 Proxy as intent** — the client sends only a boolean; the credentialed
`PROXY_URL` is operator config (Secret), never persisted/returned and redacted in
logs. Details in [Proxy support](#proxy-support).

**✅ Strict input validation** — global `ValidationPipe` with `whitelist` +
`forbidNonWhitelisted` rejects unknown body keys outright.

**❤️ Real health checks** (`health.controller.ts`) — `/health` uses
`@nestjs/terminus` to actually ping the Job Manager over TCP (503 when unreachable),
feeding the k8s probes — not a hardcoded `{status:"ok"}`.

**🛡️ Fetch hardening** (`scraper.service.ts`) — env-tunable request timeout
(`REQUEST_TIMEOUT_MS`, default 30s) and content cap (`MAX_CONTENT_BYTES`, default
10 MB), bounded redirects, identifiable `User-Agent`.

**📦 Dependency-isolated monorepo + multi-stage Docker** — each service depends only
on what it uses (the API has no `typeorm`/`bull`); Dockerfiles are
multi-stage with `npm prune --omit=dev` so runtime images carry no build tooling.

---

## Services

| Service | Role | Port |
|---|---|---|
| `api` | Stateless HTTP REST gateway; forwards to Job Manager over TCP | 3000 |
| `job-manager` | TCP microservice: validate, persist (PG), enqueue (BullMQ) | 3001 |
| `scraper` | BullMQ worker: validate URL, fetch (optional proxy), store HTML | — |

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | NestJS 10 |
| Sync inter-service | NestJS **TCP microservice** (request/response) |
| Async work queue | **BullMQ** + `@nestjs/bull` on **Redis 7** |
| Persistence | **PostgreSQL 16** via **TypeORM** + `pg` |
| Proxy | `http-proxy-agent` + `https-proxy-agent` (agent picked by target scheme; **Tinyproxy** for local demo) |
| Request validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| Env validation | **Zod** (`ConfigModule` `validate`, fail-fast at boot) |
| Health checks | `@nestjs/terminus` |
| Error mapping | custom `DomainRpcExceptionFilter` (JM side) + `RpcHttpExceptionFilter` (API side) |
| Monorepo | npm workspaces (per-package `package.json`) |
| Infrastructure | Docker Compose + Kubernetes manifests |

---

## Running locally

**Prerequisites:** Node.js 20+, Docker + Docker Compose.

### Quickest: the whole stack in Docker
```bash
docker-compose up --build      # API on http://localhost:3000
```

### Manual (for development)
```bash
npm install                          # installs all workspaces, links @netnut/shared
docker-compose up postgres redis -d  # Postgres :5432, Redis :6379
npm run build:shared
# then, in three terminals:
npm run start:dev:job-manager
npm run start:dev:scraper
npm run start:dev:api
```

**Env files** — each service has its own `.env` and loads only the vars it needs,
all **validated at boot by Zod** (fail-fast). Required infra vars have no defaults;
the scraper's `REQUEST_TIMEOUT_MS` / `MAX_CONTENT_BYTES` are optional (Zod defaults).

```ini
# apps/api/.env
API_PORT=3000
JOB_MANAGER_HOST=localhost
JOB_MANAGER_PORT=3001

# apps/job-manager/.env   (+ JOB_MANAGER_PORT=3001)
# apps/scraper/.env        (+ PROXY_URL=, optional REQUEST_TIMEOUT_MS / MAX_CONTENT_BYTES)
DB_HOST=localhost
DB_PORT=5432          # must match the published Postgres host port
DB_USER=postgres
DB_PASS=postgres
DB_NAME=netnut
REDIS_HOST=localhost
REDIS_PORT=6379
```

> In Docker/k8s these come from the container environment (which overrides `.env`).
> Editing `libs/shared`? Rebuild it (`npm run build:shared`) so the apps pick it up.

---

## API reference

**`POST /scrape`** → `201` with the created job. Body: `{ "url": "https://example.com",
"useProxy": true }` (`useProxy` optional, defaults `false`; it's a boolean *intent*
flag — the client never supplies a proxy URL).

**`GET /scrape/:id`** → `200` with the job row. Unknown id → `404`; Job Manager
unreachable → `503`.

The job object returned by both:
```json
{
  "id": "uuid", "url": "https://example.com", "useProxy": true,
  "status": "pending",          // → processing → done / failed
  "html": null,                  // populated when status = done
  "errorMessage": null,          // populated when status = failed
  "createdAt": "...", "updatedAt": "..."
}
```

**`GET /health`** → `200` when the API can reach the Job Manager (via terminus), else `503`.

---

## Proxy support

A request opts in with `"useProxy": true`; the Scraper routes the fetch through the
operator-configured `PROXY_URL` (`http://[user:pass@]host:port`), choosing the agent
by target scheme — `https-proxy-agent` (CONNECT tunnel) for `https://`,
`http-proxy-agent` (absolute-URI) for `http://`. If `useProxy: true` but no
`PROXY_URL` is set, the job **fails loudly** rather than silently leaking the real
egress IP. (Why it's a boolean and not a client-supplied URL: see
[Proxy as intent](#design-details-worth-noticing).)

**Try it locally:** `docker-compose` ships a
[Tinyproxy](https://tinyproxy.github.io/) container wired via
`PROXY_URL=http://proxy:8888`. Bring the stack up, submit a `"useProxy": true` job,
and watch `docker-compose logs -f proxy`. (Outside Docker, set
`PROXY_URL=http://localhost:8888` in `apps/scraper/.env`.)

---

## Kubernetes deployment

All manifests are in `k8s/`. Build the images, then apply:

```bash
docker build -f apps/api/Dockerfile         -t netnut/api:latest .
docker build -f apps/job-manager/Dockerfile -t netnut/job-manager:latest .
docker build -f apps/scraper/Dockerfile     -t netnut/scraper:latest .

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml     # ConfigMap (non-secret) + Secret (DB creds, PROXY_URL)
kubectl apply -f k8s/postgres.yaml      # StatefulSet + headless Service + PVC
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/proxy.yaml         # Deployment + Service (demo Tinyproxy)
kubectl apply -f k8s/job-manager.yaml   # Deployment + Service, tcpSocket readiness probe
kubectl apply -f k8s/scraper.yaml       # Deployment, 2 replicas
kubectl apply -f k8s/api.yaml           # Deployment + LoadBalancer, httpGet /health probes
```

Notable choices: **ConfigMap/Secret split** (creds + `PROXY_URL` in the Secret,
consumed via `envFrom`); **Postgres as a StatefulSet** with a PVC, others as
Deployments; **meaningful probes** (API `/health` readiness+liveness which
transitively checks the JM; JM `tcpSocket` on 3001); **horizontal scaling** of the
scraper (`kubectl scale deployment scraper --replicas=5 -n netnut`, since BullMQ
gives each job to one worker).

---

## Production considerations

Things intentionally **out of scope** for the assignment but worth naming — the
design leaves room for each:

- **HTML → object storage (S3).** Storing raw HTML inline in Postgres is fine at
  this scale; at volume the best practice is to write it to S3/GCS and keep only a
  reference + metadata on the row — see [Data model](#data-model) for the full
  rationale and the drop-in migration path.
- **`synchronize: true`** is convenient for the demo but unsafe in production —
  swap for **TypeORM migrations**.
- **SSRF protection.** The current URL check only validates that the target is a
  well-formed URL — it does **not** block internal targets. A production scraper
  should resolve the host and reject private/internal ranges (loopback, RFC-1918,
  link-local `169.254.x` cloud-metadata, CGNAT), reject non-`http(s)` schemes, and
  revalidate on each redirect hop (`maxRedirects: 0` + manual follow) to close the
  redirect-based TOCTOU gap.
- **Indexes** on `status` / `createdAt` once you query by them.
- **Observability** — structured (JSON) logging + a **correlation id** propagated
  API → Job Manager → Scraper so one request is traceable end-to-end; Prometheus
  metrics (queue depth, fetch latency).
- **Rate limiting / quotas** on `POST /scrape` to bound queue growth.
- **Tests** — unit tests for the fetch/queue paths and the persistence factory,
  plus an e2e happy-path. (Highest-value next addition.)

---

## Project structure

```
netnut-assignment/
├── apps/
│   ├── api/                         # @netnut/api – REST gateway
│   │   └── src/{api.controller,api.service,api.module,health.controller,main}.ts
│   ├── job-manager/                 # @netnut/job-manager – TCP microservice
│   │   └── src/{job-manager.controller,job-manager.service,job-manager.module,main}.ts
│   └── scraper/                     # @netnut/scraper – BullMQ worker
│       └── src/{scraper.processor,scraper.service,scraper.module,main}.ts
├── libs/
│   └── shared/                      # @netnut/shared – built to dist/
│       └── src/
│           ├── dto/scrape-job.dto.ts
│           ├── entities/job.entity.ts
│           ├── enums/job.enum.ts
│           ├── types.ts                       # ScrapeJobData (queue payload contract)
│           ├── constants/queue.constants.ts
│           ├── config/env-validation.ts       # Zod schemas (TypeORM config is inlined in the connection module)
│           ├── database/typeorm-connection.module.ts  # opens DB connection + provides the factory
│           ├── queue/bull-connection.module.ts        # opens Redis/BullMQ + registers queues
│           ├── repositories/                 # generic persistence (one service + factory)
│           │   ├── db-operations.service.ts         # DbOperationsService<T> (generic CRUD, the only TypeORM-aware file)
│           │   └── db-operations-factory.service.ts # DbOperationsFactoryService.getService<T>(collection)
│           ├── errors/errors.ts
│           ├── filters/{domain-rpc-exception,rpc-http-exception}.filter.ts
│           ├── providers/validation-pipe.provider.ts
│           ├── utils/url-safety.ts
│           └── index.ts
├── k8s/                             # Kubernetes manifests
├── architecture.drawio             # System architecture diagram
├── docker-compose.yml
├── tsconfig.base.json              # shared compiler options
└── package.json                    # workspaces + orchestration scripts
```
```
Each `apps/*` also has its own Dockerfile, nest-cli.json, tsconfig.json and package.json.
```
