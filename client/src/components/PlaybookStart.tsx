import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Interview } from '@/components/Interview'
import { Button } from '@/components/ui/button'
import { Sparkles, PenLine, ArrowRight } from 'lucide-react'

type Template = { id: string; name: string; blurb: string; content: string }

/**
 * How a user starts a playbook: pick a ready-made one (tweak later) or build from
 * scratch via the interview. Templates cut the blank-page friction for new users.
 */
export function PlaybookStart({ onDone }: { onDone: (id: string, name: string) => void }) {
  const [templates, setTemplates] = useState<Template[] | null>(null)
  const [scratch, setScratch] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    api<{ templates: Template[] }>('/api/playbook-templates').then((r) => setTemplates(r.templates || [])).catch(() => setTemplates([]))
  }, [])

  if (scratch) return <Interview onDone={onDone} />

  const pick = async (t: Template) => {
    setBusyId(t.id); setErr('')
    try {
      const r = await api<{ product: { id: string } }>('/api/products', { name: t.name, content: t.content })
      if (!r.product) throw new Error('Could not create it — try again.')
      onDone(r.product.id, t.name)
    } catch (e: any) { setErr(e.message || 'Something went wrong.'); setBusyId(null) }
  }

  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-primary">
        <Sparkles className="h-3.5 w-3.5" /> Start from a ready-made playbook
      </div>
      <p className="mb-4 text-sm text-muted-foreground">Pick what you sell and we'll drop in a full playbook — objections, trust lines, and the close already written. You just swap in your own prices. Editable anytime.</p>

      {err && <p className="mb-3 text-[13px] text-destructive">{err}</p>}

      {!templates ? (
        <div className="text-sm text-muted-foreground">Loading templates…</div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => pick(t)}
              disabled={!!busyId}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3.5 text-left transition-colors hover:border-primary/50 hover:bg-secondary disabled:opacity-60"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">{t.name}</div>
                <div className="mt-0.5 text-[12.5px] leading-snug text-muted-foreground">{t.blurb}</div>
              </div>
              <span className="mt-0.5 shrink-0 text-[11px] font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                {busyId === t.id ? 'Adding…' : <ArrowRight className="h-4 w-4" />}
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
        <div className="h-px flex-1 bg-border" /><span>or</span><div className="h-px flex-1 bg-border" />
      </div>

      <Button variant="outline" className="w-full justify-center" onClick={() => setScratch(true)} disabled={!!busyId}>
        <PenLine className="h-4 w-4" /> Build from scratch — I sell something else
      </Button>
    </div>
  )
}
