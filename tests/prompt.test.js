// What actually reaches the model, and what it costs.
//
// Two separate concerns that both live in buildSystemPrompt:
//   1. isolation — one user's product knowledge must never appear in another's call
//   2. ORDER — the cache keys on a byte-identical prefix, so anything that varies has to sit at
//      the tail. Putting the meeting goal first dropped the cache hit rate from 98% to 0% on
//      every goal change, which is real money for no benefit: the model reads the whole prompt
//      regardless of where a block sits.
const fs = require('fs');
const path = require('path');
const { suite } = require('./lib/t');
const { buildSystemPrompt, costUsd, GOALS, PLAYBOOK, FORMAT_RULES, DISCOVERY_PILLARS } = require('../server.js');

const t = suite('prompt');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const HVAC = read('products/vextria-hvac.md');
const SEO = read('products/templates/local-seo.md');
const sess = (over = {}) => ({
  callGoal: '', closerProfile: null, productContent: '', productMetrics: null,
  memory: '', priorMemoryMd: '', figuresMd: '', kbDocs: [],
  turns: [{ ch: 'prospect', text: 'How much does this cost?' }], cards: [], ...over,
});

t.group('one playbook per call — never a mix');
{
  const a = buildSystemPrompt(sess({ productContent: HVAC }));
  const b = buildSystemPrompt(sess({ productContent: SEO }));
  t.match('the HVAC call carries HVAC', a, /AI Quoting Agent/);
  t.notMatch('and no Local SEO at all', a, /Google Business Profile|map pack/i);
  t.match('the Local SEO call carries Local SEO', b, /Local SEO/);
  t.notMatch('and no HVAC pricing', b, /AI Quoting Agent/);
  t.match('the shared coaching layer is in both — deliberate, and carries no customer data', a, /THE OBJECTION ENGINE/);
  t.match('same', b, /THE OBJECTION ENGINE/);
}

t.group('prompt ordering keeps the cache alive');
{
  const withGoal = (g) => buildSystemPrompt(sess({ productContent: HVAC, callGoal: g }));
  const a = withGoal('one_call'), b = withGoal('discovery');
  // the shared prefix is what OpenAI can serve from cache; longer is cheaper
  let i = 0; while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const share = i / Math.max(a.length, b.length);
  t.ok(`two goals still share ${(share * 100).toFixed(0)}% of the prompt as an identical prefix`, share > 0.6);
  t.ok('the playbook sits inside that shared prefix', a.indexOf(PLAYBOOK.slice(0, 60)) < i);
  t.ok('so do the format rules', a.indexOf(FORMAT_RULES.slice(0, 60)) < i);
  t.ok('the product knowledge does too', a.indexOf('AI Quoting Agent') < i);
  // divergence happens at or after the goal block starts — everything expensive is behind it.
  // In practice it lands slightly INSIDE the block, because both goals share the identical
  // "=== MEETING GOAL — HIGHEST PRIORITY ===" header and only the guidance differs.
  t.ok('nothing before the goal block is what diverges', i >= a.indexOf('=== MEETING GOAL'));
  t.ok('the goal block comes after the product knowledge', a.indexOf('=== MEETING GOAL') > a.indexOf('AI Quoting Agent'));
}
t.group('the goal is still stated as authoritative');
{
  const a = buildSystemPrompt(sess({ productContent: HVAC, callGoal: 'discovery' }));
  t.match('marked highest priority', a, /=== MEETING GOAL — HIGHEST PRIORITY ===/);
  t.match('and explicitly overrides the playbook', a, /OVERRIDES the playbook/);
  t.match('discovery guidance actually present', a, /do NOT answer with numbers|deflect/i);
}

t.group('per-turn content stays at the tail');
{
  const base = buildSystemPrompt(sess({ productContent: HVAC, callGoal: 'one_call' }));
  const withFigs = buildSystemPrompt(sess({ productContent: HVAC, callGoal: 'one_call', figuresMd: '\n\nTHEIR NUMBERS: 45/wk' }));
  let i = 0; while (i < base.length && i < withFigs.length && base[i] === withFigs[i]) i++;
  t.ok('adding live figures only invalidates the very end', i / base.length > 0.9);
}

// A warm call that dies at "let me think about it" is usually Habit and Anxiety winning, never
// surfaced because discovery only ever measured Push. Measured before/after on six live scenarios:
// the old layer asked for a "rough average" (a guess, always rounded down), helped a prospect ghost
// by asking what to put in the info pack, and ARGUED against a stated fear instead of reducing it.
t.group('discovery surfaces the anti-forces, not just pain');
{
  const p = buildSystemPrompt(sess({ productContent: HVAC, callGoal: 'discovery' }));
  t.match('the four forces are named in the shared layer', p, /PUSH \+ PULL beats HABIT \+ ANXIETY/);
  t.match('and it says to surface them during discovery, not at the close', p, /Surface both anti-forces DURING discovery/);
  t.match('a fear is reduced, never argued', p, /fear argued with grows|Never argue it/);
  t.match('asks for the last real instance, not the typical one', p, /ASK FOR THE LAST ONE, NOT THE TYPICAL ONE/);
  t.match('praise is explicitly not treated as progress', p, /praise is not progress/i);
  t.match('the discovery goal carries the resistance instruction too', p, /RESISTANCE on record/);
}

t.group('the live discovery checklist tracks resistance');
{
  const keys = DISCOVERY_PILLARS.map(x => x.key);
  t.ok('a resistance pillar exists', keys.includes('resistance'));
  t.eq('keys are unique — a duplicate would silently corrupt the tracker parse',
    keys.length, new Set(keys).size);
  t.ok('every pillar has a key, label and question', DISCOVERY_PILLARS.every(x => x.key && x.label && x.q));
  t.ok('it stays scannable during a live call', DISCOVERY_PILLARS.length <= 8);
  const r = DISCOVERY_PILLARS.find(x => x.key === 'resistance');
  t.match('and it covers BOTH anti-forces, since they arrive together', r.q, /fear|afraid/i);
  t.match('habit as well as anxiety', r.q, /current way/i);
}

t.group('every goal is usable');
for (const g of Object.keys(GOALS)) {
  t.ok(`${g} has a label and guidance`, !!(GOALS[g].label && GOALS[g].guidance && GOALS[g].guidance.length > 80));
}

t.group('cached tokens are priced at the lower rate');
{
  const full = costUsd('gpt-4.1-mini', 7000, 70, 0);
  const cached = costUsd('gpt-4.1-mini', 7000, 70, 6860);
  t.ok('a mostly-cached call costs less than an uncached one', cached < full);
  t.ok('and materially so — >60% cheaper', 1 - cached / full > 0.6);
  t.ok('cachedTokens cannot exceed the prompt and skew it negative', costUsd('gpt-4.1-mini', 100, 10, 99999) > 0);
  t.eq('an unknown model returns null rather than guessing a price', costUsd('some-future-model', 100, 10, 0), null);
}

t.group('the merged admin + meetings modules load and expose what server.js wires');
{
  const admin = require('../admin.js');
  const meetings = require('../meetings.js');
  t.ok('admin exports a factory', typeof admin === 'function');
  t.ok('admin exposes the shared pricing table', typeof admin.costOf === 'function');
  t.ok('meetings exports a factory', typeof meetings === 'function');
  const m = meetings({ sbRest: async () => [], chatOnce: async () => '', sendJson: () => {}, readBody: async () => ({}), logActivity: () => {} });
  t.ok('meetings gives server.js a handle()', typeof m.handle === 'function');
  t.ok('and a botMode()', typeof m.botMode === 'function');
  t.eq('with no provider configured it is manual — nothing can join a call', m.botMode(), 'manual');
  // The Meetings page treats anything that is not 'self' or 'recall' as manual, so that a failed
  // or half-loaded response can never flash the bot controls. That inversion is only safe while
  // those remain the only two "a provider IS configured" values.
  t.ok('botMode only ever returns one of three known values',
    ['self', 'recall', 'manual'].includes(m.botMode()));
}

t.group('the client can rely on that contract');
{
  const manualFrom = (botMode) => botMode !== 'self' && botMode !== 'recall';
  t.ok('manual', manualFrom('manual'));
  t.no('self is a real provider', manualFrom('self'));
  t.no('recall is a real provider', manualFrom('recall'));
  t.ok('a missing field reads as manual, not as a configured bot', manualFrom(undefined));
  t.ok('an error response reads as manual', manualFrom(null));
  t.ok('an unknown future value reads as manual', manualFrom('something-new'));
}

module.exports = t.report();
