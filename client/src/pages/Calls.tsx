import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import type { CallRow } from '@/lib/types'
import { fmtDate, fmtDur } from '@/lib/format'
import { ListSkeleton } from '@/components/Skeleton'

export default function Calls() {
  const [calls, setCalls] = useState<CallRow[] | null>(null)
  useEffect(() => { api<{ calls: CallRow[] }>('/api/calls').then((r) => setCalls(r.calls || [])) }, [])

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-7">
      <h2 className="mb-6 text-xl font-bold tracking-tight">Calls</h2>
      {!calls ? (
        <ListSkeleton />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {calls.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No calls recorded yet.</div>}
          {calls.map((c, i) => (
            <Link key={c.id} to={`/calls/${c.id}`}
              className={`flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-secondary ${i > 0 ? 'border-t border-border' : ''}`}>
              <div className="min-w-0">
                <div className="truncate font-medium">{c.client}</div>
                <div className="truncate text-xs text-muted-foreground">{c.product_name || '—'} · {fmtDate(c.created_at)} · {fmtDur(c.duration_sec)}</div>
              </div>
              <span className="ml-auto max-w-[45%] truncate text-xs text-muted-foreground">{c.summary}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
