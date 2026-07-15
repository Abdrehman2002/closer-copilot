import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { DetailSkeleton } from '@/components/Skeleton'

export default function Settings() {
  const [me, setMe] = useState<Me | null>(null)
  const [name, setName] = useState('')
  const [tone, setTone] = useState('')
  const [framework, setFramework] = useState('')
  const [phrases, setPhrases] = useState('')
  const [neverSay, setNeverSay] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api<Me>('/api/me').then((m) => {
      setMe(m); setName(m.name); setTone(m.tone); setFramework(m.framework)
      setPhrases(m.signature_phrases); setNeverSay(m.never_say)
    })
  }, [])

  const save = async () => {
    await api('/api/profile', { name, tone, framework, signature_phrases: phrases, never_say: neverSay })
    setSaved(true)
  }

  if (!me) return <DetailSkeleton />

  return (
    <div className="mx-auto max-w-[680px] px-8 py-7">
      <h2 className="text-xl font-bold tracking-tight">Your closer profile</h2>
      <p className="mt-1 text-sm text-muted-foreground">The coach reads this on every call so it sounds like you, not a generic script.</p>

      <div className="mt-6 rounded-xl border border-border bg-card p-6 space-y-4">
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Your name</div>
          <Input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Your tone</div>
          <Input value={tone} onChange={(e) => { setTone(e.target.value); setSaved(false) }} placeholder="e.g. calm and consultative, never pushy" />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Sales framework / style you run</div>
          <Input value={framework} onChange={(e) => { setFramework(e.target.value); setSaved(false) }} placeholder="e.g. Chris Voss tactical empathy + question-led" />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Phrases you like to use</div>
          <Textarea value={phrases} onChange={(e) => { setPhrases(e.target.value); setSaved(false) }} placeholder="e.g. makes sense? / totally fair / let's do this" style={{ minHeight: 80 }} />
        </div>
        <div>
          <div className="mb-1.5 text-xs font-medium text-muted-foreground">Never say</div>
          <Textarea value={neverSay} onChange={(e) => { setNeverSay(e.target.value); setSaved(false) }} placeholder="e.g. trust me / limited time only / I promise" style={{ minHeight: 80 }} />
        </div>
        <Button onClick={save}>{saved ? 'Saved' : 'Save'}</Button>
      </div>
    </div>
  )
}
