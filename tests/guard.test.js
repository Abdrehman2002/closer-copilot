// The fact-guard. The single most important safety property in the product: the coach must
// never put a number or a claim in the closer's mouth that isn't real. You cannot un-say a
// price to a buyer, and an invented client result is the kind of thing a prospect can check.
//
// Under pressure testing the model genuinely produced "the last client saw an extra ten to
// fifteen thousand a month" — describing a client that does not exist. This is what stops it.
const { suite } = require('./lib/t');
const { validateLine, safePartial, stripRepeatOpener, repeatsOpener } = require('../server.js');

const t = suite('guard');
const SOURCE = 'Setup is $4,000 one-time, floor $3,500 in trade. Retainer $799/mo. ' +
  'A receptionist runs $2,500-4,000/mo. ~27% of calls go unanswered.';

t.group('spoken prices');
const allow = (label, line) => t.ok(label, validateLine(line, SOURCE, '').ok);
const block = (label, line) => t.no(label, validateLine(line, SOURCE, '').ok);
allow('"four thousand one time" is 4000, not 4001', 'The setup is four thousand one time, then seven ninety-nine a month.');
allow('plain form', 'Setup is four thousand, then seven ninety-nine a month.');
allow('"one month" is not part of the price', 'Setup is four thousand and it runs one month minimum.');
allow('real compound number', 'We can do two thousand five hundred to set up.');
allow('sourced range', 'A receptionist is three thousand five hundred a month.');
allow('two-part spoken price', 'It is seven ninety-nine a month.');
allow('the trade floor', 'Setup is thirty five hundred in trade.');
block('4500 is NOT sourced', 'Setup is four thousand five hundred.');
block('9000 unsourced — the fix must not blind the guard', 'Setup is nine thousand one time.');
block('a fabricated client result', 'Our last client saw an extra fifteen thousand a month.');

t.group('correct arithmetic on sourced numbers is not a hallucination');
{
  // No HVAC/product-specific language at all — this must hold for every playbook, not just the
  // one with a dedicated missed-call calculator (DEFAULT_METRICS/figuresBlock is HVAC's own thing).
  const NUMBERS_ONLY = 'They said 40 seats at ninety dollars a seat.';
  const allowNum = (label, line) => t.ok(label, validateLine(line, NUMBERS_ONLY, '').ok);
  const blockNum = (label, line) => t.no(label, validateLine(line, NUMBERS_ONLY, '').ok);
  allowNum('forty times ninety is thirty-six hundred', 'That is thirty-six hundred a month.');
  allowNum('and the sum of the same two numbers', 'That is a hundred and thirty a month, all in.');
  blockNum('a number no combination of 40/90 produces is still caught', 'That is eleven thousand a month.');
}

t.group('never-say list is honoured');
t.no('a forbidden phrase is refused',
  validateLine('Honestly, this is a no-brainer for you.', SOURCE, 'no-brainer, game changer').ok);
t.ok('an unrelated line passes', validateLine('What is one job worth to you?', SOURCE, 'no-brainer').ok);

t.group('streaming preview masks the number, not the sentence');
t.eq('streams the words before a figure',
  safePartial('Setup is fourteen hundred, all in.', ''), 'Setup is');
t.eq('a half-typed numeral never leaks',
  safePartial('Setup is fourte', ''), 'Setup is');
t.eq('a line with no number streams whole',
  safePartial('Is it the price you are weighing?', ''), 'Is it the price you are weighing?');
t.match('stops before a never-say phrase',
  safePartial('This is a no-brainer for you', 'no-brainer'), /^This is a?\s*$/);

t.group('repeated opener');
t.eq('strips a repeat and re-capitalises',
  stripRepeatOpener('Totally fair |||| hiring means payroll. ↘', 'Totally fair |||| this is month-to-month.'),
  'Hiring means payroll. ↘');
t.eq('leaves a DIFFERENT opener alone',
  stripRepeatOpener('I get that |||| hiring means payroll.', 'Totally fair |||| month-to-month.'),
  'I get that |||| hiring means payroll.');
t.eq('leaves the first card of a call alone',
  stripRepeatOpener('Totally fair |||| this is month-to-month.', ''),
  'Totally fair |||| this is month-to-month.');
t.eq('keeps a SUBSTANTIVE first clause',
  stripRepeatOpener('When you say you do alright, |||| what does that mean?', 'When you say you do alright, |||| how many calls?'),
  'When you say you do alright, |||| what does that mean?');
t.eq('no pause marker to cut at -> untouched',
  stripRepeatOpener('Totally fair, tell me more.', 'Totally fair |||| month-to-month.'),
  'Totally fair, tell me more.');
t.eq('preserves a leading delivery mark instead of capitalising it',
  stripRepeatOpener('Totally fair |||| [certainty] but hiring means one call at a time.', 'Totally fair |||| month-to-month.'),
  '[certainty] but hiring means one call at a time.');
t.ok('repeatsOpener spots the tic', repeatsOpener('Totally fair |||| x', 'Totally fair — |||| y'));
t.no('repeatsOpener ignores a fresh opener', repeatsOpener('I hear you |||| x', 'Totally fair |||| y'));

t.group('degenerate input');
t.safe('never throws on empty/null', () => {
  validateLine('', '', ''); validateLine(null, null, null);
  safePartial('', ''); safePartial(null, null);
  stripRepeatOpener('', ''); stripRepeatOpener(null, null);
});

module.exports = t.report();
