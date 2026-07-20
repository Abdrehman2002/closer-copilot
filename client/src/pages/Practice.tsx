import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, token } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { CoachingCard } from '@/lib/coaching'
import { Brain } from '@/components/Brain'
import { Dumbbell, Send, RotateCcw, Mic, Keyboard, Sparkles } from 'lucide-react'

type Product = { id: string; name: string }
type Msg = { ch: 'me' | 'prospect'; text: string; wpm?: number }
type Coach = { tone: string; line: string; why?: string; technique?: string; confidence?: 'high' | 'low' }
type Delivery = { talkRatioPct: number | null; questions: number; fillers: number; longestMonologue: number; meWords: number; prospectWords: number }
type Review = { review: { score: number | null; notes?: string; text?: string }; delivery: Delivery }

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
  const [voice, setVoice] = useState(true)
  const [history, setHistory] = useState<Msg[]>([])
  const [coach, setCoach] = useState<Coach | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [listening, setListening] = useState(false)
  const [interim, setInterim] = useState('')
  const [review, setReview] = useState<Review | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [err, setErr] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  // streaming refs
  const wsRef = useRef<WebSocket | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const historyRef = useRef<Msg[]>([])
  const processingRef = useRef(false)
  const queueRef = useRef<{ text: string; wpm?: number }[]>([])
  const utterStartRef = useRef(0)
  const utterRef = useRef('')
  const silenceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const setHist = (h: Msg[]) => { historyRef.current = h; setHistory(h) }

  useEffect(() => {
    api<{ products: Product[] }>('/api/products').then((r) => {
      setProducts(r.products || [])
      if (r.products && r.products[0]) setProductId(r.products[0].id)
    })
    return () => teardownMic()
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [history, coach, busy, interim])

  // ---- send a closer turn (queued so streamed finals never overlap) ----
  const drain = async () => {
    if (processingRef.current) return
    const item = queueRef.current.shift()
    if (!item) return
    processingRef.current = true
    setBusy(true); setErr('')
    try {
      const { text, wpm } = item
      const hist = historyRef.current
      const r = await api<{ prospect: string; coach: Coach }>('/api/practice/reply', { productId, difficulty, history: hist.map(({ ch, text }) => ({ ch, text })), closerMessage: text })
      setHist([...hist, { ch: 'me', text, wpm }, { ch: 'prospect', text: r.prospect }])
      setCoach(r.coach && r.coach.line ? r.coach : null)
    } catch (e: any) { setErr(e.message || 'Something went wrong — try again.') }
    setBusy(false)
    processingRef.current = false
    if (queueRef.current.length) drain()
  }
  const submitCloser = (text: string, wpm?: number) => {
    const t = text.trim(); if (!t) return
    queueRef.current.push({ text: t, wpm })
    drain()
  }
  // the accumulated utterance is "done" once you've paused — submit it as a turn
  const finalizeTurn = () => {
    if (silenceRef.current) clearTimeout(silenceRef.current)
    const full = utterRef.current.trim()
    if (!full) return
    const secs = utterStartRef.current ? (Date.now() - utterStartRef.current) / 1000 : 0
    utterRef.current = ''; utterStartRef.current = 0; setInterim('')
    const words = (full.match(/\S+/g) || []).length
    submitCloser(full, secs > 1 ? Math.round((words / secs) * 60) : undefined)
  }

  // ---- continuous mic streaming ----
  const startMic = async () => {
    try {
      if (!streamRef.current) streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const t = await token()
      const proto = location.protocol === 'https:' ? 'wss://' : 'ws://'
      const ws = new WebSocket(proto + location.host + '/practice-audio?t=' + encodeURIComponent(t!))
      wsRef.current = ws
      ws.onopen = () => {
        const rec = new MediaRecorder(streamRef.current!, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
        rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === 1) e.data.arrayBuffer().then((b) => ws.send(b)) }
        rec.start(250); recRef.current = rec; setListening(true)
      }
      ws.onmessage = (m) => {
        const d = JSON.parse(m.data)
        if (d.type !== 'stt') return
        if (!utterStartRef.current && (d.text || utterRef.current)) utterStartRef.current = Date.now()
        if (d.isFinal) {
          if (d.text) utterRef.current = (utterRef.current ? utterRef.current + ' ' : '') + d.text
          setInterim(utterRef.current)
          if (d.speechFinal) { finalizeTurn(); return }
        } else if (d.text) {
          setInterim((utterRef.current ? utterRef.current + ' ' : '') + d.text)
        }
        // finalize on a detected pause (no new words for ~1.1s) — robust regardless of Deepgram's endpoint signal
        if (silenceRef.current) clearTimeout(silenceRef.current)
        silenceRef.current = setTimeout(() => { if (utterRef.current.trim()) finalizeTurn() }, 1100)
      }
      ws.onclose = () => setListening(false)
    } catch { setErr('Couldn’t access the mic. Allow mic access, or switch to typing.') }
  }
  const teardownMic = () => {
    if (silenceRef.current) clearTimeout(silenceRef.current)
    try { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop() } catch {}
    try { wsRef.current?.close() } catch {}
    streamRef.current?.getTracks().forEach((t) => t.stop())
    recRef.current = null; wsRef.current = null; streamRef.current = null
    utterRef.current = ''; utterStartRef.current = 0
    setListening(false); setInterim('')
  }

  const start = async () => {
    if (!productId) return setErr('Pick a playbook first.')
    setStarted(true); setHist([]); setCoach(null); setInput(''); setReview(null)
    setBusy(true)
    try {
      const r = await api<{ prospect: string; coach: Coach }>('/api/practice/reply', { productId, difficulty, history: [], closerMessage: '' })
      setHist([{ ch: 'prospect', text: r.prospect }])
      setCoach(r.coach && r.coach.line ? r.coach : null)
    } catch (e: any) { setErr(e.message || 'Could not start.') }
    setBusy(false)
    if (voice) startMic()
  }
  const replyText = () => { const m = input.trim(); if (!m || busy) return; setInput(''); submitCloser(m) }
  const reset = () => { teardownMic(); queueRef.current = []; processingRef.current = false; setStarted(false); setHist([]); setCoach(null); setInput(''); setErr(''); setReview(null) }

  const endPractice = async () => {
    teardownMic()
    setReviewing(true); setErr('')
    try {
      const pname = (products || []).find((p) => p.id === productId)?.name
      const r = await api<Review>('/api/practice/review', { transcript: historyRef.current.map(({ ch, text }) => ({ ch, text })), productName: pname })
      setReview(r)
    } catch (e: any) { setErr(e.message || 'Could not build the review.') }
    setReviewing(false)
  }

  // ---- setup ----
  if (!started) {
    return (
      <div className="mx-auto max-w-[620px] px-8 py-8">
        <div className="mb-2 flex items-center gap-2"><Dumbbell className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold tracking-tight">Practice a call</h2></div>
        <p className="mb-6 text-sm text-muted-foreground">Spar with an AI prospect. In voice mode it just listens — talk naturally, your words drop in when you pause, and you get a delivery review at the end.</p>
        {products && products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-8 text-center text-sm text-muted-foreground">
            You need a playbook first. <Link to="/playbooks/new" className="text-primary hover:underline">Create one</Link> and come back.
          </div>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Which playbook are you selling?</div>
              <select value={productId} onChange={(e) => setProductId(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2.5 text-sm outline-none focus:border-primary">
                {(products || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">How tough is the prospect?</div>
              <div className="grid grid-cols-3 gap-2">
                {DIFFS.map((d) => (
                  <button key={d.id} onClick={() => setDifficulty(d.id)} className={`rounded-xl border p-3 text-left transition-colors ${difficulty === d.id ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                    <div className={`text-sm font-semibold ${difficulty === d.id ? 'text-primary' : ''}`}>{d.label}</div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">{d.blurb}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">How do you want to respond?</div>
              <div className="flex gap-2">
                <button onClick={() => setVoice(true)} className={`flex-1 rounded-xl border p-3 text-left transition-colors ${voice ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${voice ? 'text-primary' : ''}`}><Mic className="h-4 w-4" /> Voice</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">Always listening — just talk</div>
                </button>
                <button onClick={() => setVoice(false)} className={`flex-1 rounded-xl border p-3 text-left transition-colors ${!voice ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${!voice ? 'text-primary' : ''}`}><Keyboard className="h-4 w-4" /> Type</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">Drill objections by typing</div>
                </button>
              </div>
            </div>
            {err && <p className="text-[13px] text-destructive">{err}</p>}
            <Button size="lg" className="w-full" onClick={start} disabled={!productId || busy}>{busy ? 'Setting up…' : 'Start practice'}</Button>
          </div>
        )}
      </div>
    )
  }

  // ---- review ----
  if (review) {
    const rv = review.review || ({} as any)
    const d = review.delivery
    const notes = rv.notes || rv.text || ''
    return (
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <div className="mb-5 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" /><h2 className="text-xl font-bold tracking-tight">Practice review</h2>
          {rv.score != null && <span className="ml-auto rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">{rv.score}/100</span>}
        </div>
        {d && <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Talk ratio" value={d.talkRatioPct == null ? '—' : `${d.talkRatioPct}%`} warn={(d.talkRatioPct ?? 0) > 65} />
          <Tile label="Questions" value={String(d.questions)} />
          <Tile label="Longest streak" value={`${d.longestMonologue}w`} warn={d.longestMonologue > 120} />
          <Tile label="Fillers" value={String(d.fillers)} warn={d.fillers >= 8} />
        </div>}
        {notes ? <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5"><Brain md={notes} /></div>
          : <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Not enough of the call to review — try a few more exchanges next time.</div>}
        <p className="mt-4 text-[11.5px] text-muted-foreground">Judged on your words, pace, and whether you followed the coaching — not the literal sound of your voice.</p>
        <div className="mt-5"><Button size="lg" onClick={reset}><RotateCcw className="h-4 w-4" /> Practice again</Button></div>
      </div>
    )
  }

  // ---- live session ----
  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] max-w-[820px] flex-col px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-primary" /><h2 className="text-base font-bold tracking-tight">Practice</h2></div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">{difficulty} prospect</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={endPractice} disabled={reviewing}>{reviewing ? 'Reviewing…' : 'End & review'}</Button>
          <Button variant="ghost" size="sm" onClick={reset}><RotateCcw className="h-3.5 w-3.5" /> New</Button>
        </div>
      </div>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto rounded-xl border border-border bg-card p-4">
        {history.map((m, i) => (
          <div key={i} className={`max-w-[85%] rounded-xl border px-3.5 py-2.5 text-[14px] leading-relaxed ${m.ch === 'me' ? 'self-end border-primary/20 bg-primary/5' : 'self-start border-amber-500/20 bg-amber-500/5'}`}>
            <span className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wider ${m.ch === 'me' ? 'text-primary' : 'text-amber-700'}`}>{m.ch === 'me' ? 'You' : 'Prospect'}</span>
            {m.text}
            {m.wpm != null && <span className={`ml-2 text-[10.5px] font-medium ${m.wpm > 180 ? 'text-amber-600' : 'text-muted-foreground'}`}>≈{m.wpm} wpm{m.wpm > 180 ? ' · slow down' : ''}</span>}
          </div>
        ))}
        {interim && <div className="max-w-[85%] self-end rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-[14px] italic leading-relaxed text-muted-foreground">{interim}…</div>}
        {(busy && !interim) && <div className="self-start text-[12px] italic text-muted-foreground">prospect is thinking…</div>}
      </div>

      {coach && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Suggested line — say it out loud</div>
          <CoachingCard tone={coach.tone} line={coach.line} why={coach.why} technique={coach.technique} confidence={coach.confidence} />
        </div>
      )}

      {err && <p className="mt-2 text-[13px] text-destructive">{err}</p>}

      {voice ? (
        <div className="mt-3 flex items-center justify-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
          <span className={`relative flex h-2.5 w-2.5 ${listening ? '' : 'opacity-40'}`}>
            {listening && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-destructive opacity-70" />}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${listening ? 'bg-destructive' : 'bg-muted-foreground'}`} />
          </span>
          <Mic className="h-4 w-4 text-muted-foreground" />
          <span className="text-[13px] text-muted-foreground">{listening ? 'Listening — just talk. Your words drop in when you pause.' : 'Starting mic…'}</span>
          <button onClick={() => { teardownMic(); setVoice(false) }} className="ml-auto text-[11.5px] text-muted-foreground hover:text-foreground">type instead</button>
        </div>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); replyText() } }}
            placeholder="Type what you'd say back…" rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-primary" />
          <div className="flex flex-col gap-1">
            <Button size="lg" onClick={replyText} disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
            <button onClick={() => { setVoice(true); startMic() }} className="text-[10px] text-muted-foreground hover:text-foreground">use voice</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-bold tracking-tight ${warn ? 'text-amber-600' : ''}`}>{value}</div>
    </div>
  )
}
