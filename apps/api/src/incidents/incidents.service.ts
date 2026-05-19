// apps/api/src/incidents/incidents.service.ts

import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common'
import { PrismaService } from '../common/prisma.service'
import { KafkaService } from '../common/kafka.service'
import { RedisService } from '../common/redis.service'
import { CreateIncidentDto } from './dto/create-incident.dto'
import { UpdateIncidentDto } from './dto/update-incident.dto'
import { IncidentStatus, Severity, TimelineEntryType } from '@prisma/client'
import { IncidentQueryDto } from './dto/incident-query.dto'

@Injectable()
export class IncidentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kafka: KafkaService,
    private readonly redis: RedisService,
  ) {}

  async create(dto: CreateIncidentDto, userId: string) {
    const incident = await this.prisma.incident.create({
      data: {
        title: dto.title,
        description: dto.description,
        severity: dto.severity,
        teamId: dto.teamId,
        createdById: userId,
        assignedToId: dto.assignedToId,
        slaPolicyId: dto.slaPolicyId,
        services: dto.serviceIds?.length
          ? { create: dto.serviceIds.map((id) => ({ serviceId: id })) }
          : undefined,
        labels: dto.labelIds?.length
          ? { create: dto.labelIds.map((id) => ({ labelId: id })) }
          : undefined,
        timeline: {
          create: {
            type: TimelineEntryType.SYSTEM,
            userId,
            content: 'Incident created',
          },
        },
      },
      include: this.defaultInclude(),
    })

    await this.kafka.publish('incident.created', {
      incidentId: incident.id,
      teamId: incident.teamId,
      severity: incident.severity,
      createdById: userId,
    })

    await this.invalidateTeamFeedCache(incident.teamId)

    return incident
  }

  async findAll(teamId: string, query: IncidentQueryDto) {
    const cacheKey = `incidents:${teamId}:${JSON.stringify(query)}`
    const cached = await this.redis.get(cacheKey)
    if (cached) return JSON.parse(cached)

    const where = {
      teamId,
      ...(query.status && { status: { in: query.status } }),
      ...(query.severity && { severity: { in: query.severity } }),
      ...(query.assignedToId && { assignedToId: query.assignedToId }),
      ...(query.search && {
        OR: [
          { title: { contains: query.search, mode: 'insensitive' as const } },
          { description: { contains: query.search, mode: 'insensitive' as const } },
        ],
      }),
    }

    const [incidents, total] = await Promise.all([
      this.prisma.incident.findMany({
        where,
        include: this.listInclude(),
        orderBy: [{ severity: 'asc' }, { createdAt: 'desc' }],
        take: query.limit ?? 25,
        skip: query.offset ?? 0,
      }),
      this.prisma.incident.count({ where }),
    ])

    const result = { incidents, total, hasMore: total > (query.offset ?? 0) + incidents.length }
    await this.redis.setex(cacheKey, 30, JSON.stringify(result))
    return result
  }

  async findOne(id: string, teamId: string) {
    const incident = await this.prisma.incident.findFirst({
      where: { id, teamId },
      include: this.defaultInclude(),
    })
    if (!incident) throw new NotFoundException('Incident not found')
    return incident
  }

  async update(id: string, dto: UpdateIncidentDto, userId: string, teamId: string) {
    const incident = await this.findOne(id, teamId)
    const previousStatus = incident.status

    const updated = await this.prisma.incident.update({
      where: { id },
      data: {
        ...(dto.title && { title: dto.title }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...(dto.severity && { severity: dto.severity }),
        ...(dto.status && { status: dto.status }),
        ...(dto.assignedToId !== undefined && { assignedToId: dto.assignedToId }),
      },
      include: this.defaultInclude(),
    })

    const timelineEntries: Array<{ type: TimelineEntryType; content: string; userId: string }> = []

    if (dto.status && dto.status !== previousStatus) {
      timelineEntries.push({
        type: TimelineEntryType.STATUS_CHANGE,
        userId,
        content: `Status changed from ${previousStatus} to ${dto.status}`,
      })
    }

    if (dto.assignedToId && dto.assignedToId !== incident.assignedToId) {
      timelineEntries.push({
        type: TimelineEntryType.ASSIGNMENT,
        userId,
        content: `Incident reassigned`,
      })
    }

    if (timelineEntries.length > 0) {
      await this.prisma.timelineEntry.createMany({
        data: timelineEntries.map((e) => ({ ...e, incidentId: id })),
      })
    }

    await this.kafka.publish('incident.updated', {
      incidentId: id,
      teamId,
      changes: dto,
      updatedById: userId,
    })

    await this.invalidateTeamFeedCache(teamId)

    return updated
  }

  async resolve(id: string, userId: string, teamId: string) {
    await this.findOne(id, teamId)

    const resolved = await this.prisma.incident.update({
      where: { id },
      data: {
        status: IncidentStatus.RESOLVED,
        resolvedAt: new Date(),
        timeline: {
          create: {
            type: TimelineEntryType.STATUS_CHANGE,
            userId,
            content: 'Incident resolved',
          },
        },
      },
      include: this.defaultInclude(),
    })

    await this.kafka.publish('incident.resolved', {
      incidentId: id,
      teamId,
      resolvedById: userId,
      resolvedAt: resolved.resolvedAt,
    })

    await this.invalidateTeamFeedCache(teamId)

    return resolved
  }

  async escalate(id: string, reason: string, escalatedTo: string, userId: string, teamId: string) {
    await this.findOne(id, teamId)

    const [, escalation] = await this.prisma.$transaction([
      this.prisma.incident.update({
        where: { id },
        data: {
          severity: this.escalateSeverity,
          timeline: {
            create: {
              type: TimelineEntryType.ESCALATION,
              userId,
              content: `Escalated: ${reason}`,
            },
          },
        },
      }),
      this.prisma.escalation.create({
        data: { incidentId: id, reason, escalatedTo },
      }),
    ])

    await this.kafka.publish('incident.escalated', { incidentId: id, teamId, reason, escalatedTo })

    return escalation
  }

  private escalateSeverity(incident: { severity: Severity }): Severity {
    const levels: Severity[] = [Severity.SEV4, Severity.SEV3, Severity.SEV2, Severity.SEV1]
    const current = levels.indexOf(incident.severity)
    return current > 0 ? levels[current - 1] : Severity.SEV1
  }

  private async invalidateTeamFeedCache(teamId: string) {
    const keys = await this.redis.keys(`incidents:${teamId}:*`)
    if (keys.length > 0) await this.redis.del(...keys)
  }

  private defaultInclude() {
    return {
      createdBy: { select: { id: true, displayName: true, avatarUrl: true } },
      assignedTo: { select: { id: true, displayName: true, avatarUrl: true } },
      team: { select: { id: true, name: true, slug: true } },
      services: { include: { service: true } },
      labels: { include: { label: true } },
      timeline: {
        orderBy: { createdAt: 'asc' as const },
        include: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      },
      escalations: true,
      _count: { select: { comments: true, logUploads: true, aiAnalyses: true } },
    }
  }

  private listInclude() {
    return {
      createdBy: { select: { id: true, displayName: true, avatarUrl: true } },
      assignedTo: { select: { id: true, displayName: true, avatarUrl: true } },
      services: { include: { service: { select: { id: true, name: true, status: true } } } },
      labels: { include: { label: true } },
      _count: { select: { comments: true } },
    }
  }
}
