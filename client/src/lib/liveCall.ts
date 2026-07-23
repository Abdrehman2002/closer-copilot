import { useEffect, useState } from 'react'
import { api, token } from './api'
import type { Turn, CardData, Outcome, DiscoveryPillar } from './types'
import { renderLineHtml } from './coaching'

type State = {
  active: boolean
  status: string
  srvOn: boolean
  dealId: string | null
  productId: string | null
  brief: string | null
  battlePlan: string | null
  clientName: string | null
  productName: string | null
  goalLabel: string | null
  transcript: Turn[]
  cards: CardData[]
  streaming: CardData | null
  discovery: DiscoveryPillar[] | null   // live discovery/MEDDPICC checklist
  signal: { tag: string; hint: string } | null   // instant lane: live read while prospect talks
  interim: string
  awaitingOutcome: boolean   // capture stopped, End Call modal should show
}

const state: State = {
  active: false, status: '', srvOn: false,
  dealId: null, productId: null, brief: null, battlePlan: null, clientName: null, productName: null,
  goalLabel: null,
  transcript: [], cards: [], streaming: null, discovery: null, signal: null, interim: '', awaitingOutcome: false,
}

const listeners = new Set<() => void>()
const emit = () => listeners.forEach((fn) => fn())

let ev: WebSocket | null = null
let socks: WebSocket[] = []
let recs: MediaRecorder[] = []
let streams: MediaStream[] = []
let pipWin: Window | null = null

const wsUrl = (p: string) => (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + p

function pushTurn(ch: 'me' | 'prospect', text: string) {
  const last = state.transcript[state.transcript.length - 1]
  if (last && last.ch === ch) last.text += ' ' + text
  else state.transcript = [...state.transcript, { ch, text }]
  state.interim = ''
  emit()
}
function pushCard(c: CardData & { done: boolean }) {
  if (!c.done) state.streaming = { tone: c.tone, line: c.line, why: '', technique: '' }
  else { state.streaming = null; if (c.line) state.cards = [...state.cards, { ...c, used: null }] }
  emit()
  updatePip(c)
}

async function connectEvents() {
  if (ev && (ev.readyState === 0 || ev.readyState === 1)) return
  const t = await token()
  if (!t) return
  ev = new WebSocket(wsUrl('/events?t=' + encodeURIComponent(t)))
  ev.onopen = () => { state.srvOn = true; emit() }
  ev.onclose = () => { state.srvOn = false; emit(); if (state.active) setTimeout(connectEvents, 1500) }
  ev.onmessage = (m) => {
    const d = JSON.parse(m.data)
    if (d.type === 'transcript') pushTurn(d.ch, d.text)
    else if (d.type === 'interim') { state.interim = (d.ch === 'me' ? 'ME: ' : 'PROSPECT: ') + d.text; emit() }
    else if (d.type === 'card-stream') pushCard(d)
    else if (d.type === 'signal') { state.signal = d.tag ? { tag: d.tag, hint: d.hint } : null; emit(); updatePipSignal() }
    else if (d.type === 'discovery') { state.discovery = d.pillars; emit() }
    else if (d.type === 'status') { state.status = d.msg; emit() }
  }
}

function pipe(stream: MediaStream, ch: 'me' | 'prospect', t: string) {
  let ws: WebSocket
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
  rec.ondataavailable = (e) => { if (e.data.size && ws && ws.readyState === 1) e.data.arrayBuffer().then((b) => ws.send(b)) }
  // Auto-reconnect: if the audio socket drops mid-call (server redeploy, network blip), the
  // MediaRecorder keeps running but sends would silently fail — reopen and keep streaming.
  const connect = () => {
    ws = new WebSocket(wsUrl('/audio?ch=' + ch + '&t=' + encodeURIComponent(t)))
    ws.onopen = () => { if (rec.state === 'inactive') rec.start(250) }
    ws.onclose = () => { if (state.active) setTimeout(connect, 800) }
    socks.push(ws)
  }
  connect()
  recs.push(rec)
}

function stopMedia() {
  recs.forEach((r) => { try { if (r.state !== 'inactive') r.stop() } catch { /* noop */ } })
  socks.forEach((w) => { try { w.close() } catch { /* noop */ } })
  streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
  recs = []; socks = []; streams = []
}

export const liveCall = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) },

  async start(dealId: string, productId: string, goal?: string) {
    const r = await api<{ brief: string | null; battlePlan: string | null; clientName: string | null; productName: string | null; goalLabel?: string }>(
      '/api/call/start', { dealId, productId, goal })
    state.brief = r.brief; state.battlePlan = r.battlePlan; state.clientName = r.clientName; state.productName = r.productName
    state.goalLabel = r.goalLabel || null
    state.transcript = []; state.cards = []; state.streaming = null; state.discovery = null; state.signal = null; state.interim = ''; state.awaitingOutcome = false
    state.dealId = dealId; state.productId = productId
    state.status = 'Allow the mic, then pick your Meet tab with "Also share tab audio"…'; emit()

    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    if (!disp.getAudioTracks().length) {
      mic.getTracks().forEach((t) => t.stop()); disp.getTracks().forEach((t) => t.stop())
      throw new Error('No tab audio — pick the Meet tab and tick "Also share tab audio".')
    }
    disp.getVideoTracks()[0].onended = () => { if (state.active) liveCall.stopCapture() }
    streams = [mic, disp]
    await connectEvents()
    const t = await token()
    pipe(mic, 'me', t!)
    pipe(new MediaStream(disp.getAudioTracks()), 'prospect', t!)
    state.active = true; state.status = 'Live — listening on both channels.'; emit()
  },

  /** Stop capturing audio immediately (End Call was clicked) — the outcome modal
   *  shows next; the actual save + Client Brain analysis happens in finish(). */
  stopCapture() {
    if (!state.active) return
    stopMedia()
    state.active = false; state.awaitingOutcome = true
    state.status = 'Call ended — one quick question before we save it…'
    emit()
  },

  /** Submit the outcome (or skip) and run the post-call analysis + save. */
  async finish(meta: { outcome?: Outcome; savedDeal?: boolean; savedDealNote?: string; outcomeAmount?: number; outcomeReason?: string } = {}) {
    state.awaitingOutcome = false
    state.status = 'Analyzing & saving the Client Brain…'; emit()
    const r = await api<{ dealId?: string }>('/api/call/end', meta)
    return r.dealId ?? null
  },

  /** Cancel without saving (used if the call never really started / no transcript). */
  discard() {
    stopMedia()
    state.active = false; state.awaitingOutcome = false
    emit()
  },

  sim() { api('/simulate', {}) },

  rateCard(id: number | undefined, used: boolean) {
    if (id === undefined) return
    const card = state.cards.find((c) => c.id === id)
    if (card) { card.used = used; emit() }
    api('/api/card-feedback', { id, used })
  },

  async overlay() {
    if (pipWin) { pipWin.focus(); return }
    const dpip = (window as any).documentPictureInPicture
    if (!dpip) { alert('Overlay needs Chrome 116+.'); return }
    pipWin = await dpip.requestWindow({ width: 620, height: 240 })
    const b = pipWin!.document.body
    b.style.cssText = 'margin:0;background:#fff;color:#16181d;font:15px/1.5 Inter,system-ui,sans-serif;overflow:hidden;border-top:3px solid hsl(214 95% 52%)'
    // two lanes: #ps = instant live read (while the prospect talks), #pc = the considered line
    b.innerHTML =
      '<div id="ps" style="display:none;padding:8px 18px;border-bottom:1px solid #eef0f3;background:#fafbfc"></div>' +
      '<div id="pc" style="padding:14px 18px;color:#77839a">Overlay live — your line appears here, on top of everything.</div>'
    pipWin!.addEventListener('pagehide', () => { pipWin = null })
    updatePipSignal()
    if (state.streaming || state.cards.length) updatePip((state.streaming || state.cards[state.cards.length - 1]) as any)
  },
}

const SIGNAL_COLORS: Record<string, string> = {
  PRICE: 'hsl(214 95% 52%)', BUYING: '#15803d', OBJECTION: '#b45309',
  STALL: '#b45309', COMPETITOR: '#7c3aed',
}

function updatePipSignal() {
  if (!pipWin) return
  const ps = pipWin.document.getElementById('ps')
  if (!ps) return
  const sig = state.signal
  if (!sig) { ps.style.display = 'none'; ps.innerHTML = ''; return }
  const color = SIGNAL_COLORS[sig.tag] || '#475569'
  ps.style.display = 'block'
  ps.innerHTML =
    '<span style="display:inline-block;font-size:10px;font-weight:800;letter-spacing:.5px;color:#fff;background:' +
    color + ';border-radius:5px;padding:2px 8px;margin-right:8px;text-transform:uppercase">' + sig.tag +
    '</span><span style="font-size:13px;color:#475569">' + sig.hint + '</span>'
}

function updatePip(c: { tone: string; line: string }) {
  if (!pipWin) return
  const pc = pipWin.document.getElementById('pc')
  if (!pc) return
  const silent = /silent/i.test(c.tone)
  const line = renderLineHtml(c.line)
    .replace(/class="cl-pause-long"/g, 'style="color:hsl(214 95% 52%);font-weight:800;font-size:12px;background:hsl(214 95% 94%);border-radius:5px;padding:2px 7px"')
    .replace(/class="cl-pause"/g, 'style="color:hsl(214 95% 52%);font-weight:800;padding:0 3px"')
    .replace(/class="cl-cue cl-body"/g, 'style="font-size:12px;color:hsl(214 80% 42%);background:hsl(214 95% 94%);border-radius:5px;padding:1px 8px;margin:0 3px"')
    .replace(/class="cl-cue"/g, 'style="font-size:12px;font-style:italic;color:#475569;background:#eef0f3;border-radius:5px;padding:1px 8px;margin:0 3px"')
    .replace(/class="cl-down"/g, 'style="color:hsl(214 95% 52%)"')
    .replace(/class="cl-up"/g, 'style="color:#b45309"')
  // Tone leads, big and unmissable — you read HOW to say it before the words.
  const toneIcon = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" style="vertical-align:-3px;margin-right:6px"><path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4"/></svg>'
  pc.innerHTML =
    '<div style="padding:12px 18px"><span style="display:inline-flex;align-items:center;font-size:13.5px;font-weight:800;letter-spacing:.9px;color:#fff;background:' +
    (silent ? '#b45309' : 'hsl(214 95% 52%)') +
    ';border-radius:7px;padding:5px 12px;margin-bottom:10px;text-transform:uppercase">' + toneIcon + (c.tone || '…') +
    '</span><div style="font-size:22px;font-weight:600;line-height:1.5">' + line + '</div></div>'
}

// React binding
export function useLiveCall() {
  const [, force] = useState(0)
  useEffect(() => liveCall.subscribe(() => force((n) => n + 1)), [])
  return { state: liveCall.get(), live: liveCall }
}
