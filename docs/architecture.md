# Architecture

## System Overview

The platform is a monorepo with two primary applications: a Next.js frontend (App Router) and a NestJS REST + WebSocket API. They share TypeScript types through a `packages/shared` workspace.

---

## Request Lifecycle

### HTTP requests

```
Browser → Next.js Server Component (SSR) → NestJS API → Prisma → Postgres
                                                       → Redis (cache check/set)
```

Client components make requests through a typed `api` client (`apps/web/src/lib/api/client.ts`) that handles JWT refresh transparently on 401 responses.

### WebSocket events

```
Browser ←→ Socket.IO (/incidents namespace) ←→ NestJS IncidentGateway
                                              ↓
                                           Redis pub/sub (cross-instance sync)
```

When multiple API instances run (K8s HPA), Socket.IO uses a Redis adapter so events broadcast from one instance reach clients connected to others.

### AI pipeline

```
POST /incidents/:id/logs
  → S3 upload
  → BullMQ job queued: ingest-logs

Worker picks up job:
  → Fetch from S3
  → Chunk text (3000 chars, 300 overlap)
  → text-embedding-3-small → pgvector INSERT
  → job complete

GET /incidents/:id/ai/analysis
  → Embed query string
  → pgvector ANN search → top 6 chunks
  → Assemble prompt with incident context + chunks
  → gpt-4o completion
  → Structured JSON extraction
  → AiAnalysis record saved
  → IncidentEmbedding upserted
```

---

## Event Bus (Kafka)

Topics:

| Topic | Producer | Consumer(s) |
|---|---|---|
| `incident.created` | IncidentsService | NotificationConsumer, SlaTracker |
| `incident.updated` | IncidentsService | WsGateway broadcast, AuditConsumer |
| `incident.resolved` | IncidentsService | NotificationConsumer, MetricsConsumer |
| `incident.escalated` | IncidentsService | NotificationConsumer |
| `logs.uploaded` | LogsController | AiIngestConsumer |

Kafka is isolated from the request path. Consumers are NestJS microservice workers in the same process, registered with `@EventPattern`.

---

## Data Access Patterns

**Incident feed** (most common read path):
- Cached in Redis sorted set for 30 seconds per `teamId + query hash`
- Invalidated on any write to that team's incidents
- Ordered by severity then creation time at query time

**Timeline**:
- Never cached — always fetched fresh
- Indexed on `(incidentId, createdAt)` for ordered appends

**Vector search**:
- `pgvector` with `ivfflat` index (lists=100)
- cosine distance operator `<=>`
- Separate tables for incident-level embeddings (for similar incident search) and log chunk embeddings (for RAG)

---

## Authentication

```
Login → bcrypt verify → JWT (15m) + refresh token (7d, hashed in DB)
Refresh → verify stored token → revoke old → issue new pair (rotation)
Logout → revoke refresh token
```

Access tokens are stored in memory (Zustand). Refresh tokens are stored in `httpOnly` cookies. The API client auto-retries failed requests after a successful refresh.

RBAC is enforced via a `@Roles()` decorator + `RolesGuard`. Resource ownership checks happen in service methods, not at the controller level.

---

## WebSocket Events Reference

Events emitted to the client:

| Event | Scope | Payload |
|---|---|---|
| `incident:updated` | Incident room | `{ patch: Partial<Incident> }` |
| `timeline:entry` | Incident room | `TimelineEntry` |
| `presence:current` | Joining client | `PresenceUser[]` |
| `presence:update` | Incident room | `{ type, userId, displayName, presence }` |
| `typing:update` | Incident room | `{ userId, displayName, typing }` |
| `incident:created` | Team room | `Incident` |
| `incident:feed:updated` | Team room | `Incident` |

Events emitted by the client:

| Event | Payload |
|---|---|
| `join:incident` | `{ incidentId }` |
| `leave:incident` | `{ incidentId }` |
| `typing:start` | `{ incidentId }` |
| `typing:stop` | `{ incidentId }` |
| `join:team` | `{ teamId }` |

---

## Observability

- **Metrics**: `@willsoto/nestjs-prometheus` exposes `/metrics` in Prometheus format. Custom metrics: `incident_created_total`, `incident_resolution_duration_seconds`, `ai_analysis_duration_seconds`, `ai_tokens_used_total`.
- **Logging**: Pino with JSON output. Log level configurable via `LOG_LEVEL` env var. Request IDs propagated via `AsyncLocalStorage`.
- **Tracing**: OpenTelemetry instrumentation for NestJS (configured but not required for dev).
- **Grafana**: Dashboards in `infra/docker/grafana/dashboards/`. Covers incident rates, SLA compliance, AI latency, and service health.

---

## Folder Conventions

### API

- `*.module.ts` — NestJS module definition
- `*.controller.ts` — HTTP route handlers, input validation only
- `*.service.ts` — Business logic
- `*.gateway.ts` — WebSocket handlers
- `dto/` — Zod-validated DTOs (via `nestjs-zod`)
- `*.spec.ts` — Co-located unit tests

### Web

- `app/(dashboard)/` — Authenticated pages using App Router layouts
- `app/(auth)/` — Login/register pages (no sidebar)
- `components/incidents/` — Feature-specific components
- `components/ui/` — Re-exported shadcn/ui primitives with local overrides
- `hooks/` — Custom React hooks (data fetching delegated to React Query)
- `store/` — Zustand slices
- `lib/api/` — Typed API client and per-resource fetchers
