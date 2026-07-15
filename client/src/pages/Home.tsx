import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { DashboardData, NextMove, MoveType } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { DashboardSkeleton } from '@/components/Skeleton'
import {
  Phone, Clock3, PhoneCall, Target, Snowflake, ArrowRight, UserPlus,
  CheckCircle2, BookOpen, Radar, Lightbulb, Trophy, Plus, Zap,
} from 'lucide-react'

const META: Record<MoveType, { title: string; blurb: string; icon: any; verb: string }> = {
  waiting: { title: 'Waiting on you', blurb: 'You promised this — deliver it before you lose momentum.', icon: Clock3, verb: 'You owe' },
  follow_up: { title: 'Follow up', blurb: 'They were deciding — nudge them before it goes quiet.', icon: PhoneCall, verb: 'They said' },
  ready: { title: 'Ready to close', blurb: 'Objections handled. Ask for the business.', icon: Target, verb: 'Close it' },
  cold: { title: 'Going cold', blurb: 'No contact in a while — re-open the pain.', icon: Snowflake, verb: 'Re-open' },
  motion: { title: 'In motion', blurb: 'Keep the conversation moving.', icon: ArrowRight, verb: 'Next' },
  first: { title: 'New — never called', blurb: 'Get their pain on record.', icon: UserPlus, verb: 'First call' },
}
const ORDER: MoveType[] = ['waiting', 'follow_up', 'ready', 'cold', 'motion', 'first']

const dayChip = (days: number | null) => {
  if (days == null) return { text: 'not called yet', cls: 'bg-secondary text-muted-foreground' }
  const text = days === 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`
  const cls = days >= 7 ? 'bg-destructive/10 text-destructive' : days >= 4 ? 'bg-amber-500/10 text-amber-700' : 'bg-secondary text-muted-foreground'
  return { text, cls }
}

export default function Home() {
  const [d, setD] = useState<DashboardData | null>(null)
  const navigate = useNavigate()
  useEffect(() => { api<DashboardData>('/api/dashboard').then(setD) }, [])

  const grouped = useMemo(() => {
    const g: Record<MoveType, NextMove[]> = { waiting: [], follow_up: [], ready: [], cold: [], motion: [], first: [] }
    const focusId = d?.focus?.id
    for (const m of d?.moves || []) if (m.id !== focusId) g[m.type].push(m)
    return g
  }, [d])

  if (!d) return <DashboardSkeleton />

  return (
    <div className="mx-auto max-w-[1180px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Next moves</h2>
          <p className="text-sm text-muted-foreground">Who to call, what to say, and where your playbook needs work.</p>
        </div>
        <Button onClick={() => navigate('/new')}><Phone className="h-4 w-4" /> New Call</Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* MAIN */}
        <div className="min-w-0 space-y-6">
          {d?.focus && <FocusHero m={d.focus} onCall={() => navigate(`/new?client=${d.focus!.id}`)} onBrief={() => navigate(`/clients/${d.focus!.id}`)} />}

          {d && d.moves.length === 0 && (
            <div className="rounded-xl border border-dashed border-border bg-card px-6 py-14 text-center">
              <CheckCircle2 className="mx-auto mb-3 h-6 w-6 text-success" />
              <div className="font-medium">You're all caught up</div>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">No open deals need a move right now. Start a call and your follow-ups will show up here.</p>
              <Button className="mt-4" onClick={() => navigate('/new')}>Start a call</Button>
            </div>
          )}

          {ORDER.map((t) => {
            const rows = grouped[t]
            if (!rows.length) return null
            const meta = META[t]
            const Icon = meta.icon
            return (
              <section key={t}>
                <div className="mb-1 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold">{meta.title}</h3>
                  <span className="text-xs text-muted-foreground">{rows.length}</span>
                </div>
                <p className="mb-3 text-xs text-muted-foreground">{meta.blurb}</p>
                <div className="flex flex-col gap-2">
                  {rows.map((m) => <MoveRow key={m.id} m={m} onCall={() => navigate(`/new?client=${m.id}`)} />)}
                </div>
              </section>
            )
          })}
        </div>

        {/* RIGHT RAIL */}
        <div className="space-y-5">
          <RailCard title="Quick actions" icon={Zap}>
            <div className="flex flex-col gap-2">
              <Button variant="outline" className="justify-start" onClick={() => navigate('/new')}><Phone className="h-4 w-4" /> Start a call</Button>
              <Button variant="outline" className="justify-start" onClick={() => navigate('/clients')}><UserPlus className="h-4 w-4" /> Clients</Button>
              <Button variant="outline" className="justify-start" onClick={() => navigate('/playbooks/new')}><Plus className="h-4 w-4" /> New playbook</Button>
            </div>
          </RailCard>

          <RailCard title="Playbook cues" icon={BookOpen}
            action={d?.cues && <Link to={`/playbooks/${d.cues.playbookId}`} className="ml-auto text-xs text-primary hover:underline">Edit</Link>}>
            {d?.cues?.objections.length ? (
              <>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">{d.cues.playbookName}</div>
                <div className="space-y-2.5">
                  {d.cues.objections.map((c, i) => (
                    <div key={i} className="rounded-lg bg-secondary/60 p-2.5">
                      <div className="text-[12.5px] font-medium">“{c.objection}”</div>
                      {c.say && <div className="mt-0.5 text-[12.5px] leading-snug text-foreground/80">{c.say}</div>}
                    </div>
                  ))}
                </div>
              </>
            ) : <Empty text="No playbook cues yet — build a playbook to see your objection lines here." />}
          </RailCard>

          <RailCard title="Objection radar" icon={Radar}>
            {d?.radar.length ? (
              <div className="space-y-2">
                {d.radar.map((r, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">{r.objection}</span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{r.count}</span>
                  </div>
                ))}
              </div>
            ) : <Empty text="No open objections across your deals. Nice." />}
          </RailCard>

          <RailCard title="Sharpen your playbook" icon={Lightbulb}>
            {d?.gaps.length ? (
              <div className="space-y-2.5">
                <p className="text-[12px] text-muted-foreground">Prospects raised these — your playbook has no answer yet.</p>
                {d.gaps.map((g, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px]">“{g.objection}”</span>
                    <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-700">{g.count}×</span>
                  </div>
                ))}
                <Button variant="outline" size="sm" className="mt-1 w-full" onClick={() => navigate(d.cues ? `/playbooks/${d.cues.playbookId}` : '/playbooks')}>Add answers</Button>
              </div>
            ) : <Empty text="Your playbook covers every objection that's come up. Sharp." />}
          </RailCard>

          <RailCard title="Recent wins" icon={Trophy}>
            {d?.wins.length ? (
              <div className="space-y-1.5">
                {d.wins.map((w) => (
                  <Link key={w.id} to={`/clients/${w.id}`} className="flex items-center gap-2 rounded-md px-1 py-1 text-[13px] hover:bg-secondary">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                    <span className="font-medium">{w.name}</span>
                    {w.company && <span className="truncate text-xs text-muted-foreground">{w.company}</span>}
                  </Link>
                ))}
              </div>
            ) : <Empty text="Close one and it lands here." />}
          </RailCard>
        </div>
      </div>
    </div>
  )
}

function FocusHero({ m, onCall, onBrief }: { m: NextMove; onCall: () => void; onBrief: () => void }) {
  const meta = META[m.type]
  const chip = dayChip(m.days)
  return (
    <div className="rounded-2xl border border-primary/25 bg-gradient-to-br from-primary/[0.06] to-transparent p-5 shadow-sm">
      <div className="mb-2 flex items-center gap-2">
        <Target className="h-4 w-4 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-wide text-primary">Focus now</span>
        <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>
      </div>
      <div className="text-lg font-bold leading-tight">{m.name}</div>
      {m.company && <div className="text-sm text-muted-foreground">{m.company}</div>}
      <div className="mt-3 text-[15px] leading-snug"><span className="text-muted-foreground">{meta.verb}: </span>{m.action}</div>
      {m.howToClose && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-card p-3 text-[13px] leading-snug text-foreground/85">
          <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {m.howToClose}
        </div>
      )}
      <div className="mt-4 flex gap-2">
        <Button onClick={onCall}><Phone className="h-4 w-4" /> Call {m.name.split(' ')[0]}</Button>
        <Button variant="outline" onClick={onBrief}>Open brief</Button>
      </div>
    </div>
  )
}

function MoveRow({ m, onCall }: { m: NextMove; onCall: () => void }) {
  const meta = META[m.type]
  const chip = dayChip(m.days)
  return (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 shadow-sm transition-colors hover:border-primary/40">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/clients/${m.id}`} className="font-semibold leading-tight hover:underline">{m.name}</Link>
          {m.company && <span className="truncate text-xs text-muted-foreground">{m.company}</span>}
          <span className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}>{chip.text}</span>
        </div>
        <div className="mt-1 text-sm leading-snug"><span className="text-muted-foreground">{meta.verb}: </span>{m.action}</div>
      </div>
      <Button size="sm" onClick={onCall}><Phone className="h-3.5 w-3.5" /> Call</Button>
    </div>
  )
}

function RailCard({ title, icon: Icon, action, children }: { title: string; icon: any; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <Icon className="h-4 w-4 text-primary" />
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <p className="text-[13px] text-muted-foreground">{text}</p>
}
