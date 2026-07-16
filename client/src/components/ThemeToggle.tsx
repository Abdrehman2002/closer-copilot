import { useState } from 'react'
import { Sun, Moon, Monitor } from 'lucide-react'
import { getTheme, setTheme, type ThemeChoice } from '@/lib/theme'
import { cn } from '@/lib/utils'

const OPTIONS: { id: ThemeChoice; icon: any; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Light' },
  { id: 'dark', icon: Moon, label: 'Dark' },
  { id: 'system', icon: Monitor, label: 'System' },
]

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const [choice, setChoice] = useState<ThemeChoice>(getTheme())
  const pick = (id: ThemeChoice) => { setTheme(id); setChoice(id) }

  if (compact) {
    const next = choice === 'light' ? 'dark' : choice === 'dark' ? 'system' : 'light'
    const Icon = OPTIONS.find((o) => o.id === choice)?.icon ?? Sun
    return (
      <button
        onClick={() => pick(next)}
        title={'Theme: ' + choice + ' (click to change)'}
        className="grid h-9 w-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
      >
        <Icon className="h-4 w-4" />
      </button>
    )
  }

  return (
    <div className="inline-flex rounded-lg border border-border bg-secondary/60 p-1">
      {OPTIONS.map((o) => (
        <button
          key={o.id}
          onClick={() => pick(o.id)}
          className={cn(
            'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors',
            choice === o.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <o.icon className="h-3.5 w-3.5" /> {o.label}
        </button>
      ))}
    </div>
  )
}
