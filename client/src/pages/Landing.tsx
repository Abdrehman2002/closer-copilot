import { useEffect, useState } from 'react'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { CoachingCard } from '@/lib/coaching'
import { Headphones, MessagesSquare, BrainCircuit, Check, ArrowRight, Radio } from 'lucide-react'

const SCENES = [
  { prospect: 'Honestly, fourteen hundred is a lot right now.', tone: 'CALM · slow', line: "I hear you — |||| most owners said the same… ↘ until they counted the *missed* calls." },
  { prospect: 'I already have an answering service.', tone: 'CURIOUS · genuine', line: "Totally fair — || what does yours do when a *job's* on the line? ↗" },
  { prospect: 'Let me think about it, run it by my brother.', tone: 'WARM · slower', line: "Of course — || is it the *price* you're weighing, || or whether it'll work? ↗" },
]

function CoachDemo() {
  const [i, setI] = useState(0)
  const [showCard, setShowCard] = useState(false)
  useEffect(() => {
    setShowCard(false)
    const t1 = setTimeout(() => setShowCard(true), 1100)
    const t2 = setTimeout(() => setI((x) => (x + 1) % SCENES.length), 4800)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [i])
  const s = SCENES[i]

  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-full bg-primary/20 blur-[90px]" />
      <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-white shadow-2xl">
        <div className="flex items-center gap-2 border-b border-black/5 bg-[#f4f5f7] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 text-xs font-medium text-slate-500">Live Call — Mike Torres</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-red-500"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> transcribing</span>
        </div>
        <div className="flex min-h-[300px] flex-col gap-3 bg-[#f8f9fb] p-4">
          <div className="ml-auto max-w-[78%] rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[13px] text-slate-700">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-primary">Me</span>
            So with setup it's fourteen hundred, all in.
          </div>
          <div key={`p${i}`} className="max-w-[85%] animate-fade-up rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[13px] text-slate-700">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-amber-700">Prospect</span>
            {s.prospect}
          </div>
          {showCard && (
            <div key={`c${i}`} className="mt-auto animate-fade-up">
              <CoachingCard tone={s.tone} line={s.line} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const steps = [
  { icon: Headphones, title: 'Listen', text: 'Join your Google Meet. It hears you and the prospect live — no bot joins the call.' },
  { icon: MessagesSquare, title: 'Coach', text: 'The moment they push back, it whispers the exact line — the words, the tone, the pauses.' },
  { icon: BrainCircuit, title: 'Remember', text: 'After the call it writes a Client Brain, and briefs you before the next one.' },
]
const features = [
  { title: 'Live whisper', text: 'One glanceable line at a time, grounded in real sales psychology — never a generic script.' },
  { title: 'Deal memory', text: "It remembers every objection, commitment and stakeholder, so call #3 knows what happened on call #1." },
  { title: 'Your playbooks', text: 'Answer a few questions about what you sell; it builds the coaching around your offer and your best lines.' },
]

function Field(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="h-11 w-full rounded-lg border border-white/10 bg-white/5 px-3.5 text-sm text-white placeholder:text-white/35 outline-none transition-colors focus:border-primary focus:bg-white/[0.07]" />
}

export default function Landing() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const prev = document.body.style.background
    document.body.style.background = '#080a10'
    return () => { document.body.style.background = prev }
  }, [])

  const signIn = async () => {
    setBusy(true); setMsg({ t: 'Signing in…', ok: true })
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass })
    setBusy(false); if (error) setMsg({ t: error.message })
  }
  const signUp = async () => {
    setBusy(true); setMsg({ t: 'Creating your workspace…', ok: true })
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pass })
    setBusy(false); if (error) return setMsg({ t: error.message })
    if (!data.session) setMsg({ t: 'Account created — check your email to confirm, then sign in.', ok: true })
  }
  const toAuth = () => document.getElementById('auth')?.scrollIntoView({ behavior: 'smooth' })

  return (
    <div className="min-h-screen bg-[#080a10] text-white">
      {/* nav */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2.5">
          <div className="h-5 w-5 rounded-[6px] bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.6)]" />
          <span className="text-[15px] font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
        </div>
        <button onClick={toAuth} className="rounded-lg border border-white/10 px-4 py-2 text-sm font-medium text-white/80 transition-colors hover:bg-white/5 hover:text-white">Sign in</button>
      </header>

      {/* hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-6 pb-20 pt-10 lg:grid-cols-2">
        <div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[12px] font-medium text-white/70">
            <Radio className="h-3.5 w-3.5 text-primary" /> Live coaching for sales calls
          </span>
          <h1 className="mt-5 text-[42px] font-extrabold leading-[1.05] tracking-tight sm:text-[52px]">
            Know exactly what to say<br /><span className="text-primary">on every sales call.</span>
          </h1>
          <p className="mt-5 max-w-lg text-[16px] leading-relaxed text-white/60">
            Live, whispered coaching grounded in your product and the memory of every deal — so you never fumble an objection or forget where you left off.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button size="lg" onClick={toAuth}>Get started <ArrowRight className="h-4 w-4" /></Button>
            <a href="#how" className="inline-flex h-11 items-center rounded-lg border border-white/10 px-5 text-[15px] font-medium text-white/80 transition-colors hover:bg-white/5">See how it works</a>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-white/45">
            <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> Works on Google Meet</span>
            <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> No bot joins your call</span>
            <span className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-primary" /> Remembers every deal</span>
          </div>
        </div>
        <CoachDemo />
      </section>

      {/* how it works */}
      <section id="how" className="border-t border-white/5 bg-white/[0.015] py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-[30px] font-bold tracking-tight">From “uh…” to closed, in three steps</h2>
          <p className="mx-auto mt-2 max-w-md text-center text-white/55">You talk to your prospect. It does the rest, live.</p>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map((s, n) => (
              <div key={s.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary"><s.icon className="h-5 w-5" /></div>
                <div className="mb-1.5 text-[13px] font-semibold text-primary">Step {n + 1} · {s.title}</div>
                <p className="text-[15px] leading-relaxed text-white/70">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section className="py-20">
        <div className="mx-auto max-w-6xl px-6">
          <h2 className="text-center text-[30px] font-bold tracking-tight">Everything a closer needs</h2>
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-6">
                <div className="mb-2 text-[17px] font-semibold">{f.title}</div>
                <p className="text-[15px] leading-relaxed text-white/60">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* auth */}
      <section id="auth" className="border-t border-white/5 bg-white/[0.015] py-20">
        <div className="mx-auto max-w-md px-6 text-center">
          <h2 className="text-[28px] font-bold tracking-tight">Start closing smarter</h2>
          <p className="mt-2 text-white/55">Create your workspace in seconds.</p>
          <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.03] p-7 text-left">
            {msg.t && <p className={`mb-3 text-[13px] ${msg.ok ? 'text-primary' : 'text-red-400'}`}>{msg.t}</p>}
            <label className="mb-1.5 block text-xs font-medium text-white/50">Email</label>
            <Field type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            <label className="mb-1.5 mt-4 block text-xs font-medium text-white/50">Password</label>
            <Field type="password" autoComplete="current-password" placeholder="Your password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') signIn() }} />
            <Button className="mt-5 w-full" size="lg" disabled={busy} onClick={signIn}>Sign in</Button>
            <div className="my-3 flex items-center gap-3 text-xs text-white/30"><div className="h-px flex-1 bg-white/10" /><span>new here?</span><div className="h-px flex-1 bg-white/10" /></div>
            <button disabled={busy} onClick={signUp} className="h-11 w-full rounded-lg border border-white/10 text-[15px] font-medium text-white/85 transition-colors hover:bg-white/5">Create an account</button>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/5 py-8 text-center text-xs text-white/40">Closer Copilot · Built for closers.</footer>
    </div>
  )
}
