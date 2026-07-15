import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Metrics as MetricsData } from '@/lib/types'
import { DashboardSkeleton } from '@/components/Skeleton'
import { ThumbsUp, Trophy, Target, CalendarDays } from 'lucide-react'

const pct = (n: number | null) => (n == null ? '—' : `${n}%`)

export default function Metrics() {
  const [m, setM] = useState<MetricsData | null>(null)
  useEffect(() => { api<MetricsData>('/api/metrics').then(setM) }, [])

  if (!m) return <DashboardSkeleton />

  const maxCalls = Math.max(1, ...m.last14.map((d) => d.calls))
  const tiles = [
    { label: 'Line-acceptance', value: pct(m.lineAcceptancePct), sub: `${m.linesRated} lines rated`, icon: ThumbsUp },
    { label: 'Deals saved', value: String(m.savedDeals), sub: 'flagged by you post-call', icon: Trophy },
    { label: 'Close rate', value: pct(m.closeRatePct), sub: `${m.decidedCalls} calls with an outcome`, icon: Target },
    { label: 'Active days', value: String(m.activeDays), sub: `${m.totalCalls} calls total`, icon: CalendarDays },
  ]

  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <h2 className="text-xl font-bold tracking-tight">Your metrics</h2>
      <p className="mt-1 text-sm text-muted-foreground">Your own track record with the copilot — this is what proves it works.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-card p-4">
            <t.icon className="mb-2 h-4 w-4 text-primary" />
            <div className="text-2xl font-extrabold tracking-tight">{t.value}</div>
            <div className="mt-0.5 text-xs font-medium text-muted-foreground">{t.label}</div>
            <div className="mt-1 text-[11px] text-muted-foreground/70">{t.sub}</div>
          </div>
        ))}
      </div>

      <h3 className="mb-3 mt-8 text-sm font-semibold">Calls per day, last 14 days</h3>
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex h-32 items-end gap-2">
          {m.last14.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div
                className="w-full rounded-t-sm bg-primary/70"
                style={{ height: `${Math.max(4, (d.calls / maxCalls) * 100)}%` }}
                title={`${d.day}: ${d.calls} call${d.calls === 1 ? '' : 's'}`}
              />
              <span className="text-[9px] text-muted-foreground">{d.day.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
