#!/usr/bin/env node
/*
 * Card smoke test — does a prospect turn actually put a card on screen, right now?
 *
 * This drives the SHIPPED coach() from server.js, not a copy of it, and captures what the
 * browser would receive by standing a fake socket in s.events. So it exercises the real
 * prompt, the real model call, the real fact-guard, the real card-stacking hold and the
 * real broadcast. Everything in the live path except Deepgram and the browser itself.
 *
 * It costs a few cents of OpenAI per run, which is why it is not in `npm test` (that suite
 * is offline and free on purpose). Run it before a deploy you care about:
 *
 *   node scripts/card-smoke.js
 *
 * Exit code is 0 only if every scenario that should fire, fired.
 */
const path = require('path');
const fs = require('fs');

for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const srv = require('../server.js');
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', y: '\x1b[33m', x: '\x1b[0m' };

// A product the guard will accept numbers from. Without this every priced line is
// correctly rejected as unsourced, and the run would look broken when it is working.
const PRODUCT = `# Vextria AI Quoting Agent
It answers the phone, gives the caller a real price on that call, and books the estimate.
Pricing: $4,000 setup, $797/month. Handles 20 simultaneous calls.
Starts on overflow only: no-answer and after-hours forwarding, never the main line.`;

function session(turns) {
  const sent = [];
  return {
    s: {
      userId: 'smoke-test-0000-0000-0000-000000000000', jwt: null,
      turns: turns.slice(), cards: [], events: new Set([{ readyState: 1, send: (str) => sent.push(JSON.parse(str)) }]),
      callLog: null, callStartAt: Date.now() - 120000,
      activeDealId: null, activeProductId: null, activeProductName: 'AI Quoting Agent',
      productContent: PRODUCT, productMetrics: null, memory: '', dealState: null,
      dealName: 'Brightline Restoration', dealCompany: 'Brightline',
      closerProfile: null, callGoal: '', kbDocs: [],
      lastCardAt: 0, coachGen: 0, coachAbort: null, coachTimer: null, figuresMd: '',
      // 0 means "the closer is not mid-sentence", so a finished card shows immediately
      // instead of being held by the anti-stacking timer.
      meLastAt: 0,
      pendingCard: null, cardFlushTimer: null,
      pendingProspectTurn: false, confSamples: null, warnedAudio: false,
      lastSignalTag: null, lastProspectFinalAt: Date.now(),
      discovery: null, lastDiscoveryAt: 0, discoveryBusy: false,
      sprint: null, productLiveModel: '', simIdx: 0,
    },
    sent,
  };
}

// Real moments off real calls in this repo, each one a thing a closer needs a line for.
const SCENARIOS = [
  { name: 'the price objection',
    turns: [
      { ch: 'me', text: 'So the system answers every call and gives them a price on the spot.' },
      { ch: 'them', text: 'Right. Honestly that sounds expensive for what it is. We are a small shop.' },
    ] },
  { name: 'the brush-off',
    turns: [
      { ch: 'me', text: 'Does that line up with how you handle after-hours calls today?' },
      { ch: 'them', text: 'Look, can you just send me some information and I will take a look when I get a chance.' },
    ] },
  { name: 'a real pain surfaces',
    turns: [
      { ch: 'me', text: 'What happens to a call that comes in at two in the morning?' },
      { ch: 'them', text: 'It rings out. We probably lose ten or twelve a month that way. Whoever answers first gets the job.' },
    ] },
  { name: 'the stall',
    turns: [
      { ch: 'me', text: 'What would stop you starting in the next couple of weeks?' },
      { ch: 'them', text: 'I would need to think about it and talk to my business partner before I commit to anything.' },
    ] },
  // A control. Pure small talk is the ONE case the playbook says to stay quiet for, so a
  // card here means the coach fires on everything - which on a live call is noise the
  // closer learns to ignore, and that is its own failure.
  { name: 'pure small talk (should HOLD)', expectHold: true,
    turns: [
      { ch: 'me', text: 'Morning, thanks for making the time.' },
      { ch: 'them', text: 'No problem at all, good to meet you. Bit of rain here today.' },
    ] },
];

(async () => {
  console.log(`\n${C.b}card smoke test${C.x}  model=${srv.LIVE_MODEL}  key=${srv.OPENAI_KEY ? 'set' : C.r + 'MISSING' + C.x}\n`);
  if (!srv.OPENAI_KEY) { console.log(`${C.r}no OPENAI_API_KEY — cannot test the coach at all${C.x}`); process.exit(1); }

  // The same preflight /api/call/start now runs. If this says no, a real call would be
  // refused up front rather than starting healthy and firing nothing.
  const reach = await srv.modelReachable();
  if (!reach.ok) {
    console.log(`  ${C.r}PREFLIGHT FAILED${C.x}  ${reach.reason}`);
    console.log(`  ${C.d}A call started now would be refused at /api/call/start with this message,`);
    console.log(`  rather than running with a dead coach.${C.x}
`);
    process.exit(1);
  }
  console.log(`  ${C.g}preflight ok${C.x} ${C.d}— the model is reachable${C.x}
`);

  let bad = 0;
  for (const sc of SCENARIOS) {
    const { s, sent } = session(sc.turns);
    const t0 = Date.now();
    try {
      await srv.coach(s);
    } catch (e) {
      console.log(`  ${C.r}ERROR${C.x}  ${sc.name}\n         ${e.message}`);
      bad++; continue;
    }
    // Let the anti-stacking flush timer run; a card can be held up to 150ms at a time.
    await new Promise(r => setTimeout(r, 400));
    const ms = Date.now() - t0;

    const fired = s.cards.length > 0;
    const card = s.cards[0];
    const streamed = sent.filter(m => m.type === 'card-stream');
    const status = sent.filter(m => m.type === 'status').map(m => m.msg);

    if (sc.expectHold) {
      // A deliberate HOLD and a dead API both produce "no card". Without this check the
      // control scenario reports PASS while the coach is completely unreachable - which is
      // exactly what it did on the first run of this script.
      if (status.some(m => /coach error|429|quota|credit/i.test(m))) {
        console.log(`  ${C.r}FAIL${C.x}  ${sc.name} — silent because the coach ERRORED, not because it chose to hold`);
        console.log(`         ${C.d}${status.join(' | ').slice(0, 200)}${C.x}`);
        bad++; continue;
      }
      if (!fired) console.log(`  ${C.g}PASS${C.x}  ${sc.name} ${C.d}(stayed quiet, ${ms}ms)${C.x}`);
      else { console.log(`  ${C.y}SOFT${C.x}  ${sc.name} ${C.d}— fired anyway: "${card.line}"${C.x}`); }
      continue;   // a model judgement call, not a pass/fail of the machinery
    }

    if (!fired) {
      console.log(`  ${C.r}FAIL${C.x}  ${sc.name} — NO CARD after ${ms}ms`);
      if (status.length) console.log(`         ${C.d}status: ${status.join(' | ')}${C.x}`);
      bad++; continue;
    }

    // A card that reaches s.cards but never reaches the socket is a card the closer
    // never sees - exactly the complaint this script exists to rule out.
    const reachedClient = streamed.some(m => m.done && m.line === card.line);
    const hasId = streamed.some(m => typeof m.id === 'number');
    if (!reachedClient) { console.log(`  ${C.r}FAIL${C.x}  ${sc.name} — card made but never broadcast to the client`); bad++; continue; }
    if (!card.line || !card.line.trim()) { console.log(`  ${C.r}FAIL${C.x}  ${sc.name} — empty line`); bad++; continue; }
    if (!hasId) { console.log(`  ${C.r}FAIL${C.x}  ${sc.name} — no card id sent, so the closer cannot rate it`); bad++; continue; }

    console.log(`  ${C.g}PASS${C.x}  ${sc.name} ${C.d}(${ms}ms, ${card.tone || 'no tone'})${C.x}`);
    console.log(`         ${C.b}${card.line}${C.x}`);
    if (card.why) console.log(`         ${C.d}why: ${card.why}${C.x}`);
    if (status.length) console.log(`         ${C.d}status: ${status.join(' | ')}${C.x}`);
  }

  console.log('\n' + '─'.repeat(58));
  console.log(bad === 0
    ? `  ${C.g}cards are firing${C.x} — prompt, model, fact-guard and broadcast all live\n`
    : `  ${C.r}${bad} scenario(s) produced no usable card${C.x}\n`);
  process.exit(bad === 0 ? 0 : 1);
})();
