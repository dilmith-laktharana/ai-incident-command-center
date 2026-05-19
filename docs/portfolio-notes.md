# Portfolio Notes

## Resume Description

**AI Incident Command Center** — Full-stack incident response platform
*NestJS · Next.js 14 · PostgreSQL · pgvector · Redis · Kafka · OpenAI · Docker · Kubernetes*

- Built a production-grade incident management platform with real-time WebSocket collaboration, JWT authentication with refresh token rotation, and role-based access control across team workspaces
- Implemented a RAG pipeline using LangChain and pgvector to analyze uploaded log files: chunked text is embedded with `text-embedding-3-small`, stored in PostgreSQL, and retrieved via cosine similarity to provide grounded context for `gpt-4o` root-cause analysis
- Designed a vector similarity search system for historical incident correlation, surfacing past incidents with matching failure signatures and their postmortem resolutions
- Built an event-driven incident lifecycle using Kafka topics; upstream producers (API service) decouple from downstream consumers (notification worker, SLA tracker, audit logger) enabling independent scaling
- Implemented Redis-backed real-time presence (who's viewing an incident) and typed feed caching with sorted sets; Socket.IO gateway uses Redis adapter for cross-instance event propagation
- Configured Prometheus metrics endpoint with custom counters for incident rates, AI token usage, and resolution time histograms; provisioned Grafana dashboards for operational visibility
- Wrote Kubernetes manifests with HPA configured on CPU/memory targets, rolling update strategy, and readiness/liveness probes for zero-downtime deployments
- Structured CI/CD with GitHub Actions: lint, type-check, unit tests against real Postgres/Redis service containers, Docker image build and push to GHCR on merge

---

## Development Roadmap / Commit Strategy

### Phase 1 — Foundation (Week 1)
```
feat: initialize turborepo monorepo with apps/api and apps/web
feat: configure NestJS with Prisma, initial schema
feat: add JWT auth module with refresh token rotation
feat: implement User and Team CRUD with RBAC guards
feat: Next.js App Router setup with auth layout and login page
feat: configure Zustand auth store and API client with refresh interceptor
chore: add docker-compose for local postgres, redis, kafka
```

### Phase 2 — Incident Core (Week 2)
```
feat: add Incident model with severity, status, SLA, and service relations
feat: implement incident CRUD with team-scoped queries
feat: add incident timeline with typed entry categories
feat: add Redis caching for incident feed with invalidation
feat: add incident assignment and escalation workflow
feat: Kafka producer for incident lifecycle events
test: add unit tests for incidents.service
```

### Phase 3 — Real-Time Layer (Week 3)
```
feat: setup Socket.IO gateway with WsJwtGuard
feat: implement join/leave incident rooms
feat: add real-time presence with Redis hashes
feat: broadcast incident updates and timeline entries over WebSocket
feat: add typing indicators for comment threads
feat: useIncidentSocket hook with event handlers
feat: useTeamSocket for feed-level live updates
```

### Phase 4 — AI Pipeline (Week 4)
```
feat: S3 log upload endpoint with multipart validation
feat: LangChain log ingestion pipeline with pgvector embedding storage
feat: RAG retrieval for log chunk similarity queries
feat: root cause analysis chain with structured JSON output
feat: postmortem generation from timeline and prior analysis
feat: vector similarity search for historical incident matching
feat: AiAnalysisPanel component with collapsible sections
feat: SimilarIncidents component with similarity scores
```

### Phase 5 — Observability & Polish (Week 5)
```
feat: Prometheus metrics endpoint with custom incident counters
feat: Grafana dashboard provisioning via docker-compose
feat: add analytics page with Recharts incident trends
feat: service health grid on dashboard
feat: postmortem editor with markdown support
feat: SLA breach detection in Kafka consumer
chore: add GitHub Actions CI pipeline
chore: write Kubernetes manifests with HPA
docs: architecture documentation and API reference
```

---

## Technical Achievements (for interviews)

**"Tell me about a technical challenge you solved"**

The AI pipeline needed to handle log files up to 50MB without blowing up the token budget. The solution was a chunked ingestion flow: files are split into 3000-character overlapping windows, each embedded independently and stored in pgvector. At analysis time, the incident title and description form the query vector — the top-6 most semantically similar chunks are retrieved and assembled into the prompt. This means gpt-4o only sees the relevant sections of a log file regardless of total size.

**"How did you handle real-time at scale?"**

Socket.IO rooms scope events to individual incidents so a broadcast on incident A never reaches viewers of incident B. For multi-instance deployments (HPA), a Redis adapter ensures events published by any API pod reach all connected clients regardless of which pod they're connected to. Presence state lives in Redis hashes (one hash per incident room) with a 1-hour TTL, so pod restarts don't corrupt presence state.

**"Describe your approach to caching"**

Incident feeds are cached in Redis with a 30-second TTL keyed on `incidents:{teamId}:{query-hash}`. Any write to a team's incidents calls `KEYS incidents:{teamId}:*` and deletes matching keys. The 30-second window is intentional — it's long enough to absorb dashboard polling but short enough that a resolved incident propagates quickly. Hot paths (incident detail) are not cached because they have real-time WebSocket updates that would conflict with stale cache reads.

---

## Suggested Screenshots / Dashboard Ideas

1. **Command Center Dashboard** — Grid of active incidents ranked by severity, service health sparklines, 24h incident volume chart, SLA compliance gauge
2. **Incident Detail** — Left: timeline with typed entries and comment thread. Right: AI analysis panel with collapsible sections, similar incidents list, metadata sidebar
3. **AI Analysis Panel** — Confidence badge (HIGH/MEDIUM/LOW), root causes as bullet list, immediate action items numbered in monospace, suspicious patterns as code chips
4. **Postmortem Editor** — Markdown editor prefilled by AI, action items table with owner/priority/due date columns, publish button
5. **Analytics Page** — Incident volume by severity over time (area chart), MTTR trend (line chart), top affected services (horizontal bar), resolution rate (donut)
6. **Presence Bar** — Avatar stack with colored presence dots, typing indicator ("Priya is typing...")

---

## Future Roadmap

- **Runbook automation**: Attach runbooks to services; AI suggests relevant runbook steps during active incidents
- **Alert ingestion**: Webhook receiver for PagerDuty, Grafana, and Datadog alerts to auto-create incidents
- **On-call scheduling**: Rotation management with escalation policies integrated into assignment workflow
- **Slack integration**: Two-way sync — incidents post to channels, Slack threads sync back as comments
- **Audit log**: Immutable append-only audit trail for compliance use cases
- **Multi-tenancy**: Organization-level isolation for SaaS deployment model
