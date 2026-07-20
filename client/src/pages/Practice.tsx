import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, token } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { CoachingCard } from '@/lib/coaching'
import { Brain } from '@/components/Brain'
import { Dumbbell, Send, RotateCcw, Mic, Square, Keyboard, Sparkles } from 'lucide-react'

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
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [err, setErr] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)

  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const recStartRef = useRef(0)

  useEffect(() => {
    api<{ products: Product[] }>('/api/products').then((r) => {
      setProducts(r.products || [])
      if (r.products && r.products[0]) setProductId(r.products[0].id)
    })
    return () => { streamRef.current?.getTracks().forEach((t) => t.stop()) }
  }, [])
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) }, [history, coach, busy])

  const send = async (closerMessage: string, hist: Msg[], wpm?: number) => {
    setBusy(true); setErr('')
    try {
      const r = await api<{ prospect: string; coach: Coach }>('/api/practice/reply', { productId, difficulty, history: hist.map(({ ch, text }) => ({ ch, text })), closerMessage })
      const withMe = closerMessage ? [...hist, { ch: 'me', text: closerMessage, wpm } as Msg] : hist
      setHistory([...withMe, { ch: 'prospect', text: r.prospect }])
      setCoach(r.coach && r.coach.line ? r.coach : null)
    } catch (e: any) { setErr(e.message || 'Something went wrong — try again.') }
    setBusy(false)
  }

  const start = async () => {
    if (!productId) return setErr('Pick a playbook first.')
    setStarted(true); setHistory([]); setCoach(null); setInput(''); setReview(null)
    await send('', [])
  }
  const replyText = async () => {
    const msg = input.trim()
    if (!msg || busy) return
    setInput('')
    await send(msg, history)
  }
  const reset = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null
    setStarted(false); setHistory([]); setCoach(null); setInput(''); setErr(''); setReview(null)
  }

  // ---- voice capture (one recorded turn at a time → Deepgram → text) ----
  const startRec = async () => {
    setErr('')
    try {
      if (!streamRef.current) streamRef.current = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const rec = new MediaRecorder(streamRef.current, { mimeType: 'audio/webm;codecs=opus' })
      chunksRef.current = []
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      rec.onstop = onRecStop
      recRef.current = rec
      recStartRef.current = Date.now()
      rec.start()
      setRecording(true)
    } catch { setErr('Couldn’t access the mic. Allow mic access, or switch to typing.') }
  }
  const stopRec = () => { if (recRef.current && recRef.current.state !== 'inactive') recRef.current.stop(); setRecording(false) }
  const onRecStop = async () => {
    const secs = (Date.now() - recStartRef.current) / 1000
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
    if (!blob.size) return
    setTranscribing(true); setErr('')
    try {
      const t = await token()
      const r = await fetch('/api/practice/stt', { method: 'POST', headers: { 'Content-Type': 'audio/webm', Authorization: `Bearer ${t}` }, body: blob })
      const { text } = await r.json()
      setTranscribing(false)
      const msg = (text || '').trim()
      if (!msg) { setErr('Didn’t catch that — try again a bit louder.'); return }
      const words = (msg.match(/\S+/g) || []).length
      const wpm = secs > 1 ? Math.round((words / secs) * 60) : undefined
      await send(msg, history, wpm)
    } catch { setTranscribing(false); setErr('Transcription failed — try again or switch to typing.') }
  }

  const endPractice = async () => {
    setReviewing(true); setErr('')
    try {
      const pname = (products || []).find((p) => p.id === productId)?.name
      const r = await api<Review>('/api/practice/review', { transcript: history.map(({ ch, text }) => ({ ch, text })), productName: pname })
      setReview(r)
    } catch (e: any) { setErr(e.message || 'Could not build the review.') }
    setReviewing(false)
  }

  // ---- setup ----
  if (!started) {
    return (
      <div className="mx-auto max-w-[620px] px-8 py-8">
        <div className="mb-2 flex items-center gap-2">
          <Dumbbell className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Practice a call</h2>
        </div>
        <p className="mb-6 text-sm text-muted-foreground">Spar with an AI prospect before the real thing. Speak your lines out loud — the same coach whispers what to say, and you get a delivery review at the end.</p>

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
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">How do you want to respond?</div>
              <div className="flex gap-2">
                <button onClick={() => setVoice(true)} className={`flex-1 rounded-xl border p-3 text-left transition-colors ${voice ? 'border-primary bg-primary/5' : 'border-border hover:bg-secondary'}`}>
                  <div className={`flex items-center gap-1.5 text-sm font-semibold ${voice ? 'text-primary' : ''}`}><Mic className="h-4 w-4" /> Voice</div>
                  <div className="mt-0.5 text-[11.5px] text-muted-foreground">Speak out loud — realistic rehearsal</div>
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

  // ---- review screen ----
  if (review) {
    const rv = review.review || {} as any
    const d = review.delivery
    const notes = rv.notes || rv.text || ''
    return (
      <div className="mx-auto max-w-[680px] px-8 py-8">
        <div className="mb-5 flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-bold tracking-tight">Practice review</h2>
          {rv.score != null && <span className="ml-auto rounded-full bg-primary px-3 py-1 text-sm font-bold text-primary-foreground">{rv.score}/100</span>}
        </div>
        {d && <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile label="Talk ratio" value={d.talkRatioPct == null ? '—' : `${d.talkRatioPct}%`} warn={(d.talkRatioPct ?? 0) > 65} />
          <Tile label="Questions" value={String(d.questions)} />
          <Tile label="Longest streak" value={`${d.longestMonologue}w`} warn={d.longestMonologue > 120} />
          <Tile label="Fillers" value={String(d.fillers)} warn={d.fillers >= 8} />
        </div>}
        {notes ? (
          <div className="rounded-xl border border-primary/25 bg-primary/[0.04] p-5"><Brain md={notes} /></div>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground">Not enough of the call to review — try a few more exchanges next time.</div>
        )}
        <p className="mt-4 text-[11.5px] text-muted-foreground">Delivery is judged on your words, pace, and whether you followed the coaching — not the actual sound of your voice.</p>
        <div className="mt-5 flex gap-2">
          <Button size="lg" onClick={reset}><RotateCcw className="h-4 w-4" /> Practice again</Button>
        </div>
      </div>
    )
  }

  const lastMe = [...history].reverse().find((m) => m.ch === 'me')

  // ---- live session ----
  return (
    <div className="mx-auto flex h-[calc(100vh-56px)] max-w-[820px] flex-col px-6 py-5">
      <div className="mb-3 flex items-center gap-3">
        <div className="flex items-center gap-2"><Dumbbell className="h-4 w-4 text-primary" /><h2 className="text-base font-bold tracking-tight">Practice</h2></div>
        <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold capitalize text-muted-foreground">{difficulty} prospect</span>
        <div className="ml-auto flex items-center gap-2">
          {history.some((m) => m.ch === 'me') && <Button variant="outline" size="sm" onClick={endPractice} disabled={reviewing || busy}>{reviewing ? 'Reviewing…' : 'End & review'}</Button>}
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
        {(busy || transcribing) && <div className="self-start text-[12px] italic text-muted-foreground">{transcribing ? 'transcribing…' : 'prospect is thinking…'}</div>}
      </div>

      {coach && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Suggested line — say it out loud</div>
          <CoachingCard tone={coach.tone} line={coach.line} why={coach.why} technique={coach.technique} confidence={coach.confidence} />
        </div>
      )}

      {err && <p className="mt-2 text-[13px] text-destructive">{err}</p>}

      {voice ? (
        <div className="mt-3 flex flex-col items-center gap-1.5">
          <Button size="lg" onClick={recording ? stopRec : startRec} disabled={busy || transcribing}
            className={recording ? 'w-full bg-destructive hover:bg-destructive/90' : 'w-full'}>
            {recording ? <><Square className="h-4 w-4" /> Stop &amp; send</> : <><Mic className="h-4 w-4" /> {lastMe ? 'Speak your reply' : 'Speak'}</>}
          </Button>
          <button onClick={() => setVoice(false)} className="text-[11.5px] text-muted-foreground hover:text-foreground">or type instead</button>
        </div>
      ) : (
        <div className="mt-3 flex items-end gap-2">
          <textarea value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); replyText() } }}
            placeholder="Type what you'd say back…" rows={2}
            className="flex-1 resize-none rounded-xl border border-border bg-card px-3.5 py-2.5 text-sm outline-none focus:border-primary" />
          <div className="flex flex-col gap-1">
            <Button size="lg" onClick={replyText} disabled={busy || !input.trim()}><Send className="h-4 w-4" /></Button>
            <button onClick={() => setVoice(true)} className="text-[10px] text-muted-foreground hover:text-foreground">use voice</button>
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
