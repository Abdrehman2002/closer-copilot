import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { NextMove, MoveType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Phone, Clock3, PhoneCall, Target, Snowflake, ArrowRight, UserPlus, CheckCircle2 } from 'lucide-react'

const SECTIONS: { type: MoveType; title: string; blurb: string; icon: any; verb: string }[] = [
  { type: 'waiting', title: 'Waiting on you', blurb: 'You promised this last call — deliver it before you lose momentum.', icon: Clock3, verb: 'You owe' },
  { type: 'follow_up', title: 'Follow up', blurb: 'They were deciding — nudge them before it goes quiet.', icon: PhoneCall, verb: 'They said' },
  { type: 'ready', title: 'Ready to close', blurb: 'Objections handled. Get on and ask for the business.', icon: Target, verb: 'Close it' },
  { type: 'cold', title: 'Going cold', blurb: 'No contact in a while — re-open the pain and earn the next call.', icon: Snowflake, verb: 'Re-open' },
  { type: 'motion', title: 'In motion', blurb: 'Keep the conversation moving.', icon: ArrowRight, verb: 'Next' },
  { type: 'first', title: 'New — never called', blurb: 'Get their situation and pain on record.', icon: UserPlus, verb: 'First call' },
]

const dayChip = (days: number | null) => {
  if (days == null) return { text: 'not called yet', cls: 'bg-secondary text-muted-foreground' }
  const text = days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`
  const cls = days >= 7 ? 'bg-destructive/10 text-destructive' : days >= 4 ? 'bg-amber-500/10 text-amber-700' : 'bg-secondary text-muted-foreground'
  return { text, cls }
}

export default function Home() {
  const [items, setItems] = useState<NextMove[] | null>(null)
  const navigate = useNavigate()
  useEffect(() => { api<{ items: NextMove[] }>('/api/next-moves').then((r) => setItems(r.items || [])) }, [])

  const grouped = useMemo(() => {
    const g: Record<MoveType, NextMove[]> = { waiting: [], follow_up: [], ready: [], cold: [], motion: [], first: [] }
    for (const it of items || []) g[it.type].push(it)
    return g
  }, [items])

  const isEmpty = items && items.length === 0

  return (
    <div className="mx-auto max-w-[840px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Next moves</h2>
          <p className="text-sm text-muted-foreground">Who to call and what to do — ranked by what's most urgent right now.</p>
        </div>
        <Button onClick={() => navigate('/new')}><Phone className="h-4 w-4" /> New Call</Button>
      </div>

      {!items && <div className="text-sm text-muted-foreground">Loading your moves…</div>}

      {isEmpty && (
        <div className="rounded-xl border border-dashed border-border bg-card px-6 py-16 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-6 w-6 text-success" />
          <div className="font-medium">You're all caught up</div>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">No open deals need a move right now. Start a call and your follow-ups will show up here.</p>
          <Button className="mt-4" onClick={() => navigate('/new')}>Start a call</Button>
        </div>
      )}

      <div className="space-y-7">
        {SECTIONS.map((sec) => {
          const rows = grouped[sec.type]
          if (!rows.length) return null
          const Icon = sec.icon
          return (
            <section key={sec.type}>
              <div className="mb-1 flex items-center gap-2">
                <Icon className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold">{sec.title}</h3>
                <span className="text-xs text-muted-foreground">{rows.length}</span>
              </div>
              <p className="mb-3 text-xs text-muted-foreground">{sec.blurb}</p>
              <div className="flex flex-col gap-2">
                {rows.map((it) => {
                  const chip = dayChip(it.days)
                  return (
                    <div key={it.id} className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/40">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <Link to={`/clients/${it.id}`} className="font-semibold leading-tight hover:underline">{it.name}</Link>
                          {it.company && <span className="truncate text-xs text-muted-foreground">{it.company}</span>}
                          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>
                        </div>
                        <div className="mt-1 text-sm leading-snug">
                          <span className="text-muted-foreground">{sec.verb}: </span>{it.action}
                        </div>
                      </div>
                      <Button size="sm" onClick={() => navigate(`/new?client=${it.id}`)}><Phone className="h-3.5 w-3.5" /> Call</Button>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}
      </div>
    </div>
  )
}
