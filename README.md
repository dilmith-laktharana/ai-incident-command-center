
# AI Incident Command Center

A full-stack incident management platform I built to get hands-on with how real engineering teams handle production outages. The idea came from noticing that during an incident, engineers are jumping between 4-5 different tools instead of actually solving the problem.
The platform handles the coordination side — real-time collaboration, incident timelines, team presence — and the AI side analyses uploaded log files to suggest root causes and generate postmortem drafts automatically.


## Why I built this

I wanted to understand how production engineering teams actually work — not just CRUD apps. So I designed this around real patterns: event-driven architecture with Kafka, WebSocket rooms scoped per incident, Redis for caching and presence, and a RAG pipeline that handles large log files without blowing up the token limit.

The stack is opinionated on purpose. Every choice has a reason behind it.

# What it does

Teams can create and manage incidents with severity levels, assignees, and affected services
Everyone working on an incident sees live updates — status changes, timeline entries, who else is viewing it
You can upload log files and the AI will analyse them and suggest what caused the incident
It finds similar past incidents automatically so you can check how they were resolved before
Generates postmortem drafts from the incident timeline so your team isn't writing them from scratch

# Tech stack

Backend — NestJS, PostgreSQL, Redis, Kafka, Prisma
Frontend — Next.js 14, TypeScript, Tailwind CSS, Zustand
AI — OpenAI API, LangChain, pgvector
Infra — Docker, Kubernetes, GitHub Actions

### Agile & QA Workflow
This project was managed using an Agile/Scrum methodology via **Jira Cloud**. 
- Formulated custom workflows tracking defects through the entire Bug Life Cycle (*Ready for QA ➔ Retesting ➔ Closed*).
- Enforced strict traceability by linking Git branches and commit messages to active Jira Issue Keys (e.g., `AIC-XX`).
# Running it locally

You need Node 20+, Docker, and an OpenAI API key.
bashgit clone https://github.com/dilmith-laktharana/ai-incident-command-center.git
cd ai-incident-command-center
npm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local

docker compose -f infra/docker/docker-compose.yml up -d

cd apps/api && npx prisma migrate dev && cd ../..

npm run dev


# License

MIT
