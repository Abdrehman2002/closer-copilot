import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { DetailSkeleton } from '@/components/Skeleton'
import { ArrowLeft } from 'lucide-react'

export default function PlaybookDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api<{ id: string; name: string; content: string }>(`/api/products/${id}`).then((p) => {
      setName(p.name || ''); setContent(p.content || ''); setLoaded(true)
    })
  }, [id])

  const save = async () => { await api('/api/products', { id, name, content }); setSaved(true) }
  const del = async () => { if (confirm('Delete this playbook?')) { await api(`/api/products/${id}`, undefined, 'DELETE'); navigate('/playbooks') } }

  if (!loaded) return <DetailSkeleton />

  return (
    <div className="mx-auto max-w-[820px] px-8 py-7">
      <Link to="/playbooks" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Playbooks</Link>
      <h2 className="mb-5 text-xl font-bold tracking-tight">Edit playbook</h2>

      <div className="mb-1.5 text-xs font-medium text-muted-foreground">Playbook name</div>
      <Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} />

      <div className="mb-1.5 mt-4 text-xs font-medium text-muted-foreground">Playbook content <span className="text-muted-foreground/70">— the coach reads this every call</span></div>
      <Textarea value={content} onChange={(e) => { setContent(e.target.value); setSaved(false) }} className="min-h-[360px] font-mono text-[13px]" />

      <div className="mt-4 flex gap-2">
        <Button onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
        <Button variant="outline" onClick={del}>Delete</Button>
      </div>
    </div>
  )
}
