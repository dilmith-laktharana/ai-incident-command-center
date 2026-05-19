// packages/shared/src/types/incidents.ts

export type Severity = 'SEV1' | 'SEV2' | 'SEV3' | 'SEV4'

export type IncidentStatus =
  | 'OPEN'
  | 'ACKNOWLEDGED'
  | 'INVESTIGATING'
  | 'MITIGATED'
  | 'RESOLVED'

export type TimelineEntryType =
  | 'STATUS_CHANGE'
  | 'ASSIGNMENT'
  | 'COMMENT'
  | 'LOG_UPLOAD'
  | 'AI_ANALYSIS'
  | 'ESCALATION'
  | 'SLA_BREACH'
  | 'SYSTEM'

export interface User {
  id: string
  displayName: string
  avatarUrl: string | null
}

export interface Service {
  id: string
  name: string
  slug: string
  status: 'OPERATIONAL' | 'DEGRADED' | 'PARTIAL_OUTAGE' | 'MAJOR_OUTAGE'
}

export interface Label {
  id: string
  name: string
  color: string
}

export interface TimelineEntry {
  id: string
  incidentId: string
  type: TimelineEntryType
  content: string
  metadata: Record<string, unknown> | null
  createdAt: string
  user: User | null
}

export interface Incident {
  id: string
  title: string
  description: string | null
  severity: Severity
  status: IncidentStatus
  teamId: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  slaBreachedAt: string | null
  createdBy: User
  assignedTo: User | null
  services: Array<{ service: Service }>
  labels: Array<{ label: Label }>
  timeline: TimelineEntry[]
  _count: { comments: number; logUploads: number; aiAnalyses: number }
}

export interface PresenceUser {
  userId: string
  displayName: string
  joinedAt: number
}

// packages/shared/src/types/ai.ts
export interface AiAnalysisResult {
  summary: string
  rootCauses: string[]
  suspiciousPatterns: string[]
  immediateActions: string[]
  longerTermFixes: string[]
  confidence: 'HIGH' | 'MEDIUM' | 'LOW'
  affectedComponents: string[]
  parsed: boolean
  raw?: string
}

export interface PostmortemResult {
  summary: string
  impact: string
  timeline: string
  rootCauses: string
  contributingFactors: string[]
  whatWentWell: string[]
  whatWentPoorly: string[]
  actionItems: Array<{
    item: string
    owner: string
    priority: 'P1' | 'P2' | 'P3'
    dueInDays: number
  }>
}

export interface SimilarIncident {
  id: string
  title: string
  severity: Severity
  status: IncidentStatus
  createdAt: string
  resolvedAt: string | null
  similarity: number
  services: Array<{ service: Pick<Service, 'name'> }>
  postmortem: { summary: string; rootCauses: string } | null
}
