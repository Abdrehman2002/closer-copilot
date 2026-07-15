import { useEffect, useState } from 'react'
import { api, token } from './api'
import type { Turn, CardData } from './types'
import { renderLineHtml } from './coaching'

type State = {
  active: boolean
  status: string
  srvOn: boolean
  dealId: string | null
  productId: string | null
  brief: string | null
  clientName: string | null
  productName: string | null
  transcript: Turn[]
  cards: CardData[]
  streaming: CardData | null
  interim: string
}

const state: State = {
  active: false, status: '', srvOn: false,
  dealId: null, productId: null, brief: null, clientName: null, productName: null,
  transcript: [], cards: [], streaming: null, interim: '',
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
  else { state.streaming = null; if (c.line) state.cards = [...state.cards, c] }
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
    else if (d.type === 'status') { state.status = d.msg; emit() }
  }
}

function pipe(stream: MediaStream, ch: 'me' | 'prospect', t: string) {
  const ws = new WebSocket(wsUrl('/audio?ch=' + ch + '&t=' + encodeURIComponent(t)))
  const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 64000 })
  rec.ondataavailable = (e) => { if (e.data.size && ws.readyState === 1) e.data.arrayBuffer().then((b) => ws.send(b)) }
  ws.onopen = () => rec.start(250)
  socks.push(ws); recs.push(rec)
}

export const liveCall = {
  get: () => state,
  subscribe(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn) },

  async start(dealId: string, productId: string) {
    const r = await api<{ brief: string | null; clientName: string | null; productName: string | null }>(
      '/api/call/start', { dealId, productId })
    state.brief = r.brief; state.clientName = r.clientName; state.productName = r.productName
    state.transcript = []; state.cards = []; state.streaming = null; state.interim = ''
    state.dealId = dealId; state.productId = productId
    state.status = 'Allow the mic, then pick your Meet tab with "Also share tab audio"…'; emit()

    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    const disp = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    if (!disp.getAudioTracks().length) {
      mic.getTracks().forEach((t) => t.stop()); disp.getTracks().forEach((t) => t.stop())
      throw new Error('No tab audio — pick the Meet tab and tick "Also share tab audio".')
    }
    disp.getVideoTracks()[0].onended = () => { if (state.active) liveCall.end() }
    streams = [mic, disp]
    await connectEvents()
    const t = await token()
    pipe(mic, 'me', t!)
    pipe(new MediaStream(disp.getAudioTracks()), 'prospect', t!)
    state.active = true; state.status = 'Live — listening on both channels.'; emit()
  },

  async end() {
    recs.forEach((r) => { try { if (r.state !== 'inactive') r.stop() } catch { /* noop */ } })
    socks.forEach((w) => { try { w.close() } catch { /* noop */ } })
    streams.forEach((s) => s.getTracks().forEach((t) => t.stop()))
    recs = []; socks = []; streams = []
    const wasActive = state.active
    state.active = false; state.status = 'Analyzing & saving the Client Brain…'; emit()
    if (!wasActive) return null
    const r = await api<{ dealId?: string }>('/api/call/end', {})
    return r.dealId ?? null
  },

  sim() { api('/simulate', {}) },

  async overlay() {
    if (pipWin) { pipWin.focus(); return }
    const dpip = (window as any).documentPictureInPicture
    if (!dpip) { alert('Overlay needs Chrome 116+.'); return }
    pipWin = await dpip.requestWindow({ width: 620, height: 210 })
    const b = pipWin!.document.body
    b.style.cssText = 'margin:0;background:#fff;color:#16181d;font:15px/1.5 Inter,system-ui,sans-serif;overflow:hidden;border-top:3px solid hsl(214 95% 52%)'
    b.innerHTML = '<div id="pc" style="padding:14px 18px;color:#77839a">Overlay live — the next card appears here, on top of everything.</div>'
    pipWin!.addEventListener('pagehide', () => { pipWin = null })
    if (state.streaming || state.cards.length) updatePip((state.streaming || state.cards[state.cards.length - 1]) as any)
  },
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
  pc.innerHTML =
    '<div style="padding:12px 18px"><span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.5px;color:#fff;background:' +
    (silent ? '#b45309' : 'hsl(214 95% 52%)') +
    ';border-radius:6px;padding:3px 10px;margin-bottom:8px;text-transform:uppercase">' + (c.tone || '…') +
    '</span><div style="font-size:22px;font-weight:600;line-height:1.5">' + line + '</div></div>'
}

// React binding
export function useLiveCall() {
  const [, force] = useState(0)
  useEffect(() => liveCall.subscribe(() => force((n) => n + 1)), [])
  return { state: liveCall.get(), live: liveCall }
}
