import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type Q = { key: string; q: string; ph: string; short?: boolean; big?: boolean; required?: boolean }

const QUESTIONS: Q[] = [
  { key: 'name', short: true, required: true, q: 'What should we call this playbook? (usually the product or offer name)', ph: 'e.g. Vextria HVAC' },
  { key: 'offer', required: true, q: 'In a sentence or two, what exactly do you sell?', ph: 'An AI voice receptionist for HVAC companies that answers every call 24/7 and books the job.' },
  { key: 'outcome', q: "What's the real outcome the customer gets — the 'after' state?", ph: 'They never miss a job again; every call answered and booked, even after hours.' },
  { key: 'buyer', q: "Who's on the other end of the call — role, industry, their world?", ph: 'Owner-operator HVAC, out on jobs all day, answers the phone himself.' },
  { key: 'pain', q: "What's the #1 problem you solve — and what does NOT solving it cost them, in their terms?", ph: 'Missed calls become lost jobs — 5-6 a week, ~$300 each = real money walking away.' },
  { key: 'objections', big: true, q: 'Your objections — list the ones you hear most, in the prospect\'s words, each with your best answer.', ph: '"It\'s too expensive" -> compared to one lost job a week it pays for itself.\n"AI sounds robotic" -> ...\n"I already have an answering service" -> ...' },
  { key: 'proof', q: 'What proof do you have — results, numbers, testimonials — and any guarantee?', ph: 'One client recovered 8 jobs in month one. 30-day money-back guarantee.' },
  { key: 'competition', q: 'What else might they consider (including doing nothing), and why are you better?', ph: 'Cheap answering services just take messages; voicemail loses the job; we book it.' },
  { key: 'close', q: 'What EXACTLY are you asking them to do on the call — and your price, plus any REAL urgency?', ph: 'Start a paid pilot today. $1,400 setup + first month. A few onboarding slots left this month.' },
  { key: 'voice', q: 'How do you want to SOUND on these calls? Any phrases you always or never use?', ph: 'Calm, confident, consultative — never pushy. I always say "makes sense?"' },
]

export function Interview({ onDone }: { onDone: (id: string, name: string) => void }) {
  const [qi, setQi] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [val, setVal] = useState('')
  const [err, setErr] = useState('')
  const [building, setBuilding] = useState(false)

  const item = QUESTIONS[qi]

  const goto = (next: number, save = true) => {
    const a = save ? { ...answers, [item.key]: val.trim() } : answers
    setAnswers(a)
    if (next >= QUESTIONS.length) return compile(a)
    setQi(next); setVal(a[QUESTIONS[next].key] || ''); setErr('')
  }
  const compile = async (a: Record<string, string>) => {
    setBuilding(true)
    try {
      const c = await api<{ content: string }>('/api/playbook/compile', { answers: a })
      const r = await api<{ product: { id: string } }>('/api/products', { name: a.name || 'My playbook', content: c.content })
      onDone(r.product.id, a.name || 'My playbook')
    } catch (e: any) { setErr("Couldn't build it: " + e.message); setBuilding(false) }
  }

  if (building) {
    return (
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-primary">Building your playbook…</div>
        <p className="mt-1 text-sm text-muted-foreground">Turning your answers into a coaching playbook — a few seconds.</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-primary">Question {qi + 1} of {QUESTIONS.length}</div>

      {qi > 0 && (
        <div className="mb-4 max-h-[220px] space-y-2.5 overflow-y-auto pr-1">
          {QUESTIONS.slice(0, qi).filter((q) => answers[q.key]).map((q) => (
            <div key={q.key} className="border-l-2 border-primary/30 pl-3">
              <div className="text-[11px] text-muted-foreground">{q.q}</div>
              <div className="whitespace-pre-wrap text-[13px]">{answers[q.key]}</div>
            </div>
          ))}
        </div>
      )}

      <div className="mb-2.5 text-[17px] font-semibold leading-snug">{item.q}</div>
      {err && <div className="mb-2 text-[13px] text-destructive">{err}</div>}
      {item.short ? (
        <Input autoFocus value={val} placeholder={item.ph}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { if (item.required && !val.trim()) return setErr('This one is needed to build a useful playbook.'); goto(qi + 1) } }} />
      ) : (
        <Textarea autoFocus value={val} placeholder={item.ph} style={{ minHeight: item.big ? 170 : 110 }} onChange={(e) => setVal(e.target.value)} />
      )}

      <div className="mt-3 flex gap-2">
        {qi > 0 && <Button variant="outline" onClick={() => goto(qi - 1)}>Back</Button>}
        <Button onClick={() => { if (item.required && !val.trim()) return setErr('This one is needed to build a useful playbook.'); goto(qi + 1) }}>
          {qi === QUESTIONS.length - 1 ? 'Build my playbook' : 'Next'}
        </Button>
        {!item.required && <Button variant="ghost" onClick={() => { setVal(''); goto(qi + 1) }}>Skip</Button>}
      </div>
    </div>
  )
}
