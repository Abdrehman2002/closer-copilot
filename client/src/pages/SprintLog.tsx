import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { fmtDate, fmtDur } from '@/lib/format'
import { ListSkeleton } from '@/components/Skeleton'
import { PhoneForwarded, PhoneOff, MessageSquare, CalendarCheck } from 'lucide-react'

type Dial = {
  id: string; created_at: string; sprintId: string | null; dial: number | null
  stage: 'no_answer' | 'contact' | 'booked'
  prospectTurns: number; cards: number; duration_sec: number; product_name: string
  summary: string; client: string | null; company: string | null
}
type Tally = { dials: number; contacts: number; booked: number; talkSec: number }
type Session = Tally & { id: string; startedAt: string; endedAt: string; dials_list: Dial[] }
type Day = Tally & { day: string; sessions: Session[] }

const STAGE: Record<Dial['stage'], { label: string; cls: string; Icon: typeof PhoneOff }> = {
  no_answer: { label: 'No answer', cls: 'bg-muted text-muted-foreground', Icon: PhoneOff },
  contact:   { label: 'Spoke',     cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300', Icon: MessageSquare },
  booked:    { label: 'Booked',    cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300', Icon: CalendarCheck },
}

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0)

export default function SprintLog() {
  const [data, setData] = useState<{ total: Tally; days: Day[] } | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => { api<{ total: Tally; days: Day[] }>('/api/sprint/log').then(setData).catch(() => setData({ total: { dials: 0, contacts: 0, booked: 0, talkSec: 0 }, days: [] })) }, [])

  if (!data) return <div className="mx-auto max-w-[1000px] px-8 py-7"><ListSkeleton /></div>

  const t = data.total
  return (
    <div className="mx-auto max-w-[1000px] px-8 py-7">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-bold tracking-tight">
        <PhoneForwarded className="h-5 w-5" /> Cold call log
      </h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Every dial from every sprint, with the transcript. Grouped by day, then by session.
      </p>

      {/* Only three numbers, because only three are honestly measurable from a transcript.
          Nothing in the audio says who is speaking, so there is no "got past the gatekeeper"
          count here — a metric you cannot measure is worse than one you do not show. */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Dials" value={String(t.dials)} />
        <Stat label="Reached someone" value={String(t.contacts)} sub={pct(t.contacts, t.dials) + '% of dials'} />
        <Stat label="Appointments" value={String(t.booked)} sub={pct(t.booked, t.dials) + '% of dials'} />
        <Stat label="Time on calls" value={fmtDur(t.talkSec)} />
      </div>

      {data.days.length === 0 && (
        <div className="rounded-xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
          No cold calls logged yet. Start a sprint from the dashboard and every dial lands here.
        </div>
      )}

      {data.days.map((d) => (
        <div key={d.day} className="mb-5 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-secondary/40 px-5 py-3">
            <span className="font-semibold">{fmtDate(d.day)}</span>
            <span className="text-xs text-muted-foreground">
              <b>{d.dials}</b> dials · <b>{d.contacts}</b> reached · <b>{d.booked}</b> booked · {fmtDur(d.talkSec)} talking
            </span>
            <span className="ml-auto text-xs text-muted-foreground">{d.sessions.length} session{d.sessions.length === 1 ? '' : 's'}</span>
          </div>

          {d.sessions.map((s) => {
            const key = d.day + s.id
            const isOpen = open[key] !== false   // sessions start expanded; the log is the point
            return (
              <div key={key}>
                <button
                  onClick={() => setOpen((o) => ({ ...o, [key]: !isOpen }))}
                  className="flex w-full items-center gap-3 px-5 py-2.5 text-left text-xs text-muted-foreground hover:bg-secondary">
                  <span className="font-medium text-foreground">Sprint · {s.dials} dials</span>
                  <span>{s.booked} booked · {fmtDur(s.talkSec)}</span>
                  <span className="ml-auto">{isOpen ? 'hide' : 'show'}</span>
                </button>

                {isOpen && s.dials_list.map((dial) => {
                  const st = STAGE[dial.stage] || STAGE.contact
                  return (
                    <Link key={dial.id} to={`/calls/${dial.id}`}
                      className="flex items-center gap-3 border-t border-border px-5 py-3 transition-colors hover:bg-secondary">
                      <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">#{dial.dial ?? '—'}</span>
                      <span className={`inline-flex shrink-0 items-center gap-1 rounded px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                        <st.Icon className="h-3 w-3" /> {st.label}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {dial.client ? <b>{dial.client}{dial.company ? ` · ${dial.company}` : ''}</b> : <span className="text-muted-foreground">{dial.summary}</span>}
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {fmtDur(dial.duration_sec)} · {dial.cards} card{dial.cards === 1 ? '' : 's'} · {dial.product_name || '—'}
                        </div>
                      </div>
                      <span className="shrink-0 text-xs text-primary">transcript →</span>
                    </Link>
                  )
                })}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  )
}
