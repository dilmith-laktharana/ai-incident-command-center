# AI Incident Command Center

A collaborative incident response platform where engineering teams manage outages in real time while AI analyzes logs, surfaces root causes, and auto-generates postmortems.

Built to reflect realistic platform engineering practices — not a tutorial project.

![Dashboard Preview](docs/assets/dashboard-preview.png)

---

## What This Is

Modern incident response is fragmented — engineers switch between Slack, PagerDuty, Datadog, and Confluence during an outage, losing time on coordination instead of resolution. This platform consolidates that workflow into a single command surface.

The AI layer isn't a chatbot wrapper. It's a structured analysis pipeline: logs go in, pattern-matched failure signatures come out, correlated against historical incidents via vector similarity, producing actionable summaries and draft postmortems that teams actually edit instead of write from scratch.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                  Next.js Frontend                    │
│   Command Center UI  ·  Real-time Feed  ·  AI Panel │
└──────────────────────┬──────────────────────────────┘
                       │ HTTP + WebSocket
┌──────────────────────▼──────────────────────────────┐
│                  NestJS API Gateway                  │
│  Auth  ·  Incidents  ·  AI Router  ·  WS Gateway    │
└────┬──────────┬───────────────┬──────────────────────┘
     │          │               │
  Postgres   Redis          Kafka/RabbitMQ
  (Prisma)   (cache,        (event bus)
  pgvector   sessions,
  (RAG)      pub/sub)
     │
  OpenAI API + LangChain
  (log analysis, embeddings, postmortem generation)
```

### Key Design Decisions

**Event-driven incident lifecycle** — All state transitions (created → acknowledged → investigating → resolved) publish to a Kafka topic. Downstream consumers handle notifications, SLA tracking, and audit logging independently.

**Hybrid AI pipeline** — Short log snippets go directly to the completion endpoint. Large log files are chunked, embedded into pgvector, and queried via RAG before summarization. This prevents token bloat while keeping context relevant.

**WebSocket scoping** — Each incident has its own Socket.IO room. Presence, typing indicators, and timeline updates are scoped at room level, not broadcast globally.

**Redis dual role** — Sessions and rate-limiting use Redis as cache. Incident feed ordering uses a sorted set to maintain insertion-ordered real-time feeds without Postgres polling.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Zustand, Framer Motion |
| Backend | NestJS, Prisma ORM, PostgreSQL + pgvector, Redis, Kafka |
| AI | OpenAI API, LangChain, RAG pipeline, vector similarity search |
| Auth | JWT (access + refresh), RBAC middleware |
| Infra | Docker Compose (dev), Kubernetes-ready manifests, GitHub Actions CI/CD |
| Observability | Prometheus metrics endpoint, Grafana dashboards, structured logging (Pino) |

---

## Repository Structure

```
ai-incident-command-center/
├── apps/
│   ├── web/                         # Next.js frontend
│   │   ├── src/
│   │   │   ├── app/                 # App Router pages
│   │   │   │   ├── (auth)/
│   │   │   │   ├── (dashboard)/
│   │   │   │   │   ├── incidents/
│   │   │   │   │   ├── analytics/
│   │   │   │   │   └── settings/
│   │   │   ├── components/
│   │   │   │   ├── incidents/       # Incident-specific components
│   │   │   │   ├── ai/              # AI panel components
│   │   │   │   ├── layout/          # Shell, sidebar, header
│   │   │   │   └── ui/              # Re-exported shadcn primitives
│   │   │   ├── hooks/               # Custom React hooks
│   │   │   ├── lib/                 # API client, socket client, utils
│   │   │   ├── store/               # Zustand stores
│   │   │   └── types/               # Shared TS types (synced from packages/)
│   │   ├── public/
│   │   ├── Dockerfile
│   │   └── next.config.ts
│   │
│   └── api/                         # NestJS backend
│       ├── src/
│       │   ├── auth/                # JWT strategy, guards, refresh flow
│       │   ├── incidents/           # Core incident CRUD + lifecycle
│       │   ├── ai/                  # LangChain pipeline, RAG, postmortems
│       │   ├── teams/               # Workspace and membership management
│       │   ├── websocket/           # Socket.IO gateway
│       │   ├── metrics/             # Prometheus endpoint
│       │   ├── notifications/       # Kafka consumer → push/email
│       │   └── common/             # Guards, interceptors, filters, pipes
│       ├── prisma/
│       │   ├── schema.prisma
│       │   └── migrations/
│       ├── Dockerfile
│       └── nest-cli.json
│
├── packages/
│   └── shared/                      # Shared TypeScript types and constants
│       └── src/
│           ├── types/
│           └── constants/
│
├── infra/
│   ├── k8s/                         # Kubernetes manifests
│   │   ├── api-deployment.yaml
│   │   ├── web-deployment.yaml
│   │   ├── postgres-statefulset.yaml
│   │   └── ingress.yaml
│   └── docker/
│       ├── docker-compose.yml
│       └── docker-compose.prod.yml
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml
│   │   └── deploy.yml
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
│
└── docs/
    ├── api.md
    ├── architecture.md
    └── deployment.md
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Docker and Docker Compose
- An OpenAI API key

### Local Development

```bash
# Clone and install
git clone https://github.com/yourhandle/ai-incident-command-center.git
cd ai-incident-command-center
npm install

# Copy environment files
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

# Add your OpenAI API key to apps/api/.env

# Start infrastructure (Postgres, Redis, Kafka)
docker compose -f infra/docker/docker-compose.yml up -d

# Run database migrations and seed
cd apps/api
npx prisma migrate dev
npx prisma db seed

# Start development servers (from root)
npm run dev
```

The web app runs on `http://localhost:3000`, API on `http://localhost:4000`.

### Default Credentials (dev seed)

```
admin@incident.dev  /  changeme123
operator@incident.dev  /  changeme123
```

---

## Environment Variables

### API (`apps/api/.env`)

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/incident_cmd
REDIS_URL=redis://localhost:6379
KAFKA_BROKERS=localhost:9092

JWT_SECRET=your-jwt-secret-min-32-chars
JWT_REFRESH_SECRET=your-refresh-secret-min-32-chars

OPENAI_API_KEY=sk-...

AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET=incident-cmd-logs

FRONTEND_URL=http://localhost:3000
```

### Web (`apps/web/.env.local`)

```env
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_WS_URL=ws://localhost:4000
```

---

## API Reference

See [`docs/api.md`](docs/api.md) for full endpoint documentation.

Core endpoints:

```
POST   /auth/login
POST   /auth/refresh

GET    /incidents
POST   /incidents
GET    /incidents/:id
PATCH  /incidents/:id
POST   /incidents/:id/resolve
POST   /incidents/:id/escalate

POST   /incidents/:id/logs          # Upload logs for AI analysis
GET    /incidents/:id/ai/analysis   # Get AI root cause analysis
GET    /incidents/:id/ai/postmortem # Generate postmortem draft
GET    /incidents/:id/similar       # Vector similarity search

GET    /metrics                     # Prometheus metrics
```

WebSocket events: see [`docs/architecture.md`](docs/architecture.md).

---

## Running Tests

```bash
# Unit tests
npm run test

# E2E tests (requires running infrastructure)
npm run test:e2e

# Coverage
npm run test:cov
```

---

## Deployment

### Docker Compose (staging)

```bash
docker compose -f infra/docker/docker-compose.prod.yml up -d
```

### Kubernetes

```bash
kubectl apply -f infra/k8s/
```

Expects a Kubernetes cluster with:
- A `incident-cmd` namespace
- Secrets configured via `kubectl create secret`
- An Ingress controller (nginx or ALB)

Full deployment guide: [`docs/deployment.md`](docs/deployment.md)

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). Branch strategy:

- `main` — production
- `develop` — integration branch
- `feat/*` — feature branches
- `fix/*` — bug fixes
- `infra/*` — infrastructure changes

---

## License

MIT
