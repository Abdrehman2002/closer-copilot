// The Client Brain: one rolling memo per client, read on every turn of every future call.
//
// It used to accumulate without limit — ~230 tokens after one call, ~1,466 after eighteen — and
// had grown past the generation cap, so the most-worked deal in the account was being truncated
// mid-sentence with "## How to close them next call" missing entirely. Instructions alone did
// not hold the caps, so trimBrain() enforces them in code.
const { suite } = require('./lib/t');
const { trimBrain, parseBrain } = require('../server.js');

const t = suite('brain');

// the OLD format, which existing brains are still written in and must keep parsing
const OLD = `# Acme — Acme Ltd
**Snapshot:** warm but price-sensitive and a bit skeptical

## Their situation & pain
- Receives about 40-45 calls weekly, more in summer.

## Objections raised
- Price concerns — status: open, questioned why it costs more than a competitor.
- Budget concerns — status: handled, open to month-to-month with a guarantee.

## Commitments
- us: send a clear breakdown
- them: discuss with his brother

## Where we left off / agreed next step
- Demo Tuesday

## How to close them next call
- Lead with the missed-call math, then risk reversal
`;

// the COMPACT format written from now on
const NEW = `# Acme — Acme Ltd
**Snapshot:** HOT · demo booked; brother wants proof

## Their situation & pain
- 45 calls/wk (~180/mo) · 15 missed/mo

## Objections raised
- price too high · OPEN
- budget · HANDLED (month-to-month, 30d guarantee)

## Commitments
- us: live demo Tuesday
- them: attend and evaluate

## Where we left off / agreed next step
- Demo Tuesday with both

## How to close them next call
- Show a job booked live, then risk reversal
`;

t.group('old brains keep parsing — they are never rewritten');
{
  const p = parseBrain(trimBrain(OLD));
  t.match('snapshot survives', p.snapshot, /price-sensitive/);
  t.eq('open objection extracted, status text stripped', p.openObjections[0], 'Price concerns');
  t.no('a HANDLED objection is not listed as open', p.openObjections.some(o => /budget/i.test(o)));
  t.eq('commitments split us/them', [p.commitmentsUs[0], p.commitmentsThem[0]],
    ['send a clear breakdown', 'discuss with his brother']);
  t.match('close plan survives', p.howToClose, /missed-call math/);
}

t.group('compact brains parse too');
{
  const p = parseBrain(trimBrain(NEW));
  t.eq('warmth read from the stated token, not guessed from keywords', p.warmth, 'hot');
  t.eq('"· OPEN" is stripped from the objection text', p.openObjections[0], 'price too high');
  t.no('HANDLED is not treated as open', p.openObjections.some(o => /budget/i.test(o)));
  t.match('close plan present', p.howToClose, /risk reversal/);
}

t.group('warmth');
t.eq('HOT', parseBrain('**Snapshot:** HOT · ready to sign').warmth, 'hot');
t.eq('WARM maps to warming', parseBrain('**Snapshot:** WARM · interested').warmth, 'warming');
t.eq('COLD', parseBrain('**Snapshot:** COLD · gone quiet').warmth, 'cold');
t.eq('no token -> falls back to the old keyword scan',
  parseBrain('**Snapshot:** they are ready to buy').warmth, 'hot');

t.group('caps are enforced in code, because instructions did not hold them');
{
  const over = '## Objections raised\n' + Array.from({ length: 12 }, (_, i) => `- objection ${i} · OPEN`).join('\n');
  t.eq('12 bullets capped to 6', (trimBrain(over).match(/^- /gm) || []).length, 6);
  const tail = '## How to close them next call\n' + Array.from({ length: 9 }, (_, i) => `- move ${i}`).join('\n');
  t.eq('the closing section is capped tighter, at 3', (trimBrain(tail).match(/^- /gm) || []).length, 3);
}
t.notMatch('notes about our own tool are dropped — that is our problem, not a fact about the buyer',
  trimBrain('## Their situation & pain\n- bad transcription quality lately\n- 45 calls/wk'), /transcription/);
t.match('but the real fact beside it is kept',
  trimBrain('## Their situation & pain\n- bad transcription quality lately\n- 45 calls/wk'), /45 calls\/wk/);

t.group('trimming never mangles');
t.eq('no headings -> untouched', trimBrain('just some text'), 'just some text');
t.eq('empty is safe', trimBrain(''), '');
t.eq('null is safe', trimBrain(null), '');
t.match('a section under its cap is passed through whole',
  trimBrain('## Commitments\n- us: a\n- them: b'), /us: a[\s\S]*them: b/);
t.safe('degenerate input never throws', () => {
  parseBrain(''); parseBrain(null); parseBrain('# only a title');
  trimBrain(undefined); trimBrain('## Objections raised');
});

module.exports = t.report();
