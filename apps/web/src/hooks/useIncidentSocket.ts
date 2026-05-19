// apps/web/src/hooks/useIncidentSocket.ts

import { useEffect, useRef, useCallback } from 'react'
import { io, Socket } from 'socket.io-client'
import { useIncidentStore } from '@/store/incident.store'
import { useAuthStore } from '@/store/auth.store'

let socket: Socket | null = null

function getSocket(): Socket {
  if (!socket || socket.disconnected) {
    socket = io(`${process.env.NEXT_PUBLIC_WS_URL}/incidents`, {
      auth: { token: useAuthStore.getState().accessToken },
      transports: ['websocket'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    })
  }
  return socket
}

export function useIncidentSocket(incidentId: string) {
  const socketRef = useRef<Socket | null>(null)
  const { updateIncident, appendTimelineEntry, updatePresence, setTyping } = useIncidentStore()

  useEffect(() => {
    const s = getSocket()
    socketRef.current = s

    s.emit('join:incident', { incidentId })

    s.on('incident:updated', (data: { patch: Record<string, unknown> }) => {
      updateIncident(data.patch as Parameters<typeof updateIncident>[0])
    })

    s.on('timeline:entry', appendTimelineEntry)

    s.on('presence:update', updatePresence)
    s.on('presence:current', (presence) => useIncidentStore.getState().setPresence(presence))

    s.on('typing:update', ({ userId, displayName, typing }: { userId: string; displayName: string; typing: boolean }) => {
      setTyping(userId, displayName, typing)
    })

    return () => {
      s.emit('leave:incident', { incidentId })
      s.off('incident:updated')
      s.off('timeline:entry')
      s.off('presence:update')
      s.off('presence:current')
      s.off('typing:update')
    }
  }, [incidentId, updateIncident, appendTimelineEntry, updatePresence, setTyping])

  const emitTypingStart = useCallback(() => {
    socketRef.current?.emit('typing:start', { incidentId })
  }, [incidentId])

  const emitTypingStop = useCallback(() => {
    socketRef.current?.emit('typing:stop', { incidentId })
  }, [incidentId])

  return { emitTypingStart, emitTypingStop }
}

// Team-level socket for the incident feed
export function useTeamSocket(teamId: string) {
  const { upsertIncidentInFeed } = useIncidentStore()

  useEffect(() => {
    const s = getSocket()
    s.emit('join:team', { teamId })

    s.on('incident:created', upsertIncidentInFeed)
    s.on('incident:feed:updated', upsertIncidentInFeed)

    return () => {
      s.emit('leave:team', { teamId })
      s.off('incident:created')
      s.off('incident:feed:updated')
    }
  }, [teamId, upsertIncidentInFeed])
}
