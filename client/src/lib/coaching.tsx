import { cn } from '@/lib/utils'
import { ThumbsUp, ThumbsDown, AudioLines } from 'lucide-react'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// turn the coach's delivery marks into styled inline HTML
export function renderLineHtml(raw: string): string {
  let h = esc(raw || '')
  h = h.replace(/\|\|\|\|/g, '<span class="cl-pause-long">hold 2s</span>')
  h = h.replace(/\|\|/g, '<span class="cl-pause">‖</span>')
  h = h.replace(/\[👤\s*([^\]]+)\]/g, '<span class="cl-cue cl-body">on-cam: $1</span>')
  h = h.replace(/\[([^\]]+)\]/g, '<span class="cl-cue">$1</span>')
  h = h.replace(/↘/g, '<span class="cl-down">↘</span>')
  h = h.replace(/↗/g, '<span class="cl-up">↗</span>')
  h = h.replace(/\*([^*]+)\*/g, '<b>$1</b>')
  return h
}

export function CoachingCard({
  id, tone, line, why, technique, used, confidence, streaming, onRate, className, size = 'default',
}: {
  id?: number; tone: string; line: string; why?: string; technique?: string; used?: boolean | null
  confidence?: 'high' | 'low'; streaming?: boolean; onRate?: (id: number, used: boolean) => void; className?: string
  // 'lg' is for the marketing/demo context (landing page), where the card is the hero and
  // needs to read from a distance. The live-call HUD stays on 'default' — those sizes are
  // tuned for glancing at mid-conversation, not for scale.
  size?: 'default' | 'lg'
}) {
  const silent = /silent/i.test(tone)
  const lg = size === 'lg'

  // The tone is the FIRST thing in the sentence, not a badge on a row above it.
  //
  // It used to sit in its own header row while the line below was 21px and bold — so the eye
  // landed on the words and skipped the tone entirely. Two reading targets is one too many when
  // you have under two seconds to answer: hesitate longer than that and the prospect can hear
  // that you're reading. Now there is a single line of sight, and the very first thing on it
  // tells you how to open your mouth.
  const html =
    `<span class="cl-tone${silent ? ' cl-tone-silent' : ''}">${esc(tone || '…')}</span>` +
    renderLineHtml(line)

  return (
    <div className={cn('rounded-xl border border-border bg-card shadow-sm', lg ? 'p-5' : 'p-4', className)}>
      <div
        className={cn('cl-line font-semibold leading-snug', lg ? 'text-[27px]' : 'text-[21px]')}
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {!streaming && (technique || why || confidence === 'low' || (onRate && id !== undefined)) && (
        <div className="mt-2.5 flex items-center gap-2 text-xs text-muted-foreground">
          <AudioLines className="h-3.5 w-3.5 shrink-0 text-primary/60" />
          <span className="min-w-0 truncate">
            <span className="font-semibold text-primary">{technique}</span>{why ? ` — ${why}` : ''}
          </span>
          {confidence === 'low' && (
            <span className="shrink-0 rounded-md bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700"
              title="The coach is improvising beyond the playbook here — trust your own read">
              improvised
            </span>
          )}
          {onRate && id !== undefined && (
            <div className="ml-auto flex shrink-0 items-center gap-1">
              <button
                onClick={() => onRate(id, true)}
                aria-label="Used this line"
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-md transition-colors',
                  used === true ? 'bg-success/15 text-success' : 'text-muted-foreground hover:bg-secondary'
                )}
              ><ThumbsUp className="h-3.5 w-3.5" /></button>
              <button
                onClick={() => onRate(id, false)}
                aria-label="Didn't use this line"
                className={cn(
                  'grid h-7 w-7 place-items-center rounded-md transition-colors',
                  used === false ? 'bg-destructive/15 text-destructive' : 'text-muted-foreground hover:bg-secondary'
                )}
              ><ThumbsDown className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
