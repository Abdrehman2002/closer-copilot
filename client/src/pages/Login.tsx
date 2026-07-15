import { useState } from 'react'
import { sb } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check } from 'lucide-react'

const bullets = [
  'Real-time objection handling, one line at a time',
  'Live two-speaker transcript on every call',
  'Deal memory that briefs you before you dial',
]

export default function Login() {
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [msg, setMsg] = useState<{ t: string; ok?: boolean }>({ t: '' })
  const [busy, setBusy] = useState(false)

  const signIn = async () => {
    setBusy(true); setMsg({ t: 'Signing in…', ok: true })
    const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password: pass })
    setBusy(false)
    if (error) setMsg({ t: error.message })
  }
  const signUp = async () => {
    setBusy(true); setMsg({ t: 'Creating account…', ok: true })
    const { data, error } = await sb.auth.signUp({ email: email.trim(), password: pass })
    setBusy(false)
    if (error) return setMsg({ t: error.message })
    if (!data.session) setMsg({ t: 'Account created — check your email to confirm, then sign in.', ok: true })
  }

  return (
    <div className="grid min-h-screen w-full md:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden border-r border-border bg-[#07090d] p-12 md:flex md:flex-col">
        <div className="pointer-events-none absolute -right-40 -top-40 h-[520px] w-[520px] rounded-full bg-primary/20 blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-52 -left-24 h-[420px] w-[420px] rounded-full bg-primary/10 blur-[130px]" />
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="h-6 w-6 rounded-md bg-primary shadow-[0_0_24px_hsl(var(--primary)/0.6)]" />
          <span className="text-[15px] font-semibold tracking-tight text-white">
            Closer <span className="font-bold">Copilot</span>
          </span>
        </div>
        <div className="relative z-10 mt-auto">
          <h1 className="text-4xl font-extrabold leading-[1.1] text-white">
            Close more of the calls<br />you're already taking.
          </h1>
          <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/60">
            Live, whispered coaching on every sales call — grounded in your product and the memory of every
            deal, so you always know exactly what to say next.
          </p>
          <ul className="mt-8 space-y-3">
            {bullets.map((b) => (
              <li key={b} className="flex items-center gap-3 text-sm text-white/80">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-primary">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
                {b}
              </li>
            ))}
          </ul>
        </div>
        <div className="relative z-10 mt-10 text-xs tracking-wide text-white/35">Built for closers.</div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-background px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 md:hidden">
            <div className="h-6 w-6 rounded-md bg-primary" />
            <span className="text-[15px] font-semibold tracking-tight">Closer Copilot</span>
          </div>
          <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">Sign in to your workspace.</p>

          <div className="mt-7 space-y-4">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@company.com"
                value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="pass">Password</Label>
              <Input id="pass" type="password" autoComplete="current-password" placeholder="Your password"
                value={pass} onChange={(e) => setPass(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') signIn() }} />
            </div>

            {msg.t && (
              <p className={`text-[13px] ${msg.ok ? 'text-success' : 'text-destructive'}`}>{msg.t}</p>
            )}

            <Button className="w-full" size="lg" disabled={busy} onClick={signIn}>Sign in</Button>

            <div className="flex items-center gap-3 py-1 text-xs text-muted-foreground">
              <div className="h-px flex-1 bg-border" /><span>new here?</span><div className="h-px flex-1 bg-border" />
            </div>

            <Button className="w-full" size="lg" variant="outline" disabled={busy} onClick={signUp}>
              Create an account
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
