// Cold call sprint — the appointment gate.
//
// This is the layer that decides whether to interrupt a LIVE dial with a popup. A false
// positive costs the closer the call he is on; a miss costs almost nothing (the model layer
// never runs, and he can still add the client by hand afterwards). So this suite leans hard
// on the NEGATIVE cases: the gate must stay shut far more often than it opens.
//
// Both directions are mutation-checked. Removing the whenAt guard kills 5 checks; removing
// the explicit-refusal guard kills 2. A gate that cannot say no is not a gate.
const { suite } = require('./lib/t');
const { appointmentLikely } = require('../server.js');

const t = suite('sprint');
const T = (...pairs) => pairs.map(([ch, text]) => ({ ch, text }));

t.group('opens on a real booking');

t.ok('specific day + time, prospect agrees', appointmentLikely(T(
  ['me', 'Just so I have something on the calendar.'],
  ['prospect', 'Yeah alright.'],
  ['me', 'Does Thursday at 3 work, or is Tuesday morning better?'],
  ['prospect', 'Thursday at 3 works for me.'],
)));

t.ok('the callback-in-twenty-minutes close', appointmentLikely(T(
  ['me', 'Totally fair.'],
  ['prospect', 'I am on a roof right now.'],
  ['me', 'Would you be open if I gave you a ring in twenty minutes?'],
  ['prospect', 'Sure, call me back then.'],
)));

t.ok('bare confirmation one turn after the time', appointmentLikely(T(
  ['me', 'Tuesday at ten?'],
  ['prospect', 'Yep.'],
)));

t.ok('prospect names the time himself, then agrees', appointmentLikely(T(
  ['me', 'When is good for you?'],
  ['prospect', 'Try me tomorrow afternoon.'],
  ['me', 'Tomorrow afternoon it is.'],
  ['prospect', 'Sounds good.'],
)));

t.group('stays shut');

t.no('time offered and refused', appointmentLikely(T(
  ['me', 'Does Thursday at 3 work?'],
  ['prospect', 'No, that does not work.'],
)));

t.no('refusal first, stray yes later', appointmentLikely(T(
  ['me', 'Could we do Tuesday at 2?'],
  ['prospect', 'Nope, cannot do Tuesday.'],
  ['me', 'Understood.'],
  ['prospect', 'Yeah.'],
)));

t.no('agreement with no time on the table at all', appointmentLikely(T(
  ['me', 'So you are missing calls after five.'],
  ['prospect', 'Yeah, that is about right.'],
  ['me', 'That is what we fix.'],
  ['prospect', 'Okay, sounds good.'],
)));

t.no('the send-me-an-email brush-off', appointmentLikely(T(
  ['me', 'Could we grab fifteen minutes Thursday?'],
  ['prospect', 'Just send me an email and I will look at it.'],
)));

t.no('"call me sometime" — no time named', appointmentLikely(T(
  ['me', 'When should I try you?'],
  ['prospect', 'Just call me sometime, whenever.'],
)));

t.no('the CLOSER agrees, not the prospect', appointmentLikely(T(
  ['prospect', 'What time were you thinking?'],
  ['me', 'Thursday at 3.'],
  ['me', 'Yeah that works on my end.'],
)));

t.no('stale time — confirmation arrives far too late', appointmentLikely(T(
  ['me', 'Thursday at 3?'],
  ['prospect', 'Hmm.'],
  ['me', 'No pressure either way.'],
  ['prospect', 'What is it you do again?'],
  ['me', 'We answer the calls your team cannot get to.'],
  ['prospect', 'Okay sure.'],
)));

t.no('too little conversation to mean anything', appointmentLikely(T(
  ['prospect', 'Yeah?'],
)));

t.no('a price in dollars is not a time', appointmentLikely(T(
  ['me', 'It is ninety-five a month.'],
  ['prospect', 'Okay, that works.'],
)));

t.group('does not throw on junk input');
t.safe('empty transcript', () => appointmentLikely([]));
t.safe('turns with empty text', () => appointmentLikely(T(['prospect', ''], ['me', ''])));

module.exports = t.report('sprint');
