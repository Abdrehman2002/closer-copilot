// How the coach behaves during a live call, with the model stubbed so this stays offline and
// deterministic. Covers the two bugs that made it feel broken on real calls:
//   - answering the PREVIOUS thing the prospect said, because queued runs replayed stale turns
//   - making the closer wait on WHY/TECH/CONF, which are footnotes they never say out loud
const { suite } = require('./lib/t');
const { coach } = require('../server.js');

const t = suite('coach');
const chunk = (text) => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n';

// a session with no Supabase, no real sockets — just a collector for what reaches the screen
function session(onCard, turns = []) {
  const cards = [];
  const ws = { readyState: 1, send: (str) => {
    const m = JSON.parse(str);
    if (m.type === 'card-stream' && m.done && m.line) { cards.push(m); onCard && onCard(m); }
    if (m.type === 'card-meta') { cards.meta = m; }
  } };
  return {
    s: {
      userId: 'testuser0000', jwt: null, activeDealId: null, callLog: null,
      events: new Set([ws]), cards: [], turns,
      productContent: '', productMetrics: null, memory: '', priorMemoryMd: '', figuresMd: '',
      kbDocs: [], closerProfile: null, callGoal: '', dealState: null,
      coachGen: 0, coachAbort: null, coachTimer: null, lastCardAt: 0, meLastAt: 0,
      pendingCard: null, cardFlushTimer: null, lastProspectFinalAt: Date.now(), callStartAt: Date.now(),
    },
    cards,
  };
}
const wait = (ms) => new Promise(r => setTimeout(r, ms));

module.exports = (async () => {
  // ── one card per thing said, always the LATEST thing ──────────────────────────────────────
  // Deepgram emits several is_final segments inside one spoken run, so coach() is re-entered
  // while a request is still in flight. Queued replays used to answer a transcript that had
  // barely moved: 19 cards across 5 turns on one real call, 13 of them re-answering the same
  // objection, and by the time the prospect moved on the closer was still being fed the last one.
  const MODEL_MS = 600;
  global.fetch = (url, opts) => {
    const convo = JSON.parse(opts.body).messages[1].content;
    const said = (convo.match(/PROSPECT: (.*)/g) || []).pop() || 'PROSPECT: ?';
    const body = 'DECISION: FIRE\nTONE: CALM\nLINE: Tell me more about "' +
      said.replace('PROSPECT: ', '') + '"\nWHY: w\nTECH: t\nCONF: high';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve({
        ok: true,
        body: { getReader: () => { let sent = false;
          return { read: async () => sent ? { done: true } : (sent = true, { done: false, value: Buffer.from(chunk(body)) }) }; } },
      }), MODEL_MS);
      opts.signal && opts.signal.addEventListener('abort', () => {
        clearTimeout(timer); const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
      });
    });
  };

  const OBJECTIONS = [
    'I can just hire somebody in house',
    'I do not want to be locked into a contract',
    'Can you just send me a packet and I will get back to you',
  ];
  const a = session();
  for (const text of OBJECTIONS) {
    a.s.turns.push({ ch: 'prospect', text });
    coach(a.s);
    await wait(150);                       // each new turn lands while the last is still in flight
  }
  await wait(MODEL_MS + 500);

  t.group('one card per thing said');
  t.eq('exactly one card survives three overlapping turns', a.cards.length, 1);
  t.match('and it answers the LATEST one', a.cards[0] && a.cards[0].line, /packet/);
  t.notMatch('not the first, already superseded', a.cards[0] && a.cards[0].line, /hire somebody/);

  // ── ship the line, not the footnotes ──────────────────────────────────────────────────────
  // The model writes DECISION, TONE, LINE, WHY, TECH, CONF in order. Waiting for the whole
  // stream cost a measured ~230ms on every card, spent generating small print the closer never
  // says. The card now ships when LINE is done; the footnotes are patched in behind it.
  const TAIL_MS = 400;
  global.fetch = async () => {
    const parts = [
      chunk('DECISION: FIRE\nTONE: CALM\nLINE: What happens to the calls that come in at seven at night?\n'),
      chunk('WHY:'),                       // the header arrives a token after the line
      'STALL',
      chunk(' surfaces the gap\nTECH: problem-question\nCONF: high\n'),
    ];
    let i = 0;
    return { ok: true, body: { getReader: () => ({ read: async () => {
      if (i >= parts.length) return { done: true };
      const p = parts[i++];
      if (p === 'STALL') { await wait(TAIL_MS); return { done: false, value: Buffer.from(parts[i++] || '') }; }
      return { done: false, value: Buffer.from(p) };
    } }) } };
  };

  const t0 = Date.now();
  let cardAt = null, whyAtShow = null;
  const b = session((m) => { if (cardAt === null) { cardAt = Date.now() - t0; whyAtShow = m.why; } },
    [{ ch: 'prospect', text: 'We already have an answering service.' }]);
  coach(b.s);
  await wait(TAIL_MS + 600);

  t.group('ship the line, not the footnotes');
  t.ok(`card lands before the footnotes (${cardAt}ms, footnotes were ${TAIL_MS}ms away)`, cardAt !== null && cardAt < TAIL_MS);
  t.eq('no why at the moment it ships', whyAtShow, '');
  t.eq('footnotes still arrive, patched in after', b.cards.meta && b.cards.meta.why, 'surfaces the gap');
  t.eq('and persist on the stored card for the DB', b.s.cards[0] && b.s.cards[0].why, 'surfaces the gap');
  t.ok('latency recorded for later analysis', typeof (b.s.cards[0] || {}).latencyMs === 'number');

  // ── the guard is actually honoured, not merely present ────────────────────────────────────
  // validateLine() is unit-tested elsewhere, but that proves nothing about whether coach()
  // respects the verdict. Disabling the rejection branch inside coach() left every other test
  // green, which means the single most safety-critical path in the product was untested: a
  // fabricated price reaching the closer's screen and being read aloud to a buyer.
  const unsourced = 'DECISION: FIRE\nTONE: CERTAIN\nLINE: Setup is nine thousand dollars.\nWHY: w\nTECH: t\nCONF: high';
  let modelCalls = 0;
  global.fetch = async (url, opts) => {
    modelCalls++;
    const streaming = JSON.parse(opts.body).stream;
    if (streaming) {
      let sent = false;
      return { ok: true, body: { getReader: () => ({ read: async () => sent ? { done: true } : (sent = true, { done: false, value: Buffer.from(chunk(unsourced)) }) }) } };
    }
    // the corrective retry — still refuses to source it
    return { ok: true, json: async () => ({ choices: [{ message: { content: unsourced } }] }) };
  };

  const statuses = [];
  const c = session(null, [{ ch: 'prospect', text: 'How much is it?' }]);
  c.s.productContent = 'Setup is $4,000 one-time. Retainer $799/mo.';   // nine thousand is NOT in here
  c.s.events = new Set([{ readyState: 1, send: (str) => {
    const m = JSON.parse(str);
    if (m.type === 'status') statuses.push(m.msg);
    if (m.type === 'card-stream' && m.done && m.line) c.cards.push(m);
  } }]);
  coach(c.s);
  await wait(900);

  t.group('the guard is honoured, not just present');
  t.eq('an unsourceable price never reaches the screen', c.cards.length, 0);
  t.eq('and is never stored on the call', c.s.cards.length, 0);
  t.ok('it retried once before giving up', modelCalls >= 2);
  t.ok('the closer is told, rather than left staring at nothing',
    statuses.some(s => /withheld|fact-check/i.test(s)));

  return t.report('coach');
})();
