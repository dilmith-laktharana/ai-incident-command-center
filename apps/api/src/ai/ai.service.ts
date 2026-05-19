// apps/api/src/ai/ai.service.ts

import { Injectable, Logger } from '@nestjs/common'
import { ChatOpenAI, OpenAIEmbeddings } from '@langchain/openai'
import { PromptTemplate } from '@langchain/core/prompts'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { RunnableSequence } from '@langchain/core/runnables'
import { PrismaService } from '../common/prisma.service'
import { S3Service } from '../common/s3.service'
import { AiAnalysisType } from '@prisma/client'

const CHUNK_SIZE = 3000
const CHUNK_OVERLAP = 300
const TOP_K_CHUNKS = 6

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name)

  private readonly llm = new ChatOpenAI({
    model: 'gpt-4o',
    temperature: 0.2,
  })

  private readonly embeddings = new OpenAIEmbeddings({
    model: 'text-embedding-3-small',
  })

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  async ingestLogs(uploadId: string): Promise<void> {
    const upload = await this.prisma.logUpload.findUniqueOrThrow({
      where: { id: uploadId },
    })

    const raw = await this.s3.getObject(upload.s3Key)
    const chunks = this.chunkText(raw)

    this.logger.log(`Ingesting ${chunks.length} chunks for upload ${uploadId}`)

    const vectors = await this.embeddings.embedDocuments(chunks)

    await this.prisma.$transaction(
      chunks.map((content, i) =>
        this.prisma.$executeRaw`
          INSERT INTO "LogChunk" (id, "uploadId", "chunkIndex", content, embedding, "createdAt")
          VALUES (
            gen_random_uuid(),
            ${uploadId},
            ${i},
            ${content},
            ${JSON.stringify(vectors[i])}::vector,
            NOW()
          )
        `,
      ),
    )
  }

  async analyzeRootCause(incidentId: string): Promise<Record<string, unknown>> {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: {
        services: { include: { service: true } },
        timeline: { orderBy: { createdAt: 'asc' }, take: 20 },
      },
    })

    const relevantChunks = await this.retrieveRelevantChunks(
      incidentId,
      `${incident.title} ${incident.description ?? ''} error failure`,
    )

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(ROOT_CAUSE_PROMPT),
      this.llm,
      new StringOutputParser(),
    ])

    const raw = await chain.invoke({
      title: incident.title,
      description: incident.description ?? 'No description provided',
      severity: incident.severity,
      services: incident.services.map((s) => s.service.name).join(', ') || 'Unknown',
      timeline: incident.timeline
        .map((e) => `[${e.createdAt.toISOString()}] ${e.content}`)
        .join('\n'),
      logContext: relevantChunks,
    })

    const result = this.parseStructuredResponse(raw)

    await this.prisma.aiAnalysis.create({
      data: {
        incidentId,
        type: AiAnalysisType.ROOT_CAUSE,
        result,
        modelVersion: 'gpt-4o',
      },
    })

    await this.updateIncidentEmbedding(incidentId, incident.title, incident.description)

    return result
  }

  async generatePostmortem(incidentId: string): Promise<Record<string, unknown>> {
    const incident = await this.prisma.incident.findUniqueOrThrow({
      where: { id: incidentId },
      include: {
        createdBy: { select: { displayName: true } },
        assignedTo: { select: { displayName: true } },
        services: { include: { service: true } },
        timeline: { orderBy: { createdAt: 'asc' } },
        aiAnalyses: { where: { type: AiAnalysisType.ROOT_CAUSE }, take: 1 },
      },
    })

    const priorAnalysis = incident.aiAnalyses[0]?.result as Record<string, unknown> | undefined

    const chain = RunnableSequence.from([
      PromptTemplate.fromTemplate(POSTMORTEM_PROMPT),
      this.llm,
      new StringOutputParser(),
    ])

    const duration = incident.resolvedAt
      ? Math.round((incident.resolvedAt.getTime() - incident.createdAt.getTime()) / 60000)
      : null

    const raw = await chain.invoke({
      title: incident.title,
      severity: incident.severity,
      services: incident.services.map((s) => s.service.name).join(', '),
      duration: duration ? `${duration} minutes` : 'Unresolved',
      timeline: incident.timeline
        .map((e) => `[${e.createdAt.toISOString()}] ${e.type}: ${e.content}`)
        .join('\n'),
      rootCauses: priorAnalysis
        ? JSON.stringify(priorAnalysis.rootCauses ?? priorAnalysis)
        : 'No prior analysis available',
    })

    const result = this.parseStructuredResponse(raw)

    await this.prisma.$transaction([
      this.prisma.aiAnalysis.create({
        data: { incidentId, type: AiAnalysisType.POSTMORTEM, result, modelVersion: 'gpt-4o' },
      }),
      this.prisma.postmortem.upsert({
        where: { incidentId },
        create: {
          incidentId,
          title: `Postmortem: ${incident.title}`,
          summary: (result.summary as string) ?? '',
          timeline: (result.timeline as string) ?? '',
          rootCauses: (result.rootCauses as string) ?? '',
          actionItems: (result.actionItems as string) ?? '',
        },
        update: {
          summary: (result.summary as string) ?? '',
          timeline: (result.timeline as string) ?? '',
          rootCauses: (result.rootCauses as string) ?? '',
          actionItems: (result.actionItems as string) ?? '',
        },
      }),
    ])

    return result
  }

  async findSimilarIncidents(incidentId: string, limit = 5) {
    const embedding = await this.prisma.incidentEmbedding.findUnique({
      where: { incidentId },
    })

    if (!embedding) {
      const incident = await this.prisma.incident.findUniqueOrThrow({ where: { id: incidentId } })
      await this.updateIncidentEmbedding(incidentId, incident.title, incident.description)
      return this.findSimilarIncidents(incidentId, limit)
    }

    const similar = await this.prisma.$queryRaw<Array<{ id: string; similarity: number }>>`
      SELECT ie."incidentId" as id, 1 - (ie.embedding <=> ${embedding.embedding}::vector) as similarity
      FROM "IncidentEmbedding" ie
      WHERE ie."incidentId" != ${incidentId}
      ORDER BY ie.embedding <=> ${embedding.embedding}::vector
      LIMIT ${limit}
    `

    const ids = similar.map((s) => s.id)
    const incidents = await this.prisma.incident.findMany({
      where: { id: { in: ids } },
      include: {
        services: { include: { service: { select: { name: true } } } },
        postmortem: { select: { summary: true, rootCauses: true } },
      },
    })

    return incidents.map((inc) => ({
      ...inc,
      similarity: similar.find((s) => s.id === inc.id)?.similarity ?? 0,
    }))
  }

  private async retrieveRelevantChunks(incidentId: string, query: string): Promise<string> {
    const queryVector = await this.embeddings.embedQuery(query)

    const chunks = await this.prisma.$queryRaw<Array<{ content: string; similarity: number }>>`
      SELECT lc.content, 1 - (lc.embedding <=> ${JSON.stringify(queryVector)}::vector) as similarity
      FROM "LogChunk" lc
      JOIN "LogUpload" lu ON lu.id = lc."uploadId"
      WHERE lu."incidentId" = ${incidentId}
        AND lc.embedding IS NOT NULL
      ORDER BY lc.embedding <=> ${JSON.stringify(queryVector)}::vector
      LIMIT ${TOP_K_CHUNKS}
    `

    if (chunks.length === 0) return 'No log data available.'

    return chunks.map((c, i) => `[Log excerpt ${i + 1}]\n${c.content}`).join('\n\n---\n\n')
  }

  private async updateIncidentEmbedding(
    incidentId: string,
    title: string,
    description: string | null,
  ) {
    const text = `${title} ${description ?? ''}`.trim()
    const vector = await this.embeddings.embedQuery(text)

    await this.prisma.$executeRaw`
      INSERT INTO "IncidentEmbedding" (id, "incidentId", embedding, "updatedAt")
      VALUES (gen_random_uuid(), ${incidentId}, ${JSON.stringify(vector)}::vector, NOW())
      ON CONFLICT ("incidentId") DO UPDATE SET embedding = ${JSON.stringify(vector)}::vector, "updatedAt" = NOW()
    `
  }

  private chunkText(text: string): string[] {
    const chunks: string[] = []
    let start = 0
    while (start < text.length) {
      const end = Math.min(start + CHUNK_SIZE, text.length)
      chunks.push(text.slice(start, end))
      start += CHUNK_SIZE - CHUNK_OVERLAP
    }
    return chunks.filter((c) => c.trim().length > 50)
  }

  private parseStructuredResponse(raw: string): Record<string, unknown> {
    try {
      const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/)
      if (jsonMatch) return JSON.parse(jsonMatch[1])
      return JSON.parse(raw)
    } catch {
      return { raw, parsed: false }
    }
  }
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

const ROOT_CAUSE_PROMPT = `You are an expert site reliability engineer analyzing a production incident.

Incident: {title}
Severity: {severity}
Affected services: {services}
Description: {description}

Timeline:
{timeline}

Relevant log excerpts:
{logContext}

Analyze the incident and respond with a JSON object in this exact structure:
\`\`\`json
{{
  "summary": "2-3 sentence plain English summary of what happened",
  "rootCauses": ["primary root cause", "contributing factor if any"],
  "suspiciousPatterns": ["pattern 1", "pattern 2"],
  "immediateActions": ["action 1", "action 2", "action 3"],
  "longerTermFixes": ["fix 1", "fix 2"],
  "confidence": "HIGH | MEDIUM | LOW",
  "affectedComponents": ["component 1", "component 2"]
}}
\`\`\`

Be specific, technical, and actionable. If log data is insufficient, say so clearly in confidence.`

const POSTMORTEM_PROMPT = `You are a senior SRE writing a production postmortem for an engineering team.

Incident: {title}
Severity: {severity}
Duration: {duration}
Affected services: {services}

Root cause analysis:
{rootCauses}

Full timeline:
{timeline}

Generate a postmortem as a JSON object:
\`\`\`json
{{
  "summary": "Executive summary paragraph (3-5 sentences)",
  "impact": "Description of customer and system impact",
  "timeline": "Markdown table or bullet list of key events with timestamps",
  "rootCauses": "Detailed root cause explanation (1-2 paragraphs)",
  "contributingFactors": ["factor 1", "factor 2"],
  "whatWentWell": ["thing 1", "thing 2"],
  "whatWentPoorly": ["thing 1", "thing 2"],
  "actionItems": [
    {{ "item": "description", "owner": "team/role", "priority": "P1|P2|P3", "dueInDays": 7 }}
  ]
}}
\`\`\`

Write professionally. Avoid blame. Focus on systemic improvements.`
