import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { ClientRow } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ListSkeleton } from '@/components/Skeleton'
import { AddClientModal } from '@/components/AddClientModal'
import { Plus } from 'lucide-react'

export default function Clients() {
  const [clients, setClients] = useState<ClientRow[] | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const navigate = useNavigate()

  useEffect(() => { api<{ clients: ClientRow[] }>('/api/clients').then((r) => setClients(r.clients || [])) }, [])

  return (
    <div className="mx-auto max-w-[1000px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="text-xl font-bold tracking-tight">Clients</h2>
        <Button onClick={() => setShowAdd(true)}><Plus className="h-4 w-4" /> Add client</Button>
      </div>

      {showAdd && (
        <AddClientModal
          onClose={() => setShowAdd(false)}
          onCreated={(c) => navigate(`/clients/${c.id}`)}
        />
      )}

      {!clients ? (
        <ListSkeleton />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {clients.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No clients yet.</div>}
          {clients.map((c, i) => (
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
      )}
    </div>
  )
}
