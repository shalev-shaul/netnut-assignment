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
- **PostgreSQL** – persists jobs (`scrape_jobs` table): id, url, proxy, status, html, errorMessage
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
| Infrastructure | Docker Compose + Kubernetes |

---

## Running Locally

### Prerequisites
- Node.js 20+
- Docker + Docker Compose

### 1. Install dependencies
```bash
npm install
```

### 2. Start infrastructure (PostgreSQL + Redis)
```bash
docker-compose up postgres redis -d
```

### 3. Copy env files (each app has its own)
```bash
cp apps/api/.env.example          apps/api/.env
cp apps/job-manager/.env.example  apps/job-manager/.env
cp apps/scraper/.env.example      apps/scraper/.env
```

> Each service loads only the variables it needs via its own `.env`
> (`ConfigModule` `envFilePath`). In Docker/k8s these values come from the
> container environment, which takes precedence over the `.env` file.

### 4. Start services (3 terminals)
```bash
# Terminal 1 – Job Manager
npm run start:dev:job-manager

# Terminal 2 – Scraper
npm run start:dev:scraper

# Terminal 3 – API
npm run start:dev:api
```

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
  "proxy": "http://user:pass@proxy-host:8080"   // optional
}
```

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

Pass an optional `proxy` field in the request body:

```json
{
  "url": "https://example.com",
  "proxy": "http://user:password@proxy.example.com:8080"
}
```

The Scraper uses `https-proxy-agent` to route the HTTP request through the proxy. Both HTTP and HTTPS targets are supported.

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
│   ├── api/                  # REST gateway
│   │   ├── src/
│   │   │   ├── api.controller.ts
│   │   │   ├── api.service.ts
│   │   │   ├── api.module.ts
│   │   │   └── main.ts
│   │   ├── Dockerfile
│   │   └── tsconfig.app.json
│   ├── job-manager/          # TCP microservice
│   │   ├── src/
│   │   │   ├── job-manager.controller.ts
│   │   │   ├── job-manager.service.ts
│   │   │   ├── job-manager.module.ts
│   │   │   └── main.ts
│   │   ├── Dockerfile
│   │   └── tsconfig.app.json
│   └── scraper/              # BullMQ worker
│       ├── src/
│       │   ├── scraper.processor.ts
│       │   ├── scraper.service.ts
│       │   ├── scraper.module.ts
│       │   └── main.ts
│       ├── Dockerfile
│       └── tsconfig.app.json
├── libs/
│   └── shared/               # Shared DTOs, entities, constants
│       └── src/
│           ├── dto/scrape-job.dto.ts
│           ├── entities/job.entity.ts
│           ├── constants/queue.constants.ts
│           └── index.ts
├── k8s/                      # Kubernetes manifests
├── architecture.drawio       # System architecture diagram
├── docker-compose.yml
├── nest-cli.json
├── tsconfig.json
└── package.json
```
