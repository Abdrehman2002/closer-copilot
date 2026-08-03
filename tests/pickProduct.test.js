// Which playbook a call opens on.
//
// Imports the real client module directly (dynamic import, because it is ESM) rather than a
// transpiled copy — the thing under test is the thing that ships.
//
// This resolver decides which product knowledge the coach loads. Get it wrong and it pitches the
// wrong service to a real buyer, which has happened: a meeting scheduled as HVAC opened on
// "Lead Gen" because the hand-off dropped the product and the fallback took the oldest one.
const path = require('path');
const { pathToFileURL } = require('url');
const { suite } = require('./lib/t');

const t = suite('pickProduct');

module.exports = (async () => {
  const mod = await import(pathToFileURL(path.join(__dirname, '..', 'client', 'src', 'lib', 'pickProduct.js')).href);
  const pick = mod.pickProduct;

  const PRODUCTS = [{ id: 'lead-gen' }, { id: 'local-seo' }, { id: 'hvac' }];   // [0] is the OLDEST

  t.group('precedence');
  t.eq('the meeting\'s product beats everything', pick('hvac', 'lead-gen', PRODUCTS), 'hvac');
  t.eq('no meeting product -> what this client bought before', pick(null, 'local-seo', PRODUCTS), 'local-seo');
  t.eq('neither -> first product, last resort only', pick(null, null, PRODUCTS), 'lead-gen');
  t.eq('empty string is absent, not an id', pick('', '', PRODUCTS), 'lead-gen');

  t.group('the bug this exists to prevent');
  t.eq('a meeting scheduled as HVAC does NOT open on the oldest product', pick('hvac', null, PRODUCTS), 'hvac');

  t.group('stale and deleted ids are never selected');
  t.eq('deleted meeting product falls through to the client\'s', pick('deleted', 'local-seo', PRODUCTS), 'local-seo');
  t.eq('both stale -> all the way down to products[0]', pick('deleted', 'also-gone', PRODUCTS), 'lead-gen');
  t.no('a stale id is never returned verbatim', pick('deleted', null, PRODUCTS) === 'deleted');

  t.group('degenerate input returns "" rather than throwing inside a useEffect');
  t.eq('no products at all', pick('hvac', 'local-seo', []), '');
  t.eq('null list', pick('hvac', null, null), '');
  t.eq('undefined list', pick(null, null, undefined), '');

  t.group('switching client shares the same resolver');
  t.eq('client with history re-points to what they bought', pick('local-seo', 'hvac', PRODUCTS), 'local-seo');
  t.eq('client with NO history keeps the current pick, not products[0]', pick(null, 'hvac', PRODUCTS), 'hvac');
  t.eq('client whose product was deleted keeps the current pick', pick('gone', 'hvac', PRODUCTS), 'hvac');

  return t.report('pickProduct');
})();
