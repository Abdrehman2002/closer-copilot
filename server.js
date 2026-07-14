// closer-copilot — live sales whisper server with deal memory (multi-user SaaS)
// Auth: Supabase (email/password). Every API call and WebSocket carries the user's JWT.
// Storage: Supabase Postgres with row-level security — users only ever see their own data.
// Call state (transcript, active deal/product, coach loop, fired cards) is per-user session.
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
// WebSocket (client, for the Deepgram relay) is imported from ws so it works on
// Node 20 too — global WebSocket only exists from Node 22.
const { WebSocketServer, WebSocket } = require('ws');

// ---- tiny .env loader ----
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch { /* no .env — rely on real env vars */ }

const DG_KEY = process.env.DEEPGRAM_API_KEY || '';
const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const LIVE_MODEL = process.env.LIVE_MODEL || 'gpt-4o-mini';
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-4o';
const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_KEY = process.env.SUPABASE_KEY || '';
const PORT = Number(process.env.PORT || 7801);
const HOST = process.env.HOST || '127.0.0.1';

if (!DG_KEY || !OPENAI_KEY || !SUPA_URL || !SUPA_KEY) {
  console.error('Missing DEEPGRAM_API_KEY / OPENAI_API_KEY / SUPABASE_URL / SUPABASE_KEY in .env');
  process.exit(1);
}

const PLAYBOOK = fs.readFileSync(path.join(__dirname, 'playbook.md'), 'utf8');
const PRODUCT_TEMPLATE = fs.readFileSync(path.join(__dirname, 'products', 'vextria-hvac.md'), 'utf8');

const FORMAT_RULES = `Respond in EXACTLY this plain-text format (no JSON, no markdown fences):
DECISION: FIRE or HOLD
TONE: <from the tone vocabulary, ALWAYS with a pace, e.g. CALM · slow>
LINE: <the exact words ME should say next>
WHY: <max 10 words, the read on the moment>
TECH: <named move: mirror, label, reframe, takeaway, assumptive close, silence, calibrated question, pain quantify>

If HOLD: output only "DECISION: HOLD" and nothing else. Per the playbook, FIRE whenever a useful next line exists (most of the time the prospect just spoke); HOLD only for pure greetings/small talk. When in doubt, FIRE.

LINE delivery rules (MANDATORY, every card). You are directing an actor — the delivery
must be precise enough to perform without thinking:
- ONE sentence-length line, max ~28 words of SPOKEN text, verbatim.
- || = one-beat pause exactly there. |||| = long pause, 2+ seconds, let it breathe.
  At least one pause if the line is longer than 6 words.
- ↘ = the words after it drop lower and slower (authority, statement lands).
  ↗ = the words after it lift (genuine curious question). Use at least one.
- *word* = the single most-stressed word in the line. Exactly one per card.
- [micro-cue] = an inline stage direction placed EXACTLY where the delivery changes,
  in square brackets. Vocabulary: [slower] [speed up] [softer] [almost a whisper]
  [warm smile] [dead serious] [lean in] [word by word] [shrug, easy] [eyebrows up].
  Use 1–2 per card, at the exact word where the shift happens. NEVER generic.
- TONE field = opening state before the first word: EMOTION · pace · one physical note.
  e.g. "CALM · slow · soft eyes" / "CONFIDENT · brisk · sit back" — never just "CALM".
- If the right move is silence: LINE: … and TONE: SILENT — 3 sec, hold eye contact, do not fill it
- If DEAL MEMORY is present, USE it: reference what THIS prospect said in previous calls
  (their objections, commitments, stakeholders, stated pain) whenever it sharpens the move.

Example:
DECISION: FIRE
TONE: CALM · slow · soft eyes
LINE: I hear you — |||| [softer] most owners told me the same… ↘ until they counted the *missed* calls. || [lean in] ↗ What's one job worth to you?
WHY: price pushback; re-anchor on his stated pain
TECH: label + reframe`;

const EMPTY_STATE = () => ({
  summary: '', objections: [], commitments_us: [], commitments_them: [],
  stakeholders: [], pain_points: [], sentiment: '', next_step: ''
});

// ---- supabase helpers ----
async function sbRest(pathq, jwt, opts = {}) {
  const r = await fetch(SUPA_URL + '/rest/v1/' + pathq, {
    method: opts.method || 'GET',
    headers: {
      apikey: SUPA_KEY,
      Authorization: 'Bearer ' + jwt,
      'Content-Type': 'application/json',
      Prefer: opts.prefer || 'return=representation'
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  const t = await r.text();
  if (!r.ok) throw new Error('supabase ' + r.status + ': ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

const tokenCache = new Map();   // jwt -> {user, exp}
async function getUser(jwt) {
  if (!jwt) return null;
  const c = tokenCache.get(jwt);
  if (c && c.exp > Date.now()) return c.user;
  try {
    const r = await fetch(SUPA_URL + '/auth/v1/user', {
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + jwt }
    });
    if (!r.ok) return null;
    const user = await r.json();
    if (!user || !user.id) return null;
    tokenCache.set(jwt, { user, exp: Date.now() + 5 * 60 * 1000 });
    return user;
  } catch { return null; }
}

// ---- per-user sessions ----
const sessions = new Map();   // userId -> session

function getSession(userId) {
  let s = sessions.get(userId);
  if (!s) {
    s = {
      userId, jwt: null,
      turns: [], cards: [], events: new Set(), callLog: null, callStartAt: 0,
      activeDealId: null, activeProductId: null, activeProductName: '',
      productContent: '', memory: '', dealState: null, dealName: '',
      lastCardAt: 0, coachBusy: false, coachQueued: false, coachTimer: null,
      simIdx: 0
    };
    sessions.set(userId, s);
  }
  return s;
}

function broadcast(s, obj) {
  const str = JSON.stringify(obj);
  for (const ws of s.events) if (ws.readyState === 1) ws.send(str);
}

function ensureCallLog(s) {
  if (s.callLog) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  s.callLog = path.join(__dirname, 'calls', `call-${s.userId.slice(0, 8)}-${stamp}.jsonl`);
  fs.mkdirSync(path.join(__dirname, 'calls'), { recursive: true });
}

function logEvent(s, obj) {
  ensureCallLog(s);
  fs.appendFile(s.callLog, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n', () => {});
}

function addTurn(s, ch, text) {
  const last = s.turns[s.turns.length - 1];
  if (last && last.ch === ch) last.text += ' ' + text;
  else s.turns.push({ ch, text });
  logEvent(s, { type: 'transcript', ch, text });
}

function buildBrief(dealName, company, state, priorCalls) {
  if (!priorCalls) return 'First call with ' + dealName + (company ? ' (' + company + ')' : '') + ' — no history yet. Go get the pain on record.';
  const st = state || EMPTY_STATE();
  const li = (arr, f) => arr && arr.length ? arr.map(f).join(' · ') : '—';
  return [
    'WHERE WE LEFT OFF — ' + dealName + (company ? ' (' + company + ')' : '') + ' · call #' + (priorCalls + 1),
    'Last call: ' + (st.summary || '—'),
    'Open objections: ' + li((st.objections || []).filter(o => o.status !== 'resolved'), o => o.text),
    'They committed: ' + li(st.commitments_them, x => x) + ' | We committed: ' + li(st.commitments_us, x => x),
    'Stakeholders: ' + li(st.stakeholders, x => x),
    'Their pain: ' + li(st.pain_points, x => x),
    'Agreed next step: ' + (st.next_step || '—') + (st.sentiment ? ' | Sentiment: ' + st.sentiment : '')
  ].join('\n');
}

function buildSystemPrompt(s) {
  // Keep the big stable content (intro + playbook + product + format rules) as one prefix so
  // OpenAI prompt-caching serves it near-instantly on every call after the first; the only
  // part that varies (per-client memory) goes LAST as a short tail. This is the main latency win.
  return 'You are a live sales coach whispering to "ME" (the seller) during a real video sales call.\n' +
    'You see the live transcript. Feed the closer the best next line to say. Fire whenever a useful line exists — the closer is counting on you — and stay silent only for pure small talk.\n\n' +
    PLAYBOOK + '\n\n' +
    (s.productContent || '(no product knowledge provided)') + '\n\n' +
    FORMAT_RULES +
    (s.memory || '');
}

// ---- coach loop (streaming, per session) ----
const CARD_COOLDOWN_MS = 2500;

function parseCoach(raw) {
  const get = k => {
    const m = raw.match(new RegExp('^' + k + ':\\s*(.*)$', 'm'));
    return m ? m[1].trim() : null;
  };
  return { decision: get('DECISION'), tone: get('TONE'), line: get('LINE'), why: get('WHY'), tech: get('TECH') };
}

async function coach(s) {
  if (s.coachBusy) { s.coachQueued = true; return; }
  if (Date.now() - s.lastCardAt < CARD_COOLDOWN_MS) return;
  if (!s.turns.length) return;
  s.coachBusy = true;
  try {
    const recent = s.turns.slice(-24)
      .map(t => (t.ch === 'me' ? 'ME' : 'PROSPECT') + ': ' + t.text)
      .join('\n');
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LIVE_MODEL,
        temperature: 0.4,
        max_tokens: 200,
        stream: true,
        messages: [
          { role: 'system', content: buildSystemPrompt(s) },
          { role: 'user', content: 'LIVE TRANSCRIPT (most recent last):\n' + recent + '\n\nDecide now.' }
        ]
      })
    });
    if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 120));

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let sse = '', raw = '', lastSentLine = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sse += dec.decode(value, { stream: true });
      let nl;
      while ((nl = sse.indexOf('\n')) >= 0) {
        const ln = sse.slice(0, nl).trim();
        sse = sse.slice(nl + 1);
        if (!ln.startsWith('data:')) continue;
        const payload = ln.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const d = JSON.parse(payload);
          raw += (d.choices && d.choices[0] && d.choices[0].delta && d.choices[0].delta.content) || '';
        } catch {}
      }
      const p = parseCoach(raw);
      if (p.decision === 'FIRE' && p.tone && p.line !== null && p.line !== lastSentLine) {
        if (lastSentLine === null) s.lastCardAt = Date.now();
        lastSentLine = p.line;
        broadcast(s, { type: 'card-stream', tone: p.tone, line: p.line, why: '', technique: '', done: false });
      }
    }

    const p = parseCoach(raw);
    if (p.decision === 'FIRE' && p.line) {
      s.lastCardAt = Date.now();
      const card = { type: 'card-stream', tone: p.tone || '', line: p.line, why: p.why || '', technique: p.tech || '', done: true };
      broadcast(s, card);
      s.cards.push({ at: Date.now() - (s.callStartAt || Date.now()), tone: card.tone, line: card.line, why: card.why, technique: card.technique });
      logEvent(s, { type: 'card', tone: card.tone, line: card.line, why: card.why, technique: card.technique });
      console.log('[coach]', s.userId.slice(0, 8), 'FIRE:', p.line);
    } else {
      if (lastSentLine !== null) broadcast(s, { type: 'card-stream', tone: '', line: lastSentLine, why: '', technique: '', done: true });
      broadcast(s, { type: 'status', msg: 'coach: watching — no move needed' });
      console.log('[coach]', s.userId.slice(0, 8), 'hold');
    }
  } catch (e) {
    console.error('[coach]', e.message);
    broadcast(s, { type: 'status', msg: 'coach error: ' + e.message });
  }
  s.coachBusy = false;
  if (s.coachQueued) { s.coachQueued = false; coach(s); }
}

// ---- post-call extraction → per-client Markdown "Client Brain" ----
const BRAIN_TEMPLATE = `# {Client name} — {Company}
**Snapshot:** one-line status + how warm the deal is.
## Their situation & pain
## Objections raised
## What they care about / buying signals
## Stakeholders & decision process
## Commitments
## Where we left off / agreed next step
## How to close them next call`;

// pull the Snapshot line out of a Client Brain for the per-call summary list
function snapshotOf(md) {
  const s = String(md || '');
  const m = s.match(/\*\*Snapshot:\*\*\s*(.+)/i) || s.match(/Snapshot:\s*(.+)/i);
  if (m) return m[1].trim().slice(0, 220);
  const first = s.split('\n').find(l => l.trim());
  return (first || '').replace(/^#+\s*/, '').replace(/\*\*/g, '').slice(0, 160);
}

async function extractClientBrain(prevMemoryMd, turns, productName, clientName, company) {
  const transcript = turns.map(t => (t.ch === 'me' ? 'ME' : 'PROSPECT') + ': ' + t.text).join('\n');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANALYSIS_MODEL,
      temperature: 0.2,
      max_tokens: 1100,
      messages: [
        {
          role: 'system',
          content: `You maintain a per-client "Client Brain" — a living Markdown memo a salesperson reads before and during their NEXT call with this ONE prospect.
Given the PREVIOUS Client Brain and the transcript of the call that just ended, output the UPDATED, FULL Client Brain in Markdown.
Use EXACTLY these sections and headings, in this order:

${BRAIN_TEMPLATE}

Rules:
- MERGE: carry forward everything from the previous Brain that still holds; update objection status; add new facts; sharpen the close plan.
- Under "Objections raised", each bullet: the objection — status: open OR handled, and how.
- Factual only — only what was actually said or clearly implied. Never invent.
- Keep every line short; this is read mid-call. Use "- " bullets under each section.
- Output ONLY the Markdown document — no preamble, no code fences.`
        },
        {
          role: 'user',
          content: `CLIENT: ${clientName || 'the prospect'}${company ? ' — ' + company : ''}  (use this exact name/company in the "# " title; "PROSPECT:" in the transcript = this client)
PRODUCT BEING SOLD: ${productName || '(unspecified)'}

PREVIOUS CLIENT BRAIN:
${prevMemoryMd && prevMemoryMd.trim() ? prevMemoryMd : '(none — this is the first call)'}

TRANSCRIPT OF THE CALL THAT JUST ENDED:
${transcript}`
        }
      ]
    })
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return (j.choices[0].message.content || '').trim();
}

// canned ME+prospect pairs for the Test button
const SIM_PAIRS = [
  { me: "So with setup and the first month included, it comes to fourteen hundred dollars total.",
    prospect: "Look, fourteen hundred is just a lot for us right now. I need to think about it and maybe talk to my brother, he handles the money side." },
  { me: "The AI answers every call day and night and books the job straight into your calendar.",
    prospect: "Honestly we already have an answering service, so I don't really see why I'd pay more for an AI thing." },
  { me: "Based on what you told me about the missed calls, I'd say we should get you live this month.",
    prospect: "I like it, I do, but this isn't a good time. Call me back after the summer rush maybe." },
  { me: "Every call gets answered in two rings, and you can hear every recording yourself.",
    prospect: "Okay and what happens when your AI messes up a booking and I lose that customer? That's my name on the truck, not yours." },
  { me: "For your size of operation this is the right tier, most of our HVAC clients run on it.",
    prospect: "Your competitor quoted us half of that. Why would I pay double for the same thing?" }
];

// ---- http helpers ----
function readBody(req) {
  return new Promise(resolve => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
  });
}
function sendJson(res, obj, code) {
  res.writeHead(code || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}
function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// ---- http + ws ----
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];

  try {
    if (urlPath === '/api/config' && req.method === 'GET') {
      return sendJson(res, { url: SUPA_URL, key: SUPA_KEY });
    }

    if (urlPath.startsWith('/api/') || urlPath === '/simulate') {
      const jwt = bearer(req);
      const user = await getUser(jwt);
      if (!user) return sendJson(res, { error: 'not signed in' }, 401);
      const s = getSession(user.id);
      s.jwt = jwt;
      const seg = urlPath.split('/').filter(Boolean);   // e.g. ['api','clients','<id>']

      // ---- onboarding / profile ----
      if (urlPath === '/api/me' && req.method === 'GET') {
        const [prof, prods, cls] = await Promise.all([
          sbRest('profiles?user_id=eq.' + user.id + '&select=name', jwt),
          sbRest('products?select=id&limit=1', jwt),
          sbRest('deals?select=id&limit=1', jwt)
        ]);
        return sendJson(res, {
          email: user.email, name: (prof[0] && prof[0].name) || '',
          hasProducts: prods.length > 0, hasClients: cls.length > 0, productTemplate: PRODUCT_TEMPLATE
        });
      }
      if (urlPath === '/api/profile' && req.method === 'POST') {
        const { name } = await readBody(req);
        if (!name) return sendJson(res, { error: 'name required' }, 400);
        await sbRest('profiles?on_conflict=user_id', jwt, {
          method: 'POST', body: { user_id: user.id, name },
          prefer: 'resolution=merge-duplicates,return=representation'
        });
        return sendJson(res, { ok: true });
      }

      // ---- products ----
      if (urlPath === '/api/products' && req.method === 'GET') {
        const products = await sbRest('products?select=id,name&order=created_at', jwt);
        return sendJson(res, { products, activeProductId: s.activeProductId });
      }
      if (urlPath === '/api/products' && req.method === 'POST') {
        const { id, name, content } = await readBody(req);
        if (!name) return sendJson(res, { error: 'name required' }, 400);
        let row;
        if (id) row = (await sbRest('products?id=eq.' + id, jwt, { method: 'PATCH', body: { name, content } }))[0];
        else row = (await sbRest('products', jwt, { method: 'POST', body: { user_id: user.id, name, content: content || '' } }))[0];
        if (s.activeProductId === row.id) s.productContent = row.content;
        return sendJson(res, { ok: true, product: { id: row.id, name: row.name } });
      }
      if (seg[0] === 'api' && seg[1] === 'products' && seg[2] && req.method === 'GET') {
        const rows = await sbRest('products?id=eq.' + seg[2] + '&select=id,name,content', jwt);
        return sendJson(res, rows[0] || {});
      }
      if (seg[0] === 'api' && seg[1] === 'products' && seg[2] && req.method === 'DELETE') {
        await sbRest('products?id=eq.' + seg[2], jwt, { method: 'DELETE' });
        return sendJson(res, { ok: true });
      }
      if (urlPath === '/api/product' && req.method === 'POST') {
        const { id } = await readBody(req);
        s.activeProductId = id;
        return sendJson(res, { ok: true });
      }

      // ---- clients (deals) ----
      if (urlPath === '/api/clients' && req.method === 'GET') {
        const deals = await sbRest('deals?select=id,name,company,status,created_at,calls(count)&order=created_at.desc', jwt);
        return sendJson(res, {
          clients: deals.map(d => ({
            id: d.id, name: d.name, company: d.company, status: d.status,
            calls: (d.calls && d.calls[0] && d.calls[0].count) || 0, created_at: d.created_at
          }))
        });
      }
      if (urlPath === '/api/clients' && req.method === 'POST') {
        const { name, company } = await readBody(req);
        if (!name) return sendJson(res, { error: 'name required' }, 400);
        const row = (await sbRest('deals', jwt, {
          method: 'POST',
          body: { user_id: user.id, name, company: company || '', product_id: s.activeProductId, state: EMPTY_STATE() }
        }))[0];
        return sendJson(res, { ok: true, client: { id: row.id, name: row.name, company: row.company } });
      }
      if (seg[0] === 'api' && seg[1] === 'clients' && seg[2] && req.method === 'GET') {
        const rows = await sbRest('deals?id=eq.' + seg[2] + '&select=*,calls(id,created_at,summary,product_name,duration_sec)', jwt);
        const d = rows[0];
        if (!d) return sendJson(res, { error: 'not found' }, 404);
        (d.calls || []).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        return sendJson(res, { client: d });
      }
      if (seg[0] === 'api' && seg[1] === 'clients' && seg[2] && req.method === 'PATCH') {
        const body = await readBody(req);
        const patch = {};
        for (const k of ['name', 'company', 'status', 'notes']) if (k in body) patch[k] = body[k];
        const row = (await sbRest('deals?id=eq.' + seg[2], jwt, { method: 'PATCH', body: patch }))[0];
        return sendJson(res, { ok: true, client: row });
      }

      // ---- calls ----
      if (urlPath === '/api/calls' && req.method === 'GET') {
        const rows = await sbRest('calls?select=id,created_at,summary,product_name,duration_sec,deals(name,company)&order=created_at.desc', jwt);
        return sendJson(res, {
          calls: rows.map(c => ({
            id: c.id, created_at: c.created_at, summary: c.summary,
            product_name: c.product_name, duration_sec: c.duration_sec,
            client: c.deals ? c.deals.name : '(no client)', company: c.deals ? c.deals.company : ''
          }))
        });
      }
      if (seg[0] === 'api' && seg[1] === 'calls' && seg[2] && req.method === 'GET') {
        const rows = await sbRest('calls?id=eq.' + seg[2] + '&select=*,deals(name,company)', jwt);
        return sendJson(res, { call: rows[0] || null });
      }

      // ---- dashboard summary ----
      if (urlPath === '/api/home' && req.method === 'GET') {
        const [clients, calls] = await Promise.all([
          sbRest('deals?select=id,name,company,status,calls(count)&order=created_at.desc&limit=6', jwt),
          sbRest('calls?select=id,created_at,summary,product_name,deals(name)&order=created_at.desc&limit=6', jwt)
        ]);
        const allClients = await sbRest('deals?select=status', jwt);
        const stats = { total: allClients.length, won: 0, open: 0, lost: 0 };
        for (const c of allClients) stats[c.status] = (stats[c.status] || 0) + 1;
        return sendJson(res, {
          email: user.email, stats,
          recentClients: clients.map(d => ({ id: d.id, name: d.name, company: d.company, status: d.status, calls: (d.calls && d.calls[0] && d.calls[0].count) || 0 })),
          recentCalls: calls.map(c => ({ id: c.id, created_at: c.created_at, summary: c.summary, product_name: c.product_name, client: c.deals ? c.deals.name : '(no client)' }))
        });
      }

      // ---- call lifecycle ----
      if (urlPath === '/api/call/start' && req.method === 'POST') {
        const { dealId, productId } = await readBody(req);
        if (productId) s.activeProductId = productId;
        s.activeDealId = dealId || null;
        s.turns = []; s.cards = []; s.callLog = null; s.lastCardAt = 0; s.callStartAt = Date.now();
        s.memory = ''; s.priorMemoryMd = ''; s.dealName = '';
        const prod = (await sbRest('products?id=eq.' + s.activeProductId + '&select=name,content', jwt))[0];
        s.productContent = (prod && prod.content) || '';
        s.activeProductName = (prod && prod.name) || '';
        let brief = null, clientName = null;
        if (s.activeDealId) {
          const deal = (await sbRest('deals?id=eq.' + s.activeDealId + '&select=name,company,memory_md', jwt))[0];
          if (deal) {
            s.dealName = deal.name; s.dealCompany = deal.company || ''; clientName = deal.name;
            s.priorMemoryMd = deal.memory_md || '';
            if (s.priorMemoryMd.trim()) {
              brief = s.priorMemoryMd;
              s.memory = '\n\nDEAL MEMORY — the accumulated Client Brain for THIS prospect. USE it in your lines (their objections, stakeholders, commitments, stated pain, agreed next step, and the close plan):\n' + s.priorMemoryMd;
            } else {
              brief = 'First call with ' + deal.name + (deal.company ? ' (' + deal.company + ')' : '') + ' — no history yet. Get their situation and pain on record.';
              s.memory = '\n\nDEAL MEMORY: first call with ' + deal.name + ' — no history yet.';
            }
          }
        }
        return sendJson(res, { ok: true, brief, clientName, productName: s.activeProductName });
      }
      if (urlPath === '/api/call/end' && req.method === 'POST') {
        const duration = Math.round((Date.now() - (s.callStartAt || Date.now())) / 1000);
        if (!s.activeDealId) return sendJson(res, { ok: true, saved: false, msg: 'no client selected — nothing saved to memory' });
        if (s.turns.length < 2) return sendJson(res, { ok: true, saved: false, msg: 'call too short to analyze' });
        const memoryMd = await extractClientBrain(s.priorMemoryMd, s.turns, s.activeProductName, s.dealName, s.dealCompany);
        await sbRest('deals?id=eq.' + s.activeDealId, jwt, { method: 'PATCH', body: { memory_md: memoryMd } });
        const callRow = (await sbRest('calls', jwt, {
          method: 'POST',
          body: {
            user_id: user.id, deal_id: s.activeDealId, transcript: s.turns, cards: s.cards,
            summary: snapshotOf(memoryMd), product_name: s.activeProductName, duration_sec: duration
          }
        }))[0];
        s.priorMemoryMd = memoryMd;
        return sendJson(res, { ok: true, saved: true, msg: 'Client Brain updated — ' + (s.dealName || 'client'), callId: callRow.id, dealId: s.activeDealId });
      }

      if (urlPath === '/simulate' && req.method === 'POST') {
        const pair = SIM_PAIRS[s.simIdx++ % SIM_PAIRS.length];
        addTurn(s, 'me', pair.me);
        broadcast(s, { type: 'transcript', ch: 'me', text: pair.me });
        addTurn(s, 'prospect', pair.prospect);
        broadcast(s, { type: 'transcript', ch: 'prospect', text: pair.prospect });
        s.lastCardAt = 0;
        setTimeout(() => coach(s), 100);
        return sendJson(res, { ok: true });
      }

      return sendJson(res, { error: 'not found' }, 404);
    }
  } catch (e) {
    console.error('[api]', e.message);
    return sendJson(res, { error: e.message }, 500);
  }

  // -- static --
  const rel = urlPath === '/' ? 'index.html' : urlPath.slice(1);
  const file = path.join(__dirname, 'public', path.normalize(rel));
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

// ---- Deepgram relay (one live socket per browser audio socket) ----
const DG_URL = 'wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&punctuate=true&interim_results=true&endpointing=300';

function relayAudio(clientWs, ch, s) {
  ensureCallLog(s);
  const pending = [];
  let dgOpen = false;
  const dg = new WebSocket(DG_URL, ['token', DG_KEY]);
  dg.binaryType = 'arraybuffer';

  const keepAlive = setInterval(() => {
    if (dgOpen) { try { dg.send(JSON.stringify({ type: 'KeepAlive' })); } catch {} }
  }, 8000);

  dg.onopen = () => {
    dgOpen = true;
    for (const chunk of pending) dg.send(chunk);
    pending.length = 0;
    broadcast(s, { type: 'status', msg: ch + ' channel listening' });
  };

  dg.onmessage = (ev) => {
    let d; try { d = JSON.parse(ev.data.toString()); } catch { return; }
    const alt = d.channel && d.channel.alternatives && d.channel.alternatives[0];
    if (!alt) return;
    const text = (alt.transcript || '').trim();
    if (!text) return;
    if (d.is_final) {
      addTurn(s, ch, text);
      broadcast(s, { type: 'transcript', ch, text });
      if (ch === 'prospect') {
        clearTimeout(s.coachTimer);
        // prospect actually stopped (speech_final) → coach immediately; mid-stream → short debounce
        s.coachTimer = setTimeout(() => coach(s), d.speech_final ? 0 : 400);
      }
    } else {
      broadcast(s, { type: 'interim', ch, text });
    }
  };

  dg.onerror = () => broadcast(s, { type: 'status', msg: ch + ' transcription error — reconnect by re-starting the call' });
  dg.onclose = () => { dgOpen = false; clearInterval(keepAlive); };

  clientWs.on('message', (data) => {
    if (dgOpen) dg.send(data);
    else pending.push(data);
  });
  clientWs.on('close', () => {
    clearInterval(keepAlive);
    try { if (dgOpen) dg.send(JSON.stringify({ type: 'CloseStream' })); } catch {}
    setTimeout(() => { try { dg.close(); } catch {} }, 1500);
  });
}

const wss = new WebSocketServer({ server });
wss.on('connection', async (ws, req) => {
  const u = new URL(req.url, 'http://x');
  const user = await getUser(u.searchParams.get('t'));
  if (!user) { ws.close(4001, 'not signed in'); return; }
  const s = getSession(user.id);

  if (u.pathname === '/events') {
    s.events.add(ws);
    ws.send(JSON.stringify({ type: 'status', msg: 'connected' }));
    ws.on('close', () => s.events.delete(ws));
  } else if (u.pathname === '/audio') {
    const ch = u.searchParams.get('ch') === 'me' ? 'me' : 'prospect';
    relayAudio(ws, ch, s);
  } else {
    ws.close();
  }
});

server.listen(PORT, HOST, () => {
  console.log('closer-copilot running → http://localhost:' + PORT + ' (host ' + HOST + ')');
  console.log('live model: ' + LIVE_MODEL + ' | analysis model: ' + ANALYSIS_MODEL);
});
