import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Brain } from '@/components/Brain'
import { PageSkeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import {
  CalendarClock, Plus, Video, Bot, Sparkles, FileText, Trash2, RefreshCw,
  CheckCircle2, Circle, Phone, AlertTriangle,
} from 'lucide-react'

const STATUS: Record<string, { label: string; tint: string }> = {
  scheduled:  { label: 'Scheduled',  tint: 'bg-secondary text-muted-foreground' },
  joining:    { label: 'Joining',    tint: 'bg-amber-500/15 text-amber-600' },
  recording:  { label: 'Recording',  tint: 'bg-destructive/15 text-destructive' },
  processing: { label: 'Processing', tint: 'bg-amber-500/15 text-amber-600' },
  done:       { label: 'Notes ready',tint: 'bg-emerald-500/15 text-emerald-600' },
  failed:     { label: 'Failed',     tint: 'bg-destructive/15 text-destructive' },
  cancelled:  { label: 'Cancelled',  tint: 'bg-secondary text-muted-foreground' },
}

const when = (iso?: string | null) => {
  if (!iso) return 'No time set'
  const d = new Date(iso), now = Date.now()
  const mins = Math.round((d.getTime() - now) / 60000)
  const stamp = d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  if (mins > 0 && mins < 60) return `${stamp} · in ${mins}m`
  if (mins < 0 && mins > -180) return `${stamp} · ${-mins}m ago`
  return stamp
}

export default function Meetings() {
  const [data, setData] = useState<{ meetings: any[]; botMode: string } | null>(null)
  const [clients, setClients] = useState<any[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [busy, setBusy] = useState('')
  const navigate = useNavigate()

  // new meeting form
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [startsAt, setStartsAt] = useState('')
  const [dealId, setDealId] = useState('')
  const [autoJoin, setAutoJoin] = useState(false)

  const load = useCallback(() => api<{ meetings: any[]; botMode: string }>('/api/meetings').then(setData), [])
  useEffect(() => {
    load()
    api<{ clients: any[] }>('/api/clients').then((r) => setClients(r.clients || [])).catch(() => {})
  }, [load])

  if (!data) return <PageSkeleton />
  const manual = data.botMode === 'manual'

  const create = async () => {
    if (!title.trim() && !url.trim()) return
    setBusy('create')
    try {
      await api('/api/meetings', {
        title: title.trim() || 'Untitled meeting', meeting_url: url.trim(),
        starts_at: startsAt ? new Date(startsAt).toISOString() : null,
        dealId: dealId || null, auto_join: autoJoin,
      })
      setTitle(''); setUrl(''); setStartsAt(''); setDealId(''); setAutoJoin(false)
      load()
    } finally { setBusy('') }
  }

  const act = async (id: string, what: string, path: string) => {
    setBusy(id + what)
    try { const r = await api<any>(`/api/meetings/${id}/${path}`, {}); if (r.error) alert(r.error); load() }
    finally { setBusy('') }
  }
  const del = async (id: string) => {
    if (!confirm('Delete this meeting and its notes?')) return
    await api(`/api/meetings/${id}`, undefined, 'DELETE'); load()
  }

  const upcoming = data.meetings.filter((m) => !['done', 'cancelled', 'failed'].includes(m.status))
  const past = data.meetings.filter((m) => ['done', 'cancelled', 'failed'].includes(m.status))

  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <h2 className="text-xl font-bold tracking-tight">Meetings</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Schedule a call and the copilot writes your prep brief, then turns the conversation into notes and action items.
      </p>

      {manual && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 p-3.5 text-[13px]">
          <Bot className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <b className="text-amber-700 dark:text-amber-400">Auto-join isn't switched on.</b> A bot that joins Meet/Zoom for you
            needs a meeting-bot provider — set <code className="rounded bg-secondary px-1">RECALL_API_KEY</code> in <code>.env</code> and restart.
            Everything else works now: prep briefs, and notes generated from a call you run yourself with <b>Start Call</b>.
          </div>
        </div>
      )}

      {/* schedule */}
      <div className="mt-5 rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold"><Plus className="h-4 w-4" /> Schedule a meeting</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Discovery call — Acme" />
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste Meet / Zoom / Teams link" />
          <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          <select className="h-10 rounded-md border border-input bg-card px-3 text-sm" value={dealId} onChange={(e) => setDealId(e.target.value)}>
            <option value="">Link to a client… (enables prep brief)</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''}</option>)}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className={cn('flex items-center gap-2 text-sm', manual && 'opacity-50')}>
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={autoJoin} disabled={manual}
              onChange={(e) => setAutoJoin(e.target.checked)} />
            Send a notetaker bot automatically
          </label>
          <Button size="sm" className="ml-auto" onClick={create} disabled={busy === 'create' || (!title.trim() && !url.trim())}>
            {busy === 'create' ? 'Adding…' : 'Add meeting'}
          </Button>
        </div>
      </div>

      <Section title={`Upcoming (${upcoming.length})`} empty="Nothing scheduled." items={upcoming}
        {...{ open, setOpen, act, del, busy, manual, navigate }} />
      <Section title={`Past (${past.length})`} empty="No past meetings yet." items={past}
        {...{ open, setOpen, act, del, busy, manual, navigate }} />
    </div>
  )
}

function Section({ title, empty, items, open, setOpen, act, del, busy, manual, navigate }: any) {
  if (!items.length) return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
        <CalendarClock className="mx-auto mb-2 h-6 w-6 opacity-40" />{empty}
      </div>
    </div>
  )
  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {items.map((m: any, i: number) => {
          const st = STATUS[m.status] || STATUS.scheduled
          const isOpen = open === m.id
          return (
            <div key={m.id} className={i > 0 ? 'border-t border-border' : ''}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <button className="min-w-0 flex-1 text-left" onClick={() => setOpen(isOpen ? null : m.id)}>
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{m.title}</span>
                    <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', st.tint)}>{st.label}</span>
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {when(m.starts_at)}{m.deals?.name ? ` · ${m.deals.name}` : ''}{m.platform !== 'other' ? ` · ${m.platform}` : ''}
                  </div>
                </button>
                {m.meeting_url && (
                  <a href={m.meeting_url} target="_blank" rel="noreferrer"
                    className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary" title="Open meeting link">
                    <Video className="h-4 w-4" />
                  </a>
                )}
                <Button size="sm" variant="outline" onClick={() => navigate(`/new?client=${m.deal_id || ''}${m.product_id ? `&product=${m.product_id}` : ''}`)} title="Run this call with the live coach">
                  <Phone className="h-3.5 w-3.5" /> Start
                </Button>
                <button onClick={() => del(m.id)} className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              {isOpen && (
                <div className="border-t border-border bg-secondary/30 p-4">
                  <div className="mb-3 flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy === m.id + 'prep'} onClick={() => act(m.id, 'prep', 'prep')}>
                      <Sparkles className="h-3.5 w-3.5" /> {m.prep ? 'Regenerate prep' : 'Write prep brief'}
                    </Button>
                    {!manual && m.meeting_url && (
                      <Button size="sm" variant="outline" disabled={busy === m.id + 'join'} onClick={() => act(m.id, 'join', 'join')}>
                        <Bot className="h-3.5 w-3.5" /> Send bot now
                      </Button>
                    )}
                    {m.bot_id && (
                      <Button size="sm" variant="ghost" disabled={busy === m.id + 'sync'} onClick={() => act(m.id, 'sync', 'sync')}>
                        <RefreshCw className="h-3.5 w-3.5" /> Refresh status
                      </Button>
                    )}
                    {(m.transcript?.length > 0) && (
                      <Button size="sm" variant="outline" disabled={busy === m.id + 'notes'} onClick={() => act(m.id, 'notes', 'notes')}>
                        <FileText className="h-3.5 w-3.5" /> {m.summary ? 'Rewrite notes' : 'Generate notes'}
                      </Button>
                    )}
                  </div>

                  {m.error && (
                    <div className="mb-3 flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/5 p-2.5 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" /> {m.error}
                    </div>
                  )}

                  {m.prep && (
                    <div className="mb-3 rounded-lg border border-amber-500/25 bg-amber-500/10 p-3">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Pre-call brief</div>
                      <Brain md={m.prep} />
                    </div>
                  )}

                  {m.summary && (
                    <div className="mb-3 rounded-lg border border-border bg-card p-3">
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Meeting notes</div>
                      <p className="text-sm leading-relaxed">{m.summary}</p>
                    </div>
                  )}

                  {Array.isArray(m.action_items) && m.action_items.length > 0 && (
                    <div className="rounded-lg border border-border bg-card p-3">
                      <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Action items</div>
                      <div className="flex flex-col gap-1.5">
                        {m.action_items.map((a: any, k: number) => (
                          <div key={k} className="flex items-start gap-2 text-sm">
                            {a.who === 'me' ? <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                                            : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                            <span className="min-w-0 flex-1">{a.what}</span>
                            <span className="shrink-0 text-[11px] uppercase text-muted-foreground">{a.who}{a.due ? ` · ${a.due}` : ''}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {!m.prep && !m.summary && (
                    <p className="text-xs text-muted-foreground">
                      Link a client and hit <b>Write prep brief</b>, or run the call with <b>Start</b> and come back for notes.
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
