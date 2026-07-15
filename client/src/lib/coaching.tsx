import { cn } from '@/lib/utils'

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
  tone, line, why, technique, streaming, className,
}: {
  tone: string; line: string; why?: string; technique?: string; streaming?: boolean; className?: string
}) {
  const silent = /silent/i.test(tone)
  return (
    <div className={cn('rounded-xl border border-border bg-card p-4 shadow-sm', className)}>
      <span className={cn(
        'mb-2 inline-block rounded-md px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white',
        silent ? 'bg-amber-600' : 'bg-primary'
      )}>{tone || '…'}</span>
      <div className="cl-line text-[21px] font-semibold leading-snug" dangerouslySetInnerHTML={{ __html: renderLineHtml(line) }} />
      {!streaming && (technique || why) && (
        <div className="mt-2 text-xs text-muted-foreground">
          <span className="font-semibold text-primary">{technique}</span>{why ? ` — ${why}` : ''}
        </div>
      )}
    </div>
  )
}
