#!/usr/bin/env node
/*
 * Test runner.  `npm test`
 *
 * Every suite here is OFFLINE and DETERMINISTIC: no network, no OpenAI spend, no flakiness from
 * a model having a different opinion today than yesterday. That is deliberate — a suite that
 * costs money and sometimes fails for no reason is a suite people stop running, and then it
 * stops protecting anything.
 *
 * The suites that genuinely need a live model (does the coach still refuse to price on a
 * discovery call?) live behind `npm run test:live` and are judged by eye, because their output
 * is prose and there is no assertion that meaningfully captures "this is good coaching".
 */
const fs = require('fs');
const path = require('path');
const { C } = require('./lib/t');

const only = process.argv[2] || '';
const dir = __dirname;
const files = fs.readdirSync(dir)
  .filter(f => f.endsWith('.test.js'))
  .filter(f => !only || f.includes(only))
  .sort();

if (!files.length) {
  console.log(`no suites matched ${JSON.stringify(only)}`);
  process.exit(1);
}

(async () => {
  let passed = 0, total = 0;
  const failedSuites = [];

  for (const f of files) {
    const name = f.replace(/\.test\.js$/, '');
    console.log(`\n${C.b}${name}${C.x}`);
    let r;
    try {
      // a suite exports its result, or a promise of it — anything that has to await a timer
      // (the coach fires on a debounce) needs the latter
      r = await require(path.join(dir, f));
    } catch (e) {
      console.log(`  ${C.r}FAIL${C.x}  suite crashed\n         ${C.d}${e.stack || e.message}${C.x}`);
      failedSuites.push(name); total += 1;
      continue;
    }
    if (!r || typeof r.total !== 'number') {
      console.log(`  ${C.r}FAIL${C.x}  suite exported nothing usable — did it forget t.report()?`);
      failedSuites.push(name); total += 1;
      continue;
    }
    passed += r.passed; total += r.total;
    if (r.passed !== r.total) failedSuites.push(name);
  }

  const allGreen = passed === total && total > 0;
  console.log('\n' + '─'.repeat(58));
  console.log(`  ${allGreen ? C.g : C.r}${passed}/${total}${C.x} checks passed across ${files.length} suites`);
  if (!allGreen) console.log(`  ${C.r}failing:${C.x} ${failedSuites.join(', ')}`);
  console.log('');
  process.exit(allGreen ? 0 : 1);
})();
