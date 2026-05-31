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
- [Monorepo layout](#monorepo-layout)
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
                                          │ • SSRF guard │
                                          │ • axios.get  │ ──► (optional proxy) ──► target
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

This split — **sync where a human waits, async where work is slow** — is the
backbone of the design.

---

## Why these tools?

Every dependency earns its place. The assignment allowed any architecture; here's
the reasoning behind each choice.

### NestJS
Mandated by the assignment, but a strong fit anyway: first-class **monorepo**
support, a **DI container** that makes the shared library and per-service wiring
clean, built-in **TCP microservice transport** (no extra broker for the sync hop),
and decorator-based **validation pipes / exception filters** that let cross-cutting
concerns live in one place instead of being copy-pasted into every handler.

### PostgreSQL (via TypeORM)
Jobs are **relational, structured records** with a clear lifecycle
(`pending → processing → done/failed`) that we query by id and could index by
status/time. A battle-tested ACID store is the safe default for "source of truth"
data. TypeORM gives entity-as-code, migrations-ready schema, and `pg` connection
pooling. (HTML is currently stored inline — see
[Production considerations](#production-considerations) for when you'd offload it.)

### Redis + BullMQ
The job between Job Manager and Scraper needs a **durable, retryable queue**, not a
fire-and-forget call. BullMQ (on Redis) gives us **at-least-once delivery**,
**automatic retries with exponential backoff**, dead-letter semantics, and
**horizontal scaling** of consumers for free. Redis is the de-facto backing store
for it and is trivial to run locally and in k8s. We didn't reach for Kafka/RabbitMQ
because the workload is a simple work-queue, not an event stream or complex routing.

### Tinyproxy (local proxy for the bonus)
The proxy feature needs *something* to prove the request actually egresses through
a proxy. **Tinyproxy** is a tiny, zero-config forward proxy that ships as a Docker
image, so reviewers can demo `useProxy: true` end-to-end **with no external
account or credentials** — just `docker-compose up`. In production this slot is
filled by a real commercial gateway (e.g. NetNut), supplied via a Secret.

### axios + https-proxy-agent
`axios` for the HTTP fetch (timeouts, redirect limits, content-length caps,
`responseType` control), and `https-proxy-agent` to tunnel that fetch through the
operator-configured proxy when requested.

### Zod (env validation)
Config is validated at **boot** so a missing/garbage variable fails fast with a
clear message, instead of surfacing as an `undefined` at the first request. Zod was
chosen over Joi for its TypeScript-native inference and composable schemas.

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
| `errorMessage` | `varchar` | yes | Populated on `failed` (e.g. SSRF rejection, fetch error). `null` otherwise. |
| `createdAt` | `timestamptz` | no | `@CreateDateColumn`. |
| `updatedAt` | `timestamptz` | no | `@UpdateDateColumn`, bumped on every status transition. |

**Lifecycle:** insert as `pending` (Job Manager) → `processing` (Scraper picks it
up) → `done` (HTML stored) **or** `failed` (`errorMessage` stored). The status
column is what the client polls on.

### Why `useProxy` is a boolean, not a URL — at the data layer
The column stores **intent only**. The actual proxy connection string
(`PROXY_URL`, which carries credentials) is **deployment config in a k8s Secret**
and is deliberately **never persisted** on the row. This keeps secrets out of the
database entirely: even with full read access to `scrape_jobs`, you cannot recover
a proxy credential. The Scraper combines the row's `useProxy` flag with the
runtime `PROXY_URL` at fetch time — the two are never co-located at rest. (Full
rationale in [Proxy support](#proxy-support).)

### ⚠️ Storage note: HTML belongs in object storage (S3), not Postgres
Here, fetched HTML is stored inline in the `html` `text` column — fine for the
assignment and easy to demo. **In production my best practice is to offload the
HTML body to object storage (S3 / GCS) and keep only a reference on the row**
(e.g. an `htmlS3Key` / URL + size + content-hash), because:
- **Row/table bloat** — a 10 MB page × many jobs turns the hot table into
  multi-GB, slowing every scan, backup, and replication.
- **Separation of concerns** — Postgres should hold *structured, queryable
  metadata*; large immutable blobs are exactly what object storage is built for
  (cheaper per GB, designed for large objects, independently lifecycle-managed).
- **Performance** — `SELECT`s for status/listing no longer drag multi-MB `text`
  columns across the wire; you fetch the blob only when actually needed.
- **Lifecycle & cost** — S3 lifecycle rules can expire/transition old HTML to cold
  storage without touching the DB.

The schema is intentionally shaped so this is a drop-in change later: swap the
`html` column for an `htmlS3Key` reference and have the Scraper `PutObject` before
updating the row.

---

## Design details worth noticing

These are the "small things" that make the solution production-minded rather than
a happy-path demo.

### 🔒 SSRF protection (`libs/shared/src/utils/url-safety.ts`)
A scraper that fetches arbitrary user-supplied URLs is a classic **SSRF** vector.
Before any socket opens, `assertUrlIsSafe()`:
- rejects non-`http(s)` schemes,
- **resolves the hostname via DNS and rejects if *any* resolved address is
  private/internal** — loopback, RFC-1918, link-local **`169.254.x` (cloud
  metadata!)**, CGNAT `100.64/10`, IPv6 `::1`/`fe80`/`fc00::/7`, multicast. This
  defends against DNS records that point at internal hosts (DNS-rebinding style).

### 🔑 Proxy as intent, not a client-supplied URL
The client sends only a boolean `useProxy`. The actual connection string
(`PROXY_URL`, which carries credentials) is **operator config in a k8s Secret** —
never accepted from the request, never persisted to the DB, never returned to the
client, and **redacted in logs** (`redactProxy()`). If `useProxy: true` but no
`PROXY_URL` is configured, the job **fails loudly** instead of silently doing a
direct fetch that would leak the real egress IP.

### ♻️ Retry semantics tuned to failure type (`scraper.processor.ts`)
BullMQ retries a job when the processor **throws**, and marks it done when it
**returns**. We exploit that:
- transient failures (network, 5xx) **throw** → retried (`attempts: 3`,
  exponential backoff),
- a **permanent** `UnsafeUrlError` (SSRF rejection) is recorded as `failed` and
  then **returns** → no pointless retries of a request that can never succeed.

### 🧩 Domain errors that survive the TCP boundary (`libs/shared/src/filters/`)
NestJS microservices replace any non-`RpcException` thrown in a handler with a
generic "Internal server error", **dropping the class and custom fields**. So:
- **`DomainRpcExceptionFilter`** (Job Manager side) re-emits domain errors as a
  structured `{ code, message }` payload onto the wire.
- **`RpcHttpExceptionFilter`** (API side) decodes that back to the right HTTP
  status — `code === 'NOT_FOUND'` → `404`, an rxjs `TimeoutError` → `503`.

Services and controllers stay **HTTP-agnostic**; the translation lives in two
small filters registered via `APP_FILTER`. (`instanceof` is intentionally *not*
used across the wire — the prototype is lost in transit; we match on `code`.)

### ✅ Strict input validation (`validation-pipe.provider.ts`)
A global `ValidationPipe` with `whitelist: true` + `forbidNonWhitelisted: true`
strips/blocks unknown fields, and the DTO enforces `@IsUrl({ protocols:
['http','https'], require_protocol: true })`. Unknown keys in the body are
rejected, not silently ignored.

### ❤️ Real health checks (`api/src/health.controller.ts`)
`/health` uses `@nestjs/terminus` to **actually ping the Job Manager** over TCP and
returns `503` when it's unreachable — which is exactly what the k8s readiness/
liveness probe consumes. (Not a hardcoded `{status:"ok"}`.)

### 🛡️ Fetch hardening (`scraper.service.ts`)
30s timeout, **10 MB** content cap (`maxContentLength` / `maxBodyLength`), bounded
redirects (5), and an honest, identifiable `User-Agent`.

### 📦 Dependency-isolated monorepo + multi-stage Docker
Each service declares **only the dependencies it uses** (the API has no `typeorm`/
`bull`/`axios`), and each `Dockerfile` is **multi-stage** — build the shared lib +
that one app, then `npm prune --omit=dev` so the runtime image carries no build
tooling or unused deps.

---

## Services

| Service | Role | Port |
|---|---|---|
| `api` | Stateless HTTP REST gateway; forwards to Job Manager over TCP | 3000 |
| `job-manager` | TCP microservice: validate, persist (PG), enqueue (BullMQ) | 3001 |
| `scraper` | BullMQ worker: SSRF-guard, fetch URL (optional proxy), store HTML | — |

---

## Tech stack

| Concern | Choice |
|---|---|
| Framework | NestJS 10 |
| Sync inter-service | NestJS **TCP microservice** (request/response) |
| Async work queue | **BullMQ** + `@nestjs/bull` on **Redis 7** |
| Persistence | **PostgreSQL 16** via **TypeORM** + `pg` |
| HTTP fetching | `axios` |
| Proxy | `https-proxy-agent` (+ **Tinyproxy** for local demo) |
| Request validation | `class-validator` + `class-transformer` (global `ValidationPipe`) |
| Env validation | **Zod** (`ConfigModule` `validate`, fail-fast at boot) |
| Health checks | `@nestjs/terminus` |
| Error mapping | custom `RpcExceptionFilter` + `BaseExceptionFilter` |
| Monorepo | npm workspaces (per-package `package.json`) |
| Infrastructure | Docker Compose + Kubernetes manifests |

---

## Monorepo layout

An **npm workspaces** monorepo — each app and the shared lib is its own package
with its **own `package.json` and dependency surface**:

- `@netnut/shared` — built to `dist/`, consumed by the apps via the workspace
  symlink. Holds the **DTOs, the `Job` entity, the SSRF utils, the two exception
  filters, the Zod env schemas, queue constants and the TypeORM config** — the
  single source of truth shared across services.
- `@netnut/api` — only HTTP / microservice-client / terminus deps (no `typeorm`,
  `bull`, `pg`, `axios`).
- `@netnut/job-manager` — `typeorm`, `@nestjs/bull`, `pg`, …
- `@netnut/scraper` — `axios`, `https-proxy-agent`, `typeorm`, `@nestjs/bull`, …

> **Build order matters:** `@netnut/shared` must be built before the apps. The root
> `npm run build` script does this for you.

---

## Running locally

### Prerequisites
- Node.js 20+
- Docker + Docker Compose

### 1. Install dependencies
```bash
# Installs every workspace and links @netnut/shared into node_modules
npm install
```

### 2. Start infrastructure (PostgreSQL + Redis)
```bash
docker-compose up postgres redis -d
```
This publishes Postgres on host port **5432** and Redis on **6379**.

### 3. Env files

Each service has its **own `.env`** and loads **only the variables it needs**.
There are **no code-side defaults** — every variable is **validated at boot by
Zod**, so a missing/invalid value fails fast with a clear message.

`apps/api/.env`
```
API_PORT=3000
JOB_MANAGER_HOST=localhost
JOB_MANAGER_PORT=3001
```

`apps/job-manager/.env`
```
JOB_MANAGER_PORT=3001
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=netnut
REDIS_HOST=localhost
REDIS_PORT=6379
```

`apps/scraper/.env`
```
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASS=postgres
DB_NAME=netnut
REDIS_HOST=localhost
REDIS_PORT=6379
PROXY_URL=          # optional; set to http://localhost:8888 to use the Tinyproxy container
```

> `DB_PORT` must match the host port Postgres is published on (`5432` with the
> compose file above). In Docker/k8s these values come from the container
> environment, which takes precedence over the `.env` file.

### 4. Build the shared lib
```bash
npm run build:shared
```

### 5. Start the services (3 terminals)
```bash
npm run start:dev:job-manager   # Terminal 1
npm run start:dev:scraper       # Terminal 2
npm run start:dev:api           # Terminal 3
```

> Editing `libs/shared`? Rebuild it (`npm run build:shared`, or
> `npm run build:watch -w @netnut/shared`) so the apps pick up the change.

### Or: the whole stack with Docker Compose
```bash
docker-compose up --build
```

---

## API reference

### Submit a scrape job
```http
POST /scrape
Content-Type: application/json

{
  "url": "https://example.com",
  "useProxy": true        // optional, defaults to false
}
```

> `useProxy` is a boolean **intent** flag. The client never supplies a proxy
> connection string — see [Proxy support](#proxy-support).

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "url": "https://example.com",
  "useProxy": true,
  "status": "pending",
  "html": null,
  "errorMessage": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Poll for the result
```http
GET /scrape/:id
```
**Response** `200 OK` (when done):
```json
{
  "id": "uuid",
  "url": "https://example.com",
  "useProxy": true,
  "status": "done",
  "html": "<!DOCTYPE html>...",
  "errorMessage": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```
Unknown id → `404 Not Found`. Job Manager unreachable → `503 Service Unavailable`.

**Job lifecycle:** `pending` → `processing` → `done` / `failed`

### Health
```http
GET /health      # 200 when the API can reach the Job Manager, else 503
```

---

## Proxy support

The proxy feature is a **boolean toggle**, not a client-supplied URL. A request
opts in with `"useProxy": true`. The client only expresses *intent*; the actual
connection string lives in operator config — the `PROXY_URL` environment variable
(a k8s **Secret** in production, since real proxy URLs carry credentials). The
Scraper reads `PROXY_URL` and routes the request through it with
`https-proxy-agent`.

**Why intent, not a client URL?**
- The proxy endpoint and its credentials are **deployment config, not request
  data** — they belong in a Secret, never in the request body or the DB.
- Credentials never reach the client, never get persisted, never leak in logs
  (the URL is **redacted** when logged).
- The operator controls *which* proxy; the client controls only *whether* to use one.

**`PROXY_URL` format:** `http://[user:pass@]host:port`
- Production example: `http://USER:PASS@gw.netnut.io:5959`
- If `useProxy: true` but `PROXY_URL` is empty → the job **fails loudly** rather
  than silently doing a direct fetch (which would leak the real egress IP).

### Trying it locally
`docker-compose` ships a [Tinyproxy](https://tinyproxy.github.io/) container, wired
to the scraper via `PROXY_URL=http://proxy:8888`. Bring the stack up, submit a job
with `"useProxy": true`, and watch the request flow through the proxy:
```bash
docker-compose up --build
docker-compose logs -f proxy
```
Running the scraper outside Docker? Set `PROXY_URL=http://localhost:8888` in
`apps/scraper/.env`.

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
kubectl apply -f k8s/job-manager.yaml   # Deployment + Service, tcpSocket readiness probe
kubectl apply -f k8s/scraper.yaml       # Deployment, 2 replicas
kubectl apply -f k8s/api.yaml           # Deployment + LoadBalancer, httpGet /health probes
```

Notable choices:
- **Config vs Secret split** — non-sensitive config in a `ConfigMap`, DB
  credentials and `PROXY_URL` in a `Secret`. Apps consume both via `envFrom`.
- **Postgres as a StatefulSet** with a PVC (stable identity + persistent storage);
  **Redis/API/Scraper as Deployments**.
- **Probes that mean something** — API has an HTTP `/health` readiness+liveness
  probe (which transitively checks the Job Manager); Job Manager has a `tcpSocket`
  probe on 3001.
- **Scraper scales horizontally** — 2 replicas by default, since BullMQ hands each
  job to exactly one worker:
  ```bash
  kubectl scale deployment scraper --replicas=5 -n netnut
  ```

> Validated locally with **k3s** (rancher/k3s in Docker): `kubectl apply
> --dry-run=server` passes, and a full apply brings all pods to `Running` after
> importing the locally-built images.

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
- **Indexes** on `status` / `createdAt` once you query by them.
- **Observability** — structured (JSON) logging + a **correlation id** propagated
  API → Job Manager → Scraper so one request is traceable end-to-end; Prometheus
  metrics (queue depth, fetch latency).
- **Rate limiting / quotas** on `POST /scrape` to bound queue growth.
- **Tests** — unit tests for the SSRF guard and the fetch/queue paths, plus an e2e
  happy-path. (Highest-value next addition.)

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
│           ├── enums/job-manager-pattern.enum.ts
│           ├── constants/queue.constants.ts
│           ├── config/{typeorm.config,env-validation}.ts
│           ├── database/typeorm-connection.module.ts
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
