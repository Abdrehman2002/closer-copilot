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
    <div className="[perspective:1500px]">
      <div className="relative animate-float" style={{ transform: 'rotateY(-11deg) rotateX(5deg)', transformStyle: 'preserve-3d' }}>
        {/* soft glow */}
        <div className="absolute -inset-10 rounded-[40px] bg-primary/20 blur-[70px]" />
        {/* depth layer behind for a 3D stack */}
        <div className="absolute inset-0 translate-x-5 translate-y-6 rounded-2xl border border-black/5 bg-white/70 shadow-xl" />
        {/* the live-call window */}
        <div className="relative w-[380px] max-w-full overflow-hidden rounded-2xl border border-black/[0.07] bg-white shadow-[0_40px_80px_-20px_rgba(20,45,90,0.35)]">
          <div className="flex items-center gap-2 border-b border-black/5 bg-[#f4f5f7] px-4 py-2.5">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <span className="ml-2 text-xs font-medium text-slate-500">Live Call · Mike Torres</span>
            <span className="ml-auto flex items-center gap-1.5 text-[11px] font-semibold text-red-500"><span className="h-2 w-2 animate-pulse rounded-full bg-red-500" /> live</span>
          </div>
          <div className="flex min-h-[300px] flex-col gap-3 bg-[#f8f9fb] p-4">
            <div className="ml-auto max-w-[80%] rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-[13px] text-slate-700">
              <span className="mb-0.5 block text-[10px] font-bold uppercase tracking-wider text-primary">Me</span>
              So with setup it's fourteen hundred, all in.
            </div>
            <div key={`p${i}`} className="max-w-[86%] animate-fade-up rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2 text-[13px] text-slate-700">
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
    </div>
  )
}

const chips = ['Live whisper', 'Deal memory', 'Your playbooks']

// fixedLight: for panels whose background stays light regardless of app theme (the visual
// panel's gradient is hardcoded light) , the mark must not theme-swap there or it disappears.
function Wordmark({ fixedLight }: { fixedLight?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      {fixedLight ? (
        <img src="/brand/mark-blue.png" alt="Closer Copilot" className="h-[22px] w-[22px]" />
      ) : (
        <>
          <img src="/brand/mark-blue.png" alt="Closer Copilot" className="h-[22px] w-[22px] dark:hidden" />
          <img src="/brand/mark-white.png" alt="Closer Copilot" className="hidden h-[22px] w-[22px] dark:block" />
        </>
      )}
      <span className="text-[17px] font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
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
    <div className="grid min-h-[100dvh] grid-cols-1 overflow-hidden md:grid-cols-2">
      {/* VISUAL (left) */}
      <div className="relative hidden flex-col items-center justify-between overflow-hidden border-r border-border bg-gradient-to-br from-[#eef3fd] via-white to-[#e7effe] p-12 text-center md:flex">
        <div className="pointer-events-none absolute -left-24 -top-28 h-[420px] w-[420px] rounded-full bg-primary/[0.07] blur-[100px]" />

        <div className="relative z-10"><Wordmark fixedLight /></div>

        <div className="relative z-10 flex max-w-[440px] flex-col items-center">
          <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">Know exactly what to say<br /><span className="text-primary">live, on every call.</span></h1>
          <p className="mt-2 text-sm text-muted-foreground">Whispered coaching that hears the objection and hands you the line.</p>
          <div className="mt-8 flex justify-center"><CoachDemo /></div>
        </div>

        <p className="relative z-10 text-[11px] font-medium text-foreground/50">
          {chips.map((c, i) => <span key={c}>{i > 0 && ' · '}{c}</span>)}
        </p>
      </div>

      {/* FORM (right) */}
      <div className="flex items-center justify-center bg-background px-6 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8"><Wordmark /></div>
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
  )
}
