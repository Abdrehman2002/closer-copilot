import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, Tooltip, PieChart, Pie, Cell,
} from 'recharts'
import { api } from '@/lib/api'
import type { HomeData, CallRow } from '@/lib/types'
import { fmtDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus, ArrowUpRight } from 'lucide-react'

const DAYS = 14

export default function Home() {
  const [home, setHome] = useState<HomeData | null>(null)
  const [calls, setCalls] = useState<CallRow[]>([])
  const navigate = useNavigate()

  useEffect(() => {
    api<HomeData>('/api/home').then(setHome)
    api<{ calls: CallRow[] }>('/api/calls').then((r) => setCalls(r.calls || []))
  }, [])

  const series = useMemo(() => {
    const buckets: { label: string; day: string; count: number }[] = []
    const now = new Date()
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86400000)
      buckets.push({ label: d.toLocaleDateString([], { weekday: 'short' }), day: d.toISOString().slice(0, 10), count: 0 })
    }
    for (const c of calls) {
      const key = (c.created_at || '').slice(0, 10)
      const b = buckets.find((x) => x.day === key)
      if (b) b.count++
    }
    return buckets
  }, [calls])

  const s = home?.stats
  const closed = (s?.won ?? 0) + (s?.lost ?? 0)
  const winRate = closed ? Math.round(((s?.won ?? 0) / closed) * 100) : 0
  const pie = [
    { name: 'Won', value: s?.won ?? 0, color: 'hsl(214 95% 52%)' },
    { name: 'Open', value: s?.open ?? 0, color: 'hsl(220 13% 82%)' },
    { name: 'Lost', value: s?.lost ?? 0, color: 'hsl(222 24% 20%)' },
  ]
  const pieTotal = pie.reduce((a, b) => a + b.value, 0)

  const kpis = [
    { label: 'Clients', value: s?.total ?? 0, sub: 'in your book' },
    { label: 'Open deals', value: s?.open ?? 0, sub: 'active in pipeline' },
    { label: 'Won', value: s?.won ?? 0, sub: `${closed} closed total` },
    { label: 'Win rate', value: `${winRate}%`, sub: `${s?.won ?? 0} of ${closed || 0} closed` },
  ]

  return (
    <div className="mx-auto max-w-[1160px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">Your pipeline and coaching activity at a glance.</p>
        </div>
        <Button onClick={() => navigate('/new')}><Plus className="h-4 w-4" /> New Call</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {/* KPI row */}
        <div className="grid grid-cols-2 divide-x divide-y divide-border lg:grid-cols-4 lg:divide-y-0">
          {kpis.map((k) => (
            <div key={k.label} className="p-5">
              <div className="text-[13px] text-muted-foreground">{k.label}</div>
              <div className="mt-2 text-[30px] font-extrabold leading-none tracking-tight">{home ? k.value : '—'}</div>
              <div className="mt-2 text-xs text-muted-foreground">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* charts row */}
        <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <h3 className="font-semibold">Calls, last 14 days</h3>
            <p className="mb-4 text-sm text-muted-foreground">Daily coaching sessions.</p>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={series} margin={{ top: 4, right: 4, left: -28, bottom: 0 }}>
                  <XAxis dataKey="label" tickLine={false} axisLine={false}
                    tick={{ fontSize: 11, fill: 'hsl(220 9% 46%)' }} interval={1} />
                  <Tooltip cursor={{ fill: 'hsl(220 14% 96%)' }}
                    contentStyle={{ borderRadius: 8, border: '1px solid hsl(220 13% 91%)', fontSize: 12 }}
                    labelStyle={{ color: 'hsl(222 24% 11%)' }} />
                  <Bar dataKey="count" fill="hsl(214 95% 52%)" radius={[3, 3, 0, 0]} maxBarSize={26} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="p-5">
            <h3 className="font-semibold">Pipeline</h3>
            <p className="mb-4 text-sm text-muted-foreground">How your deals are split.</p>
            <div className="flex items-center gap-6">
              <div className="h-[180px] w-[180px] shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pie} dataKey="value" nameKey="name" innerRadius={54} outerRadius={82} paddingAngle={2} stroke="none">
                      {pie.map((e) => <Cell key={e.name} fill={e.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid hsl(220 13% 91%)', fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-3">
                {pie.map((p) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
                    <span className="text-sm font-medium">{p.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {p.value}{pieTotal ? ` · ${Math.round((p.value / pieTotal) * 100)}%` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* recent row */}
        <div className="grid divide-y divide-border border-t border-border lg:grid-cols-2 lg:divide-x lg:divide-y-0">
          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Recent clients</h3>
              <Link to="/clients" className="flex items-center gap-1 text-xs text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
            <div className="flex flex-col">
              {home?.recentClients.length ? home.recentClients.map((c) => (
                <Link key={c.id} to={`/clients/${c.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-secondary">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.company || '—'} · {c.calls} call{c.calls === 1 ? '' : 's'}</div>
                  </div>
                  <Badge variant={c.status} className="ml-auto">{c.status}</Badge>
                </Link>
              )) : <Empty text="No clients yet — start a call to create one." />}
            </div>
          </div>

          <div className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">Recent calls</h3>
              <Link to="/calls" className="flex items-center gap-1 text-xs text-primary hover:underline">View all <ArrowUpRight className="h-3 w-3" /></Link>
            </div>
            <div className="flex flex-col">
              {home?.recentCalls.length ? home.recentCalls.map((c) => (
                <Link key={c.id} to={`/calls/${c.id}`}
                  className="-mx-2 flex items-center gap-3 rounded-md px-2 py-2.5 transition-colors hover:bg-secondary">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{c.client}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.product_name || '—'} · {fmtDate(c.created_at)}</div>
                  </div>
                </Link>
              )) : <Empty text="No calls yet." />}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-muted-foreground">{text}</div>
}
