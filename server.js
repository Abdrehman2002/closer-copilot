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
// Three OpenAI model tiers, picked by measured latency + quality on the hardest
// playbook moves (see model-bench scripts): fast+sharp for the live whisper (every
// few seconds of a call — latency and quality-on-hard-cases both matter), the
// strongest model for the between-call battle plan (not latency sensitive — this is
// the moat), and a fast mid-tier for structured post-call extraction (runs once/call).
const LIVE_MODEL = process.env.LIVE_MODEL || 'gpt-4.1-mini';
const PREP_MODEL = process.env.PREP_MODEL || 'gpt-4.1';
const ANALYSIS_MODEL = process.env.ANALYSIS_MODEL || 'gpt-4.1-mini';
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
CONF: HIGH or LOW — HIGH when the move maps to a known objection/rebuttal or facts in the playbook & Client Brain; LOW when you are improvising beyond the given facts

If HOLD: output only "DECISION: HOLD" and nothing else. Per the playbook, FIRE whenever a useful next line exists (most of the time the prospect just spoke); HOLD only for pure greetings/small talk. When in doubt, FIRE.

LINE delivery rules (MANDATORY, every card). You are directing an actor — the delivery
must be precise enough to perform without thinking:
- ONE short line, max ~22 words of SPOKEN text, verbatim — short enough to glance and say in one breath.
- || = one-beat pause exactly there. |||| = long pause, 2+ seconds, let it breathe.
  At least one pause if the line is longer than 6 words.
- ↘ = the words after it drop lower and slower (authority, statement lands).
  ↗ = the words after it lift (genuine curious question). Use at least one.
- *word* = the single most-stressed word in the line. Exactly one per card.
- NUMBERS & PRICES: write them the way they are SPOKEN, never as digits, and mark them [word by word]:
  e.g. "seven ninety-seven a month" (NOT "$797"), "fifteen hundred to set up" (NOT "$1,500"). Never make the closer decode a number mid-sentence.
- [vocal-cue] = how the words SOUND — works on every call, camera on or off, placed exactly where the
  delivery shifts. Vocabulary: [slower] [speed up] [softer] [near-whisper] [warmth up] [certainty]
  [smile in your voice] [flat & serious] [let it hang] [word by word].
- [👤 body-cue] = an OPTIONAL body-language direction for when the camera is on — ALWAYS prefix with 👤
  so it reads as visual. Vocabulary: [👤 lean in] [👤 warm smile] [👤 nod] [👤 sit back] [👤 open hands] [👤 hold eye contact].
  Add one when it strengthens the moment; the closer ignores it if their camera is off.
- Use 1–2 cues total per card (a vocal one, optionally a 👤 body one), each at the exact word it applies to.
- TONE field = opening state before the first word: EMOTION · pace · vocal quality (+ optional body note).
  e.g. "CALM · slow · warmth in the voice" / "CERTAIN · deliberate · smile in your voice, sit back" — never just "CALM".
- If the right move is silence: LINE: … and TONE: SILENT — go quiet ~3 seconds, let them fill it
- If DEAL MEMORY is present, USE it: reference what THIS prospect said in previous calls
  (their objections, commitments, stakeholders, stated pain) whenever it sharpens the move.
- FACTS ARE SACRED: never state a price, discount, guarantee, statistic, or feature that is not
  explicitly in the playbook, the Client Brain, or this call's transcript. If you don't know the
  number, ask a question instead of guessing. Invented facts get the closer caught lying.

Example:
DECISION: FIRE
TONE: CALM · slow · soft eyes
LINE: I hear you — |||| [softer] most owners said the same… ↘ until they counted the *missed* calls. || [👤 lean in] ↗ what's one job worth to you?
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
      productContent: '', memory: '', dealState: null, dealName: '', dealCompany: '',
      closerProfile: null,
      lastCardAt: 0, coachBusy: false, coachQueued: false, coachTimer: null,
      meLastAt: 0, pendingCard: null, cardFlushTimer: null,
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

// the closer's own voice: tone, framework, signature phrases, never-say list —
// rarely changes call to call, so it stays in the cacheable prefix alongside the product
function closerProfileBlock(profile) {
  if (!profile || (!profile.tone && !profile.framework && !profile.signature_phrases && !profile.never_say)) return '';
  const lines = ['CLOSER PROFILE — match THIS person\'s voice, not a generic script:'];
  if (profile.tone) lines.push('- Their natural tone: ' + profile.tone);
  if (profile.framework) lines.push('- Their preferred sales framework/style: ' + profile.framework);
  if (profile.signature_phrases) lines.push('- Phrases they like to use — weave these in naturally when they fit: ' + profile.signature_phrases);
  if (profile.never_say) lines.push('- NEVER say (their words, not this list): ' + profile.never_say);
  return '\n\n' + lines.join('\n');
}

// lightweight, deterministic read on the moment from the prospect's last line —
// no extra API call, near-zero latency cost, sharpens which MOMENT->MOVE the coach reaches for
function detectTrigger(turns) {
  const lastProspect = [...turns].reverse().find(t => t.ch === 'prospect');
  if (!lastProspect) return 'Early in the call — no prospect line yet.';
  const t = lastProspect.text.toLowerCase();
  if (/\$|\bprice\b|\bcost\b|expensive|afford|budget|how much/.test(t)) return 'PRICE moment — price was just said or asked about.';
  if (/already (have|use|got)|competitor|cheaper|other (company|option|guy)/.test(t)) return 'COMPETITOR mention — comparing to another option.';
  if (/not sure|don'?t know|maybe|think (it |about )?over|talk to|run it by|call.*back|not (a )?good time|another time/.test(t)) return 'STALL — vague deferral, needs the real objection isolated.';
  if (/how (do|does|would|soon)|when can|what.*next|sounds good|i'?m in|let'?s do|get started|sign (me )?up/.test(t)) return 'BUYING SIGNAL — lean into the close.';
  if (/no|not interested|worried|concern|but |however|doubt|robot|scam|trust/.test(t)) return 'OBJECTION — a concern was just raised.';
  return 'Neutral moment — no strong signal, use judgment on whether a line helps.';
}

function buildSystemPrompt(s) {
  // Keep the big stable content (intro + closer profile + playbook + product + format rules)
  // as one prefix so OpenAI prompt-caching serves it near-instantly on every call after the
  // first; the parts that vary turn to turn (deal memory + the live trigger read) go LAST as a
  // short tail. This is the main latency win.
  return 'You are a live sales coach whispering to "ME" (the seller) during a real video sales call.\n' +
    'You see the live transcript. Feed the closer the best next line to say. Fire whenever a useful line exists — the closer is counting on you — and stay silent only for pure small talk.' +
    closerProfileBlock(s.closerProfile) + '\n\n' +
    PLAYBOOK + '\n\n' +
    (s.productContent || '(no product knowledge provided)') + '\n\n' +
    FORMAT_RULES +
    (s.memory || '') +
    '\n\nLIVE TRIGGER (read on the moment right now): ' + detectTrigger(s.turns);
}

// ---- coach loop (streaming, per session) ----
const CARD_COOLDOWN_MS = 2500;
const REP_QUIET_MS = 650;   // rep considered "still delivering" if they spoke within this window
const MAX_HOLD_MS = 6000;   // never hold a card longer than this

// true if the closer ("ME") is mid-delivery right now — don't drop a new card on top of them
function repTalking(s) { return Date.now() - s.meLastAt < REP_QUIET_MS; }

// show a finished card, but WAIT until the closer isn't mid-sentence (fixes card-stacking)
function showCard(s, card, since) {
  if (!repTalking(s) || Date.now() - since > MAX_HOLD_MS) {
    clearTimeout(s.cardFlushTimer); s.pendingCard = null;
    s.lastCardAt = Date.now();
    const id = s.cards.length;   // stable index into s.cards — the client rates a card by this id
    s.cards.push({ id, at: Date.now() - (s.callStartAt || Date.now()), tone: card.tone, line: card.line, why: card.why, technique: card.technique, confidence: card.confidence || 'high', used: null });
    broadcast(s, { ...card, id });
    logEvent(s, { type: 'card', id, tone: card.tone, line: card.line, why: card.why, technique: card.technique });
    console.log('[coach]', s.userId.slice(0, 8), 'FIRE:', card.line);
    return;
  }
  s.pendingCard = { card, since };
  clearTimeout(s.cardFlushTimer);
  s.cardFlushTimer = setTimeout(() => { const pc = s.pendingCard; if (pc) showCard(s, pc.card, pc.since); }, 150);
}

function parseCoach(raw) {
  const get = k => {
    const m = raw.match(new RegExp('^' + k + ':\\s*(.*)$', 'm'));
    return m ? m[1].trim() : null;
  };
  return { decision: get('DECISION'), tone: get('TONE'), line: get('LINE'), why: get('WHY'), tech: get('TECH'), conf: get('CONF') };
}

// === line-guard start ===
// Never-wrong guardrails: a whispered line must not contain a price/number that isn't in
// the playbook, Client Brain, or this call's transcript, and must never contain the
// closer's never-say phrases. One hallucinated price on a live call destroys all trust.

const NUM_WORDS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

// parse a run of number words ("seven ninety seven", "fourteen hundred", "two thousand five hundred")
// into every numeric reading a listener could take from it (spoken prices are ambiguous:
// "seven ninety-seven" = 797, "fourteen fifty" = 1450 or 14.50 — we collect all candidates)
function spokenRunValues(words) {
  const vals = new Set();
  const toks = words.map(w => w.toLowerCase().replace(/[^a-z]/g, '')).filter(Boolean);
  if (!toks.length) return vals;
  // sequential "hundred/thousand" grammar: X hundred [Y], X thousand [Y hundred] [Z].
  // English additive order is strictly descending ("ninety seven" = 97; "seven ninety"
  // is NOT 97 or 104 — it's a two-part price, handled below), so enforce that.
  let total = 0, cur = 0, valid = true, lastWord = null;
  for (const t of toks) {
    if (t in NUM_WORDS) {
      const v = NUM_WORDS[t];
      if (lastWord != null && !(lastWord >= 20 && lastWord % 10 === 0 && v < 10)) { valid = false; break; }
      cur += v; lastWord = v;
    } else if (t === 'hundred') { cur = (cur || 1) * 100; lastWord = null; }
    else if (t === 'thousand') { total += (cur || 1) * 1000; cur = 0; lastWord = null; }
    else if (t === 'and') { lastWord = null; }
    else { valid = false; break; }
  }
  if (valid) vals.add(total + cur);
  // two-part spoken price: "seven ninety-seven" -> 7*100 + 97; "fourteen fifty" -> 1450
  const nums = [];
  let acc = null;
  for (const t of toks) {
    if (t in NUM_WORDS) {
      const v = NUM_WORDS[t];
      if (acc != null && acc >= 20 && acc % 10 === 0 && v < 10) { acc += v; }  // "ninety"+"seven"
      else { if (acc != null) nums.push(acc); acc = v; }
    } else if (t === 'hundred' || t === 'thousand' || t === 'and') {
      if (acc != null) { nums.push(acc); acc = null; }
      nums.length = 0; // grammar handled above; bail on mixed forms
      break;
    }
  }
  if (acc != null) nums.push(acc);
  if (nums.length === 2) vals.add(nums[0] * 100 + nums[1]);
  return vals;
}

// every numeric value present in a text (digits + spoken forms)
function numbersIn(text) {
  const vals = new Set();
  const t = String(text || '');
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const v = parseFloat(m[0].replace(/,/g, ''));
    if (!isNaN(v)) { vals.add(v); if (!Number.isInteger(v)) vals.add(Math.round(v * 100)); }  // $14.50 ⇄ "fourteen fifty"
  }
  // \b on both ends + longest-first alternation, so "nine" can't match inside "ninety"
  // and "one" can't match inside "money"
  const W = 'seventeen|thirteen|fourteen|eighteen|nineteen|sixteen|fifteen|eleven|twelve|hundred|thousand|seventy|eighty|ninety|twenty|thirty|forty|fifty|sixty|three|seven|eight|four|five|nine|zero|one|two|six|ten|and';
  const wordRun = new RegExp('\\b((?:(?:' + W + ')[\\s-]+)*(?:' + W + '))\\b', 'gi');
  for (const m of t.matchAll(wordRun)) {
    for (const v of spokenRunValues(m[0].split(/[\s-]+/))) vals.add(v);
  }
  return vals;
}

const MONEY_CONTEXT = /(\$|dollar|buck|grand|\bk\b|a month|per month|monthly|a year|per year|set ?up|deposit|percent|%|-day\b|day guarantee|discount|refund|price|cost|fee|charge)/i;

// numeric values in the line that appear in a money/claim context and therefore must be sourced
function pricedNumbers(line) {
  const out = new Set();
  const t = String(line || '');
  // scan windows: any number expression whose ±4-word neighborhood mentions money
  const tokens = t.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const windowText = tokens.slice(Math.max(0, i - 4), i + 5).join(' ');
    if (!MONEY_CONTEXT.test(windowText)) continue;
    for (const v of numbersIn(tokens.slice(Math.max(0, i - 3), i + 4).join(' '))) out.add(v);
  }
  return out;
}

const ALWAYS_ALLOWED = new Set([24, 7, 100]);  // "24/7", "a hundred percent"

function validateLine(line, sources, neverSay) {
  // 1) never-say phrases are a hard no, wherever they came from
  for (const phrase of String(neverSay || '').split(/[,/;\n]+/).map(p => p.trim().toLowerCase()).filter(p => p.length > 2)) {
    if (String(line || '').toLowerCase().includes(phrase)) {
      return { ok: false, issue: 'contains a never-say phrase: "' + phrase + '"' };
    }
  }
  // 2) money/claim numbers must exist in the playbook / Client Brain / transcript
  const priced = pricedNumbers(line);
  if (priced.size) {
    const allowed = numbersIn(sources);
    for (const v of priced) {
      if (v < 13 || ALWAYS_ALLOWED.has(v)) continue;    // small counts & idioms are fine
      if (!allowed.has(v)) return { ok: false, issue: 'states a number not in the playbook/history: ' + v };
    }
  }
  return { ok: true };
}

// partial lines get held back from the HUD the moment they start talking numbers/money,
// so a bad price can never even flash on screen before validation completes
function partialNeedsHold(partialLine, neverSay) {
  const t = String(partialLine || '');
  if (/\d/.test(t) || MONEY_CONTEXT.test(t)) return true;
  if (/(hundred|thousand|ninety|eighty|seventy|sixty|fifty|forty|thirty|twenty)/i.test(t)) return true;
  for (const phrase of String(neverSay || '').split(/[,/;\n]+/).map(p => p.trim().toLowerCase()).filter(p => p.length > 2)) {
    const firstWord = phrase.split(/\s+/)[0];
    if (firstWord.length >= 4 && t.toLowerCase().includes(firstWord)) return true;
  }
  return false;
}
// === line-guard end ===

async function coach(s) {
  if (s.coachBusy) { s.coachQueued = true; return; }
  if (Date.now() - s.lastCardAt < CARD_COOLDOWN_MS) return;
  if (!s.turns.length) return;
  s.coachBusy = true;
  try {
    const recent = s.turns.slice(-24)
      .map(t => (t.ch === 'me' ? 'ME' : 'PROSPECT') + ': ' + t.text)
      .join('\n');
    const systemPrompt = buildSystemPrompt(s);
    const userPrompt = 'LIVE TRANSCRIPT (most recent last):\n' + recent + '\n\nDecide now.';
    // guard inputs: every number the line is ALLOWED to say must come from here
    const guardSources = (s.productContent || '') + '\n' + (s.priorMemoryMd || '') + '\n' + recent;
    const neverSay = (s.closerProfile && s.closerProfile.never_say) || '';

    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LIVE_MODEL,
        temperature: 0.4,
        max_tokens: 200,
        stream: true,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
    if (!r.ok) throw new Error('OpenAI ' + r.status + ' ' + (await r.text()).slice(0, 120));

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let sse = '', raw = '', lastSentLine = null, partialHeld = false;

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
      // stream partial words to the HUD only while the closer is NOT mid-sentence — and
      // freeze the partial stream the moment the line starts talking numbers/money, so an
      // unvalidated price can never flash on screen (the validated final replaces it)
      if (p.decision === 'FIRE' && p.tone && p.line !== null && p.line !== lastSentLine && !repTalking(s)) {
        if (partialNeedsHold(p.line, neverSay)) { partialHeld = true; continue; }
        if (partialHeld) continue;
        lastSentLine = p.line;
        broadcast(s, { type: 'card-stream', tone: p.tone, line: p.line, why: '', technique: '', done: false });
      }
    }

    let p = parseCoach(raw);
    if (p.decision === 'FIRE' && p.line) {
      // fact-check the finished line; one corrective retry, then withhold
      let v = validateLine(p.line, guardSources, neverSay);
      if (!v.ok) {
        console.log('[guard]', s.userId.slice(0, 8), 'REJECTED:', v.issue, '|', p.line);
        logEvent(s, { type: 'guard-reject', issue: v.issue, line: p.line });
        const r2 = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: LIVE_MODEL, temperature: 0.3, max_tokens: 200,
            messages: [
              { role: 'system', content: systemPrompt },
              { role: 'user', content: userPrompt },
              { role: 'assistant', content: raw },
              { role: 'user', content: 'REJECTED — your line ' + v.issue + '. Regenerate the full response in the same format. Use ONLY prices, numbers and claims that appear in the playbook, Client Brain or transcript, and never use forbidden phrases. If you cannot source the number, ask a question instead.' }
            ]
          })
        });
        const j2 = await r2.json();
        if (j2.error) throw new Error(j2.error.message);
        const raw2 = (j2.choices[0].message.content || '');
        p = parseCoach(raw2);
        v = p.decision === 'FIRE' && p.line ? validateLine(p.line, guardSources, neverSay) : { ok: false, issue: 'no line on retry' };
        if (!v.ok) {
          console.log('[guard]', s.userId.slice(0, 8), 'WITHHELD after retry:', v.issue);
          logEvent(s, { type: 'guard-withheld', issue: v.issue });
          if (lastSentLine !== null) broadcast(s, { type: 'card-stream', tone: '', line: lastSentLine, why: '', technique: '', done: true });
          broadcast(s, { type: 'status', msg: 'coach: line withheld (failed fact-check) — trust your read' });
          s.coachBusy = false;
          if (s.coachQueued) { s.coachQueued = false; coach(s); }
          return;
        }
      }
      const card = {
        type: 'card-stream', tone: p.tone || '', line: p.line, why: p.why || '', technique: p.tech || '',
        confidence: /low/i.test(p.conf || '') ? 'low' : 'high', done: true
      };
      showCard(s, card, Date.now());   // holds until the closer stops talking
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

// pull the section body under a "## Heading" out of a Client Brain
function sectionOf(md, heading) {
  const re = new RegExp('##\\s*' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)', 'i');
  const m = String(md || '').match(re);
  return m ? m[1].trim() : '';
}

// read the sales-actionable signals out of a Client Brain for the close board
function parseBrain(md) {
  md = String(md || '');
  const snapshot = (md.match(/\*\*Snapshot:\*\*\s*(.+)/i) || [])[1]?.trim() || '';
  const objSection = sectionOf(md, 'Objections raised');
  const openObjections = objSection.split('\n')
    .filter(l => /^[-*]/.test(l.trim()) && /open/i.test(l))
    .map(l => l.replace(/^[-*]\s*/, '').replace(/\s*[—-]\s*status:.*$/i, '').trim())
    .filter(Boolean).slice(0, 5);
  const nextStep = sectionOf(md, 'Where we left off / agreed next step').replace(/^[-*]\s*/gm, '').trim();
  const howToClose = sectionOf(md, 'How to close them next call').replace(/^[-*]\s*/gm, '').trim();
  const commitmentsUs = [], commitmentsThem = [];
  for (const raw of sectionOf(md, 'Commitments').split('\n')) {
    const t = raw.replace(/^[-*]\s*/, '').trim();
    if (/^us\s*:/i.test(t)) commitmentsUs.push(t.replace(/^us\s*:\s*/i, ''));
    else if (/^them\s*:/i.test(t)) commitmentsThem.push(t.replace(/^them\s*:\s*/i, ''));
  }
  const hay = (snapshot + ' ' + md).toLowerCase();
  let warmth = 'warming';
  if (/\b(cold|stalled|hesitant|resistant|not ready|not interested|going nowhere|skeptical|unconvinced)\b/.test(hay)) warmth = 'cold';
  if (/\b(hot|ready to (close|buy|move|sign|start|go)|eager|excited|very interested|strong interest|keen|sold|warm)\b/.test(hay)) warmth = 'hot';
  return { snapshot, openObjections, nextStep, howToClose, warmth, commitmentsUs, commitmentsThem };
}

// compute the single primary "next move" for one open deal
function dealMove(d, now) {
  const b = parseBrain(d.memory_md || '');
  const hasBrain = !!String(d.memory_md || '').trim();
  const dates = (d.calls || []).map(c => c.created_at).filter(Boolean).sort();
  const lastCallAt = dates.length ? dates[dates.length - 1] : null;
  const days = lastCallAt ? Math.floor((now - new Date(lastCallAt).getTime()) / 86400000) : null;
  let type, action;
  if (b.commitmentsUs.length) { type = 'waiting'; action = b.commitmentsUs[0]; }
  else if (b.commitmentsThem.length) { type = 'follow_up'; action = b.commitmentsThem[0]; }
  else if (b.warmth === 'hot' || /\b(close|sign|start|book|ready|onboard|schedule|go live)\b/i.test(b.nextStep)) { type = 'ready'; action = b.nextStep || 'Objections are handled — ask for the business.'; }
  else if (!hasBrain) { type = 'first'; action = 'Get their situation and pain on record.'; }
  else if (days != null && days >= 4) { type = 'cold'; action = b.nextStep || 'Re-open the pain and earn the next call.'; }
  else { type = 'motion'; action = b.nextStep || 'Keep the conversation moving.'; }
  const base = { waiting: 100, follow_up: 90, ready: 80, cold: 60, motion: 30, first: 20 }[type];
  return { id: d.id, name: d.name, company: d.company, type, action, days, howToClose: b.howToClose, nextStep: b.nextStep, score: base + Math.min(days || 0, 30) };
}

// pull objection -> line cues out of a compiled playbook's "Objection playbook" section
function parseCues(content) {
  const block = sectionOf(content, 'Objection playbook');
  const cues = [];
  const re = /###\s*"?([^"\n]+?)"?\s*\n([\s\S]*?)(?=\n###|\n##|$)/g;
  let m;
  while ((m = re.exec(block)) && cues.length < 12) {
    const objection = m[1].trim();
    const say = ((m[2].match(/-\s*Say:\s*(.+)/i) || [])[1] || '').trim();
    if (objection) cues.push({ objection, say });
  }
  return cues;
}

const STOPWORDS = new Set(['the','a','an','is','it','to','of','for','on','we','you','they','and','or','too','my','your','with','that','this','not','have','has','be','are','was','im','ive','dont','need','about','just','really']);
const kwTokens = (s) => (String(s || '').toLowerCase().match(/[a-z]+/g) || []).filter(w => w.length > 2 && !STOPWORDS.has(w));
const objKey = (s) => kwTokens(s).slice(0, 4).join(' ');

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

// compile a salesperson's interview answers into a rich structured playbook the coach reads
async function compilePlaybook(answers) {
  const body = Object.entries(answers || {})
    .filter(([k]) => k !== 'name')
    .map(([k, v]) => k.toUpperCase() + ':\n' + (v || '(not provided)')).join('\n\n');
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ANALYSIS_MODEL, temperature: 0.3, max_tokens: 1500,
      messages: [
        {
          role: 'system',
          content: `You turn a salesperson's interview answers into a sharp, structured "Sales Playbook" in Markdown that a live AI voice-coach reads on every call to feed the seller exact lines. The calls are VOICE ONLY.
Use EXACTLY these sections and headings:

# {offer name}
## What we sell & the transformation
## Ideal buyer & how to read them
## Core pain & the cost of doing nothing (in their numbers)
## Objection playbook
For EACH objection the seller mentioned, output:
### "<the objection in the prospect's own words>"
- Move: <the psychology to use — label / reframe / calibrated question / re-anchor, etc.>
- Say: <a ready, natural, voice-first line the seller can deliver — short, spoken, not corporate>
## Proof & risk-reversal
## Competition & why us (include 'doing nothing')
## The close
The exact ask, the price anchor, and any REAL urgency.
## Voice & phrases
How they want to sound; always-use and never-use phrases.

Rules: use ONLY facts from their answers — NEVER invent prices, proof, guarantees, or urgency. If something is missing, write "(not provided)". Keep every line short and natural for the ear.`
        },
        { role: 'user', content: 'PLAYBOOK NAME: ' + ((answers && answers.name) || 'Untitled') + '\n\nINTERVIEW ANSWERS:\n' + body }
      ]
    })
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return (j.choices[0].message.content || '').trim();
}

// pre-call tactical battle plan — runs once before each call, spends the best model
// (not latency sensitive, this is the moat) synthesizing closer + product + Client Brain
// into a short opening move / predicted objection / close play the closer reads before dialing
async function generateBattlePlan(closerProfile, productContent, productName, memoryMd, clientName, company) {
  const cp = closerProfile || {};
  const closerLines = [
    cp.tone ? 'Tone: ' + cp.tone : '',
    cp.framework ? 'Framework: ' + cp.framework : '',
    cp.signature_phrases ? 'Likes to say: ' + cp.signature_phrases : '',
    cp.never_say ? 'Never say: ' + cp.never_say : '',
  ].filter(Boolean).join('\n') || '(no closer profile set)';

  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: PREP_MODEL,
      temperature: 0.4,
      max_tokens: 500,
      messages: [
        {
          role: 'system',
          content: `You write a short, sharp pre-call "battle plan" for a closer about to get on a call. Output ONLY Markdown, EXACTLY these sections:
## Opening move
One or two sentences: how to open THIS specific call, in the closer's voice.
## Most likely objection
The single objection most likely to come up next (from their history or, if first call, from the product's known top objection) — and the exact counter-move.
## Close play
The concrete move to try for advancing or closing this deal on this call.
Rules: ground every line in the ACTUAL product info and Client Brain given — never invent facts, prices, or history. Keep every section to 1-3 short sentences, written to be read in 10 seconds before dialing.`
        },
        {
          role: 'user',
          content: `CLOSER PROFILE:\n${closerLines}\n\nPRODUCT (${productName || 'unspecified'}):\n${productContent || '(none provided)'}\n\nCLIENT: ${clientName || 'the prospect'}${company ? ' — ' + company : ''}\nCLIENT BRAIN (history with this prospect):\n${memoryMd && memoryMd.trim() ? memoryMd : '(first call — no history yet)'}`
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
          sbRest('profiles?user_id=eq.' + user.id + '&select=name,tone,framework,signature_phrases,never_say', jwt),
          sbRest('products?select=id&limit=1', jwt),
          sbRest('deals?select=id&limit=1', jwt)
        ]);
        const p = prof[0] || {};
        return sendJson(res, {
          email: user.email, name: p.name || '',
          tone: p.tone || '', framework: p.framework || '', signature_phrases: p.signature_phrases || '', never_say: p.never_say || '',
          hasProducts: prods.length > 0, hasClients: cls.length > 0, productTemplate: PRODUCT_TEMPLATE
        });
      }
      if (urlPath === '/api/profile' && req.method === 'POST') {
        const body = await readBody(req);
        if (!body.name) return sendJson(res, { error: 'name required' }, 400);
        const patch = { user_id: user.id, name: body.name };
        for (const k of ['tone', 'framework', 'signature_phrases', 'never_say']) if (k in body) patch[k] = body[k] || '';
        await sbRest('profiles?on_conflict=user_id', jwt, {
          method: 'POST', body: patch,
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

      if (urlPath === '/api/playbook/compile' && req.method === 'POST') {
        const { answers } = await readBody(req);
        const content = await compilePlaybook(answers || {});
        return sendJson(res, { ok: true, content });
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

      // ---- close board: open deals with sales intelligence from the Client Brain ----
      if (urlPath === '/api/pipeline' && req.method === 'GET') {
        const deals = await sbRest('deals?select=id,name,company,status,memory_md,calls(created_at)&order=created_at.desc', jwt);
        const rows = deals.filter(d => d.status === 'open').map(d => {
          const dates = (d.calls || []).map(c => c.created_at).filter(Boolean).sort();
          return {
            id: d.id, name: d.name, company: d.company,
            calls: (d.calls || []).length,
            lastCallAt: dates.length ? dates[dates.length - 1] : null,
            hasBrain: !!String(d.memory_md || '').trim(),
            ...parseBrain(d.memory_md || '')
          };
        });
        return sendJson(res, { deals: rows });
      }

      // ---- action queue: the closer's ranked "next moves" from deal memory ----
      if (urlPath === '/api/next-moves' && req.method === 'GET') {
        const deals = await sbRest('deals?select=id,name,company,status,memory_md,calls(created_at)&order=created_at.desc', jwt);
        const now = Date.now();
        const items = deals.filter(d => d.status === 'open').map(d => dealMove(d, now)).sort((a, b) => b.score - a.score);
        return sendJson(res, { items });
      }

      // ---- full dashboard: moves + focus + playbook cues + objection radar + gaps + wins ----
      if (urlPath === '/api/dashboard' && req.method === 'GET') {
        const now = Date.now();
        const [deals, products] = await Promise.all([
          sbRest('deals?select=id,name,company,status,memory_md,calls(created_at)&order=created_at.desc', jwt),
          sbRest('products?select=id,name,content&order=created_at', jwt),
        ]);
        const openDeals = deals.filter(d => d.status === 'open');
        const moves = openDeals.map(d => dealMove(d, now)).sort((a, b) => b.score - a.score);

        const radarMap = {};
        for (const d of openDeals) for (const o of parseBrain(d.memory_md || '').openObjections) {
          const k = objKey(o) || o.toLowerCase();
          (radarMap[k] = radarMap[k] || { objection: o, count: 0 }).count++;
        }
        const radar = Object.values(radarMap).sort((a, b) => b.count - a.count).slice(0, 6);

        const cueList = products.map(p => ({ id: p.id, name: p.name, cues: parseCues(p.content || '') }));
        const primary = cueList.find(p => p.cues.length) || cueList[0] || null;
        const cues = primary ? { playbookId: primary.id, playbookName: primary.name, objections: primary.cues.slice(0, 8) } : null;

        const coveredTokens = new Set();
        for (const p of products) for (const c of parseCues(p.content || '')) kwTokens(c.objection).forEach(t => coveredTokens.add(t));
        const gapMap = {};
        for (const d of deals) for (const o of parseBrain(d.memory_md || '').openObjections) {
          const tk = kwTokens(o);
          if (tk.length && !tk.some(t => coveredTokens.has(t))) {
            const k = objKey(o) || o.toLowerCase();
            (gapMap[k] = gapMap[k] || { objection: o, count: 0 }).count++;
          }
        }
        const gaps = Object.values(gapMap).sort((a, b) => b.count - a.count).slice(0, 4);

        const wins = deals.filter(d => d.status === 'won').slice(0, 5).map(d => ({ id: d.id, name: d.name, company: d.company }));

        return sendJson(res, { moves, focus: moves[0] || null, cues, radar, gaps, wins });
      }

      // ---- call lifecycle ----
      if (urlPath === '/api/call/start' && req.method === 'POST') {
        const { dealId, productId } = await readBody(req);
        if (productId) s.activeProductId = productId;
        s.activeDealId = dealId || null;
        s.turns = []; s.cards = []; s.callLog = null; s.lastCardAt = 0; s.callStartAt = Date.now();
        s.memory = ''; s.priorMemoryMd = ''; s.dealName = ''; s.dealCompany = '';

        const [prodRow, profRows] = await Promise.all([
          sbRest('products?id=eq.' + s.activeProductId + '&select=name,content', jwt),
          sbRest('profiles?user_id=eq.' + user.id + '&select=tone,framework,signature_phrases,never_say', jwt),
        ]);
        const prod = prodRow[0];
        s.productContent = (prod && prod.content) || '';
        s.activeProductName = (prod && prod.name) || '';
        s.closerProfile = profRows[0] || null;

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

        let battlePlan = null;
        try {
          battlePlan = await generateBattlePlan(s.closerProfile, s.productContent, s.activeProductName, s.priorMemoryMd, clientName, s.dealCompany);
        } catch (e) {
          console.error('[battle-plan]', e.message);   // non-fatal — the call still starts without it
        }

        return sendJson(res, { ok: true, brief, battlePlan, clientName, productName: s.activeProductName });
      }
      if (urlPath === '/api/call/end' && req.method === 'POST') {
        const { outcome, savedDeal, savedDealNote } = await readBody(req);
        const duration = Math.round((Date.now() - (s.callStartAt || Date.now())) / 1000);
        if (!s.activeDealId) return sendJson(res, { ok: true, saved: false, msg: 'no client selected — nothing saved to memory' });
        if (s.turns.length < 2) return sendJson(res, { ok: true, saved: false, msg: 'call too short to analyze' });
        const memoryMd = await extractClientBrain(s.priorMemoryMd, s.turns, s.activeProductName, s.dealName, s.dealCompany);
        await sbRest('deals?id=eq.' + s.activeDealId, jwt, { method: 'PATCH', body: { memory_md: memoryMd } });
        const callRow = (await sbRest('calls', jwt, {
          method: 'POST',
          body: {
            user_id: user.id, deal_id: s.activeDealId, transcript: s.turns, cards: s.cards,
            summary: snapshotOf(memoryMd), product_name: s.activeProductName, duration_sec: duration,
            outcome: outcome && ['closed', 'lost', 'follow_up'].includes(outcome) ? outcome : 'unknown',
            saved_deal: typeof savedDeal === 'boolean' ? savedDeal : null,
            saved_deal_note: savedDealNote || ''
          }
        }))[0];
        s.priorMemoryMd = memoryMd;
        return sendJson(res, { ok: true, saved: true, msg: 'Client Brain updated — ' + (s.dealName || 'client'), callId: callRow.id, dealId: s.activeDealId });
      }

      // ---- live-call card feedback (line-acceptance metric) ----
      if (urlPath === '/api/card-feedback' && req.method === 'POST') {
        const { id, used } = await readBody(req);
        const card = s.cards.find(c => c.id === id);
        if (card) card.used = !!used;
        return sendJson(res, { ok: true });
      }

      // ---- personal metrics (the closer's own PMF numbers) ----
      if (urlPath === '/api/metrics' && req.method === 'GET') {
        const calls = await sbRest('calls?select=id,created_at,cards,outcome,saved_deal', jwt);
        let used = 0, rated = 0, closed = 0, decided = 0, savedDeals = 0;
        const byDay = {};
        for (const c of calls) {
          for (const card of (c.cards || [])) {
            if (card.used === true) { used++; rated++; }
            else if (card.used === false) rated++;
          }
          if (c.outcome && c.outcome !== 'unknown') { decided++; if (c.outcome === 'closed') closed++; }
          if (c.saved_deal === true) savedDeals++;
          const day = (c.created_at || '').slice(0, 10);
          if (day) byDay[day] = (byDay[day] || 0) + 1;
        }
        const last14 = [];
        for (let i = 13; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
          last14.push({ day: d, calls: byDay[d] || 0 });
        }
        return sendJson(res, {
          totalCalls: calls.length,
          lineAcceptancePct: rated ? Math.round((used / rated) * 100) : null,
          linesRated: rated,
          savedDeals,
          closeRatePct: decided ? Math.round((closed / decided) * 100) : null,
          decidedCalls: decided,
          activeDays: Object.keys(byDay).length,
          last14,
        });
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
    if (err) {
      // SPA fallback: a route with no file extension → serve the app shell so client routing works
      if (!path.extname(file)) {
        return fs.readFile(path.join(__dirname, 'public', 'index.html'), (e2, html) => {
          if (e2) { res.writeHead(404); return res.end('not found'); }
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(html);
        });
      }
      res.writeHead(404); return res.end('not found');
    }
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
    // note when the closer is speaking (interim OR final) so the coach can hold cards until they pause
    if (ch === 'me') s.meLastAt = Date.now();
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
