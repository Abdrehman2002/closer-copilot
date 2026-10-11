// The call-start preflight: does it refuse a call when the coach is actually dead, and -
// just as important - does it stay out of the way when it is not?
//
// Background. /api/call/start already checked creditsExhausted(), but that reads our own
// per-user budget in Supabase and says nothing about the upstream account. Between
// 24 Sep and 11 Oct 2026 OpenAI had no credits: calls started looking perfectly healthy
// and every card died on a 429, with the only clue a status line mid-call. A closer on a
// live meeting does not read status lines.
//
// The risk in the fix is the opposite failure. A preflight that blocks on a transient
// blip would stop a real meeting over nothing, which is worse than the bug it replaces.
// Most of this suite is about NOT blocking.
const { suite } = require('./lib/t');
const srv = require('../server.js');

const t = suite('preflight');
const pending = [];

// Stand in for OpenAI. force=true bypasses the 60s cache so each case is independent.
async function probeWith(responder) {
  const real = globalThis.fetch;
  globalThis.fetch = responder;
  try { return await srv.modelReachable(true); }
  finally { globalThis.fetch = real; }
}
const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});
const err = (code, message) => reply(429, { error: { code, message } });

pending.push(async () => {
  t.group('refuses a call when the coach is genuinely dead');

  const dry = await probeWith(err('credit_balance_exhausted',
    'You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/.'));
  t.no('out of credits blocks', dry.ok);
  t.match('and says so in words a person can act on', dry.reason, /out of credits/i);
  t.match('naming where to fix it', dry.reason, /billing/i);

  const quota = await probeWith(err('insufficient_quota', 'You exceeded your current quota.'));
  t.no('insufficient_quota blocks', quota.ok);

  // Some accounts return the prose without the machine-readable code.
  const prose = await probeWith(reply(429, { error: { message: 'You have no credits remaining.' } }));
  t.no('the message alone is enough, no code needed', prose.ok);

  const badkey = await probeWith(reply(401, { error: { code: 'invalid_api_key', message: 'Incorrect API key provided' } }));
  t.no('an invalid key blocks', badkey.ok);
  t.match('and is not described as a billing problem', badkey.reason, /key/i);
  t.notMatch('specifically not as credits', badkey.reason, /credits/i);
});

pending.push(async () => {
  t.group('stays out of the way otherwise');
  // Every case here would be a meeting refused over nothing.
  const ok = await probeWith(reply(200, { choices: [{ message: { content: 'ok' } }] }));
  t.ok('a healthy account passes', ok.ok);
  t.eq('with no reason to show anybody', ok.reason, '');

  const busy = await probeWith(err('rate_limit_exceeded', 'Rate limit reached for gpt-4.1-mini'));
  t.ok('an ordinary rate limit does NOT block - it passes in a second', busy.ok);

  const down = await probeWith(reply(500, { error: { message: 'The server had an error' } }));
  t.ok('a provider 500 does not block', down.ok);

  const gateway = await probeWith(reply(503, 'upstream connect error'));
  t.ok('a 503 does not block', gateway.ok);

  const offline = await probeWith(async () => { throw new Error('fetch failed'); });
  t.ok('no network at all does not block', offline.ok);

  const slow = await probeWith(async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; });
  t.ok('a timeout does not block', slow.ok);

  const junk = await probeWith(reply(429, 'not json at all'));
  t.ok('an unparseable 429 does not block', junk.ok);
});

pending.push(async () => {
  t.group('the probe is cached, so it cannot become a tax on every call');
  let hits = 0;
  const counting = async () => { hits++; return (await reply(200, {})()); };
  const real = globalThis.fetch;
  globalThis.fetch = counting;
  try {
    await srv.modelReachable(true);    // one real probe
    const before = hits;
    await srv.modelReachable();        // these must all come from cache
    await srv.modelReachable();
    await srv.modelReachable();
    t.eq('three further starts cost nothing', hits, before);
  } finally { globalThis.fetch = real; }

  // The probe runs before every call, so it has to be negligible in both money and time.
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fn = src.slice(src.indexOf('async function modelReachable'), src.indexOf('const tokenCache'));
  t.match('it asks for a single token, so it is free in practice', fn, /max_tokens:\s*1\b/);
  // Without this, a hanging provider would hang the call-start request itself.
  t.match('and gives up quickly rather than stalling the call start', fn, /AbortSignal\.timeout\(\d+\)/);
});

pending.push(async () => {
  t.group('the gate is actually wired into call start');
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = src.indexOf("urlPath === '/api/call/start'");
  const gate = src.indexOf('await modelReachable()', start);
  t.ok('call start exists', start > -1);
  t.ok('and preflights before doing anything else', gate > start && gate - start < 1200);
  t.match('refusing with a message about cards, not a status code', src,
    /error: 'Cards will not fire: ' \+ reach\.reason/);
  // creditsExhausted is our own budget; it was never evidence about the upstream account.
  t.match('the internal budget check is still there too', src, /await creditsExhausted\(jwt\)/);
});

pending.push(async () => {
  t.group('a mid-call failure reads as English, not provider JSON');
  // These CALL the classifier rather than grepping server.js for a message string. The
  // grep version of this group passed while the invalid-key branch was dead, because its
  // regex had been written to disk with a backspace byte where a word boundary belonged.
  const ex = srv.explainCoachFailure;

  const dry = ex('OpenAI 429 {"error":{"message":"You have no credits remaining.","code":"credit_balance_exhausted"}}');
  t.ok('out of credits is fatal', dry.fatal === true);
  t.match('and spelled out', dry.human, /out of credits/i);
  t.match('saying plainly that cards stop', dry.human, /no cards will fire/i);
  t.notMatch('with no raw json left in it', dry.human, /[{}]/);

  const quota = ex('OpenAI 429 You exceeded your current quota.');
  t.ok('quota exhaustion is fatal too', quota.fatal === true);

  // The branch that was broken on disk.
  const key401 = ex('OpenAI 401 Incorrect API key provided: sk-xxx');
  t.ok('a bare 401 is recognised', key401.fatal === true);
  t.match('as a key problem', key401.human, /api key is not valid/i);
  const keyCode = ex('request failed: invalid_api_key');
  t.ok('so is the error code on its own', keyCode.fatal === true);

  // A status code is not a number that happens to appear in prose.
  const notAKey = ex('model returned 1401 tokens unexpectedly');
  t.no('1401 is not a 401', notAKey.fatal);

  const blip = ex('fetch failed');
  t.no('an ordinary failure is NOT fatal', blip.fatal);
  t.match('and is still reported', blip.human, /coach error: fetch failed/);
  t.eq('with nothing to invalidate the probe', blip.reason, '');

  const huge = ex('x'.repeat(5000));
  t.ok('a giant provider dump is truncated, not pasted into the UI', huge.human.length < 200);

  t.safe('junk input does not throw', () => { ex(null); ex(undefined); ex(0); ex({}); });

  // The wiring: a fatal failure must poison the probe, or the next call start sails
  // through on the 60s cache and the closer gets a dead coach all over again.
  const fs = require('fs'), path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  t.match('the catch invalidates the probe when fatal', src,
    /if \(f\.fatal\) modelProbe = \{ at: 0, ok: false, reason: f\.reason \}/);
  t.match('and broadcasts the human text', src, /broadcast\(s, \{ type: 'status', msg: f\.human \}\)/);
});

pending.push(async () => {
  t.group('the client actually STOPS when the server refuses');
  // The server returning 402 is worth nothing on its own: api() in the client returns
  // r.json() without ever checking r.ok, so a refusal arrives as an ordinary object. Before
  // this, /api/call/start could answer "Out of credits" and the call started anyway.
  const fs = require('fs'), path = require('path');
  const live = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'lib', 'liveCall.ts'), 'utf8');

  t.match('there is a refusal helper that throws', live,
    /function refuse\(r: any\) \{ if \(r && r\.error\) throw new Error\(r\.error\) \}/);

  // Both entry points must check. Missing one leaves a whole mode unprotected.
  const starts = live.split("'/api/call/start'").length - 1;
  t.eq('both call-start sites exist', starts, 2);
  const guarded = live.split(/'\/api\/call\/start'[\s\S]{0,120}?refuse\(r\)/).length - 1;
  t.eq('and BOTH are followed by a refusal check', guarded, 2);

  // The refusal has to land before capture begins, or the mic is live on a dead coach.
  const iStart = live.indexOf("'/api/call/start', { dealId, productId, goal })");
  const iRefuse = live.indexOf('refuse(r)', iStart);
  const iCapture = live.indexOf('beginCapture()', iStart);
  t.ok('the check comes before beginCapture()', iRefuse > -1 && iCapture > iRefuse);

  // And something has to show it to the human.
  const nc = fs.readFileSync(path.join(__dirname, '..', 'client', 'src', 'pages', 'NewCall.tsx'), 'utf8');
  t.match('NewCall catches it and puts it on screen', nc, /catch \(e: any\) \{ setMsg\(e\.message\)/);
});

module.exports = (async () => {
  for (const group of pending) await group();
  const r = t.report();
  if (r.total < 40) {
    console.log(`  FAIL  only ${r.total} checks ran, expected >= 40`);
    return { name: 'preflight', passed: r.passed, total: r.total + 1 };
  }
  return r;
})();
