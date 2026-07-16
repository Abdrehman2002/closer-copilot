import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Billing as BillingData } from '@/lib/types'
import { DashboardSkeleton } from '@/components/Skeleton'
import { DollarSign, Cpu, Layers, AlertTriangle } from 'lucide-react'

const KIND_LABEL: Record<string, string> = {
  live: 'Live coaching', battle_plan: 'Battle plans', client_brain: 'Client Brain updates',
  playbook: 'Playbook building', review: 'Post-call reviews', live_retry: 'Coaching retries (fact-check)',
}

export default function Billing() {
  const [b, setB] = useState<BillingData | null>(null)
  useEffect(() => { api<BillingData>('/api/billing').then(setB) }, [])

  if (!b) return <DashboardSkeleton />

  const maxCost = Math.max(0.0001, ...b.last14.map((d) => d.cost))
  const fmt = (n: number) => (n < 0.01 && n > 0 ? '<$0.01' : `$${n.toFixed(2)}`)

  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <h2 className="text-xl font-bold tracking-tight">Billing</h2>
      <p className="mt-1 text-sm text-muted-foreground">Real token usage and cost from every AI call — know your margins.</p>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <DollarSign className="mb-2 h-4 w-4 text-primary" />
          <div className="text-2xl font-extrabold tracking-tight">{fmt(b.totalCost)}</div>
          <div className="mt-0.5 text-xs font-medium text-muted-foreground">Total spend</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <Cpu className="mb-2 h-4 w-4 text-primary" />
          <div className="text-2xl font-extrabold tracking-tight">{b.totalTokens.toLocaleString()}</div>
          <div className="mt-0.5 text-xs font-medium text-muted-foreground">Tokens used</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <Layers className="mb-2 h-4 w-4 text-primary" />
          <div className="text-2xl font-extrabold tracking-tight">{b.events}</div>
          <div className="mt-0.5 text-xs font-medium text-muted-foreground">AI calls logged</div>
        </div>
      </div>

      {b.unpricedEvents > 0 && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3.5 py-2.5 text-[13px] text-amber-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {b.unpricedEvents} call{b.unpricedEvents === 1 ? '' : 's'} used a model without a listed price — cost for those isn't included above.
        </div>
      )}

      <h3 className="mb-3 mt-8 text-sm font-semibold">Spend, last 14 days</h3>
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex h-32 items-end gap-2">
          {b.last14.map((d) => (
            <div key={d.day} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="w-full rounded-t-sm bg-primary/70" style={{ height: `${Math.max(4, (d.cost / maxCost) * 100)}%` }} title={`${d.day}: ${fmt(d.cost)}`} />
              <span className="text-[9px] text-muted-foreground">{d.day.slice(5).replace('-', '/')}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">By model</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {b.byModel.length === 0 && <div className="p-4 text-sm text-muted-foreground">No usage yet.</div>}
            {b.byModel.map((m, i) => (
              <div key={m.model} className={`flex items-center justify-between px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}>
                <span className="font-mono text-[13px]">{m.model}{m.unpriced && <span className="ml-1.5 text-[10px] text-amber-600">unpriced</span>}</span>
                <span className="text-muted-foreground">{fmt(m.cost)}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">By purpose</h3>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            {b.byKind.length === 0 && <div className="p-4 text-sm text-muted-foreground">No usage yet.</div>}
            {b.byKind.map((k, i) => (
              <div key={k.kind} className={`flex items-center justify-between px-4 py-2.5 text-sm ${i > 0 ? 'border-t border-border' : ''}`}>
                <span>{KIND_LABEL[k.kind] || k.kind}</span>
                <span className="text-muted-foreground">{fmt(k.cost)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
