import { useState } from 'react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AddClientModal({
  onCreated, onClose,
}: {
  onCreated: (client: { id: string; name: string }) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) return setErr('Client name is required.')
    setSaving(true)
    try {
      const r = await api<{ client: { id: string } }>('/api/clients', { name: name.trim(), company: company.trim() })
      if (!r.client) throw new Error('Something went wrong — try again.')
      onCreated({ id: r.client.id, name: name.trim() })
    } catch (e: any) {
      setErr(e.message || 'Something went wrong — try again.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-bold tracking-tight">Add client</h2>
        <p className="mt-1 text-sm text-muted-foreground">The person you'll be calling.</p>

        <div className="mt-5 space-y-3">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Client name</div>
            <Input autoFocus placeholder="e.g. Mike Sanders" value={name}
              onChange={(e) => { setName(e.target.value); setErr('') }}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Company (optional)</div>
            <Input placeholder="e.g. Sanders HVAC" value={company}
              onChange={(e) => setCompany(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') submit() }} />
          </div>
          {err && <div className="text-[13px] text-destructive">{err}</div>}
        </div>

        <div className="mt-6 flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={saving}>{saving ? 'Adding…' : 'Add client'}</Button>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </div>
  )
}
