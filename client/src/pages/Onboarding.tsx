import { useState } from 'react'
import type { Me } from '@/lib/types'
import { api } from '@/lib/api'
import { PlaybookStart } from '@/components/PlaybookStart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export default function Onboarding({ me, onComplete }: { me: Me; onComplete: () => void }) {
  const steps = ['name', 'closer', ...(!me.hasProducts ? ['playbook'] : []), ...(!me.hasClients ? ['client'] : []), 'done']
  const [i, setI] = useState(0)
  const next = () => setI((n) => n + 1)
  const step = steps[i]

  const [name, setName] = useState(me.name || '')
  const [tone, setTone] = useState('')
  const [framework, setFramework] = useState('')
  const [phrases, setPhrases] = useState('')
  const [neverSay, setNeverSay] = useState('')
  const [cName, setCName] = useState('')
  const [cCompany, setCCompany] = useState('')
  const [err, setErr] = useState('')

  const saveName = async () => { if (!name.trim()) return setErr('Enter your name'); await api('/api/profile', { name: name.trim() }); next() }
  const saveCloser = async () => {
    await api('/api/profile', { name: name.trim(), tone, framework, signature_phrases: phrases, never_say: neverSay })
    next()
  }
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

        {step === 'closer' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">How do you sell?</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">So the coach sounds like YOU, not a generic script. Edit this anytime in Settings.</p>
            <div className="space-y-3">
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Your tone</div>
                <Input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="e.g. calm and consultative, never pushy" />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Sales framework / style you run</div>
                <Input value={framework} onChange={(e) => setFramework(e.target.value)} placeholder="e.g. Chris Voss tactical empathy + question-led" />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Phrases you like to use</div>
                <Textarea value={phrases} onChange={(e) => setPhrases(e.target.value)} placeholder="e.g. makes sense? / totally fair" style={{ minHeight: 60 }} />
              </div>
              <div>
                <div className="mb-1.5 text-xs font-medium text-muted-foreground">Never say</div>
                <Textarea value={neverSay} onChange={(e) => setNeverSay(e.target.value)} placeholder="e.g. trust me / limited time only" style={{ minHeight: 60 }} />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button size="lg" onClick={saveCloser}>Continue</Button>
              <Button size="lg" variant="ghost" onClick={next}>Skip for now</Button>
            </div>
          </div>
        )}

        {step === 'playbook' && (
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Your first playbook</h1>
            <p className="mb-5 mt-1 text-sm text-muted-foreground">This is what the coach reads on every call. Start from a ready-made one and tweak it, or build your own.</p>
            <PlaybookStart onDone={() => next()} />
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
