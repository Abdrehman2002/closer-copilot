import { useState } from 'react'
import type { Outcome } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { CheckCircle2, XCircle, Clock3 } from 'lucide-react'

const OUTCOMES: { value: Outcome; label: string; icon: any }[] = [
  { value: 'closed', label: 'Closed', icon: CheckCircle2 },
  { value: 'follow_up', label: 'Follow-up needed', icon: Clock3 },
  { value: 'lost', label: 'Lost', icon: XCircle },
]

export function OutcomeModal({
  onSubmit, onSkip,
}: {
  onSubmit: (meta: { outcome?: Outcome; savedDeal?: boolean; savedDealNote?: string }) => void
  onSkip: () => void
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [savedDeal, setSavedDeal] = useState<boolean | null>(null)
  const [note, setNote] = useState('')

  const submit = () => onSubmit({
    outcome: outcome ?? undefined,
    savedDeal: savedDeal ?? undefined,
    savedDealNote: savedDeal ? note : undefined,
  })

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <h2 className="text-lg font-bold tracking-tight">Quick wrap-up</h2>
        <p className="mt-1 text-sm text-muted-foreground">Two taps — this is what builds your track record.</p>

        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-muted-foreground">How did this call go?</div>
          <div className="grid grid-cols-3 gap-2">
            {OUTCOMES.map((o) => (
              <button
                key={o.value}
                onClick={() => setOutcome(o.value)}
                className={cn(
                  'flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-xs font-medium transition-colors',
                  outcome === o.value ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground hover:bg-secondary'
                )}
              >
                <o.icon className="h-4 w-4" /> {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5">
          <div className="mb-2 text-xs font-medium text-muted-foreground">Did the copilot save a deal you were losing?</div>
          <div className="flex gap-2">
            <Button variant={savedDeal === true ? 'default' : 'outline'} className="flex-1" onClick={() => setSavedDeal(true)}>Yes</Button>
            <Button variant={savedDeal === false ? 'default' : 'outline'} className="flex-1" onClick={() => setSavedDeal(false)}>No</Button>
          </div>
          {savedDeal && (
            <Textarea
              className="mt-2"
              placeholder="Which line saved it? (optional)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              style={{ minHeight: 70 }}
            />
          )}
        </div>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" size="lg" onClick={submit}>Save call</Button>
          <Button variant="ghost" onClick={onSkip}>Skip</Button>
        </div>
      </div>
    </div>
  )
}
