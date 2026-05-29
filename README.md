# Netnut Scraper – Backend Home Assignment

A NestJS monorepo that accepts URL scraping jobs via a REST API, queues them through a Job Manager, and processes them asynchronously with a Scraper worker.

---

## Architecture

See `architecture.drawio` (open in [draw.io](https://app.diagrams.net)).

```
┌──────────┐        HTTP REST         ┌──────────────────────┐
│  Client  │ ───────────────────────► │   API Service :3000  │
└──────────┘                          │  POST /scrape        │
                                      │  GET  /scrape/:id    │
                                      └────────┬─────────────┘
                                               │ NestJS TCP Microservice
                                               ▼
                                      ┌──────────────────────┐
                                      │  Job Manager :3001   │
                                      │  • Validate URL      │
                                      │  • Persist → PG      │
                                      │  • Enqueue → Redis   │
                                      └────────┬─────────────┘
                                               │ BullMQ
                                               ▼
                                      ┌──────────────────────┐
                                      │   Scraper Worker     │
                                      │  • Consume queue     │
                                      │  • axios.get(url)    │
                                      │  • Optional proxy    │
                                      │  • Save HTML → PG    │
                                      └──────────────────────┘
```

**Data stores:**
- **PostgreSQL** – persists jobs (`scrape_jobs` table): id, url, useProxy, status, html, errorMessage
- **Redis** – BullMQ queue named `scrape`

---

## Services

| Service | Role | Port |
|---|---|---|
| `api` | HTTP REST gateway | 3000 |
| `job-manager` | TCP microservice: validate, persist, enqueue | 3001 |
| `scraper` | BullMQ worker: fetch URLs, store HTML | — |

---

## Tech Stack

| Concern | Library |
|---|---|
| Framework | NestJS 10 |
| Job Queue | BullMQ + `@nestjs/bull` |
| ORM | TypeORM + `pg` (PostgreSQL) |
| HTTP Fetching | axios |
| Proxy Support | `https-proxy-agent` |
| Validation | `class-validator` + `class-transformer` |
| Inter-service | NestJS TCP Microservices |
| Monorepo | npm workspaces (per-package `package.json`) |
| Infrastructure | Docker Compose + Kubernetes |

---

## Monorepo Layout

This is an **npm workspaces** monorepo — each app and the shared lib is its own
package with its **own `package.json` and dependencies**:

- `@netnut/shared` — built to `dist/`, consumed by the apps via the workspace
  symlink in `node_modules`. Declares only `class-validator`, `class-transformer`,
  `typeorm`, `reflect-metadata`.
- `@netnut/api` — declares only the HTTP/microservice-client deps (no `typeorm`,
  `bull`, `pg` or `axios`).
- `@netnut/job-manager` — declares `typeorm`, `@nestjs/bull`, `pg`, etc.
- `@netnut/scraper` — declares `axios`, `https-proxy-agent`, `typeorm`, `@nestjs/bull`, etc.

This keeps each service's dependency surface (and Docker image) limited to what it
actually uses. Build dev tooling (`@nestjs/cli`, `typescript`) lives once at the root.

> Build order matters: `@netnut/shared` must be built before the apps (the root
> `npm run build` script does this for you).

---

## Running Locally

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

### 3. Create env files (each app has its own; values fall back to code defaults)

`apps/api/.env`
```
PORT=3000
JOB_MANAGER_HOST=localhost
PORT=3001
```

`apps/job-manager/.env`
```
PORT=3001
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASS=postgres
DB_NAME=netnut
REDIS_HOST=localhost
REDIS_PORT=6379
```

`apps/scraper/.env`
```
DB_HOST=localhost
DB_PORT=5433
DB_USER=postgres
DB_PASS=postgres
DB_NAME=netnut
REDIS_HOST=localhost
REDIS_PORT=6379
PROXY_URL=          # optional; set to http://localhost:8888 to use the Tinyproxy container
```

> Each service loads only the variables it needs via its own `.env`
> (`ConfigModule` `envFilePath`). Every variable has a sensible default in code,
> so the only one you typically must set locally is `DB_PORT=5433` (to match the
> docker-compose port mapping). In Docker/k8s these values come from the
> container environment, which takes precedence over the `.env` file.

### 4. Build the shared lib (apps resolve `@netnut/shared` from its `dist/`)
```bash
npm run build:shared
```

### 5. Start services (3 terminals)
```bash
# Terminal 1 – Job Manager
npm run start:dev:job-manager

# Terminal 2 – Scraper
npm run start:dev:scraper

# Terminal 3 – API
npm run start:dev:api
```

> If you change code in `libs/shared`, rebuild it (`npm run build:shared`, or run
> `npm run build:watch -w @netnut/shared` in its own terminal) so the apps pick up
> the changes.

### Or: run everything with Docker Compose
```bash
docker-compose up --build
```

---

## API Reference

### Submit a scrape job

```http
POST /scrape
Content-Type: application/json

{
  "url": "https://example.com",
  "useProxy": true   // optional, defaults to false
}
```

> `useProxy` is a boolean **intent** flag. The client never supplies a proxy
> connection string — the actual proxy is configured operator-side via the
> `PROXY_URL` env var / k8s Secret (see [Proxy Support](#proxy-support)).

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "url": "https://example.com",
  "proxy": null,
  "status": "pending",
  "html": null,
  "errorMessage": null,
  "createdAt": "...",
  "updatedAt": "..."
}
```

### Poll for result

```http
GET /scrape/:id
```

**Response** `200 OK` (when done):
```json
{
  "id": "uuid",
  "url": "https://example.com",
  "status": "done",
  "html": "<!DOCTYPE html>...",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Job statuses:** `pending` → `processing` → `done` / `failed`

---

## Proxy Support

The proxy feature is a **boolean toggle**, not a client-supplied URL. A request
opts in with `useProxy: true`:

```json
{
  "url": "https://example.com",
  "useProxy": true
}
```

The client only expresses *intent*. The actual proxy connection string lives in
operator config — the `PROXY_URL` environment variable (a k8s **Secret** in
production, since real proxy URLs carry credentials). When a job has
`useProxy: true`, the Scraper reads `PROXY_URL` and routes the request through it
with `https-proxy-agent`. Both HTTP and HTTPS targets are supported.

**Why this design rather than a client-supplied proxy URL?**
- The proxy endpoint (and its credentials) are deployment config, not request data — so they belong in a Secret, never in the request body or the DB.
- Credentials never reach the client, never get persisted, never leak in logs (the URL is redacted when logged).
- The operator controls *which* proxy; the client only controls *whether* to use one.

**`PROXY_URL` format:** `http://[user:pass@]host:port`
- Production example (a commercial gateway): `http://USER:PASS@gw.netnut.io:5959`
- If `useProxy: true` but `PROXY_URL` is empty, the job **fails loudly** rather than silently falling back to a direct fetch (which would leak the real egress IP).

### Trying it locally

`docker-compose` ships a [Tinyproxy](https://tinyproxy.github.io/) container so
you can demo the feature with zero external accounts. It's already wired into the
scraper via `PROXY_URL=http://proxy:8888`. Just bring the stack up and submit a
job with `"useProxy": true` — you'll see the request flow through Tinyproxy's
logs:

```bash
docker-compose up --build
docker-compose logs -f proxy   # watch requests being relayed
```

To use it when running the scraper outside Docker, set in `apps/scraper/.env`:
```
PROXY_URL=http://localhost:8888
```

---

## Kubernetes Deployment

All manifests are in `k8s/`. Apply in order:

```bash
kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/postgres.yaml
kubectl apply -f k8s/redis.yaml
kubectl apply -f k8s/job-manager.yaml
kubectl apply -f k8s/scraper.yaml
kubectl apply -f k8s/api.yaml
```

Build and push images first:
```bash
docker build -f apps/api/Dockerfile -t netnut/api:latest .
docker build -f apps/job-manager/Dockerfile -t netnut/job-manager:latest .
docker build -f apps/scraper/Dockerfile -t netnut/scraper:latest .
```

The `api` Service is of type `LoadBalancer` — the external IP exposes port 80 → container port 3000.

The `scraper` Deployment runs 2 replicas for parallel job processing. Scale as needed:
```bash
kubectl scale deployment scraper --replicas=5 -n netnut
```

---

## Project Structure

```
netnut-assignment/
├── apps/
│   ├── api/                      # @netnut/api – REST gateway
│   │   ├── src/
│   │   │   ├── api.controller.ts
│   │   │   ├── api.service.ts
│   │   │   ├── api.module.ts
│   │   │   ├── health.controller.ts
│   │   │   └── main.ts
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json          # ← own deps
│   ├── job-manager/              # @netnut/job-manager – TCP microservice
│   │   ├── src/ ...
│   │   ├── Dockerfile
│   │   ├── nest-cli.json
│   │   ├── tsconfig.json
│   │   └── package.json          # ← own deps
│   └── scraper/                  # @netnut/scraper – BullMQ worker
│       ├── src/ ...
│       ├── Dockerfile
│       ├── nest-cli.json
│       ├── tsconfig.json
│       └── package.json          # ← own deps
├── libs/
│   └── shared/                   # @netnut/shared – DTOs, entity, utils
│       ├── src/
│       │   ├── dto/
│       │   ├── entities/job.entity.ts
│       │   ├── constants/queue.constants.ts
│       │   ├── utils/url-safety.ts
│       │   └── index.ts
│       ├── tsconfig.json
│       └── package.json          # ← own deps, built to dist/
├── k8s/                          # Kubernetes manifests
├── architecture.drawio           # System architecture diagram
├── docker-compose.yml
├── tsconfig.base.json            # shared compiler options
└── package.json                  # workspaces config + orchestration scripts
```
