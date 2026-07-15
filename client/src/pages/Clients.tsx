import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ClientRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Plus } from 'lucide-react'

export default function Clients() {
  const [clients, setClients] = useState<ClientRow[] | null>(null)
  const navigate = useNavigate()

  useEffect(() => { api<{ clients: ClientRow[] }>('/api/clients').then((r) => setClients(r.clients || [])) }, [])

  const add = async () => {
    const name = window.prompt('Client name (the person on the call):')
    if (!name) return
    const company = window.prompt('Company (optional):') || ''
    const r = await api<{ client: { id: string } }>('/api/clients', { name, company })
    if (r.client) navigate(`/clients/${r.client.id}`)
  }

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Clients</h2>
        <Button onClick={add}><Plus className="h-4 w-4" /> Add client</Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {!clients && <div className="p-6 text-sm text-muted-foreground">Loading…</div>}
        {clients && clients.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No clients yet.</div>}
        {clients?.map((c, i) => (
          <Link key={c.id} to={`/clients/${c.id}`}
            className={`flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-secondary ${i > 0 ? 'border-t border-border' : ''}`}>
            <div className="min-w-0">
              <div className="truncate font-medium">{c.name}</div>
              <div className="truncate text-xs text-muted-foreground">{c.company || '—'}</div>
            </div>
            <span className="ml-auto text-xs text-muted-foreground">{c.calls} call{c.calls === 1 ? '' : 's'}</span>
            <Badge variant={c.status}>{c.status}</Badge>
          </Link>
        ))}
      </div>
    </div>
  )
}
