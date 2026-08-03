# Tests

```bash
npm test              # everything
npm test guard        # one suite (substring match on the filename)
npm run check         # syntax-check every module, then run the suite
```

**Offline, free and deterministic.** No network, no OpenAI spend, no flakiness from the model
having a different opinion today than yesterday. That is deliberate: a suite that costs money and
sometimes fails for no reason is a suite people stop running, and then it stops protecting
anything.

## What each suite is defending

| Suite | The bug it exists to prevent |
|---|---|
| `guard` | A fabricated price or client result reaching the closer's mouth. Under pressure the model produced *"the last client saw an extra ten to fifteen thousand a month"* — describing a client that does not exist. |
| `figures` | The loss maths being wrong out loud. Asked to do the arithmetic itself, the model read *"forty-five calls a WEEK"* as forty-five a MONTH, and turned a weekly total into *"forty-five missed calls a month at nine grand each"* — $405,000/mo. |
| `coach` | Answering the **previous** thing the prospect said (queued runs replaying stale turns: 19 cards across 5 turns on one real call), and making the closer wait ~230ms on footnotes they never say aloud. |
| `brain` | The Client Brain growing without limit until it truncated mid-sentence and silently dropped *"## How to close them next call"* off the most-worked deal in the account. |
| `prompt` | One account's product knowledge leaking into another's call, and prompt ordering that dropped the cache hit rate from 98% to 0% on every goal change. |
| `pickProduct` | Opening a call on the wrong playbook. A meeting scheduled as HVAC opened on "Lead Gen" because the hand-off dropped the product and the fallback took the oldest one. |

## Writing one

```js
const { suite } = require('./lib/t');
const t = suite('name');

t.group('what this section is about');
t.eq('label', actual, expected);      // JSON deep-equal
t.ok('label', truthyValue);
t.no('label', falsyValue);
t.match('label', text, /regex/);
t.notMatch('label', text, /regex/);   // asserts something is ABSENT
t.safe('never throws', () => fn(null));

module.exports = t.report();          // or: module.exports = (async () => { ... })()
```

Async suites export a promise — the coach fires on a debounce, so it has to await timers.

## The rule that matters

**A test that cannot fail proves nothing.** Before trusting a new suite, break the behaviour it
claims to cover and watch it go red. Mutation-checked regressions currently caught:

- rounding a buyer's own problem up instead of down
- disabling the fact-guard inside `coach()`
- quoting the industry average over the prospect's own stated figure
- letting the Client Brain grow unbounded
- dropping the meeting's chosen playbook

That last set found a genuine gap: `validateLine` was unit-tested, but nothing checked that
`coach()` **honoured** the verdict — the guard could have been disabled entirely and the suite
would have stayed green.

## Not covered here

Anything whose output is prose and can only be judged by ear — *does the coach still refuse to
give a price on a discovery call?* Those need a live model, cost money, and have no assertion
that meaningfully captures "this is good coaching". Run them by hand against a real call.
