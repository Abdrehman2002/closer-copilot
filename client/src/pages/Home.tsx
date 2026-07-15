import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { HomeData } from '@/lib/types'
import { fmtDate } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus } from 'lucide-react'

const stats = [
  { key: 'total', label: 'Clients' },
  { key: 'open', label: 'Open' },
  { key: 'won', label: 'Won' },
  { key: 'lost', label: 'Lost' },
] as const

export default function Home() {
  const [d, setD] = useState<HomeData | null>(null)
  const navigate = useNavigate()
  useEffect(() => { api<HomeData>('/api/home').then(setD) }, [])

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <div className="mb-7 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Home</h1>
        <Button onClick={() => navigate('/new')}><Plus className="h-4 w-4" /> New Call</Button>
      </div>

      <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.key} className="relative overflow-hidden rounded-lg border border-border bg-card p-5">
            <div className={cnColor(s.key)} />
            <div className="text-[28px] font-extrabold tracking-tight">{d ? (d.stats as any)[s.key] ?? 0 : '—'}</div>
            <div className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-semibold">Recent clients</h3>
          <div className="flex flex-col gap-2">
            {d?.recentClients.length ? d.recentClients.map((c) => (
              <Link key={c.id} to={`/clients/${c.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.company || '—'} · {c.calls} call{c.calls === 1 ? '' : 's'}</div>
                </div>
                <Badge variant={c.status} className="ml-auto">{c.status}</Badge>
              </Link>
            )) : <Empty text="No clients yet — start a call to create one." />}
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-sm font-semibold">Recent calls</h3>
          <div className="flex flex-col gap-2">
            {d?.recentCalls.length ? d.recentCalls.map((c) => (
              <Link key={c.id} to={`/calls/${c.id}`}
                className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-primary/40">
                <div className="min-w-0">
                  <div className="truncate font-medium">{c.client}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.product_name || '—'} · {fmtDate(c.created_at)}</div>
                </div>
              </Link>
            )) : <Empty text="No calls yet." />}
          </div>
        </section>
      </div>
    </div>
  )
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{text}</div>
}
function cnColor(key: string) {
  const c = key === 'won' ? 'bg-success' : key === 'lost' ? 'bg-destructive' : 'bg-primary'
  return `absolute left-0 top-0 h-full w-[3px] ${c}`
}
