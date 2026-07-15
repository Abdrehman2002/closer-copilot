import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLiveCall } from '@/lib/liveCall'
import { Brain } from '@/components/Brain'
import { CoachingCard } from '@/lib/coaching'
import { Button } from '@/components/ui/button'
import { PictureInPicture2, Zap } from 'lucide-react'

export default function LiveCall() {
  const { state, live } = useLiveCall()
  const navigate = useNavigate()

  useEffect(() => {
    if (!state.active && state.transcript.length === 0) navigate('/new')
  }, [])

  const end = async () => {
    const dealId = await live.end()
    navigate(dealId ? `/clients/${dealId}` : '/')
  }

  return (
    <div className="flex h-[calc(100vh-56px)] flex-col px-8 py-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-bold tracking-tight">Live Call{state.clientName ? ` — ${state.clientName}` : ''}</h2>
        <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={`h-2 w-2 rounded-full ${state.srvOn ? 'bg-success' : 'bg-muted-foreground/40'}`} /> coach
        </span>
        {state.active && <span className="flex items-center gap-1.5 text-xs font-semibold text-destructive"><span className="h-2 w-2 animate-pulse rounded-full bg-destructive" /> transcribing</span>}
        <div className="ml-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => live.overlay()}><PictureInPicture2 className="h-4 w-4" /> Overlay</Button>
          <Button variant="outline" size="sm" onClick={() => live.sim()}><Zap className="h-4 w-4" /> Test</Button>
          {state.active && <Button variant="destructive" size="sm" onClick={end}>End Call</Button>}
        </div>
      </div>

      {state.brief && (
        <div className="mb-3 max-h-[26vh] overflow-y-auto rounded-xl border border-amber-500/25 bg-amber-50 p-4">
          <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">Pre-call brief — Client Brain</div>
          <Brain md={state.brief} />
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-[1.3] flex-col justify-end gap-3 overflow-y-auto pb-1">
          {state.cards.length === 0 && !state.streaming && (
            <div className="m-auto max-w-xs text-center text-sm text-muted-foreground">Coached lines appear here the moment they matter. Small talk stays silent.</div>
          )}
          {state.cards.slice(-4).map((c, i, arr) => (
            <CoachingCard key={i} {...c} className={i < arr.length - 1 || state.streaming ? 'opacity-50' : ''} />
          ))}
          {state.streaming && <CoachingCard {...state.streaming} streaming />}
        </div>

        <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card">
          <div className="border-b border-border bg-secondary px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Live transcript</div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-4">
            {state.transcript.map((t, i) => (
              <div key={i} className={`max-w-[92%] rounded-xl border px-3 py-2 text-[13.5px] leading-relaxed ${t.ch === 'me' ? 'self-end border-primary/20 bg-primary/5' : 'self-start border-amber-500/20 bg-amber-500/5'}`}>
                <span className={`mb-0.5 block text-[10px] font-bold uppercase tracking-wider ${t.ch === 'me' ? 'text-primary' : 'text-amber-700'}`}>{t.ch === 'me' ? 'Me' : 'Prospect'}</span>
                {t.text}
              </div>
            ))}
          </div>
          {state.interim && <div className="border-t border-border px-4 py-2 text-[12.5px] italic text-muted-foreground">{state.interim}</div>}
          <div className="border-t border-border px-4 py-2 text-[11px] uppercase tracking-wide text-muted-foreground">{state.status || (state.active ? 'live' : 'call ended')}</div>
        </div>
      </div>
    </div>
  )
}
