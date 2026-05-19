// apps/web/src/store/incident.store.ts

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Incident, TimelineEntry, PresenceUser } from '@/types/incidents'

interface IncidentState {
  // Active incident detail
  activeIncident: Incident | null
  timeline: TimelineEntry[]
  presence: PresenceUser[]
  typingUsers: Array<{ userId: string; displayName: string }>

  // Incident list feed
  incidents: Incident[]
  totalIncidents: number
  feedLoading: boolean

  // Actions
  setActiveIncident: (incident: Incident | null) => void
  updateIncident: (patch: Partial<Incident>) => void
  appendTimelineEntry: (entry: TimelineEntry) => void
  setPresence: (users: PresenceUser[]) => void
  updatePresence: (update: { type: 'join' | 'leave'; userId: string; displayName?: string; presence: PresenceUser[] }) => void
  setTyping: (userId: string, displayName: string, isTyping: boolean) => void
  setIncidents: (incidents: Incident[], total: number) => void
  upsertIncidentInFeed: (incident: Incident) => void
  setFeedLoading: (loading: boolean) => void
}

export const useIncidentStore = create<IncidentState>()(
  subscribeWithSelector((set) => ({
    activeIncident: null,
    timeline: [],
    presence: [],
    typingUsers: [],
    incidents: [],
    totalIncidents: 0,
    feedLoading: false,

    setActiveIncident: (incident) =>
      set({ activeIncident: incident, timeline: incident?.timeline ?? [], presence: [] }),

    updateIncident: (patch) =>
      set((state) => ({
        activeIncident: state.activeIncident
          ? { ...state.activeIncident, ...patch }
          : null,
        incidents: state.incidents.map((inc) =>
          state.activeIncident && inc.id === state.activeIncident.id
            ? { ...inc, ...patch }
            : inc,
        ),
      })),

    appendTimelineEntry: (entry) =>
      set((state) => ({
        timeline: [...state.timeline, entry],
      })),

    setPresence: (users) => set({ presence: users }),

    updatePresence: ({ presence }) => set({ presence }),

    setTyping: (userId, displayName, isTyping) =>
      set((state) => ({
        typingUsers: isTyping
          ? state.typingUsers.some((u) => u.userId === userId)
            ? state.typingUsers
            : [...state.typingUsers, { userId, displayName }]
          : state.typingUsers.filter((u) => u.userId !== userId),
      })),

    setIncidents: (incidents, total) =>
      set({ incidents, totalIncidents: total, feedLoading: false }),

    upsertIncidentInFeed: (incident) =>
      set((state) => {
        const exists = state.incidents.some((i) => i.id === incident.id)
        const incidents = exists
          ? state.incidents.map((i) => (i.id === incident.id ? incident : i))
          : [incident, ...state.incidents]
        return { incidents, totalIncidents: exists ? state.totalIncidents : state.totalIncidents + 1 }
      }),

    setFeedLoading: (feedLoading) => set({ feedLoading }),
  })),
)
