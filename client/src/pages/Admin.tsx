import { useCallback, useEffect, useState } from 'react'
import { api, token } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { PageSkeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import {
  Activity, Users, Gauge, Database, KeyRound, Download, ScrollText, Radio, Building2,
  MousePointerClick, RefreshCw, ShieldCheck, ShieldAlert, Play, Trash2, AlertTriangle, Server,
  Eye, EyeOff, Coins, ToggleLeft, Megaphone, Archive, FileClock, Plus, UserPlus, UserX, Ban,
  Video, Bot, CheckCircle2, Phone,
} from 'lucide-react'

// ---------------------------------------------------------------- helpers
const tok = (n = 0) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n))
const usd = (n = 0) => '$' + (n > 0 && n < 0.01 ? n.toFixed(4) : n.toFixed(2))
const kb = (b = 0) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB')
const ago = (iso?: string | null) => {
  if (!iso) return '—'
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return s + 's ago'
  if (s < 3600) return Math.round(s / 60) + 'm ago'
  if (s < 86400) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}
const dur = (s = 0) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

function Tile({ label, value, sub, tone, icon: Icon }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad'; icon?: any }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}{label}
      </div>
      <div className={cn('mt-1.5 text-[26px] font-bold leading-none tracking-tight',
        tone === 'ok' && 'text-emerald-600', tone === 'warn' && 'text-amber-600', tone === 'bad' && 'text-destructive')}>{value}</div>
      {sub && <div className="mt-1.5 text-xs leading-tight text-muted-foreground">{sub}</div>}
    </div>
  )
}

function Panel({ title, right, children, sub }: { title: string; right?: React.ReactNode; children: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border px-5 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold leading-tight">{title}</div>
          {sub && <div className="text-[11px] leading-tight text-muted-foreground">{sub}</div>}
        </div>
        <div className="ml-auto shrink-0">{right}</div>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// simple bar sparkline — no chart library, scales to whatever it's given
function Spark({ points, height = 44 }: { points: { date: string; count: number }[]; height?: number }) {
  const max = Math.max(1, ...points.map((p) => p.count))
  return (
    <div className="flex items-end gap-[3px]" style={{ height }}>
      {points.map((p) => (
        <div key={p.date} className="group relative flex-1" title={`${p.date}: ${p.count}`}>
          <div className="w-full rounded-t-sm bg-primary/70 transition-colors group-hover:bg-primary"
            style={{ height: Math.max(2, (p.count / max) * height) }} />
        </div>
      ))}
    </div>
  )
}

// two-tone proportion bar (talk ratio, win/loss …)
function Split({ a, b, aLabel, bLabel }: { a: number; b: number; aLabel: string; bLabel: string }) {
  const total = Math.max(1, a + b)
  const pct = Math.round((a / total) * 100)
  return (
    <div>
      <div className="mb-1.5 flex justify-between text-xs">
        <span className="font-medium">{aLabel} {pct}%</span>
        <span className="text-muted-foreground">{bLabel} {100 - pct}%</span>
      </div>
      <div className="flex h-2 overflow-hidden rounded-full bg-secondary">
        <div className="bg-primary" style={{ width: `${pct}%` }} />
        <div className="bg-amber-500" style={{ width: `${100 - pct}%` }} />
      </div>
    </div>
  )
}

function Kv({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className={cn('text-sm font-semibold', tone === 'bad' && 'text-destructive', tone === 'ok' && 'text-emerald-600')}>{v}</div>
    </div>
  )
}

function Bars({ rows, fmt }: { rows: { key: string; n: number; extra?: string }[]; fmt?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.n))
  if (!rows.length) return <div className="py-6 text-center text-xs text-muted-foreground">No data yet.</div>
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-3">
          <span className="w-40 shrink-0 truncate text-xs" title={r.key}>{r.key}</span>
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(r.n / max) * 100}%`, minWidth: 3 }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{(fmt || tok)(r.n)}</span>
          {r.extra && <span className="w-16 shrink-0 text-right text-xs tabular-nums">{r.extra}</span>}
        </div>
      ))}
    </div>
  )
}

type Who = { isAdmin: boolean; schemaReady: boolean; email?: string; userId?: string; role?: string; canWrite?: boolean; canBilling?: boolean; isOwner?: boolean }

const TABS = [
  { id: 'overview', label: 'Overview', icon: Gauge },
  { id: 'live', label: 'Live', icon: Radio },
  { id: 'users', label: 'Accounts', icon: Users },
  { id: 'credits', label: 'Credits', icon: Coins },
  { id: 'orgs', label: 'Organizations', icon: Building2 },
  { id: 'usage', label: 'API & Cost', icon: Activity },
  { id: 'meetings', label: 'Meetings', icon: Video },
  { id: 'telemetry', label: 'Telemetry', icon: MousePointerClick },
  { id: 'logs', label: 'Logs', icon: FileClock },
  { id: 'database', label: 'Database', icon: Database },
  { id: 'keys', label: 'Keys & Health', icon: KeyRound },
  { id: 'backups', label: 'Backups', icon: Archive },
  { id: 'flags', label: 'Flags', icon: ToggleLeft },
  { id: 'audit', label: 'Audit', icon: ScrollText },
] as const
type TabId = typeof TABS[number]['id']

export default function Admin() {
  const [who, setWho] = useState<Who | null>(null)
  const [tab, setTab] = useState<TabId>('overview')

  useEffect(() => { api<Who>('/api/admin/whoami').then(setWho) }, [])
  if (!who) return <PageSkeleton />
  if (!who.schemaReady) return <SchemaMissing />
  if (!who.isAdmin) return <NotAdmin email={who.email} />

  return (
    <div className="mx-auto max-w-[1280px] px-6 py-7 lg:px-8">
      <div className="mb-6 flex flex-wrap items-center gap-2.5">
        <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/10 text-primary">
          <ShieldCheck className="h-[18px] w-[18px]" />
        </div>
        <div>
          <h2 className="text-xl font-bold leading-tight tracking-tight">Admin</h2>
          <div className="text-xs text-muted-foreground">{who.email}</div>
        </div>
        <span className={cn('ml-1 rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide',
          who.role === 'owner' ? 'bg-primary/15 text-primary' : who.role === 'viewer' ? 'bg-secondary text-muted-foreground' : 'bg-emerald-500/15 text-emerald-600')}>
          {who.role}
        </span>
      </div>

      {/* tab bar — scrolls horizontally instead of wrapping into a ragged block */}
      <div className="mb-6 -mx-6 overflow-x-auto border-b border-border px-6 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-0.5">
          {TABS.map((t) => {
            const Icon = t.icon
            return (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={cn('-mb-px flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors',
                  tab === t.id ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground')}>
                <Icon className="h-4 w-4" /> {t.label}
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'meetings' && <MeetingsAdmin />}
      {tab === 'overview' && <Overview />}
      {tab === 'live' && <Live />}
      {tab === 'users' && <Accounts who={who} />}
      {tab === 'credits' && <Credits who={who} />}
      {tab === 'orgs' && <Orgs who={who} />}
      {tab === 'usage' && <Usage />}
      {tab === 'telemetry' && <Telemetry />}
      {tab === 'logs' && <Logs who={who} />}
      {tab === 'database' && <DatabaseTab who={who} />}
      {tab === 'keys' && <Keys who={who} />}
      {tab === 'backups' && <Backups who={who} />}
      {tab === 'flags' && <Flags who={who} />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

function NotAdmin({ email }: { email?: string }) {
  return (
    <div className="mx-auto max-w-[560px] px-8 py-16 text-center">
      <ShieldAlert className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
      <h2 className="text-lg font-bold">Not an admin</h2>
      <p className="mt-1 text-sm text-muted-foreground"><b>{email}</b> isn't in the admin list. Grant it from the Supabase SQL editor:</p>
      <pre className="mt-3 overflow-x-auto rounded-lg bg-secondary p-3 text-left text-xs">{`insert into public.admin_users (user_id, role)
select id, 'owner' from auth.users where email = '${email}'
on conflict (user_id) do update set role = 'owner';`}</pre>
    </div>
  )
}

function SchemaMissing() {
  return (
    <div className="mx-auto max-w-[720px] px-8 py-12">
      <AlertTriangle className="mb-3 h-8 w-8 text-amber-500" />
      <h2 className="text-lg font-bold">Admin schema not installed</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        The admin platform needs its database objects — roles, credits, organizations, the activity log,
        telemetry, backups and a read-only SQL function.
      </p>
      <p className="mt-3 text-sm">
        Open <b>Supabase → SQL Editor</b>, paste <code>admin-schema.sql</code> from the project root, and run it.
        Read the header first — <b>section 3</b> grants admins read access to every account's data.
      </p>
      <Button className="mt-4" onClick={() => location.reload()}><RefreshCw className="h-4 w-4" /> Re-check</Button>
    </div>
  )
}

// ---------------------------------------------------------------- shared action hook
function useAction(after?: () => void) {
  const [msg, setMsg] = useState('')
  const run = async (body: any, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return
    const r = await api<any>('/api/admin/db/action', body)
    setMsg(r.error || r.msg || 'done')
    setTimeout(() => setMsg(''), 5000)
    after?.()
    return r
  }
  return { msg, run, setMsg }
}

// ---------------------------------------------------------------- overview
function Overview() {
  const [d, setD] = useState<any>(null)
  const [sys, setSys] = useState<any>(null)
  const load = useCallback(() => { api('/api/admin/overview').then(setD); api('/api/admin/system').then(setSys) }, [])
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t) }, [load])
  if (!d || !sys) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-5">
      {/* headline numbers */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile icon={Radio} label="Live now" value={String(d.liveNow)} tone={d.liveNow ? 'ok' : undefined}
          sub={`${d.users.activeDay} active today`} />
        <Tile icon={Users} label="Accounts" value={String(d.users.total)}
          sub={d.users.retentionPct != null ? `${d.users.retentionPct}% week retention` : `${d.users.activeWeek} this week`} />
        <Tile icon={Phone} label="Calls" value={String(d.calls.total)} sub={`${d.calls.day} today · ${d.calls.totalMinutes}m total`} />
        <Tile icon={Coins} label="Revenue" value={usd(d.deals.revenue)}
          sub={d.deals.winRate != null ? `${d.deals.winRate}% win · avg ${usd(d.deals.avgDealSize)}` : `${d.deals.won}W/${d.deals.lost}L`} />
        <Tile icon={Activity} label="AI spend" value={usd(d.ai.cost)} sub={`${usd(d.ai.costDay)} today · ${usd(d.ai.costPerCall)}/call`} />
        <Tile icon={AlertTriangle} label="Errors 24h" value={String(d.health.errors24)}
          tone={d.health.errors24 > 0 ? 'bad' : 'ok'} sub={`${d.health.warns24} warnings`} />
      </div>

      {/* activity + quality */}
      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Calls, last 14 days" sub={`${d.calls.week} in the last 7`}>
          <Spark points={d.calls.timeline} height={56} />
          <div className="mt-3 flex justify-between text-[11px] text-muted-foreground">
            <span>{d.calls.timeline[0]?.date.slice(5)}</span><span>today</span>
          </div>
        </Panel>
        <Panel title="Talk ratio" sub="across every transcript">
          <Split a={d.talk.me} b={d.talk.them} aLabel="Reps" bLabel="Prospects" />
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
            {d.talk.ratio > 60 ? 'Reps are dominating calls — discovery is probably thin.'
              : d.talk.ratio < 35 ? 'Prospects are doing most of the talking. Good discovery.'
              : 'Healthy balance.'}
          </p>
        </Panel>
        <Panel title="Coaching quality" sub={`${d.calls.scored} calls scored`}>
          <div className="grid grid-cols-2 gap-4">
            <Kv k="Avg AI score" v={d.calls.avgScore != null ? String(d.calls.avgScore) : '—'} />
            <Kv k="Avg duration" v={dur(d.calls.avgDuration)} />
            <Kv k="Deals w/ Brain" v={`${d.deals.withBrain}/${d.deals.total}`} />
            <Kv k="Open pipeline" v={String(d.deals.open)} />
          </div>
        </Panel>
      </div>

      {/* platform */}
      <div className="grid gap-5 lg:grid-cols-4">
        <Panel title="Credits">
          <div className="grid grid-cols-2 gap-4">
            <Kv k="Outstanding" v={usd(d.credits.outstanding)} />
            <Kv k="Accounts" v={String(d.credits.accounts)} />
            <Kv k="Enforced" v={String(d.credits.enforced)} />
            <Kv k="Drained" v={String(d.credits.drained)} tone={d.credits.drained ? 'bad' : undefined} />
          </div>
        </Panel>
        <Panel title="Meetings">
          <div className="grid grid-cols-2 gap-4">
            <Kv k="Scheduled" v={String(d.meetings.upcoming)} />
            <Kv k="Completed" v={String(d.meetings.done)} />
            <Kv k="Auto-join" v={String(d.meetings.autoJoin)} />
            <Kv k="Total" v={String(d.meetings.total)} />
          </div>
        </Panel>
        <Panel title="Knowledge base">
          <div className="grid grid-cols-2 gap-4">
            <Kv k="Documents" v={String(d.knowledge.docs)} />
            <Kv k="Global" v={String(d.knowledge.byScope.global || 0)} />
            <Kv k="Per client" v={String(d.knowledge.byScope.deal || d.knowledge.byScope.client || 0)} />
            <Kv k="Telemetry 24h" v={tok(d.telemetry.day)} />
          </div>
        </Panel>
        <Panel title="AI usage">
          <div className="grid grid-cols-2 gap-4">
            <Kv k="Tokens" v={tok(d.ai.tokens)} />
            <Kv k="Today" v={tok(d.ai.tokensDay)} />
            <Kv k="Model calls" v={String(d.ai.events)} />
            <Kv k="Models used" v={String(d.ai.models)} />
          </div>
        </Panel>
      </div>

      {/* infrastructure */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Server" sub={`${sys.platform} · pid ${sys.pid}`}>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Kv k="Uptime" v={dur(sys.uptimeSec)} />
            <Kv k="Node" v={sys.node} />
            <Kv k="Requests" v={String(sys.requests)} />
            <Kv k="Error rate" v={sys.errorRate + '%'} tone={sys.errorRate > 5 ? 'bad' : 'ok'} />
            <Kv k="Heap" v={`${sys.memoryMb.heapUsed}/${sys.memoryMb.heapTotal}MB`} />
            <Kv k="RSS" v={sys.memoryMb.rss + ' MB'} />
            <Kv k="Sessions" v={String(sys.sessionsInMemory)} />
            <Kv k="Free RAM" v={sys.freeMemMb + ' MB'} />
          </div>
          <div className="mt-4 flex flex-wrap gap-1.5 border-t border-border pt-3">
            {(sys.statusCounts || []).map((s: any) => (
              <span key={s.status} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
                s.status >= 500 ? 'bg-destructive/15 text-destructive' :
                s.status >= 400 ? 'bg-amber-500/15 text-amber-600' : 'bg-emerald-500/15 text-emerald-600')}>
                {s.status} × {s.n}
              </span>
            ))}
            <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium',
              sys.backupsConfigured ? 'bg-emerald-500/15 text-emerald-600' : 'bg-secondary text-muted-foreground')}>
              nightly backups {sys.backupsConfigured ? 'on' : 'off'}
            </span>
          </div>
        </Panel>
        <Panel title="Busiest endpoints" sub="this process, since boot">
          <Bars rows={(sys.paths || []).map((p: any) => ({ key: p.path, n: p.count, extra: p.avgMs + 'ms' }))} fmt={(n) => String(n)} />
        </Panel>
      </div>

      {(sys.recentErrors || []).length > 0 && (
        <Panel title="Recent errors" sub={`${sys.recentErrors.length} in memory`}>
          <div className="flex flex-col gap-2">
            {sys.recentErrors.map((e: any, i: number) => (
              <div key={i} className="flex gap-3 text-xs">
                <span className="w-16 shrink-0 text-muted-foreground">{ago(e.at)}</span>
                <span className="w-48 shrink-0 truncate font-mono text-muted-foreground">{e.path}</span>
                <span className="truncate text-destructive">{e.msg}</span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- live
function Live() {
  const [d, setD] = useState<any>(null)
  const [auto, setAuto] = useState(true)
  const load = useCallback(() => api('/api/admin/live').then(setD), [])
  useEffect(() => { load(); if (!auto) return; const t = setInterval(load, 3000); return () => clearInterval(t) }, [load, auto])
  if (!d) return <PageSkeleton />
  return (
    <Panel title={`Live sessions (${d.sessions.length})`} right={
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" className="h-3.5 w-3.5 accent-primary" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> auto
        </label>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>}>
      {d.sessions.length === 0 ? <div className="py-10 text-center text-sm text-muted-foreground">Nobody connected right now.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">User</th><th className="pb-2">State</th><th className="pb-2">Client</th>
              <th className="pb-2">Playbook</th><th className="pb-2 text-right">Elapsed</th>
              <th className="pb-2 text-right">Turns</th><th className="pb-2 text-right">Cards</th>
            </tr></thead>
            <tbody>
              {d.sessions.map((s: any) => (
                <tr key={s.userId} className="border-b border-border/60 last:border-0">
                  <td className="py-2 font-mono text-xs">{s.userId.slice(0, 8)}</td>
                  <td className="py-2">
                    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold',
                      s.onCall ? 'bg-destructive/15 text-destructive' : s.connected ? 'bg-emerald-500/15 text-emerald-600' : 'bg-secondary text-muted-foreground')}>
                      <span className={cn('h-1.5 w-1.5 rounded-full', s.onCall ? 'animate-pulse bg-destructive' : s.connected ? 'bg-emerald-500' : 'bg-muted-foreground')} />
                      {s.onCall ? 'on call' : s.connected ? 'idle' : 'stale'}
                    </span>
                  </td>
                  <td className="py-2">
                    {s.client || '—'}
                    {s.goal && <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{s.goal}</div>}
                  </td>
                  <td className="py-2 text-muted-foreground">{s.product || '—'}</td>
                  <td className="py-2 text-right tabular-nums">{s.elapsedSec ? dur(s.elapsedSec) : '—'}</td>
                  <td className="py-2 text-right tabular-nums">{s.turns}</td>
                  <td className="py-2 text-right tabular-nums">{s.cards}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-3 text-[11px] text-muted-foreground">Read from the server's in-memory session map — real-time, not a database poll.</p>
    </Panel>
  )
}

// ---------------------------------------------------------------- accounts
const ROLES = ['owner', 'admin', 'support', 'viewer']

function Accounts({ who }: { who: Who }) {
  const [users, setUsers] = useState<any[] | null>(null)
  const [caps, setCaps] = useState<any>(null)
  const load = useCallback(() => api<{ users: any[]; caps: any }>('/api/admin/users').then((r) => { setUsers(r.users); setCaps(r.caps) }), [])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!users) return <PageSkeleton />

  const missing = caps && (!caps.listUsers || !caps.crossTenant)

  return (
    <>
    {missing && (
      <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" /> Partial data — two schema pieces aren't installed
        </div>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
          {!caps.listUsers && <li><b>Email addresses are missing.</b> The <code>admin_list_users()</code> function isn't installed, so accounts show as IDs only.</li>}
          {!caps.crossTenant && <li><b>You're only seeing your own data.</b> The cross-tenant <code>"admin full access"</code> policies aren't installed, so RLS still scopes every table to your account.</li>}
        </ul>
        <p className="mt-2 text-xs text-muted-foreground">
          Run <b>section 3</b> of <code>admin-schema.sql</code> in the Supabase SQL editor to enable both. Everything else on this page is live.
        </p>
      </div>
    )}
    <CreateUser caps={caps} who={who} run={run} />
    <div className="h-4" />
    <Panel title={`Accounts (${users.length})`} right={msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <th className="pb-2">Account</th><th className="pb-2">Admin role</th><th className="pb-2">Org</th>
            <th className="pb-2 text-right">Credits</th><th className="pb-2 text-right">Calls</th>
            <th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">Cost</th>
            <th className="pb-2">Last seen</th><th className="pb-2"></th>
          </tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60 last:border-0">
                <td className="py-2">
                  <div className="flex items-center gap-1.5">
                    {u.live && <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" title="online" />}
                    <span className="font-medium">{u.email || u.id.slice(0, 8)}</span>
                    {u.banned && <span className="rounded bg-destructive/15 px-1.5 text-[10px] text-destructive">banned</span>}
                  </div>
                  <div className="text-[11px] text-muted-foreground">{u.name || '—'} · joined {ago(u.createdAt)}</div>
                </td>
                <td className="py-2">
                  {who.isOwner ? (
                    <select className="h-7 rounded-md border border-input bg-card px-1.5 text-xs" value={u.adminRole || ''}
                      onChange={(e) => e.target.value
                        ? run({ action: 'set_admin_role', userId: u.id, role: e.target.value })
                        : run({ action: 'revoke_admin', userId: u.id }, `Remove admin access from ${u.email}?`)}>
                      <option value="">— none —</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  ) : <span className="text-xs text-muted-foreground">{u.adminRole || '—'}</span>}
                </td>
                <td className="py-2 text-xs text-muted-foreground">{u.org?.name || '—'}</td>
                <td className="py-2 text-right tabular-nums">
                  {u.credits != null ? <span className={u.credits <= 0 && u.creditsEnforced ? 'text-destructive' : ''}>{usd(u.credits)}</span> : '—'}
                </td>
                <td className="py-2 text-right tabular-nums">{u.calls}</td>
                <td className="py-2 text-right tabular-nums">{u.revenue ? usd(u.revenue) : '—'}</td>
                <td className="py-2 text-right tabular-nums">{usd(u.cost)}</td>
                <td className="py-2 text-xs text-muted-foreground">{ago(u.lastSignInAt || u.lastCall)}</td>
                <td className="py-2">
                  <div className="flex justify-end gap-1">
                    {who.canBilling && (
                      <Button size="sm" variant="ghost" title="Add $10 credit"
                        onClick={() => run({ action: 'adjust_credits', userId: u.id, amount: 10, reason: 'admin top-up' })}>
                        <Coins className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {who.canBilling && u.email && (
                      <Button size="sm" variant="ghost" title="Email a password reset"
                        onClick={() => run({ action: 'send_password_reset', email: u.email })}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {who.canWrite && caps?.manageAccounts && (
                      <Button size="sm" variant="ghost" title={u.banned ? 'Unban' : 'Ban this account'}
                        onClick={() => run({ action: 'set_banned', userId: u.id, banned: !u.banned },
                          u.banned ? undefined : `Ban ${u.email}? They won't be able to sign in.`)}>
                        <Ban className={cn('h-3.5 w-3.5', u.banned && 'text-destructive')} />
                      </Button>
                    )}
                    {who.canWrite && (
                      <Button size="sm" variant="ghost" title="Delete this account's calls"
                        onClick={() => run({ action: 'delete_user_calls', userId: u.id }, `Delete ALL calls for ${u.email}? This cannot be undone.`)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {who.isOwner && caps?.manageAccounts && (
                      <Button size="sm" variant="ghost" title="Delete account permanently"
                        onClick={() => run({ action: 'delete_user', userId: u.id },
                          `PERMANENTLY delete ${u.email} and all their data? This cannot be undone.`)}>
                        <UserX className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
    </>
  )
}

function CreateUser({ caps, who, run }: { caps: any; who: Who; run: (b: any, c?: string) => Promise<any> }) {
  const [email, setEmail] = useState(''); const [pw, setPw] = useState(''); const [busy, setBusy] = useState(false)
  if (!who.canWrite) return null

  if (caps && !caps.manageAccounts) return (
    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" /> Creating accounts needs the service key
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Creating, deleting and banning accounts are privileged Supabase Auth operations that a user token can't do.
        Add <code className="rounded bg-secondary px-1">SUPABASE_SERVICE_KEY</code> to <code>.env</code>
        (Supabase → Project Settings → API → <b>service_role</b>) and restart. It stays server-side and is never sent to the browser.
        The same key switches on unattended nightly backups.
      </p>
    </div>
  )

  const go = async () => {
    setBusy(true)
    try { await run({ action: 'create_user', email: email.trim(), password: pw }); setEmail(''); setPw('') }
    finally { setBusy(false) }
  }

  return (
    <Panel title="Create an account">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[220px] flex-1">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Email</div>
          <Input className="h-9" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="new.user@company.com" />
        </div>
        <div className="min-w-[200px] flex-1">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Password (blank = email an invite)</div>
          <Input className="h-9" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="leave blank to invite" />
        </div>
        <Button size="sm" onClick={go} disabled={busy || !email.trim()}>
          <UserPlus className="h-3.5 w-3.5" /> {busy ? 'Creating…' : pw ? 'Create' : 'Send invite'}
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">
        A password you type here goes straight to Supabase — it is never stored or written to any log by this app.
        Inviting is safer: they set their own.
      </p>
    </Panel>
  )
}

// ---------------------------------------------------------------- credits
function Credits({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [target, setTarget] = useState(''); const [amt, setAmt] = useState('10'); const [why, setWhy] = useState('')
  const load = useCallback(() => {
    api('/api/admin/credits').then(setD)
    api<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users))
  }, [])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!d) return <PageSkeleton />
  const emailOf = (id: string) => users.find((u) => u.id === id)?.email || id.slice(0, 8)

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Grant or extend credit" right={msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}>
        {!who.canBilling ? <p className="text-xs text-muted-foreground">Your role can't change credits.</p> : (
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Account</div>
              <select className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm" value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Select…</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.email || u.id.slice(0, 8)}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Amount (USD)</div>
              <Input className="h-9 w-28" type="number" step="0.01" value={amt} onChange={(e) => setAmt(e.target.value)} />
            </div>
            <div className="min-w-[180px] flex-1">
              <div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">Reason</div>
              <Input className="h-9" value={why} onChange={(e) => setWhy(e.target.value)} placeholder="trial extension…" />
            </div>
            <Button size="sm" disabled={!target || !amt} onClick={() => run({ action: 'adjust_credits', userId: target, amount: Number(amt), reason: why })}>
              <Plus className="h-3.5 w-3.5" /> Apply
            </Button>
          </div>
        )}
      </Panel>

      <Panel title={`Balances (${d.credits.length})`}>
        {d.credits.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">No credit records yet — grant some above.</div> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <th className="pb-2">Account</th><th className="pb-2">Plan</th><th className="pb-2 text-right">Balance</th>
              <th className="pb-2 text-right">Granted</th><th className="pb-2 text-right">Used</th><th className="pb-2">Enforced</th>
            </tr></thead>
            <tbody>
              {d.credits.map((c: any) => (
                <tr key={c.user_id} className="border-b border-border/60 last:border-0">
                  <td className="py-2">{emailOf(c.user_id)}</td>
                  <td className="py-2">
                    <select className="h-7 rounded-md border border-input bg-card px-1.5 text-xs" value={c.plan} disabled={!who.canBilling}
                      onChange={(e) => run({ action: 'set_credit_plan', userId: c.user_id, plan: e.target.value })}>
                      {['free', 'trial', 'pro', 'enterprise'].map((p) => <option key={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className={cn('py-2 text-right tabular-nums', Number(c.credits) <= 0 && c.enforced && 'text-destructive')}>{usd(Number(c.credits))}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{usd(Number(c.granted))}</td>
                  <td className="py-2 text-right tabular-nums text-muted-foreground">{usd(Number(c.used))}</td>
                  <td className="py-2">
                    <input type="checkbox" className="h-4 w-4 accent-primary" checked={c.enforced} disabled={!who.canBilling}
                      onChange={(e) => run({ action: 'set_credit_enforcement', userId: c.user_id, enforced: e.target.checked })} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Enforcement is off by default — turning it on is deliberate, so nobody gets locked out by accident.
        </p>
      </Panel>

      <Panel title="Ledger">
        {d.ledger.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">No entries.</div> : (
          <div className="max-h-72 overflow-y-auto">
            {d.ledger.map((l: any) => (
              <div key={l.id} className="flex gap-3 border-b border-border/50 py-1.5 text-xs last:border-0">
                <span className="w-20 shrink-0 text-muted-foreground">{ago(l.created_at)}</span>
                <span className={cn('w-16 shrink-0 text-right font-semibold tabular-nums', Number(l.delta) >= 0 ? 'text-emerald-600' : 'text-destructive')}>
                  {Number(l.delta) >= 0 ? '+' : ''}{usd(Number(l.delta))}
                </span>
                <span className="w-48 shrink-0 truncate">{emailOf(l.user_id)}</span>
                <span className="truncate text-muted-foreground">{l.reason}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- organizations
function Orgs({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const [users, setUsers] = useState<any[]>([])
  const [name, setName] = useState('')
  const load = useCallback(() => {
    api('/api/admin/orgs').then(setD)
    api<{ users: any[] }>('/api/admin/users').then((r) => setUsers(r.users))
  }, [])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!d) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Organizations" right={msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}>
        {who.canWrite && (
          <div className="mb-4 flex gap-2">
            <Input className="h-9 max-w-xs" value={name} onChange={(e) => setName(e.target.value)} placeholder="New organization name" />
            <Button size="sm" disabled={!name.trim()} onClick={() => { run({ action: 'create_org', name: name.trim() }); setName('') }}>
              <Plus className="h-3.5 w-3.5" /> Create
            </Button>
          </div>
        )}
        {d.orgs.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">No organizations yet.</div> : (
          <div className="flex flex-col gap-3">
            {d.orgs.map((o: any) => (
              <div key={o.id} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <span className="font-semibold">{o.name}</span>
                  <select className="h-7 rounded-md border border-input bg-card px-1.5 text-xs" value={o.plan} disabled={!who.canWrite}
                    onChange={(e) => run({ action: 'update_org', orgId: o.id, plan: e.target.value })}>
                    {['free', 'trial', 'pro', 'enterprise'].map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <select className="h-7 rounded-md border border-input bg-card px-1.5 text-xs" value={o.status} disabled={!who.canWrite}
                    onChange={(e) => run({ action: 'update_org', orgId: o.id, status: e.target.value })}>
                    {['active', 'suspended', 'cancelled'].map((p) => <option key={p}>{p}</option>)}
                  </select>
                  <span className="text-xs text-muted-foreground">{o.members.length}/{o.seats} seats</span>
                  {who.canWrite && (
                    <Button size="sm" variant="ghost" className="ml-auto"
                      onClick={() => run({ action: 'delete_row', table: 'organizations', id: o.id }, `Delete organization "${o.name}"?`)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
                {who.canWrite && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">Add member</span>
                    <select className="h-8 rounded-md border border-input bg-card px-2 text-xs"
                      onChange={(e) => { if (e.target.value) { run({ action: 'add_org_member', orgId: o.id, userId: e.target.value }); e.target.value = '' } }}>
                      <option value="">Select account…</option>
                      {users.map((u) => <option key={u.id} value={u.id}>{u.email || u.id.slice(0, 8)}</option>)}
                    </select>
                    <div className="flex flex-wrap gap-1">
                      {o.members.map((m: any) => (
                        <span key={m.user_id} className="flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]">
                          {users.find((u) => u.id === m.user_id)?.email?.split('@')[0] || m.user_id.slice(0, 6)}
                          <select className="border-0 bg-transparent text-[10px] text-muted-foreground outline-none" value={m.org_role}
                            onChange={(e) => run({ action: 'set_org_member_role', orgId: o.id, userId: m.user_id, orgRole: e.target.value })}>
                            {['owner', 'admin', 'member'].map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button className="text-muted-foreground hover:text-destructive" title="Remove"
                            onClick={() => run({ action: 'remove_org_member', orgId: o.id, userId: m.user_id })}>×</button>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- meetings / bot fleet
const MSTATUS: Record<string, string> = {
  scheduled: 'bg-secondary text-muted-foreground', joining: 'bg-amber-500/15 text-amber-600',
  recording: 'bg-destructive/15 text-destructive', processing: 'bg-amber-500/15 text-amber-600',
  done: 'bg-emerald-500/15 text-emerald-600', failed: 'bg-destructive/15 text-destructive',
  cancelled: 'bg-secondary text-muted-foreground',
}

function MeetingsAdmin() {
  const [d, setD] = useState<any>(null)
  const load = useCallback(() => api('/api/admin/meetings').then(setD), [])
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t) }, [load])
  if (!d) return <PageSkeleton />

  const modeTint = d.botMode === 'manual' ? 'bg-secondary text-muted-foreground' : 'bg-emerald-500/15 text-emerald-600'
  const modeLabel = { self: 'self-hosted worker', recall: 'recall.ai', manual: 'manual (no bot)' }[d.botMode as string] || d.botMode

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile icon={Video} label="Meetings" value={String(d.stats.total)} sub={`${d.stats.upcoming} upcoming`} />
        <Tile icon={Bot} label="Bot mode" value={d.botMode} tone={d.botMode === 'manual' ? undefined : 'ok'} sub={modeLabel} />
        <Tile icon={Radio} label="Bots active" value={String(d.stats.active)} tone={d.stats.active ? 'ok' : undefined} />
        <Tile icon={CheckCircle2} label="Notes written" value={String(d.stats.done)} />
        <Tile icon={AlertTriangle} label="Failed" value={String(d.stats.failed)} tone={d.stats.failed ? 'bad' : 'ok'} />
      </div>

      {d.botMode === 'manual' && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <div className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-400">
            <Bot className="h-4 w-4" /> No bot provider configured
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
            Meetings still get prep briefs and notes, but nothing joins calls automatically. Two options:
            run the bundled <code className="rounded bg-secondary px-1">bot-worker.js</code> (free, Google Meet, set
            <code className="mx-1 rounded bg-secondary px-1">BOT_WORKER_URL</code>), or set
            <code className="mx-1 rounded bg-secondary px-1">RECALL_API_KEY</code> for a managed bot that also does Zoom and Teams.
          </p>
        </div>
      )}

      <Panel title={`All meetings (${d.meetings.length})`} sub="across every account you can see"
        right={<Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>}>
        {d.meetings.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No meetings scheduled yet.</div> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="pb-2.5">Meeting</th><th className="pb-2.5">Status</th><th className="pb-2.5">Platform</th>
                <th className="pb-2.5">Bot</th><th className="pb-2.5 text-right">Turns</th><th className="pb-2.5">When</th>
              </tr></thead>
              <tbody>
                {d.meetings.map((m: any) => (
                  <tr key={m.id} className="border-b border-border/60 last:border-0">
                    <td className="py-2.5">
                      <div className="font-medium">{m.title}</div>
                      {m.client && <div className="text-[11px] text-muted-foreground">{m.client}</div>}
                    </td>
                    <td className="py-2.5">
                      <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase', MSTATUS[m.status])}>{m.status}</span>
                    </td>
                    <td className="py-2.5 text-xs text-muted-foreground">{m.platform}</td>
                    <td className="py-2.5 text-xs text-muted-foreground">{m.bot_provider || '—'}</td>
                    <td className="py-2.5 text-right tabular-nums">{m.turns}</td>
                    <td className="py-2.5 text-xs text-muted-foreground">{m.starts_at ? ago(m.starts_at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- usage
function Usage() {
  const [d, setD] = useState<any>(null)
  useEffect(() => { api('/api/admin/usage').then(setD) }, [])
  if (!d) return <PageSkeleton />
  const row = (a: any) => ({ key: a.key, n: a.tokens, extra: usd(a.cost) })
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title="By model"><Bars rows={d.byModel.map(row)} /></Panel>
      <Panel title="By activity"><Bars rows={d.byKind.map(row)} /></Panel>
      <Panel title="By account"><Bars rows={d.byUser.map((a: any) => ({ key: a.key.slice(0, 8), n: a.tokens, extra: usd(a.cost) }))} /></Panel>
      <Panel title="Tokens per day"><Bars rows={d.timeline.map((t: any) => ({ key: t.date, n: t.tokens }))} /></Panel>
      <div className="text-xs text-muted-foreground lg:col-span-2">{d.note}</div>
    </div>
  )
}

// ---------------------------------------------------------------- telemetry
function Telemetry() {
  const [d, setD] = useState<any>(null)
  const [hours, setHours] = useState(24)
  const [path, setPath] = useState('')
  const load = useCallback(() => {
    api(`/api/admin/telemetry?hours=${hours}${path ? '&path=' + encodeURIComponent(path) : ''}`).then(setD)
  }, [hours, path])
  useEffect(() => { load() }, [load])
  if (!d) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>Last hour</option><option value={24}>Last 24h</option>
          <option value={168}>Last 7 days</option><option value={720}>Last 30 days</option>
        </select>
        <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={path} onChange={(e) => setPath(e.target.value)}>
          <option value="">All pages</option>
          {d.paths.map((p: any) => <option key={p.path} value={p.path}>{p.path}</option>)}
        </select>
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /> Refresh</Button>
        <span className="text-xs text-muted-foreground">{d.total} events</span>
      </div>

      <Panel title={`Click heatmap${path ? ' — ' + path : ' — all pages'}`}>
        {d.heat.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">No clicks recorded yet — telemetry collects as people use the app.</div>
        ) : (
          <div className="relative aspect-[16/9] w-full overflow-hidden rounded-lg border border-border bg-secondary/40">
            {d.heat.map((h: any, i: number) => (
              <span key={i} title={h.el} className="pointer-events-none absolute rounded-full"
                style={{ left: `${h.x * 100}%`, top: `${h.y * 100}%`, width: 22, height: 22, transform: 'translate(-50%,-50%)',
                  background: 'radial-gradient(circle, hsl(var(--primary)/0.55) 0%, hsl(var(--primary)/0) 70%)' }} />
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Top pages"><Bars rows={d.paths.map((p: any) => ({ key: p.path, n: p.count }))} fmt={(n) => String(n)} /></Panel>
        <Panel title="Event kinds"><Bars rows={d.kinds.map((k: any) => ({ key: k.kind, n: k.count }))} fmt={(n) => String(n)} /></Panel>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- logs
const LEVEL_TINT: Record<string, string> = {
  error: 'bg-destructive/15 text-destructive', warn: 'bg-amber-500/15 text-amber-600',
  info: 'bg-secondary text-muted-foreground', debug: 'bg-secondary text-muted-foreground',
}

function Logs({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const [level, setLevel] = useState(''); const [category, setCategory] = useState('')
  const [hours, setHours] = useState(24); const [q, setQ] = useState('')
  const load = useCallback(() => {
    const p = new URLSearchParams({ hours: String(hours) })
    if (level) p.set('level', level); if (category) p.set('category', category); if (q) p.set('q', q)
    api(`/api/admin/logs?${p}`).then(setD)
  }, [level, category, hours, q])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!d) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          <option value={1}>Last hour</option><option value={24}>Last 24h</option><option value={168}>7 days</option><option value={720}>30 days</option>
        </select>
        <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">All levels</option>{['info', 'warn', 'error', 'debug'].map((l) => <option key={l}>{l}</option>)}
        </select>
        <select className="h-9 rounded-md border border-input bg-card px-3 text-sm" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>{['api', 'admin', 'call', 'auth', 'ai', 'billing', 'security', 'system'].map((c) => <option key={c}>{c}</option>)}
        </select>
        <Input className="h-9 w-48" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search action/target…" />
        <Button size="sm" variant="outline" onClick={load}><RefreshCw className="h-3.5 w-3.5" /></Button>
        {who.canWrite && (
          <Button size="sm" variant="ghost" className="ml-auto"
            onClick={() => run({ action: 'purge_logs', days: 30 }, 'Delete activity logs older than 30 days?')}>
            <Trash2 className="h-3.5 w-3.5" /> Purge &gt;30d
          </Button>
        )}
        {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
      </div>

      <Panel title={`Activity log (${d.logs.length})`} right={
        <div className="flex gap-1.5">
          {Object.entries(d.counts).map(([k, n]: any) => (
            <span key={k} className="rounded-full bg-secondary px-2 py-0.5 text-[10px] text-muted-foreground">{k} {n}</span>
          ))}
        </div>}>
        {d.logs.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">Nothing logged in this window.</div> : (
          <div className="max-h-[65vh] overflow-y-auto">
            {d.logs.map((l: any) => (
              <div key={l.id} className="flex items-start gap-2.5 border-b border-border/50 py-1.5 text-xs last:border-0">
                <span className="w-16 shrink-0 text-muted-foreground">{ago(l.at)}</span>
                <span className={cn('w-12 shrink-0 rounded px-1.5 text-center text-[10px] font-semibold uppercase', LEVEL_TINT[l.level])}>{l.level}</span>
                <span className="w-16 shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{l.category}</span>
                <span className="w-64 shrink-0 truncate font-mono">{l.action}</span>
                <span className="w-24 shrink-0 truncate text-muted-foreground">{l.target}</span>
                {l.ms != null && <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">{l.ms}ms</span>}
                <span className="truncate text-muted-foreground">{l.detail && Object.keys(l.detail).length ? JSON.stringify(l.detail) : ''}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- database
const PRESETS = [
  { label: 'Row counts', sql: "select 'calls' t, count(*) from calls union all select 'deals', count(*) from deals union all select 'documents', count(*) from documents union all select 'activity_log', count(*) from activity_log" },
  { label: 'Newest calls', sql: 'select id, user_id, created_at, duration_sec, review_score from calls order by created_at desc limit 20' },
  { label: 'Top spenders', sql: 'select user_id, sum(prompt_tokens + completion_tokens) tokens from usage_events group by 1 order by 2 desc limit 20' },
  { label: 'Table sizes', sql: 'select relname table_name, n_live_tup rows from pg_stat_user_tables order by n_live_tup desc limit 20' },
  { label: 'Errors today', sql: "select at, action, target, detail from activity_log where level = 'error' order by at desc limit 30" },
]

function DatabaseTab({ who }: { who: Who }) {
  const [sql, setSql] = useState(PRESETS[0].sql)
  const [res, setRes] = useState<any>(null)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const { msg, run } = useAction()

  const go = async () => {
    setBusy(true); setErr(''); setRes(null)
    try { const r = await api<any>('/api/admin/db/query', { sql }); if (r.error) setErr(r.error); else setRes(r) }
    finally { setBusy(false) }
  }
  const cols = res?.rows?.length ? Object.keys(res.rows[0]) : []

  return (
    <div className="flex flex-col gap-4">
      <Panel title="SQL console" right={<span className="text-[11px] text-muted-foreground">read-only — SELECT / WITH</span>}>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.label} onClick={() => setSql(p.sql)}
              className="rounded-full border border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-primary">{p.label}</button>
          ))}
        </div>
        <Textarea value={sql} onChange={(e) => setSql(e.target.value)} className="min-h-[90px] font-mono text-xs" spellCheck={false} />
        <div className="mt-2 flex items-center gap-2">
          <Button size="sm" onClick={go} disabled={busy}><Play className="h-3.5 w-3.5" /> {busy ? 'Running…' : 'Run'}</Button>
          {res && <span className="text-xs text-muted-foreground">{res.count} rows · {res.ms}ms</span>}
        </div>
        {err && <div className="mt-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">{err}</div>}
        {res && res.rows.length > 0 && (
          <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-secondary"><tr>{cols.map((c) => <th key={c} className="px-2 py-1.5 text-left font-semibold">{c}</th>)}</tr></thead>
              <tbody>
                {res.rows.map((r: any, i: number) => (
                  <tr key={i} className="border-t border-border/60">
                    {cols.map((c) => <td key={c} className="max-w-[280px] truncate px-2 py-1.5 font-mono">{String(r[c] ?? '')}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {res && res.rows.length === 0 && <div className="mt-3 text-xs text-muted-foreground">No rows.</div>}
      </Panel>

      <Panel title="Quick actions" right={msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}>
        {!who.canWrite ? <p className="text-xs text-muted-foreground">Your role is read-only.</p> : (
          <>
            <p className="mb-3 text-xs text-muted-foreground">
              Writes go through a fixed, parameterised list — the console stays read-only so a typo can't drop a table. Everything here is audited.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={() => run({ action: 'purge_telemetry', days: 30 }, 'Delete telemetry older than 30 days?')}>
                <Trash2 className="h-3.5 w-3.5" /> Purge telemetry &gt;30d
              </Button>
              <Button size="sm" variant="outline" onClick={() => run({ action: 'purge_logs', days: 30 }, 'Delete logs older than 30 days?')}>
                <Trash2 className="h-3.5 w-3.5" /> Purge logs &gt;30d
              </Button>
              <Button size="sm" variant="outline" onClick={() => run({ action: 'clear_sessions' }, 'Clear all in-memory sessions? Anyone mid-call loses coach state.')}>
                <Server className="h-3.5 w-3.5" /> Clear live sessions
              </Button>
            </div>
            <DeleteRow run={run} />
          </>
        )}
      </Panel>
    </div>
  )
}

function DeleteRow({ run }: { run: (b: any, c?: string) => Promise<any> }) {
  const [table, setTable] = useState('calls'); const [id, setId] = useState('')
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
      <span className="text-xs text-muted-foreground">Delete a row:</span>
      <select className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={table} onChange={(e) => setTable(e.target.value)}>
        {['calls', 'deals', 'documents', 'reminders', 'products', 'telemetry_events', 'activity_log'].map((t) => <option key={t}>{t}</option>)}
      </select>
      <Input value={id} onChange={(e) => setId(e.target.value)} placeholder="row id" className="h-9 w-64 font-mono text-xs" />
      <Button size="sm" variant="destructive" disabled={!id.trim()}
        onClick={() => { run({ action: 'delete_row', table, id: id.trim() }, `Delete ${table} row ${id}?`); setId('') }}>Delete</Button>
    </div>
  )
}

// ---------------------------------------------------------------- keys & health
function Keys({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const [h, setH] = useState<any>(null)
  const [checking, setChecking] = useState(false)
  const [shown, setShown] = useState<Record<string, string>>({})

  useEffect(() => { api('/api/admin/keys').then(setD) }, [])
  const check = useCallback(async () => { setChecking(true); try { setH(await api('/api/admin/health')) } finally { setChecking(false) } }, [])
  useEffect(() => { check() }, [check])

  const reveal = async (id: string) => {
    if (shown[id]) { setShown((s) => { const n = { ...s }; delete n[id]; return n }) ; return }
    const r = await api<{ value?: string; error?: string }>('/api/admin/keys/reveal', { id })
    if (r.error) { alert(r.error); return }
    setShown((s) => ({ ...s, [id]: r.value || '' }))
    setTimeout(() => setShown((s) => { const n = { ...s }; delete n[id]; return n }), 30000)   // auto-hide
  }

  if (!d) return <PageSkeleton />
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Service health" right={<Button size="sm" variant="outline" onClick={check} disabled={checking}><RefreshCw className="h-3.5 w-3.5" /> {checking ? 'Checking…' : 'Re-check'}</Button>}>
        {!h ? <div className="text-xs text-muted-foreground">Checking…</div> : (
          <div className="grid gap-3 sm:grid-cols-3">
            {Object.entries(h).map(([name, v]: any) => (
              <div key={name} className="rounded-lg border border-border p-3">
                <div className="flex items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', v.ok ? 'bg-emerald-500' : 'bg-destructive')} />
                  <span className="text-sm font-semibold capitalize">{name}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{v.ms}ms</span>
                </div>
                <div className={cn('mt-1 text-xs', v.ok ? 'text-muted-foreground' : 'text-destructive')}>{v.detail}</div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="API keys">
        <div className="flex flex-col gap-2">
          {d.keys.map((k: any) => (
            <div key={k.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', k.set ? 'bg-emerald-500' : 'bg-destructive')} />
              <span className="text-sm font-semibold">{k.name}</span>
              <code className={cn('rounded px-2 py-0.5 font-mono text-xs', shown[k.id] ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-secondary')}>
                {shown[k.id] || k.masked}
              </code>
              <span className="text-[11px] text-muted-foreground">{k.length} chars</span>
              {k.set && who.isOwner && (
                <Button size="sm" variant="ghost" onClick={() => reveal(k.id)} title={shown[k.id] ? 'Hide' : 'Reveal (audited)'}>
                  {shown[k.id] ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </Button>
              )}
              <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">{k.scope}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
          <b className="text-amber-700 dark:text-amber-400">Reveal is owner-only, logged, and auto-hides after 30s.</b>{' '}
          Every reveal writes an entry to the audit log and the security log with your account and IP. Don't reveal
          a key while screen-sharing — rotate it in the provider dashboard if you ever do.
        </div>
      </Panel>

      <Panel title="Models in use">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kv k="Live coach" v={d.models.live} /><Kv k="Analysis" v={d.models.analysis} />
          <Kv k="Prep / battle plan" v={d.models.prep} /><Kv k="Endpoint" v={d.models.base} />
        </div>
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- backups
function Backups({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const load = useCallback(() => api('/api/admin/backups').then(setD), [])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!d) return <PageSkeleton />

  const dl = async (file: string) => {
    const t = await token()
    const r = await fetch(`/api/admin/backups/download?file=${encodeURIComponent(file)}`, { headers: { Authorization: `Bearer ${t}` } })
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = file; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 4000)
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Backups" right={
        who.canWrite ? <Button size="sm" onClick={() => run({ action: 'run_backup' })}><Archive className="h-3.5 w-3.5" /> Back up now</Button> : null}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kv k="Snapshots kept" v={`${d.files.length} / ${d.keepDays} days`} />
          <Kv k="Schedule" v={d.scheduled ? 'daily, automatic' : 'manual only'} tone={d.scheduled ? 'ok' : undefined} />
          <Kv k="Newest" v={d.files[0] ? ago(d.files[0].at) : '—'} />
          <Kv k="Total size" v={kb(d.files.reduce((a: number, f: any) => a + f.bytes, 0))} />
        </div>
        {msg && <div className="mt-3 text-xs text-muted-foreground">{msg}</div>}
        {!d.scheduled && (
          <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs">
            <b className="text-amber-700 dark:text-amber-400">Nightly backups need a service key.</b> Unattended runs happen at 3am when
            nobody is signed in, so there's no user token to authenticate with. Add
            <code className="mx-1 rounded bg-secondary px-1">SUPABASE_SERVICE_KEY</code> to <code>.env</code>
            (Supabase → Project Settings → API → service_role) and restart. It stays server-side and is never sent to the browser.
            Until then, "Back up now" works and the scheduler will use your session if you happen to be signed in.
          </div>
        )}
      </Panel>

      <Panel title={`Snapshots (${d.files.length})`}>
        {d.files.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No snapshots yet.</div> : (
          <div className="flex flex-col gap-1.5">
            {d.files.map((f: any) => (
              <div key={f.file} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <Archive className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate font-mono text-xs">{f.file}</span>
                <span className="text-xs text-muted-foreground">{kb(f.bytes)}</span>
                <span className="text-xs text-muted-foreground">{ago(f.at)}</span>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => dl(f.file)}><Download className="h-3.5 w-3.5" /></Button>
              </div>
            ))}
          </div>
        )}
        <p className="mt-3 text-[11px] text-muted-foreground">
          Files live in <code>{d.dir}</code> and older ones are pruned automatically past {d.keepDays} days.
          Supabase also keeps its own point-in-time backups.
        </p>
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- flags & announcements
function Flags({ who }: { who: Who }) {
  const [d, setD] = useState<any>(null)
  const [key, setKey] = useState(''); const [desc, setDesc] = useState('')
  const [title, setTitle] = useState(''); const [body, setBody] = useState(''); const [level, setLevel] = useState('info')
  const load = useCallback(() => api('/api/admin/flags').then(setD), [])
  useEffect(() => { load() }, [load])
  const { msg, run } = useAction(load)
  if (!d) return <PageSkeleton />

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Feature flags" right={msg ? <span className="text-xs text-muted-foreground">{msg}</span> : null}>
        {who.canWrite && (
          <div className="mb-4 flex flex-wrap gap-2">
            <Input className="h-9 w-48" value={key} onChange={(e) => setKey(e.target.value)} placeholder="flag_key" />
            <Input className="h-9 flex-1" value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="what it controls" />
            <Button size="sm" disabled={!key.trim()} onClick={() => { run({ action: 'set_flag', key: key.trim(), enabled: false, description: desc }); setKey(''); setDesc('') }}>
              <Plus className="h-3.5 w-3.5" /> Add
            </Button>
          </div>
        )}
        {d.flags.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">No flags defined.</div> : (
          <div className="flex flex-col gap-2">
            {d.flags.map((f: any) => (
              <div key={f.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
                <input type="checkbox" className="h-4 w-4 accent-primary" checked={f.enabled} disabled={!who.canWrite}
                  onChange={(e) => run({ action: 'set_flag', key: f.key, enabled: e.target.checked, description: f.description, rollout: f.rollout })} />
                <code className="font-mono text-sm font-semibold">{f.key}</code>
                <span className="text-xs text-muted-foreground">{f.description}</span>
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  rollout
                  <Input type="number" min={0} max={100} defaultValue={f.rollout} disabled={!who.canWrite}
                    className="h-7 w-16 text-xs"
                    onBlur={(e) => { const v = Math.max(0, Math.min(100, Number(e.target.value) || 0))
                      if (v !== f.rollout) run({ action: 'set_flag', key: f.key, enabled: f.enabled, description: f.description, rollout: v }) }} />
                  %
                </label>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Announcements">
        {who.canWrite && (
          <div className="mb-4 flex flex-col gap-2">
            <div className="flex gap-2">
              <Input className="h-9 flex-1" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
              <select className="h-9 rounded-md border border-input bg-card px-2 text-sm" value={level} onChange={(e) => setLevel(e.target.value)}>
                {['info', 'warn', 'critical'].map((l) => <option key={l}>{l}</option>)}
              </select>
            </div>
            <Textarea className="min-h-[60px]" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Message shown to users…" />
            <Button size="sm" className="self-start" disabled={!title.trim()}
              onClick={() => { run({ action: 'post_announcement', title: title.trim(), body, level }); setTitle(''); setBody('') }}>
              <Megaphone className="h-3.5 w-3.5" /> Post
            </Button>
          </div>
        )}
        {d.announcements.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">Nothing posted.</div> : (
          <div className="flex flex-col gap-2">
            {d.announcements.map((a: any) => (
              <div key={a.id} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <Megaphone className={cn('mt-0.5 h-4 w-4 shrink-0', a.level === 'critical' ? 'text-destructive' : a.level === 'warn' ? 'text-amber-600' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{a.title}</div>
                  <div className="text-xs text-muted-foreground">{a.body}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{ago(a.created_at)}</div>
                </div>
                {who.canWrite && (
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={a.active} title="active"
                    onChange={(e) => run({ action: 'toggle_announcement', id: a.id, active: e.target.checked })} />
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  )
}

// ---------------------------------------------------------------- audit
function Audit() {
  const [rows, setRows] = useState<any[] | null>(null)
  useEffect(() => { api<{ audit: any[] }>('/api/admin/audit').then((r) => setRows(r.audit)) }, [])
  if (!rows) return <PageSkeleton />
  return (
    <Panel title={`Admin audit log (${rows.length})`}>
      {rows.length === 0 ? <div className="py-8 text-center text-sm text-muted-foreground">No admin actions recorded yet.</div> : (
        <div className="max-h-[60vh] overflow-y-auto">
          {rows.map((r) => (
            <div key={r.id} className="flex gap-3 border-b border-border/60 py-2 text-xs last:border-0">
              <span className="w-20 shrink-0 text-muted-foreground">{ago(r.created_at)}</span>
              <span className="w-36 shrink-0 font-semibold">{r.action}</span>
              <span className="w-40 shrink-0 truncate font-mono text-muted-foreground">{r.target}</span>
              <span className="truncate text-muted-foreground">{JSON.stringify(r.detail)}</span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
