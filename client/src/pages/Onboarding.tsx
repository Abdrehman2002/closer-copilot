import { useState } from 'react'
import type { Me } from '@/lib/types'
import { api } from '@/lib/api'
import { Interview } from '@/components/Interview'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function Onboarding({ me, onComplete }: { me: Me; onComplete: () => void }) {
  const steps = ['name', ...(!me.hasProducts ? ['playbook'] : []), ...(!me.hasClients ? ['client'] : []), 'done']
  const [i, setI] = useState(0)
  const next = () => setI((n) => n + 1)
  const step = steps[i]

  const [name, setName] = useState(me.name || '')
  const [cName, setCName] = useState('')
  const [cCompany, setCCompany] = useState('')
  const [err, setErr] = useState('')

  const saveName = async () => { if (!name.trim()) return setErr('Enter your name'); await api('/api/profile', { name: name.trim() }); next() }
  const saveClient = async () => { if (!cName.trim()) return setErr('Enter a client name'); await api('/api/clients', { name: cName.trim(), company: cCompany.trim() }); next() }

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-[560px] rounded-2xl border border-border bg-card p-8 shadow-sm">
        <div className="mb-1 flex items-center gap-2.5">
          <div className="h-5 w-5 rounded-[6px] bg-primary" />
          <span className="text-[15px] font-semibold tracking-tight">Closer <span className="font-bold">Copilot</span></span>
        </div>
        <div className="mb-6 text-xs text-muted-foreground">Setup · step {i + 1} of {steps.length}</div>

        {step === 'name' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">What should we call you?</p>
            {err && <p className="mb-2 text-[13px] text-destructive">{err}</p>}
            <Input autoFocus value={name} placeholder="Your name" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') saveName() }} />
            <Button className="mt-4 w-full" size="lg" onClick={saveName}>Continue</Button>
          </div>
        )}

        {step === 'playbook' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Build your first playbook</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">A few quick questions about what you sell — the coach reads this on every call.</p>
            <Interview onDone={() => next()} />
          </div>
        )}

        {step === 'client' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Add your first client</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">The person you'll be selling to. Their memory builds from your first call.</p>
            {err && <p className="mb-2 text-[13px] text-destructive">{err}</p>}
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Client name</div>
            <Input autoFocus value={cName} placeholder="Person on the call" onChange={(e) => setCName(e.target.value)} />
            <div className="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">Company (optional)</div>
            <Input value={cCompany} placeholder="Their company" onChange={(e) => setCCompany(e.target.value)} />
            <Button className="mt-4 w-full" size="lg" onClick={saveClient}>Continue</Button>
          </div>
        )}

        {step === 'done' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">You're all set</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">Head to your close board and start your first call. On the call screen, hit <b>Test</b> to feel the coaching instantly.</p>
            <Button className="w-full" size="lg" onClick={onComplete}>Go to my close board</Button>
          </div>
        )}
      </div>
    </div>
  )
}
