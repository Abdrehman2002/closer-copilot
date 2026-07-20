import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { CoachingCard } from '@/lib/coaching'
import { Dumbbell, Send, RotateCcw } from 'lucide-react'

type Product = { id: string; name: string }
type Msg = { ch: 'me' | 'prospect'; text: string }
type Coach = { tone: string; line: string; why?: string; technique?: string; confidence?: 'high' | 'low' }

const DIFFS = [
  { id: 'warm', label: 'Warm', blurb: 'Receptive, light concerns' },
  { id: 'skeptical', label: 'Skeptical', blurb: 'Real objections, price-conscious' },
  { id: 'tough', label: 'Tough', blurb: 'Guarded, been burned, hard to move' },
]

export default function Practice() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const [productId, setProductId] = useState('')
  const [difficulty, setDifficulty] = useState('skeptical')
  const [started, setStarted] = useState(false)
  const [history, setHistory] = useState<Msg[]>([])
  const [coach, setCoach] = useState<Coach | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ products: Product[] }>('/api/products').then((r) => {
      setProducts(r.products || [])
      if (r.products && r.products[0]) setProductId(r.products[0].id)
    })
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [history, coach, busy])

  const send = async (closerMessage: string, hist: Msg[]) => {
    setBusy(true); setErr('')
    try {
      const r = await api<{ prospect: string; coach: Coach }>('/api/practice/reply', { productId, difficulty, history: hist, closerMessage })
      const withMe = closerMessage ? [...hist, { ch: 'me', text: closerMessage } as Msg] : hist
      setHistory([...withMe, { ch: 'prospect', text: r.prospect }])
      setCoach(r.coach && r.coach.line ? r.coach : null)
    } catch (e: any) { setErr(e.message || 'Something went wrong — try again.') }
    setBusy(false)
  }

  const start = async () => {
    if (!productId) return setErr('Pick a playbook first.')
    setStarted(true); setHistory([]); setCoach(null); setInput('')
    await send('', [])
  }
  const reply = async () => {
    const msg = input.trim()
    if (!msg || busy) return
    setInput('')
    await send(msg, history)
  }
  const reset = () => { setStarted(false); setHistory([]); setCoach(null); setInput(''); setErr('') }

  // ---- setup ----
  if (!started) {
    return (
      <div className="mx-auto max-w-[620px] px-8 py-8">
        <div className="mb-2 flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Practice a call</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">Spar with an AI prospect before the real thing. Same coach whispers your lines — no mic, no pressure. Great warm-up before a big call.</p>

        {products && products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            You need a playbook first. <Link to="/playbooks/new" className="text-primary hover:underline">Create one</Link> and come back.
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Which playbook are you selling?</div>
              <select value={productId} onChange={(e) => setProductId(e.target.value)}
                className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary">
                {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">How tough is the prospect?</div>
              <div className="grid grid-cols-3 gap-2">
                {DIFFS.map((d) => (
                  <button key={d.id} onClick={() => setDifficulty(d.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${difficulty === d.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                    <div className={`text-sm font-semibold ${difficulty === d.id ? 'text-primary' : ''}`}>{d.label}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{d.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
            {err && <p className="text-[13px] text-destructive">{err}</p>}
            <Button size="lg" className="w-full" onClick={start} disabled={!productId || busy}>{busy ? 'Setting up…' : 'Start practice'}</Button>
          </div>
        )}
      </div>
    )
  }

  // ---- session ----
  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] max-w-[820px] flex-col px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-2">
          <Dumbbell className="h-4 w-4 text-primary" />
          <h2 className="text-base font-bold tracking-tight">Practice</h2>
        </div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">{difficulty} prospect</span>
        <Button variant="outline" size="sm" className="ml-auto" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> New scenario</Button>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl border border-border bg-card p-4">
        {history.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 text-[14px] leading-relaxed ${m.ch === 'me' ? 'self-end border-primary/20 bg-primary/5' : 'self-start border-amber-500/20 bg-amber-500/5'}`}>
            <span className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wider ${m.ch === 'me' ? 'text-primary' : 'text-amber-700'}`}>{m.ch === 'me' ? 'You' : 'Prospect'}</span>
            {m.text}
          </div>
        ))}
        {busy && <div className="self-start text-[12px] italic text-muted-foreground">prospect is thinking…</div>}
      </div>

      {coach && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Suggested line</div>
          <CoachingCard tone={coach.tone} line={coach.line} why={coach.why} technique={coach.technique} confidence={coach.confidence} />
        </div>
      )}

      {err && <p className="mt-2 text-[13px] text-destructive">{err}</p>}

      <div className="mt-3 flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); reply() } }}
          placeholder="Type what you'd say back…"
          rows={2}
          className="flex-1 resize-none rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-primary"
        />
        <Button size="lg" onClick={reply} disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}
