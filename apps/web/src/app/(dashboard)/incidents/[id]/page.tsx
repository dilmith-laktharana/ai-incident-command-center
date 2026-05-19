// apps/web/src/app/(dashboard)/incidents/[id]/page.tsx

import { notFound } from 'next/navigation'
import { Suspense } from 'react'
import { getIncident } from '@/lib/api/incidents'
import { IncidentHeader } from '@/components/incidents/IncidentHeader'
import { IncidentTimeline } from '@/components/incidents/IncidentTimeline'
import { AiAnalysisPanel } from '@/components/ai/AiAnalysisPanel'
import { SimilarIncidents } from '@/components/ai/SimilarIncidents'
import { CommentThread } from '@/components/incidents/CommentThread'
import { PresenceBar } from '@/components/incidents/PresenceBar'
import { ServiceStatusBadges } from '@/components/incidents/ServiceStatusBadges'
import { IncidentMetaPanel } from '@/components/incidents/IncidentMetaPanel'
import { LiveIncidentProvider } from '@/components/incidents/LiveIncidentProvider'
import { Skeleton } from '@/components/ui/skeleton'

interface Props {
  params: { id: string }
}

export default async function IncidentPage({ params }: Props) {
  const incident = await getIncident(params.id).catch(() => null)
  if (!incident) notFound()

  return (
    <LiveIncidentProvider incidentId={incident.id}>
      <div className="flex h-full flex-col">
        <PresenceBar incidentId={incident.id} />

        <div className="flex-1 overflow-auto">
          <div className="mx-auto max-w-screen-2xl px-6 py-6">
            <IncidentHeader incident={incident} />

            <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* Main column */}
              <div className="space-y-6 lg:col-span-2">
                <ServiceStatusBadges services={incident.services} />

                <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                  <IncidentTimeline incidentId={incident.id} initialEntries={incident.timeline} />
                </Suspense>

                <CommentThread incidentId={incident.id} />
              </div>

              {/* Sidebar */}
              <div className="space-y-4">
                <IncidentMetaPanel incident={incident} />

                <Suspense fallback={<Skeleton className="h-64 w-full" />}>
                  <AiAnalysisPanel incidentId={incident.id} />
                </Suspense>

                <Suspense fallback={<Skeleton className="h-48 w-full" />}>
                  <SimilarIncidents incidentId={incident.id} />
                </Suspense>
              </div>
            </div>
          </div>
        </div>
      </div>
    </LiveIncidentProvider>
  )
}

export async function generateMetadata({ params }: Props) {
  const incident = await getIncident(params.id).catch(() => null)
  if (!incident) return { title: 'Incident not found' }
  return { title: `${incident.title} · Incident Command` }
}
