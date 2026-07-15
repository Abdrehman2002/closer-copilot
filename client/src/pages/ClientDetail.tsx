import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ClientDetail as CDetail, Status } from '@/lib/types'
import { fmtDate, fmtDur } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Brain } from '@/components/Brain'
import { DetailSkeleton } from '@/components/Skeleton'
import { ArrowLeft, Download, Phone } from 'lucide-react'

export default function ClientDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [c, setC] = useState<CDetail | null | undefined>(undefined)
  const [notes, setNotes] = useState('')
  const [savedNotes, setSavedNotes] = useState(false)

  const load = () => api<{ client: CDetail }>(`/api/clients/${id}`).then((r) => { setC(r.client); setNotes(r.client?.notes || '') })
  useEffect(() => { load() }, [id])

  if (c === undefined) return <DetailSkeleton />
  if (!c) return <div className="p-8 text-sm text-muted-foreground">Not found.</div>

  const setStatus = async (status: Status) => { await api(`/api/clients/${id}`, { status }, 'PATCH'); load() }
  const saveNotes = async () => { await api(`/api/clients/${id}`, { notes }, 'PATCH'); setSavedNotes(true) }
  const download = () => {
    const blob = new Blob([c.memory_md || ''], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = (c.name || 'client').replace(/[^\w]+/g, '_') + '.md'; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 2000)
  }
  const brain = (c.memory_md || '').trim()

  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <Link to="/clients" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Clients</Link>

      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-bold tracking-tight">{c.name}</h2>
        <Badge variant={c.status}>{c.status}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setStatus('open')}>Open</Button>
          <Button variant="outline" size="sm" onClick={() => setStatus('won')}>Mark Won</Button>
          <Button variant="outline" size="sm" onClick={() => setStatus('lost')}>Mark Lost</Button>
          <Button size="sm" onClick={() => navigate(`/new?client=${id}`)}><Phone className="h-3.5 w-3.5" /> New call</Button>
        </div>
      </div>
      <div className="mb-6 text-sm text-muted-foreground">{c.company || '—'}</div>

      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">Client Brain <span className="font-normal text-muted-foreground">· auto-updated after every call</span></h3>
        {brain && <Button variant="ghost" size="sm" onClick={download}><Download className="h-3.5 w-3.5" /> .md</Button>}
      </div>
      <div className="rounded-xl border border-border bg-card p-5">
        {brain ? <Brain md={c.memory_md} /> : <span className="text-sm text-muted-foreground">No history yet — your first call will build this.</span>}
      </div>

      <div className="mt-6">
        <div className="mb-1.5 text-xs font-medium text-muted-foreground">Your notes</div>
        <Textarea value={notes} onChange={(e) => { setNotes(e.target.value); setSavedNotes(false) }} placeholder="Anything you want to remember about this client…" />
        <Button variant="outline" size="sm" className="mt-2" onClick={saveNotes}>{savedNotes ? 'Saved' : 'Save notes'}</Button>
      </div>

      <h3 className="mb-3 mt-8 text-sm font-semibold">Call history ({(c.calls || []).length})</h3>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {(c.calls || []).length === 0 && <div className="p-6 text-sm text-muted-foreground">No calls yet.</div>}
        {(c.calls || []).map((k, i) => (
          <Link key={k.id} to={`/calls/${k.id}`}
            className={`flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary ${i > 0 ? 'border-t border-border' : ''}`}>
            <div className="min-w-0">
              <div className="text-sm font-medium">{fmtDate(k.created_at)}</div>
              <div className="truncate text-xs text-muted-foreground">{k.summary}</div>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">{fmtDur(k.duration_sec)}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
