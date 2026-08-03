// Which playbook should a call open on?
//
// Plain JS with JSDoc types on purpose: the test suite requires this file DIRECTLY, with no
// transpile step in between. A compiled copy is a copy that can drift from its source, and this
// is not logic worth testing a stale version of.
//
// Getting it wrong is not cosmetic. The coach loads its entire product knowledge — pricing,
// objection answers, the loss maths — from whichever playbook this returns. Pick the wrong one
// and it confidently pitches the wrong service at a real buyer. That has already happened once:
// an HVAC call coached as Local SEO, because the fallback silently chose the oldest product.
//
// Precedence, strongest first:
//   1. an explicit choice — ?product= handed over from a scheduled meeting
//   2. what this client was actually sold last time
//   3. the first product, only because a call has to start with something
//
// Every candidate is checked against the CURRENT list before use. A deleted or stale id must
// never be selected: it would leave the dropdown looking populated while the call starts with no
// product knowledge at all — the coach running blind but appearing fine.
//
// @param {string|null|undefined} asked        explicit ?product=
// @param {string|null|undefined} clientsLast  what this client bought before
// @param {{id: string}[]|null|undefined} products  the current list
// @returns {string}
export function pickProduct(asked, clientsLast, products) {
  const list = products || [];
  const exists = (id) => !!id && list.some((p) => p.id === id);
  if (exists(asked)) return asked;
  if (exists(clientsLast)) return clientsLast;
  return (list[0] && list[0].id) || '';
}
