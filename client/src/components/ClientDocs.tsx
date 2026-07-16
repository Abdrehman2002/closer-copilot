import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { DocumentRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { FileText, Plus, Trash2 } from 'lucide-react'

export function ClientDocs({ dealId }: { dealId: string }) {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const load = () => api<{ documents: DocumentRow[] }>(`/api/documents?dealId=${dealId}`).then((r) => setDocs(r.documents.filter((d) => d.scope === 'deal')))
  useEffect(() => { load() }, [dealId])

  const save = async () => {
    if (!name.trim() || !content.trim()) return
    await api('/api/documents', { name: name.trim(), content: content.trim(), dealId })
    setName(''); setContent(''); setAdding(false); load()
  }
  const del = async (id: string) => { await api(`/api/documents/${id}`, undefined, 'DELETE'); load() }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Documents for this client</h3>
        {!adding && <Button variant="ghost" size="sm" onClick={() => setAdding(true)}><Plus className="h-3.5 w-3.5" /> Add</Button>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Notes, past emails, proposals — the coach can pull from these live.</p>

      {adding && (
        <div className="mb-3 rounded-lg border border-border bg-card p-3">
          <input className="mb-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary"
            placeholder="Title" value={name} onChange={(e) => setName(e.target.value)} />
          <textarea className="mb-2 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus:border-primary" style={{ minHeight: 90 }}
            placeholder="Paste content…" value={content} onChange={(e) => setContent(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {docs === null && <div className="text-sm text-muted-foreground">Loading…</div>}
      {docs !== null && docs.length === 0 && !adding && <div className="text-sm text-muted-foreground">No documents yet.</div>}
      <div className="space-y-1.5">
        {docs?.map((d) => (
          <div key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.name}</span>
            <button onClick={() => del(d.id)} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
