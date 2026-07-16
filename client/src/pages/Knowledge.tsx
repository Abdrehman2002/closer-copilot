import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { DocumentRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ListSkeleton } from '@/components/Skeleton'
import { FileText, Plus, Trash2 } from 'lucide-react'

export default function Knowledge() {
  const [docs, setDocs] = useState<DocumentRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [content, setContent] = useState('')

  const load = () => api<{ documents: DocumentRow[] }>('/api/documents').then((r) => setDocs(r.documents.filter((d) => d.scope === 'global')))
  useEffect(() => { load() }, [])

  const save = async () => {
    if (!name.trim() || !content.trim()) return
    await api('/api/documents', { name: name.trim(), content: content.trim() })
    setName(''); setContent(''); setAdding(false); load()
  }
  const del = async (id: string) => { await api(`/api/documents/${id}`, undefined, 'DELETE'); load() }

  return (
    <div className="mx-auto max-w-[800px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Knowledge base</h2>
          <p className="mt-1 text-sm text-muted-foreground">Docs available on every call — competitor comparisons, FAQs, pricing sheets. The coach pulls from these live when relevant.</p>
        </div>
        {!adding && <Button onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add document</Button>}
      </div>

      {adding && (
        <div className="mb-6 rounded-xl border border-border bg-card p-5">
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Title</div>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Competitor comparison" />
          <div className="mb-1.5 mt-3 text-xs font-medium text-muted-foreground">Content</div>
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} style={{ minHeight: 160 }} placeholder="Paste the doc content…" />
          <div className="mt-3 flex gap-2">
            <Button onClick={save}>Save</Button>
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {docs === null && <ListSkeleton rows={3} />}
      {docs !== null && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {docs.length === 0 && !adding && <div className="p-10 text-center text-sm text-muted-foreground">No documents yet — add your first.</div>}
          {docs.map((d, i) => (
            <div key={d.id} className={`flex items-center gap-3 px-5 py-3.5 ${i > 0 ? 'border-t border-border' : ''}`}>
              <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-medium">{d.name}</span>
              <button onClick={() => del(d.id)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
