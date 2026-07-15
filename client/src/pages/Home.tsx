import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { PipelineDeal, Warmth } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Phone, AlertCircle, Target } from 'lucide-react'

const relTime = (iso: string | null) => {
  if (!iso) return 'not called yet'
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days}d ago`
}

const columns: { warmth: Warmth; title: string; sub: string; dot: string }[] = [
  { warmth: 'hot', title: 'Ready to close', sub: 'Push for the ask this call', dot: 'bg-success' },
  { warmth: 'warming', title: 'Warming up', sub: 'Build value, handle the objection', dot: 'bg-primary' },
  { warmth: 'cold', title: 'Needs a nudge', sub: 'Re-open the pain, earn the next call', dot: 'bg-muted-foreground/50' },
]

export default function Home() {
  const [deals, setDeals] = useState<PipelineDeal[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => { api<{ deals: PipelineDeal[] }>('/api/pipeline').then((r) => setDeals(r.deals || [])) }, [])

  const grouped = useMemo(() => {
    const g: Record<Warmth, PipelineDeal[]> = { hot: [], warming: [], cold: [] }
    for (const d of deals || []) g[d.warmth].push(d)
    return g
  }, [deals])

  const isEmpty = deals && deals.length === 0

  return (
    <div className="mx-auto max-w-[1200px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Your close board</h2>
          <p className="text-sm text-muted-foreground">Who's ready, what's blocking them, and the next move — sorted by how close they are.</p>
        </div>
        <Button onClick={() => navigate('/new')}><Phone className="h-4 w-4" /> New Call</Button>
      </div>

      {!deals && <div className="text-sm text-muted-foreground">Loading your pipeline…</div>}

      {isEmpty && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <Target className="mx-auto mb-3 h-6 w-6 text-muted-foreground" />
          <div className="font-medium">No open deals yet</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Start a call and pick a client — every deal you work shows up here, sorted by how close it is to a yes.</p>
          <Button className="mt-4" onClick={() => navigate('/new')}>Start your first call</Button>
        </div>
      )}

      {deals && deals.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-3">
          {columns.map((col) => (
            <div key={col.warmth} className="flex flex-col">
              <div className="mb-3 flex items-center gap-2">
                <span className={`h-2.5 w-2.5 rounded-full ${col.dot}`} />
                <h3 className="text-sm font-semibold">{col.title}</h3>
                <span className="text-xs text-muted-foreground">{grouped[col.warmth].length}</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{col.sub}</p>
              <div className="flex flex-col gap-3">
                {grouped[col.warmth].length === 0 && (
                  <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">Nobody here right now.</div>
                )}
                {grouped[col.warmth].map((d) => (
                  <DealCard key={d.id} d={d} onCall={() => navigate(`/new?client=${d.id}`)} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DealCard({ d, onCall }: { d: PipelineDeal; onCall: () => void }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <Link to={`/clients/${d.id}`} className="font-semibold leading-tight hover:underline">{d.name}</Link>
          {d.company && <div className="truncate text-xs text-muted-foreground">{d.company}</div>}
        </div>
        <span className="shrink-0 text-[11px] text-muted-foreground">{d.calls} call{d.calls === 1 ? '' : 's'}</span>
      </div>

      {d.nextStep ? (
        <div className="mt-3 text-sm leading-snug"><span className="text-muted-foreground">Next: </span>{d.nextStep}</div>
      ) : (
        <div className="mt-3 text-sm text-muted-foreground">First call — get their pain on record.</div>
      )}

      {d.howToClose && (
        <div className="mt-2 flex items-start gap-1.5 rounded-md bg-secondary px-2.5 py-2 text-[13px] leading-snug text-foreground/90">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {d.howToClose}
        </div>
      )}

      {d.openObjections.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            <AlertCircle className="h-3 w-3" /> Open objections
          </div>
          <div className="flex flex-wrap gap-1.5">
            {d.openObjections.map((o, i) => (
              <span key={i} className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700">{o}</span>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
        <span className="text-xs text-muted-foreground">Last: {relTime(d.lastCallAt)}</span>
        <Button size="sm" onClick={onCall}><Phone className="h-3.5 w-3.5" /> Call</Button>
      </div>
    </div>
  )
}
