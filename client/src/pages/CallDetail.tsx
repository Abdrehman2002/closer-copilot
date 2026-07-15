import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { CallDetail as Call } from '@/lib/types'
import { fmtDate, fmtDur } from '@/lib/format'
import { CoachingCard } from '@/lib/coaching'
import { DetailSkeleton } from '@/components/Skeleton'
import { ArrowLeft } from 'lucide-react'

export default function CallDetail() {
  const { id } = useParams()
  const [call, setCall] = useState<Call | null | undefined>(undefined)
  useEffect(() => { api<{ call: Call | null }>(`/api/calls/${id}`).then((r) => setCall(r.call)) }, [id])

  if (call === undefined) return <DetailSkeleton />
  if (!call) return <div className="p-8 text-sm text-muted-foreground">Not found.</div>

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7">
      <Link to="/calls" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Calls</Link>
      <div className="mb-1 flex items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight">{call.deals?.name ?? 'Call'}</h2>
        {call.deal_id && <Link to={`/clients/${call.deal_id}`} className="text-sm text-primary hover:underline">View client</Link>}
      </div>
      <div className="mb-5 text-sm text-muted-foreground">{call.product_name || '—'} · {fmtDate(call.created_at)} · {fmtDur(call.duration_sec)}</div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</div>
        <p className="text-sm leading-relaxed">{call.summary || '—'}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h3 className="mb-3 text-sm font-semibold">Transcript</h3>
          <div className="flex max-h-[62vh] flex-col gap-2 overflow-y-auto pr-1">
            {(call.transcript || []).map((t, i) => (
              <div key={i} className={`max-w-[92%] rounded-xl border px-3 py-2 text-[13.5px] leading-relaxed ${t.ch === 'me' ? 'self-end border-primary/20 bg-primary/5' : 'self-start border-amber-500/20 bg-amber-500/5'}`}>
                <span className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wider ${t.ch === 'me' ? 'text-primary' : 'text-amber-700'}`}>{t.ch === 'me' ? 'Me' : 'Prospect'}</span>
                {t.text}
              </div>
            ))}
            {!(call.transcript || []).length && <div className="text-sm text-muted-foreground">—</div>}
          </div>
        </section>
        <section>
          <h3 className="mb-3 text-sm font-semibold">Coaching that fired</h3>
          <div className="flex max-h-[62vh] flex-col gap-3 overflow-y-auto pr-1">
            {(call.cards || []).map((c, i) => <CoachingCard key={i} {...c} />)}
            {!(call.cards || []).length && <div className="text-sm text-muted-foreground">No cards fired.</div>}
          </div>
        </section>
      </div>
    </div>
  )
}
