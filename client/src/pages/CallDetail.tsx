import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { CallDetail as Call } from '@/lib/types'
import { fmtDate, fmtDur } from '@/lib/format'
import { CoachingCard } from '@/lib/coaching'
import { DetailSkeleton } from '@/components/Skeleton'
import { Brain } from '@/components/Brain'
import type { Delivery } from '@/lib/types'
import { ArrowLeft, Sparkles, Mic, HelpCircle, AlignLeft, Eraser } from 'lucide-react'

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
      <div className="mb-5 text-sm text-muted-foreground">
        {call.product_name || '—'} · {fmtDate(call.created_at)} · {fmtDur(call.duration_sec)}
        {call.goal && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">Goal: {call.goal.replace('_', ' ')}</span>}
        {call.outcome && call.outcome !== 'unknown' && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Outcome: {call.outcome.replace('_', ' ')}</span>}
      </div>

      <div className="mb-6 rounded-xl border border-border bg-card p-4">
        <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Summary</div>
        <p className="text-sm leading-relaxed">{call.summary || '—'}</p>
      </div>

      {call.review_notes && (
        <div className="mb-6 rounded-xl border border-primary/25 bg-primary/[0.04] p-4">
          <div className="mb-2 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <span className="text-xs font-bold uppercase tracking-wide text-primary">Coach's review of your delivery</span>
            {call.review_score != null && (
              <span className="ml-auto rounded-full bg-primary px-2.5 py-0.5 text-[12px] font-bold text-primary-foreground">{call.review_score}/100</span>
            )}
          </div>
          <Brain md={call.review_notes} />
        </div>
      )}

      {call.delivery && (call.delivery.meWords > 0 || call.delivery.prospectWords > 0) && (
        <DeliveryPanel d={call.delivery} />
      )}

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

function DeliveryPanel({ d }: { d: Delivery }) {
  // honest coaching cues from the numbers (tone = 'ok' | 'warn')
  const ratio = d.talkRatioPct
  const ratioTone = ratio == null ? 'ok' : ratio > 65 ? 'warn' : 'ok'
  const monoTone = d.longestMonologue > 120 ? 'warn' : 'ok'
  const fillerTone = d.fillers >= 8 ? 'warn' : 'ok'
  const tiles = [
    { icon: Mic, label: 'Talk ratio', value: ratio == null ? '—' : `${ratio}%`,
      sub: ratio == null ? 'your share of words' : ratio > 65 ? 'you talked more than they did — let them talk' : 'your share of words spoken', tone: ratioTone },
    { icon: HelpCircle, label: 'Questions you asked', value: String(d.questions),
      sub: d.questions >= 3 ? 'good discovery' : 'ask more to uncover pain', tone: 'ok' },
    { icon: AlignLeft, label: 'Longest monologue', value: `${d.longestMonologue}w`,
      sub: d.longestMonologue > 120 ? 'a long stretch — check in sooner' : 'your longest uninterrupted run', tone: monoTone },
    { icon: Eraser, label: 'Filler words', value: String(d.fillers),
      sub: d.fillers >= 8 ? 'trim the “um / like / you know”' : 'um, like, you know…', tone: fillerTone },
  ]
  return (
    <div className="mb-6">
      <div className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">Your delivery</div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-border bg-card p-3.5">
            <div className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </div>
            <div className={`text-2xl font-bold tracking-tight ${t.tone === 'warn' ? 'text-amber-600' : 'text-foreground'}`}>{t.value}</div>
            <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{t.sub}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
