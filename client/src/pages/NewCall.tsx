import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { api } from '@/lib/api'
import type { Product, ClientRow } from '@/lib/types'
import { liveCall } from '@/lib/liveCall'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const selectCls = 'flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm focus-visible:outline-none focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25'

export default function NewCall() {
  const [products, setProducts] = useState<Product[]>([])
  const [clients, setClients] = useState<ClientRow[]>([])
  const [ready, setReady] = useState(false)
  const [productId, setProductId] = useState('')
  const [clientId, setClientId] = useState('')
  const [ncName, setNcName] = useState('')
  const [ncCompany, setNcCompany] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const [params] = useSearchParams()

  useEffect(() => {
    Promise.all([
      api<{ products: Product[] }>('/api/products'),
      api<{ clients: ClientRow[] }>('/api/clients'),
    ]).then(([p, c]) => {
      setProducts(p.products || []); setClients(c.clients || [])
      setProductId(p.products?.[0]?.id || '')
      const pre = params.get('client')
      setClientId(pre && (c.clients || []).some((x) => x.id === pre) ? pre : '')
      setReady(true)
    })
  }, [])

  const start = async () => {
    setBusy(true); setMsg('')
    try {
      let dealId = clientId
      if (!dealId) {
        if (!ncName.trim()) { setMsg('Enter a client name or pick one.'); setBusy(false); return }
        const r = await api<{ client: { id: string } }>('/api/clients', { name: ncName.trim(), company: ncCompany.trim() })
        dealId = r.client.id
      }
      await liveCall.start(dealId, productId)
      navigate('/live')
    } catch (e: any) { setMsg(e.message); setBusy(false) }
  }

  if (ready && products.length === 0) {
    return (
      <div className="mx-auto max-w-[560px] px-8 py-7">
        <h2 className="mb-3 text-xl font-bold tracking-tight">New Call</h2>
        <div className="rounded-xl border border-border bg-card p-6">
          <p className="mb-4 text-sm">You need at least one <b>playbook</b> (what you're selling) before starting a call.</p>
          <Button onClick={() => navigate('/playbooks/new')}>Create your first playbook</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[640px] px-8 py-7">
      <h2 className="mb-5 text-xl font-bold tracking-tight">New Call</h2>
      <div className="rounded-xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Which playbook are you selling?</div>
            <select className={selectCls} value={productId} onChange={(e) => setProductId(e.target.value)}>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">Client</div>
            <select className={selectCls} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">+ New client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.company ? ` — ${c.company}` : ''} ({c.calls})</option>)}
            </select>
          </div>
        </div>

        {!clientId && (
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">New client name</div>
              <Input value={ncName} onChange={(e) => setNcName(e.target.value)} placeholder="Person on the call" />
            </div>
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Company (optional)</div>
              <Input value={ncCompany} onChange={(e) => setNcCompany(e.target.value)} placeholder="Their company" />
            </div>
          </div>
        )}

        <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 px-3.5 py-3 text-[13px] leading-snug text-foreground/80">
          Tip: at the start of the call, say <i>"I use an AI assistant that transcribes our conversation — is that okay?"</i> Then share your <b>Meet tab</b> with <b>"Also share tab audio"</b> ticked.
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button size="lg" disabled={busy} onClick={start}>Start Call</Button>
          {msg && <span className="text-sm text-muted-foreground">{msg}</span>}
        </div>
      </div>
    </div>
  )
}
