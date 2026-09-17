import { useEffect, useState } from 'react'
import { useLiveCall } from '@/lib/liveCall'
import { Button } from '@/components/ui/button'
import { PhoneForwarded, CalendarCheck, X } from 'lucide-react'

// Cold call sprint UI: a persistent bar across dials, plus the one prompt that matters.
//
// The bar deliberately shows DIALS before anything else. On a sprint the closer's job is
// volume, and a screen that leads with a conversion rate makes a bad hour feel like a verdict
// halfway through it.
export function SprintPanel() {
  const { state, live } = useLiveCall()
  const sp = state.sprint
  const appt = state.appointment

  if (!sp) return null

  return (
    <>
      <div className="mb-3 flex items-center gap-4 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-2.5 dark:border-blue-900 dark:bg-blue-950/40">
        <span className="flex items-center gap-2 text-sm font-semibold text-blue-900 dark:text-blue-200">
          <PhoneForwarded className="h-4 w-4" />
          Sprint · dial {sp.dial}
        </span>
        <span className="flex gap-3 text-xs text-blue-800/80 dark:text-blue-300/80">
          <b>{sp.stats.dials}</b> dials
          <span><b>{sp.stats.connects}</b> reached</span>
          <span><b>{sp.stats.appointments}</b> booked</span>
          <span><b>{sp.stats.clients}</b> added</span>
        </span>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => live.nextDial()}>Next dial →</Button>
          <Button size="sm" variant="outline" onClick={() => live.endSprint()}>End sprint</Button>
        </div>
      </div>

      {appt && <AppointmentPrompt key={appt.dial + appt.when} />}
    </>
  )
}

// Fires mid-call, so it is a corner card and not a modal — it must never sit on top of the
// coaching line the closer is reading while the prospect is still talking.
function AppointmentPrompt() {
  const { state, live } = useLiveCall()
  const appt = state.appointment
  const [f, setF] = useState({ name: '', company: '', phone: '', when: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (appt) setF({ name: appt.name, company: appt.company, phone: appt.phone, when: appt.when, note: appt.note })
  }, [appt?.dial, appt?.when])

  if (!appt) return null

  const add = async () => {
    if (!f.name.trim() && !f.company.trim()) { setErr('Give it a name or a company first.'); return }
    setSaving(true); setErr('')
    try { await live.addClient(f) }
    catch (e: any) { setErr(e?.message || 'Could not add — try again.'); setSaving(false) }
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 w-[340px] rounded-xl border border-emerald-300 bg-white p-4 shadow-xl dark:border-emerald-800 dark:bg-slate-900">
      <div className="mb-2 flex items-start gap-2">
        <CalendarCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        <div className="flex-1">
          <div className="text-sm font-semibold">Sounds like you booked it{appt.when ? ' — ' + appt.when : ''}</div>
          <div className="text-xs text-muted-foreground">Add them as a client?</div>
        </div>
        <button onClick={() => live.dismissAppointment()} aria-label="Dismiss" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Prefilled from what was actually said, and editable — the extractor only ever fills a
          field it heard, so a blank here means nobody said it, not that it guessed wrong. */}
      <div className="grid gap-1.5">
        <input className="rounded border px-2 py-1 text-sm" placeholder="Name" value={f.name}
          onChange={(e) => setF({ ...f, name: e.target.value })} />
        <input className="rounded border px-2 py-1 text-sm" placeholder="Company" value={f.company}
          onChange={(e) => setF({ ...f, company: e.target.value })} />
        <div className="flex gap-1.5">
          <input className="w-1/2 rounded border px-2 py-1 text-sm" placeholder="When" value={f.when}
            onChange={(e) => setF({ ...f, when: e.target.value })} />
          <input className="w-1/2 rounded border px-2 py-1 text-sm" placeholder="Phone" value={f.phone}
            onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
      </div>

      {err && <div className="mt-1.5 text-xs text-red-600">{err}</div>}

      <div className="mt-2.5 flex gap-2">
        <Button size="sm" className="flex-1" onClick={add} disabled={saving}>
          {saving ? 'Adding…' : 'Add as client'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => live.dismissAppointment()} disabled={saving}>Not now</Button>
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground">
        Keeps this call's transcript and seeds the Client Brain from it.
      </div>
    </div>
  )
}
