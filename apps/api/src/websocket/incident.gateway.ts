// apps/api/src/websocket/incident.gateway.ts

import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets'
import { UseGuards, Logger } from '@nestjs/common'
import { Server, Socket } from 'socket.io'
import { WsJwtGuard } from '../auth/ws-jwt.guard'
import { RedisService } from '../common/redis.service'

interface AuthenticatedSocket extends Socket {
  userId: string
  teamId: string
  displayName: string
}

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL, credentials: true },
  namespace: '/incidents',
})
export class IncidentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server

  private readonly logger = new Logger(IncidentGateway.name)
  private readonly presenceKey = (incidentId: string) => `presence:${incidentId}`

  constructor(private readonly redis: RedisService) {}

  @UseGuards(WsJwtGuard)
  async handleConnection(socket: AuthenticatedSocket) {
    this.logger.log(`Client connected: ${socket.id} (user: ${socket.userId})`)
  }

  async handleDisconnect(socket: AuthenticatedSocket) {
    // Clean up all presence for this socket
    const rooms = Array.from(socket.rooms).filter((r) => r !== socket.id)
    await Promise.all(rooms.map((room) => this.removePresence(room, socket.userId, socket)))
    this.logger.log(`Client disconnected: ${socket.id}`)
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('join:incident')
  async handleJoinIncident(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { incidentId: string },
  ) {
    const room = `incident:${data.incidentId}`
    await socket.join(room)

    await this.addPresence(data.incidentId, socket.userId, socket.displayName, socket)

    const presence = await this.getPresence(data.incidentId)
    socket.emit('presence:current', presence)

    return { joined: true }
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('leave:incident')
  async handleLeaveIncident(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { incidentId: string },
  ) {
    const room = `incident:${data.incidentId}`
    await socket.leave(room)
    await this.removePresence(data.incidentId, socket.userId, socket)
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('typing:start')
  async handleTypingStart(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { incidentId: string },
  ) {
    socket.to(`incident:${data.incidentId}`).emit('typing:update', {
      userId: socket.userId,
      displayName: socket.displayName,
      typing: true,
    })
  }

  @UseGuards(WsJwtGuard)
  @SubscribeMessage('typing:stop')
  async handleTypingStop(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() data: { incidentId: string },
  ) {
    socket.to(`incident:${data.incidentId}`).emit('typing:update', {
      userId: socket.userId,
      displayName: socket.displayName,
      typing: false,
    })
  }

  // Called by the IncidentsService and KafkaConsumer to push updates
  broadcastIncidentUpdate(incidentId: string, event: string, payload: unknown) {
    this.server.to(`incident:${incidentId}`).emit(event, payload)
  }

  broadcastToTeam(teamId: string, event: string, payload: unknown) {
    this.server.to(`team:${teamId}`).emit(event, payload)
  }

  private async addPresence(
    incidentId: string,
    userId: string,
    displayName: string,
    socket: AuthenticatedSocket,
  ) {
    const key = this.presenceKey(incidentId)
    await this.redis.hset(key, userId, JSON.stringify({ userId, displayName, joinedAt: Date.now() }))
    await this.redis.expire(key, 3600)

    const presence = await this.getPresence(incidentId)
    socket.to(`incident:${incidentId}`).emit('presence:update', { type: 'join', userId, displayName, presence })
  }

  private async removePresence(incidentId: string, userId: string, socket: AuthenticatedSocket) {
    const key = this.presenceKey(incidentId)
    await this.redis.hdel(key, userId)

    const presence = await this.getPresence(incidentId)
    socket.to(`incident:${incidentId}`).emit('presence:update', { type: 'leave', userId, presence })
  }

  private async getPresence(incidentId: string) {
    const key = this.presenceKey(incidentId)
    const raw = await this.redis.hgetall(key)
    return Object.values(raw ?? {}).map((v) => JSON.parse(v as string))
  }
}
