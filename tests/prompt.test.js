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
const { buildSystemPrompt, costUsd, praiseStallBlock, classifyMoment, GOALS, PLAYBOOK, FORMAT_RULES, DISCOVERY_PILLARS } = require('../server.js');

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

// The playbook already cited Belfort, but only for TONALITY — none of his certainty model. Measured
// before/after on four live scenarios: asked "how long have you been around?" the old layer led with
// "we're new" and pivoted to features; asked "have you ever run a shop?" it changed the subject to the
// product, which reads as dodging and hardens the doubt. Both are the same missing idea — certainty is
// three separate numbers (product / you / company) and only the LOW one tells you which move to make.
t.group('certainty is diagnosed as three numbers, not one');
{
  const p = buildSystemPrompt(sess({ productContent: HVAC, callGoal: 'one_call' }));
  t.match('all three elements are named', p, /THE THREE TENS/);
  t.match('the company is one of them', p, /THE COMPANY.*trust the outfit behind it/s);
  t.match('doubt in YOU is not answered with the product', p, /do NOT answer with the product/);
  t.match('doubt in the company is answered with risk reversal', p, /Risk reversal IS the answer/);
  t.match('one low element cannot be offset by the other two', p, /other two cannot make up for it/);
  t.match('the temp-check now resolves WHICH element is low', p, /That one number hides three/);
}

// Praise and a stall in one breath ("product looks good, I'll shop around") is the warm moment a deal
// dies in: the praise says element 1 is a TEN, so the block is YOU or the company — and the losing reply
// is "what did you want to compare?", which sends them shopping on the one axis already won. The playbook
// says this twice and measurably would not follow it: three runs, three identical "what do you want to
// compare" lines, one of them against an explicit instruction NOT to say it. Detected in code instead,
// and injected at the tail next to the transcript, it changed on the first run.
t.group('praise + stall is caught in code, not left to the prompt');
{
  const p = (text) => [{ ch: 'prospect', text }];
  const fires = (turns) => praiseStallBlock(turns) !== '';
  t.ok('the line that beat the prompt three times', fires(p('Honestly the product itself looks good. I just want to shop around a bit before I commit.')));
  t.ok('praise + think about it', fires(p('Sounds great honestly, let me think about it.')));
  t.ok('praise + send me info', fires(p('Looks really solid. Send me some info and I will take a look.')));
  t.ok('"I like it" counts as praise', fires(p('I like it. I just need to run it by my brother first.')));

  // False positives cost more than misses here: this injects a forceful instruction, so a stall that is
  // just a stall must stay with the playbook's ordinary objection handling.
  t.no('a stall with no praise is an ordinary objection', fires(p('I need to think about it.')));
  t.no('praise with no stall is a buying signal, not this', fires(p('That sounds great, how do we get started?')));
  t.no('"something like this" is not praise', fires(p('Is there something like this that is cheaper? Let me think about it.')));
  t.no('"I\'d like it cheaper" is a request, not praise', fires(p("I'd like it cheaper. Let me think about it.")));
  t.no('a plain price objection is untouched', fires(p('That is way too expensive for me.')));
  t.no('only the LATEST prospect turn counts', fires([
    { ch: 'prospect', text: 'Looks good, let me shop around' },
    { ch: 'me', text: 'sure' },
    { ch: 'prospect', text: 'Okay what does it cost?' },
  ]));
  t.safe('never throws on empty or malformed turns', () => {
    praiseStallBlock([]); praiseStallBlock(null); praiseStallBlock([{ ch: 'prospect' }]);
  });

  t.match('the block tells it NOT to ask what they want to compare',
    praiseStallBlock(p('Looks good, I want to shop around.')), /Do NOT ask what they want to compare/);
  t.ok('and it rides at the tail, next to the transcript, where figuresMd works',
    buildSystemPrompt(sess({ productContent: HVAC, turns: p('Looks good, I want to shop around.') }))
      .indexOf('THEY PRAISED THE OFFER AND STALLED') > 0.8 *
    buildSystemPrompt(sess({ productContent: HVAC, turns: p('Looks good, I want to shop around.') })).length);
}

// The instant lane the closer reads while the prospect is still talking. Deterministic and
// first-match-wins, so ORDER is the whole contract: a new pattern in the wrong place silently steals
// a tag the closer already relies on, and nothing would fail loudly. Every existing tag therefore
// gets a regression case pinned to its own canonical phrase.
t.group('signal classifier — existing tags keep their claim');
{
  const tag = (text) => { const m = classifyMoment(text); return m ? m.tag : null; };
  t.eq('DIY', tag('I could just hire someone in-house for that'), 'DIY');
  t.eq('CONTRACT', tag('Am I locked into a long term contract?'), 'CONTRACT');
  t.eq('COMPETITOR', tag('We already use another company for this'), 'COMPETITOR');
  t.eq('PRICE', tag('How much does it cost?'), 'PRICE');
  t.eq('TRUST', tag('What if it screws up and my name is on it'), 'TRUST');
  t.eq('BUYING', tag('How soon can we get started?'), 'BUYING');
  t.eq('STALL', tag('Let me think about it and get back to you'), 'STALL');
  t.eq('OBJECTION', tag('I am worried this is not a fit for us'), 'OBJECTION');
}

t.group('signal classifier — the quieter buying signals');
{
  const tag = (text) => { const m = classifyMoment(text); return m ? m.tag : null; };
  // Research ranks these among the strongest verbal signals, and all of them used to read as
  // "neutral moment" — the closer got no badge at exactly the moments worth pouncing on.
  // Phrased to avoid "how do/does/would", which the ORIGINAL pattern already caught — otherwise
  // this passes without ever exercising the assumptive rule it claims to cover.
  t.eq('assumptive language — they are imagining owning it', tag('Once we started, who would be our main contact?'), 'BUYING');
  t.eq('integration question', tag('Does it work with our CRM?'), 'BUYING');
  t.eq('reference request', tag('Do you have any references I could call?'), 'BUYING');
  t.eq('who else uses it', tag('Who else uses this in my area?'), 'BUYING');
  t.eq('onboarding question', tag('What does onboarding look like?'), 'BUYING');
  // "we'd" alone must NOT be a buying signal — STALL is matched after BUYING, so a bare pronoun
  // here would swallow the most common stall in the product.
  t.eq('"we would have to think about it" is still a STALL', tag('We would have to think about it'), 'STALL');
}

t.group('signal classifier — red flags, and what they must not steal');
{
  const tag = (text) => { const m = classifyMoment(text); return m ? m.tag : null; };
  t.eq('VAGUE', tag('Ah it varies a lot, hard to say really'), 'VAGUE');
  t.eq('NO_AUTHORITY', tag('Honestly that is not my call'), 'NO_AUTHORITY');
  // Red flags are last on purpose: they are the weakest reads in the list, and a real objection or
  // stall is always the more useful thing to put in front of a closer.
  t.eq('"not sure" stays STALL', tag('I am not sure, let me think about it'), 'STALL');
  t.eq('"run it by" stays STALL', tag('I need to run it by my brother'), 'STALL');
  t.eq('a live price question still beats a vague hedge', tag('It depends, how much is it?'), 'PRICE');
  t.eq('ordinary small talk stays untagged', tag('Yeah the weather has been rough this week'), null);
  t.safe('degenerate input never throws', () => { classifyMoment(''); classifyMoment(null); });
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
