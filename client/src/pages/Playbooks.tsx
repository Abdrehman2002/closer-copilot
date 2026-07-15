import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Product } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { ListSkeleton } from '@/components/Skeleton'
import { Plus, Layers } from 'lucide-react'

export default function Playbooks() {
  const [products, setProducts] = useState<Product[] | null>(null)
  const navigate = useNavigate()
  useEffect(() => { api<{ products: Product[] }>('/api/products').then((r) => setProducts(r.products || [])) }, [])

  return (
    <div className="mx-auto max-w-[900px] px-8 py-7">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Playbooks</h2>
          <p className="text-sm text-muted-foreground">What you sell. The coach reads the one you pick on every call.</p>
        </div>
        <Button onClick={() => navigate('/playbooks/new')}><Plus className="h-4 w-4" /> Add playbook</Button>
      </div>

      {!products ? (
        <ListSkeleton rows={3} />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {products.length === 0 && <div className="p-10 text-center text-sm text-muted-foreground">No playbooks yet — add your first.</div>}
          {products.map((p, i) => (
            <Link key={p.id} to={`/playbooks/${p.id}`}
              className={`flex items-center gap-3 px-5 py-4 transition-colors hover:bg-secondary ${i > 0 ? 'border-t border-border' : ''}`}>
              <Layers className="h-4 w-4 text-muted-foreground" />
              <span className="font-medium">{p.name}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
