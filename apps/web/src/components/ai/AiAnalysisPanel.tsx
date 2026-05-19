// apps/web/src/components/ai/AiAnalysisPanel.tsx

'use client'

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, AlertTriangle, ChevronDown, ChevronRight, Loader2, RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { api } from '@/lib/api/client'
import type { AiAnalysisResult } from '@/types/ai'
import { cn } from '@/lib/utils'

interface Props {
  incidentId: string
}

export function AiAnalysisPanel({ incidentId }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    summary: true,
    rootCauses: true,
    immediateActions: false,
    patterns: false,
  })
  const queryClient = useQueryClient()

  const { data: analysis, isLoading } = useQuery({
    queryKey: ['ai-analysis', incidentId],
    queryFn: () => api.get<AiAnalysisResult>(`/incidents/${incidentId}/ai/analysis`),
    staleTime: 1000 * 60 * 5,
  })

  const { mutate: runAnalysis, isPending: analyzing } = useMutation({
    mutationFn: () => api.post(`/incidents/${incidentId}/ai/analyze`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai-analysis', incidentId] })
    },
  })

  const toggle = (key: string) => setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))

  if (isLoading) {
    return (
      <Card className="border-border/50 bg-card">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <CardTitle className="text-sm font-medium">AI Analysis</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <div className="h-3 w-full animate-pulse rounded bg-muted" />
            <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
            <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border/50 bg-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <CardTitle className="text-sm font-medium">AI Analysis</CardTitle>
            {analysis && (
              <ConfidenceBadge confidence={analysis.confidence} />
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => runAnalysis()}
            disabled={analyzing}
          >
            {analyzing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RefreshCw className="h-3 w-3" />
            )}
            {analyzing ? 'Analyzing...' : 'Re-run'}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3 pt-0">
        <AnimatePresence mode="wait">
          {!analysis ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-6"
            >
              <Sparkles className="mx-auto h-8 w-8 text-muted-foreground/30 mb-2" />
              <p className="text-xs text-muted-foreground">
                Upload logs or run analysis to get AI-powered root cause suggestions.
              </p>
              <Button
                size="sm"
                variant="outline"
                className="mt-3 h-7 text-xs"
                onClick={() => runAnalysis()}
                disabled={analyzing}
              >
                {analyzing ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Run Analysis
              </Button>
            </motion.div>
          ) : (
            <motion.div
              key="results"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="space-y-2"
            >
              <Section
                label="Summary"
                open={expanded.summary}
                onToggle={() => toggle('summary')}
              >
                <p className="text-xs text-muted-foreground leading-relaxed">{analysis.summary}</p>
              </Section>

              <Section
                label="Root Causes"
                open={expanded.rootCauses}
                onToggle={() => toggle('rootCauses')}
              >
                <ul className="space-y-1.5">
                  {analysis.rootCauses.map((cause, i) => (
                    <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                      <span className="mt-0.5 flex-shrink-0 h-1.5 w-1.5 rounded-full bg-red-400" />
                      {cause}
                    </li>
                  ))}
                </ul>
              </Section>

              {analysis.immediateActions?.length > 0 && (
                <Section
                  label="Immediate Actions"
                  open={expanded.immediateActions}
                  onToggle={() => toggle('immediateActions')}
                  accent="amber"
                >
                  <ol className="space-y-1.5 list-none">
                    {analysis.immediateActions.map((action, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                        <span className="flex-shrink-0 mt-0.5 font-mono text-amber-400 text-[10px]">
                          {String(i + 1).padStart(2, '0')}
                        </span>
                        {action}
                      </li>
                    ))}
                  </ol>
                </Section>
              )}

              {analysis.suspiciousPatterns?.length > 0 && (
                <Section
                  label="Suspicious Patterns"
                  open={expanded.patterns}
                  onToggle={() => toggle('patterns')}
                >
                  <div className="flex flex-wrap gap-1.5">
                    {analysis.suspiciousPatterns.map((p, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center gap-1 rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[10px] font-mono text-red-400"
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {p}
                      </span>
                    ))}
                  </div>
                </Section>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  )
}

function Section({
  label,
  open,
  onToggle,
  accent,
  children,
}: {
  label: string
  open: boolean
  onToggle: () => void
  accent?: string
  children: React.ReactNode
}) {
  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="flex w-full items-center gap-1.5 rounded-sm px-0 py-1 text-left hover:bg-muted/50 transition-colors">
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
        <span
          className={cn(
            'text-xs font-medium',
            accent === 'amber' ? 'text-amber-400' : 'text-foreground',
          )}
        >
          {label}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-4 mt-1.5 pb-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function ConfidenceBadge({ confidence }: { confidence: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  return (
    <Badge
      variant="outline"
      className={cn('h-4 px-1.5 text-[10px] font-medium', {
        'border-green-500/30 text-green-400': confidence === 'HIGH',
        'border-amber-500/30 text-amber-400': confidence === 'MEDIUM',
        'border-red-500/30 text-red-400': confidence === 'LOW',
      })}
    >
      {confidence}
    </Badge>
  )
}
