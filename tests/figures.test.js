// The loss maths: hearing the prospect's numbers, and working them out in code.
//
// This is the highest-stakes arithmetic in the product — it is read aloud to a buyer. The model
// is deliberately kept away from it, because when it was asked to do the sums it read
// "forty-five calls a WEEK" as forty-five a MONTH, and on another call turned a weekly total
// into "forty-five missed calls a month at nine grand each" — $405,000/mo, which ends a call.
const { suite } = require('./lib/t');
const { evalExpr, extractFigures, figuresBlock, validateLine, DEFAULT_METRICS } = require('../server.js');

const t = suite('figures');
const P = (...lines) => lines.map(text => ({ ch: 'prospect', text }));

t.group('calculator — data, not code');
t.eq('precedence', evalExpr('2 + 3 * 4', {}), 14);
t.eq('brackets', evalExpr('(2 + 3) * 4', {}), 20);
t.eq('percent literal', evalExpr('200 * 27%', {}), 54);
t.eq('named variables', evalExpr('volume * 4 * 0.27', { volume: 45 }), 48.6);
t.eq('unknown name refused, not guessed', evalExpr('volume * mystery', { volume: 4 }), null);
t.eq('malformed refused', evalExpr('4 * * 2', {}), null);
t.eq('trailing junk refused', evalExpr('4 * 2 )', {}), null);
t.eq('divide by zero refused', evalExpr('4 / 0', {}), null);
t.eq('cannot execute anything', evalExpr('process.exit(1)', {}), null);
t.eq('cannot reach globals', evalExpr('global', {}), null);
t.eq('cannot reach require', evalExpr('require("fs")', {}), null);

t.group('hearing the numbers');
t.eq('self-corrected range takes the settled figure',
  extractFigures(P('Probably forty, forty-five calls a week. More in the summer.')),
  { volume: 45, period: 'week' });
t.eq('digits + per day', extractFigures(P('We get about 30 calls a day.')), { volume: 30, period: 'day' });
t.eq('value in "grand"',
  extractFigures(P('We run maybe 20 calls a week, average job is nine grand.')),
  { volume: 20, period: 'week', value: 9000 });
t.eq('value in dollars',
  extractFigures(P('20 calls a week and a typical replacement is $12,000.')),
  { volume: 20, period: 'week', value: 12000 });
t.eq('NEVER reads the closer\'s own words as the prospect\'s business',
  extractFigures([{ ch: 'me', text: 'Most shops get 200 calls a month at a $9,000 ticket.' }]), {});
t.eq('no figures stated', extractFigures(P('We do alright, me and two techs.')), {});

t.group('the unit lives in OUR question');
{
  // "how many calls a week?" -> "probably forty to forty-five" has no unit in the answer at all
  const f = extractFigures([
    { ch: 'me', text: 'How many calls come in on a typical week?' },
    { ch: 'prospect', text: 'Probably 40 to 45, more in the summer. Average job is about $9, give or take.' },
  ]);
  t.eq('reads 45/week from a bare answer', [f.volume, f.period], [45, 'week']);
  t.eq('recovers "$9" as nine grand — the word gets eaten, the sign survives', f.value, 9000);
}
t.no('"two techs" is never a $2,000 job',
  extractFigures(P('Just me and two techs doing replacement work.')).value);

t.group('arithmetic');
{
  const b = figuresBlock(extractFigures(P('Probably forty, forty-five calls a week. Average job is nine grand.')));
  t.match('45/wk becomes ~180/mo', b, /180 a month/);
  t.match('27% of 180 floors to 48, not 49', b, /about 48 a month/);
  t.match('two jobs at 9k = $18,000', b, /\$18,000 a month walking out/);
}
t.eq('no volume -> empty block, never an invented one', figuresBlock({}), '');
t.no('no value -> makes no revenue claim at all',
  /walking out/.test(figuresBlock({ volume: 45, period: 'week' })));

t.group('their number beats our average');
{
  const f = extractFigures([
    { ch: 'me', text: 'How many calls come in on a busy week?' },
    { ch: 'prospect', text: 'Probably 40 to 45 calls a week, more in the summer.' },
    { ch: 'me', text: 'How many of those go unanswered right now?' },
    { ch: 'prospect', text: "Well, probably a month if you're talking about maybe 15 calls or unanswered." },
  ]);
  const b = figuresBlock(f);
  t.eq('captures his stated 15', f.stated, 15);
  t.match('uses HIS 15', b, /about 15 a month/);
  t.notMatch('does NOT quote the 27% estimate of 48 at him', b, /\b48\b/);
  t.match('labels it as his', b, /THEY told you this/);
}
t.match('falls back to the industry rate when unstated',
  figuresBlock(extractFigures([{ ch: 'me', text: 'how many calls a week?' }, { ch: 'prospect', text: 'about 45 calls a week' }])),
  /unanswered: about 48 a month/);

t.group('configurable per playbook');
{
  const RECRUITER = {
    listen: { volume: { noun: 'roles', words: ['roles', 'openings', 'vacancies'] },
              value: { noun: 'placement fee', words: ['fee', 'placement', 'salary'] } },
    steps: [
      { name: 'perMonth', expr: 'volumeMonth', say: '{volume} {volumeNoun} a {period} = about {x} a month' },
      { name: 'unfilled', expr: 'perMonth * 40%', say: 'roughly {x} still open after 60 days' },
      { name: 'atRisk', expr: 'unfilled * value', money: true, needs: 'value', say: '{x} of fees sitting unbilled' },
    ],
  };
  const f = extractFigures([
    { ch: 'me', text: 'How many roles are you working in a month?' },
    { ch: 'prospect', text: 'Around 10 roles. Average placement fee is about 12k.' },
  ], RECRUITER);
  const b = figuresBlock(f, RECRUITER);
  t.eq('hears a completely different business', [f.volume, f.period, f.value], [10, 'month', 12000]);
  t.match('runs that playbook\'s own formula', b, /roughly 4 still open/);
  t.match('and its own money step', b, /\$48,000 of fees sitting unbilled/);
  t.notMatch('never says "calls" to a recruiter', b, /calls/);
  t.eq('a broken formula is skipped, not crashed',
    figuresBlock({ volume: 10, period: 'month' }, { listen: RECRUITER.listen, steps: [{ expr: 'volume * ', say: 'x={x}' }] }), '');
  t.match('no config at all -> old behaviour intact',
    figuresBlock(extractFigures(P('45 calls a week. job is nine grand.')), undefined), /180 a month/);
}

t.group('the guard accepts what we computed, and nothing more');
{
  const b = figuresBlock(extractFigures(P('forty-five calls a week. average job nine grand.')));
  const src = 'Avg job $7k-20k. ~27% unanswered. Setup $4,000.\n' + b + '\nPROSPECT: forty-five calls a week';
  t.ok('"a hundred and eighty" allowed — we sourced it', validateLine('That is about a hundred and eighty calls a month.', src, '').ok);
  t.ok('"eighteen thousand" allowed', validateLine('Even two closing is eighteen thousand a month walking out.', src, '').ok);
  t.no('an invented "ninety thousand" is still blocked', validateLine('You are losing ninety thousand a month.', src, '').ok);
}

t.group('defaults are sane');
t.ok('DEFAULT_METRICS has listen + steps', !!(DEFAULT_METRICS.listen && DEFAULT_METRICS.steps.length));
t.safe('degenerate input never throws', () => {
  extractFigures(null); extractFigures([]); extractFigures(undefined, {});
  figuresBlock(null); figuresBlock({}, null); figuresBlock({ volume: 5 }, { steps: [] });
});

module.exports = t.report();
