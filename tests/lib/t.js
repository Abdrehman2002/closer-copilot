// Tiny assertion helper shared by every suite. No dependency, no runner to install — a test
// suite that needs its own toolchain installed is a test suite that stops being run.
const C = { g: '\x1b[32m', r: '\x1b[31m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };

function suite(name) {
  const results = [];
  let group = '';

  const record = (ok, label, detail) => {
    results.push({ ok, label: group ? group + ' · ' + label : label, detail });
    return ok;
  };

  return {
    group(g) { group = g; return this; },

    // deep-ish equality via JSON, which is enough for the plain data these suites deal in
    eq(label, got, want) {
      const ok = JSON.stringify(got) === JSON.stringify(want);
      return record(ok, label, ok ? '' : `want ${JSON.stringify(want)}\n         got  ${JSON.stringify(got)}`);
    },
    ok(label, got) { return record(got === true, label, got === true ? '' : `expected true, got ${JSON.stringify(got)}`); },
    no(label, got) { return record(!got, label, !got ? '' : `expected falsy, got ${JSON.stringify(got)}`); },
    match(label, got, re) {
      const ok = re.test(String(got));
      return record(ok, label, ok ? '' : `${re} did not match:\n         ${String(got).slice(0, 220)}`);
    },
    notMatch(label, got, re) {
      const ok = !re.test(String(got));
      return record(ok, label, ok ? '' : `${re} SHOULD NOT have matched:\n         ${String(got).slice(0, 220)}`);
    },
    // asserts the code under test refuses bad input instead of throwing
    safe(label, fn) {
      try { fn(); return record(true, label, ''); }
      catch (e) { return record(false, label, 'threw: ' + e.message); }
    },

    report(name2) {
      const failed = results.filter(r => !r.ok);
      for (const r of results) {
        if (r.ok) console.log(`  ${C.g}PASS${C.x}  ${r.label}`);
        else console.log(`  ${C.r}FAIL${C.x}  ${r.label}\n         ${C.d}${r.detail}${C.x}`);
      }
      return { name: name2 || name, passed: results.length - failed.length, total: results.length };
    },
  };
}

module.exports = { suite, C };
