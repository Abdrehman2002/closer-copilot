import { Link, useNavigate } from 'react-router-dom'
import { PlaybookStart } from '@/components/PlaybookStart'
import { ArrowLeft } from 'lucide-react'

export default function PlaybookNew() {
  const navigate = useNavigate()
  return (
    <div className="mx-auto max-w-[720px] px-8 py-7">
      <Link to="/playbooks" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" /> Playbooks</Link>
      <h2 className="text-xl font-bold tracking-tight">New playbook</h2>
      <p className="mb-6 mt-1 max-w-lg text-sm text-muted-foreground">Start from a ready-made playbook and make it yours, or answer a few questions to build one from scratch.</p>
      <div className="rounded-xl border border-border bg-card p-6">
        <PlaybookStart onDone={() => navigate('/playbooks')} />
      </div>
    </div>
  )
}
