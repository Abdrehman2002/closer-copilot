// Which playbook should a call open on?
//
// This is pulled out of the component so it can actually be tested. Getting it wrong is not a
// cosmetic bug: the coach loads its entire product knowledge — pricing, objection answers, the
// loss maths — from whichever playbook this returns. Pick the wrong one and it confidently
// pitches the wrong service at a real buyer, which has already happened once (an HVAC call
// coached as Local SEO, because the fallback silently chose the oldest product in the list).
//
// Precedence, strongest first:
//   1. an explicit choice — ?product= handed over from a scheduled meeting
//   2. what this client was actually sold last time
//   3. the first product, only because a call has to start with something
//
// Every candidate is checked against the CURRENT product list before it is used. A deleted or
// stale id must never be selected: it would leave the dropdown looking populated while the call
// starts with no product knowledge at all — the coach running blind but appearing fine.
export function pickProduct(
  asked: string | null | undefined,
  clientsLast: string | null | undefined,
  products: { id: string }[] | null | undefined,
): string {
  const list = products || [];
  const exists = (id?: string | null): id is string => !!id && list.some((p) => p.id === id);
  if (exists(asked)) return asked;
  if (exists(clientsLast)) return clientsLast;
  return list[0]?.id || '';
}
