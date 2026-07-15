export const fmtDate = (s?: string) => {
  if (!s) return '—'
  try {
    return new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return s
  }
}

export const fmtDur = (n?: number) => (n ? `${Math.floor(n / 60)}m ${n % 60}s` : '—')

export const initials = (s?: string) => (s ? s.trim()[0]?.toUpperCase() : '?') ?? '?'
