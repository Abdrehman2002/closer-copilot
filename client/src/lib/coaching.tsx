import { cn } from '@/lib/utils'
import { ThumbsUp, ThumbsDown } from 'lucide-react'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// turn the coach's delivery marks into styled inline HTML
export function renderLineHtml(raw: string): string {
  let h = esc(raw || '')
  h = h.replace(/\|\|\|\|/g, '<span class="cl-pause-long">‖ 2s</span>')
  h = h.replace(/\|\|/g, '<span class="cl-pause">‖</span>')
  h = h.replace(/\[👤\s*([^\]]+)\]/g, '<span class="cl-cue cl-body">on-cam: $1</span>')
  h = h.replace(/\[([^\]]+)\]/g, '<span class="cl-cue">$1</span>')
  h = h.replace(/↘/g, '<span class="cl-down">↘</span>')
  h = h.replace(/↗/g, '<span class="cl-up">↗</span>')
  h = h.replace(/\*([^*]+)\*/g, '<b>$1</b>')
  return h
}

export function CoachingCard({
  id, tone, line, why, technique, used, confidence, streaming, onRate, className,
}: {
  id?: number; tone: string; line: string; why?: string; technique?: string; used?: boolean | null
  confidence?: 'high' | 'low'; streaming?: boolean; onRate?: (id: number, used: boolean) => void; className?: string
}) {
  const silent = /silent/i.test(tone)
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}>
      <div className="mb-2 flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1.5">
          <span className={cn(
            'inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white',
            silent ? 'bg-amber-600' : 'bg-primary'
          )}>{tone || '…'}</span>
          {confidence === 'low' && !streaming && (
            <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
              title="The coach is improvising beyond the playbook here — trust your own read">
              improvised
            </span>
          )}
        </span>
        {!streaming && onRate && id !== undefined && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => onRate(id, true)}
              aria-label="Used this line"
              className={cn(
                'grid h-8 w-8 place-items-center rounded-md transition-colors',
                used === true ? 'bg-success/15 text-success' : 'text-muted-foreground hover:bg-secondary'
              )}
            ><ThumbsUp className="h-3.5 w-3.5" /></button>
            <button
              onClick={() => onRate(id, false)}
              aria-label="Didn't use this line"
              className={cn(
                'grid h-8 w-8 place-items-center rounded-md transition-colors',
                used === false ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:bg-secondary'
              )}
            ><ThumbsDown className="h-3.5 w-3.5" /></button>
          </div>
        )}
      </div>
      <div className="cl-line text-[21px] font-semibold leading-snug" dangerouslySetInnerHTML={{ __html: renderLineHtml(line) }} />
      {!streaming && (technique || why) && (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-primary">{technique}</span>{why ? ` — ${why}` : ''}
        </div>
      )}
    </div>
  )
}
