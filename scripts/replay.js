#!/usr/bin/env node
/*
 * Replay harness — run real call transcripts back through the live coaching engine, offline.
 *
 * Why this exists: every change to playbook.md or the prompt silently changes what the coach
 * says on real calls, and until now there was no way to see the effect except by making a live
 * call and hoping. This replays stored conversations turn-by-turn and prints the card the coach
 * WOULD fire at each prospect turn, so prompt changes can be judged against real dialogue
 * before they ship.
 *
 * It imports server.js directly (which no longer auto-listens), so it exercises the exact
 * shipped prompt, parser and fact-guard — not a copy.
 *
 * Usage:
 *   node scripts/replay.js --list                 # show available stored calls
 *   node scripts/replay.js --call <id>            # replay one call
 *   node scripts/replay.js --all                  # replay every call with a real transcript
 *   node scripts/replay.js --all --json out.json  # save results for diffing between runs
 *   node scripts/replay.js --all --goal close     # force a meeting goal
 */

const fs = require('fs');
const path = require('path');
const {
  buildSystemPrompt, parseCoach, validateLine, detectTrigger, GOALS, LIVE_MODEL, OPENAI_KEY,
} = require('../server.js');

const SUPA_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPA_KEY = process.env.SUPABASE_KEY || '';

const argv = process.argv.slice(2);
const flag = (name, def) => { const i = argv.indexOf('--' + name); return i === -1 ? def : (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true); };
const has = (name) => argv.includes('--' + name);

const C = { dim: '\x1b[2m', b: '\x1b[1m', cyan: '\x1b[36m', yellow: '\x1b[33m', green: '\x1b[32m', red: '\x1b[31m', mag: '\x1b[35m', r: '\x1b[0m' };

async function signIn() {
  const email = process.env.REPLAY_EMAIL, pass = process.env.REPLAY_PASSWORD;
  if (!email || !pass) throw new Error('set REPLAY_EMAIL and REPLAY_PASSWORD to a user whose calls you want to replay');
  const r = await fetch(SUPA_URL + '/auth/v1/token?grant_type=password', {
    method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pass }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('auth failed: ' + (j.error_description || j.msg || JSON.stringify(j)));
  return j.access_token;
}

const sb = (q, jwt) => fetch(SUPA_URL + '/rest/v1/' + q, {
  headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + jwt },
}).then(r => r.json());

// One coach turn against the exact shipped prompt + guard.
async function coachOnce({ turns, productContent, closerProfile, memory, goal }) {
  const s = {
    callGoal: goal && GOALS[goal] ? goal : '',
    closerProfile: closerProfile || null,
    productContent: productContent || '',
    memory: memory || '', priorMemoryMd: memory || '',
    kbDocs: [], turns,
  };
  const systemPrompt = buildSystemPrompt(s);
  const recent = turns.slice(-24).map(t => (t.ch === 'me' ? 'ME' : 'PROSPECT') + ': ' + t.text).join('\n');
  const t0 = Date.now();
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + OPENAI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: LIVE_MODEL, temperature: 0.4, max_tokens: 200,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: 'LIVE TRANSCRIPT (most recent last):\n' + recent + '\n\nDecide now.' }],
    }),
  });
  const j = await r.json();
  const ms = Date.now() - t0;
  if (j.error) return { error: j.error.message, ms };
  const p = parseCoach(j.choices[0].message.content || '');
  const out = { decision: p.decision, tone: p.tone, line: p.line, tech: p.tech, why: p.why, conf: p.conf, ms, trigger: detectTrigger(turns), tokens: j.usage ? j.usage.total_tokens : null };
  if (p.decision === 'FIRE' && p.line) {
    const sources = (productContent || '') + '\n' + (memory || '') + '\n' + recent;
    const neverSay = (closerProfile && closerProfile.never_say) || '';
    const v = validateLine(p.line, sources, neverSay);
    out.guard = v.ok ? 'pass' : 'BLOCKED: ' + v.issue;
  }
  return out;
}

(async () => {
  if (!OPENAI_KEY) throw new Error('OPENAI_API_KEY missing');
  const jwt = await signIn();

  const calls = await sb('calls?select=id,created_at,summary,product_name,transcript,cards,outcome,deals(name)&order=created_at.desc', jwt);
  const real = calls.filter(c => Array.isArray(c.transcript) && c.transcript.length > 6);

  if (has('list') || (!has('all') && !flag('call', null))) {
    console.log(`\n${C.b}Stored calls${C.r}  (${real.length} with a usable transcript, of ${calls.length} total)\n`);
    for (const c of calls) {
      const n = Array.isArray(c.transcript) ? c.transcript.length : 0;
      const usable = n > 6;
      console.log(`${usable ? C.green + '  usable' : C.dim + '  thin  '}${C.r}  ${c.id.slice(0, 8)}  ${String(c.created_at).slice(0, 10)}  ${String(n).padStart(3)} turns  ${String((c.cards || []).length).padStart(2)} cards  ${C.dim}${(c.deals && c.deals.name) || '—'}${C.r}`);
    }
    console.log(`\nreplay one:  node scripts/replay.js --call <id>\nreplay all:  node scripts/replay.js --all\n`);
    return;
  }

  const targets = has('all') ? real : real.filter(c => c.id.startsWith(String(flag('call', ''))));
  if (!targets.length) { console.log('no matching call with a usable transcript'); return; }

  const goal = flag('goal', '') || '';
  const products = await sb('products?select=name,content', jwt);
  const productContent = (products[0] && products[0].content) || '';
  const profile = (await sb('profiles?select=tone,framework,signature_phrases,never_say', jwt))[0] || null;

  const results = [];
  for (const call of targets) {
    console.log(`\n${C.b}━━ call ${call.id.slice(0, 8)} · ${String(call.created_at).slice(0, 10)} · ${(call.deals && call.deals.name) || '—'}${C.r}`);
    console.log(`${C.dim}${call.transcript.length} turns · ${(call.cards || []).length} cards fired originally · outcome: ${call.outcome || '—'}${C.r}\n`);

    const turns = [];
    let fired = 0, held = 0, blocked = 0;
    const lat = [];
    for (const turn of call.transcript) {
      turns.push({ ch: turn.ch, text: turn.text });
      const who = turn.ch === 'me' ? `${C.cyan}ME       ${C.r}` : `${C.yellow}PROSPECT ${C.r}`;
      console.log(`${who}${turn.text}`);
      if (turn.ch !== 'prospect') continue;      // coach only fires after the prospect speaks

      const out = await coachOnce({ turns: [...turns], productContent, closerProfile: profile, memory: '', goal });
      if (out.error) { console.log(`  ${C.red}error: ${out.error}${C.r}`); continue; }
      lat.push(out.ms);
      if (out.decision === 'FIRE' && out.line) {
        fired++;
        const bad = out.guard && out.guard !== 'pass';
        if (bad) blocked++;
        console.log(`  ${C.mag}▸ ${out.tone || '—'}${C.r}`);
        console.log(`  ${C.b}${out.line}${C.r}`);
        console.log(`  ${C.dim}${out.tech || '—'} · ${out.ms}ms · ${out.trigger}${bad ? ` · ${C.red}${out.guard}` : ''}${C.r}`);
      } else {
        held++;
        console.log(`  ${C.dim}▸ HOLD (no card)${C.r}`);
      }
      console.log('');
    }
    const p50 = lat.length ? lat.slice().sort((a, b) => a - b)[Math.floor(lat.length / 2)] : null;
    const worst = lat.length ? Math.max(...lat) : null;
    console.log(`${C.b}summary${C.r} fired ${fired} · held ${held} · guard-blocked ${blocked} · model p50 ${p50}ms · slowest ${worst}ms`);
    results.push({ id: call.id, created_at: call.created_at, fired, held, blocked, p50, worst, turns: call.transcript.length });
  }

  const jsonOut = flag('json', null);
  if (jsonOut && typeof jsonOut === 'string') {
    fs.writeFileSync(path.resolve(jsonOut), JSON.stringify({ at: new Date().toISOString(), model: LIVE_MODEL, goal, results }, null, 2));
    console.log(`\n${C.green}wrote ${jsonOut}${C.r}  — re-run after a prompt change and diff to see the effect`);
  }

  const all = results.reduce((a, r) => ({ fired: a.fired + r.fired, held: a.held + r.held, blocked: a.blocked + r.blocked }), { fired: 0, held: 0, blocked: 0 });
  console.log(`\n${C.b}ALL CALLS${C.r}  fired ${all.fired} · held ${all.held} · guard-blocked ${all.blocked}\n`);
})().catch(e => { console.error('\n' + C.red + e.message + C.r + '\n'); process.exit(1); });
