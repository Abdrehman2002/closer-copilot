import { useEffect, useLayoutEffect, useState } from 'react'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CoachingCard } from '@/lib/coaching'

const SCENES = [
  { prospect: 'Honestly, fourteen hundred is a lot right now.', tone: 'CALM · slow', line: "I hear you, |||| most owners said the same… ↘ until they counted the *missed* calls." },
  { prospect: 'I already have an answering service.', tone: 'CURIOUS · genuine', line: "Totally fair, || what does yours do when a *job's* on the line? ↗" },
  { prospect: 'Let me run it by my brother first.', tone: 'WARM · slower', line: "Of course, || is it the *price* you're weighing, || or whether it'll work? ↗" },
]

// Landscape live-call demo: transcript stacks above, the coached line (real CoachingCard,
// same delivery-mark rendering as the live product) sits below in the same window, one
// card telling the whole story, not two cards split apart.
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
    <div className="relative w-full max-w-[720px] animate-float">
      <div className="absolute -inset-8 rounded-[32px] bg-primary/[0.14] blur-[60px]" />
      <div className="absolute inset-0 translate-x-3 translate-y-4 rounded-2xl border border-black/5 bg-white/70 shadow-xl" />
      <div className="relative w-full overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_30px_70px_-20px_rgba(20,45,90,0.30)]">
        <div className="flex items-center gap-2 border-b border-black/5 bg-[#f4f5f7] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
          <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
          <span className="ml-2 text-xs font-medium text-slate-500">Live Call · Mike Torres</span>
          <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-red-500"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> live</span>
        </div>
        <div className="flex min-h-[260px] flex-col gap-2.5 bg-[#f8f9fb] p-4">
          <div className="ml-auto max-w-[64%] rounded-xl border border-primary/20 bg-primary/5 px-3.5 py-2.5 text-[13.5px] text-slate-700">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-primary">Me</span>
            So with setup it's fourteen hundred, all in.
          </div>
          <div key={`p${i}`} className="max-w-[64%] animate-fade-up rounded-xl border border-amber-500/20 bg-amber-500/5 px-3.5 py-2.5 text-[13.5px] text-slate-700">
            <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-amber-700">Prospect</span>
            {s.prospect}
          </div>
          {showCard && (
            <div key={`c${i}`} className="animate-fade-up">
              <CoachingCard tone={s.tone} line={s.line} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const chips = ['Live whisper', 'Deal memory', 'Your playbooks']

// The whole page force-locks to light theme below (see useLayoutEffect in Landing), so the
// mark never needs to theme-swap here, always the blue variant, no dark asset to load.
function Wordmark() {
  return (
    <div className="flex items-center gap-2.5">
      <img src="/brand/mark-blue.png" alt="Closer Copilot" className="h-[27px] w-[27px]" />
      <span className="text-[19px] font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
    </div>
  )
}

export default function Landing() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: '' })
  const [busy, setBusy] = useState<'in' | 'up' | null>(null)

  // This is a fixed light-brand surface (the demo mockup and hero glow were built as one
  // consistent light look), lock it regardless of the app's dark-mode preference, which
  // resumes normally once signed in. Restores whatever was there on unmount.
  useLayoutEffect(() => {
    const root = document.documentElement
    const hadDark = root.classList.contains('dark')
    root.classList.remove('dark')
    return () => { if (hadDark) root.classList.add('dark') }
  }, [])

  const signIn = async () => {
    setBusy('in'); setMsg({ t: '' })
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass })
    setBusy(null); if (error) setMsg({ t: error.message })
  }
  const signUp = async () => {
    setBusy('up'); setMsg({ t: '' })
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pass })
    setBusy(null); if (error) return setMsg({ t: error.message })
    if (!data.session) setMsg({ t: 'Account created, check your email to confirm, then sign in.', ok: true })
  }

  return (
    // One shared canvas (no hard divider between a "hero side" and a "form side"), both
    // the demo card and the sign-in card float on the same gradient, which is what makes it
    // read as one designed page instead of two panels stitched together.
    <div className="relative min-h-[100dvh] bg-gradient-to-br from-[#d9e7fc] via-[#eef4fe] to-[#d6e5fb] px-6 py-8 md:px-10">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{ backgroundImage: 'radial-gradient(rgba(15,45,90,0.10) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
      />

      <div className="relative z-10 mx-auto max-w-[1180px]"><Wordmark /></div>

      <div className="relative z-10 mx-auto mt-6 flex max-w-[1180px] flex-col items-center gap-8 pb-8 lg:mt-7 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
        {/* MAIN: headline + live demo, the pitch, delivered in ~2 seconds */}
        <div className="flex w-full min-w-0 flex-1 flex-col items-center text-center lg:items-start lg:text-left">
          <h1 className="animate-hero-in text-[30px] font-extrabold leading-[1.12] tracking-tight md:text-[38px]">
            Never freeze on a sales call again.
          </h1>
          <p className="animate-hero-in mt-3 max-w-lg text-[15px] text-muted-foreground" style={{ animationDelay: '90ms' }}>
            It hears the objection and hands you the line, with the tone to say it in.
          </p>
          <div className="animate-hero-in mt-7 hidden w-full justify-center md:flex lg:justify-start" style={{ animationDelay: '180ms' }}>
            <CoachDemo />
          </div>
          <p className="animate-hero-in mt-6 text-[12px] font-medium text-foreground/50" style={{ animationDelay: '300ms' }}>
            {chips.map((c, i) => <span key={c}>{i > 0 && ' · '}{c}</span>)}
          </p>
        </div>

        {/* SIGN IN, unchanged flow (sign-in first), just given the same floating-card depth
            as the demo so both halves feel like one designed page */}
        <div className="relative w-full max-w-[400px] shrink-0">
          <div className="pointer-events-none absolute left-1/2 top-1/3 -z-10 h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/[0.06] blur-[100px]" />
          <div className="rounded-2xl border border-border bg-card p-7 shadow-[0_1px_2px_rgba(16,24,40,0.04),0_16px_40px_-12px_rgba(16,24,40,0.10)]">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your workspace.</p>

            <div className="mt-7 space-y-4">
              <div>
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" autoComplete="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="pass">Password</Label>
                <Input id="pass" type="password" autoComplete="current-password" placeholder="Your password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') signIn() }} />
              </div>
              <Button className="w-full" size="lg" disabled={busy !== null} onClick={signIn}>{busy === 'in' ? 'Signing in…' : 'Sign in'}</Button>
              <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /><span>new here?</span><div className="h-px flex-1 bg-border" />
              </div>
              <Button className="w-full" size="lg" variant="outline" disabled={busy !== null} onClick={signUp}>{busy === 'up' ? 'Creating…' : 'Create an account'}</Button>
              {msg.t && <p className={`text-[13px] ${msg.ok ? 'text-primary' : 'text-destructive'}`}>{msg.t}</p>}
              <p className="pt-1 text-center text-xs leading-relaxed text-muted-foreground">
                Backed by a 30-day guarantee: we measure your close rate together,
                and if it doesn't improve, full refund.
              </p>
              <p className="pt-2 text-center text-[10.5px] text-muted-foreground/60">Owned by Vextria AI</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
