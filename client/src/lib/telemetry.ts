// Lightweight product telemetry: page views, clicks (for the admin heatmap) and
// custom events. Batched and sent on an interval so it never blocks the UI, and
// dropped silently if the backend/schema isn't ready.
import { api } from './api'

type Ev = {
  kind: 'view' | 'click' | 'event'
  path: string
  el?: string
  x?: number; y?: number; vw?: number; vh?: number
  meta?: Record<string, unknown>
  sid: string
}

const SID_KEY = 'cc-sid'
function sessionId() {
  let s = sessionStorage.getItem(SID_KEY)
  if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem(SID_KEY, s) }
  return s
}

let queue: Ev[] = []
let timer: ReturnType<typeof setInterval> | null = null
let enabled = false

function push(e: Omit<Ev, 'sid'>) {
  if (!enabled) return
  queue.push({ ...e, sid: sessionId() })
  if (queue.length >= 25) flush()
}

async function flush() {
  if (!queue.length) return
  const events = queue.splice(0, 50)
  try { await api('/api/admin/telemetry', { events }) } catch { /* telemetry must never break the app */ }
}

// a short, readable label for whatever was clicked
function describe(t: EventTarget | null): string {
  const el = t as HTMLElement | null
  if (!el || !el.closest) return ''
  const node = el.closest('button, a, [role="button"], input, select, textarea') as HTMLElement | null
  if (!node) return el.tagName ? el.tagName.toLowerCase() : ''
  const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '').trim().replace(/\s+/g, ' ')
  return (node.tagName.toLowerCase() + (label ? ':' + label.slice(0, 60) : ''))
}

export function initTelemetry() {
  if (enabled) return
  enabled = true

  document.addEventListener('click', (e) => {
    push({
      kind: 'click', path: location.pathname, el: describe(e.target),
      x: e.clientX, y: e.clientY, vw: window.innerWidth, vh: window.innerHeight,
    })
  }, { capture: true, passive: true })

  timer = setInterval(flush, 10000)
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush() })
}

export function trackView(path: string) {
  push({ kind: 'view', path, vw: window.innerWidth, vh: window.innerHeight })
}

export function trackEvent(name: string, meta?: Record<string, unknown>) {
  push({ kind: 'event', path: location.pathname, el: name, meta })
}

export function stopTelemetry() {
  enabled = false
  if (timer) { clearInterval(timer); timer = null }
}
