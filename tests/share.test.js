// The shared recap page: /s/<token> and the /api/share/<token> read behind it.
//
// This is the only part of the app a person with no account ever reaches, which makes it
// the only part where a mistake is visible to someone outside the business. The failures
// worth guarding are all silent:
//
//   * a guest read that quietly runs on the service role reads every user's data
//   * a response that still carries `prep` hands a prospect the internal coaching brief
//   * an error text that differs between "no such token" and "expired" turns the endpoint
//     into an oracle for finding valid ones
//   * a page placed in public/ (the gitignored React build output) deploys as a 404 while
//     working perfectly in local dev
//
// Offline and deterministic, like every suite here: the factory takes its database handles
// through ctx, so the whole router is drivable with fakes and no network.
const fs = require('fs');
const path = require('path');
const { suite } = require('./lib/t');

const t = suite('share');
// Groups run one at a time, in order. t.group() sets a single shared label on the
// suite, so overlapping async bodies would all be filed under whichever group happened
// to start last - every check still runs, but the report names the wrong group.
const pending = [];
const ROOT = path.join(__dirname, '..');
// A floor on the check count, so a group that silently stops running fails the suite
// instead of quietly shrinking it.
const EXPECTED = 90;

// ---------------------------------------------------------------- harness

const ANON = 'sb_publishable_FAKE_ANON_KEY';

// Loads meetings.js fresh so a test can choose the env it reads at module load.
function load(env = {}) {
  const saved = {};
  for (const k of ['APP_ORIGIN', 'PUBLIC_BASE_URL', 'RECORDING_PUBLIC_BASE', 'R2_PUBLIC_BASE', 'SHARE_TTL_DAYS']) {
    saved[k] = process.env[k];
    if (k in env) process.env[k] = env[k]; else delete process.env[k];
  }
  delete require.cache[require.resolve('../meetings.js')];
  const mod = require('../meetings.js');
  for (const k of Object.keys(saved)) {
    if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
  return mod;
}

// Builds the factory with recording fakes. `row` is what share_view would return.
function build(opts = {}) {
  const calls = { sbRest: [], sbAdmin: [], patches: [] };
  const createMeetings = load(opts.env || {});

  const sbRest = async (pathq, jwt, o = {}) => {
    calls.sbRest.push({ pathq, jwt, method: (o && o.method) || 'GET', body: o && o.body });
    if (pathq === 'rpc/share_view') {
      if (opts.dbThrows) throw new Error('supabase 500: boom');
      const tok = o.body && o.body.tok;
      return (opts.rows && Object.prototype.hasOwnProperty.call(opts.rows, tok)) ? opts.rows[tok] : null;
    }
    if (/^meetings\?id=eq\./.test(pathq)) {
      if ((o && o.method) === 'PATCH') { calls.patches.push(o.body); return [{}]; }
      return [opts.meeting || { id: 'm1', title: 'A call' }];
    }
    return [];
  };

  // Calling this from a request handler is the bug the suite exists to catch, so it is a
  // tripwire rather than a stub.
  const sbAdmin = async (pathq) => {
    calls.sbAdmin.push(pathq);
    throw new Error('sbAdmin must never be reached from a request handler');
  };

  const meetings = createMeetings({
    sbRest, sbAdmin, hasServiceKey: true, anonKey: ANON,
    chatOnce: async () => '', readBody: async () => (opts.body || {}),
    logActivity: () => {},
    // Mirror the wire: sendJson stringifies, so a key set to undefined simply vanishes.
    // Asserting on the raw object instead would report fields the guest never receives.
    sendJson: (res, obj, status) => { res.sent = JSON.parse(JSON.stringify(obj)); res.status = status || 200; },
    ANALYSIS_MODEL: 'x', PREP_MODEL: 'x',
  });
  return { meetings, calls };
}

async function get(meetings, urlPath, method = 'GET') {
  const res = {};
  const handled = await meetings.handlePublic({ method }, res, urlPath);
  return { handled, status: res.status, body: res.sent };
}

const FULL = {
  title: 'Discovery call', platform: 'meet', starts_at: '2026-10-12T14:00:00Z',
  duration_min: 30, status: 'done', summary: 'They are losing overnight calls.',
  action_items: ['send the recording'], transcript: [{ speaker: 'Me', text: 'hello' }],
  recording: { key: 'rec/abc.mp4', mime: 'video/mp4', duration_sec: 2049, bytes: 2498125 },
};
const TOK = 'PROBETOKEN0123456789ab';   // 22 chars, the real token length

// ---------------------------------------------------------------- the public route

pending.push(async () => {
  t.group('the public route owns every /api/share/ path');
  const { meetings } = build({ rows: { [TOK]: FULL } });

  const good = await get(meetings, '/api/share/' + TOK);
  t.ok('a live token is served', good.handled === true && good.status === 200);
  t.eq('and carries the recap', good.body.title, 'Discovery call');

  // Each of these previously fell through to the /api/ auth gate, which answered
  // "not signed in" - sending a guest to look for a login that does not exist.
  const cases = [
    ['a truncated link', '/api/share/abc'],
    ['an over-long token', '/api/share/' + 'a'.repeat(65)],
    ['characters a token cannot contain', '/api/share/abc!$%^&*()1234567890'],
    ['a trailing slash', '/api/share/' + TOK + '/'],
    ['a nested path', '/api/share/' + TOK + '/download'],
    ['no token at all', '/api/share/'],
  ];
  for (const [label, p] of cases) {
    const r = await get(meetings, p);
    t.ok(label + ' is answered here, not by the auth gate', r.handled === true && r.status === 404);
  }

  for (const m of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const r = await get(meetings, '/api/share/' + TOK, m);
    t.ok(m + ' is refused but still owned', r.handled === true && r.status === 404);
  }

  // The guard must stay narrow: everything else is the authenticated app's business.
  for (const p of ['/api/meetings', '/api/sharex/abc', '/api/me', '/s/' + TOK, '/']) {
    const r = await get(meetings, p);
    t.ok('declines ' + p + ', leaving it to the app', r.handled === false);
  }
});

pending.push(async () => {
  t.group('a guest cannot tell one failure from another');
  const { meetings } = build({ rows: { [TOK]: FULL } });
  // share_view returns null for a token that never existed, one that was revoked and one
  // that expired. If the texts differed, the endpoint would answer "does this token
  // exist?" for anyone willing to iterate.
  const unknown = await get(meetings, '/api/share/' + 'z'.repeat(22));
  const malformed = await get(meetings, '/api/share/nope');
  t.eq('unknown and malformed read identically', unknown.body, malformed.body);
  t.match('and say nothing about why', unknown.body.error, /no longer available/i);
  t.notMatch('never names expiry', unknown.body.error, /expir/i);
  t.notMatch('never names revocation', unknown.body.error, /revok/i);
  t.notMatch('never leaks the token back', JSON.stringify(unknown.body), /zzzz/i);
});

pending.push(async () => {
  t.group('a database fault is not a stack trace');
  const { meetings } = build({ dbThrows: true });
  // The handler logs the real error server-side, which is correct. Muting it here keeps
  // a passing run free of red herrings - a green suite that prints errors teaches people
  // to scroll past errors.
  const realErr = console.error;
  console.error = () => {};
  const r = await get(meetings, '/api/share/' + TOK);
  console.error = realErr;
  t.ok('still a 404, not a 500', r.handled === true && r.status === 404);
  t.notMatch('no driver detail reaches the guest', JSON.stringify(r.body), /supabase|boom|500/i);
});

// ---------------------------------------------------------------- the security property

pending.push(async () => {
  t.group('nothing a guest sees comes from the service role');
  const { meetings, calls } = build({ rows: { [TOK]: FULL } });
  await get(meetings, '/api/share/' + TOK);
  await get(meetings, '/api/share/' + 'z'.repeat(22));

  t.eq('sbAdmin is never called', calls.sbAdmin, []);

  const reads = calls.sbRest.filter(c => c.pathq === 'rpc/share_view');
  t.ok('the read goes through share_view, not a table', reads.length === 2);
  // The credential matters more than the query. A user JWT would be wrong (there is no
  // user) and the service key would be catastrophic (it bypasses RLS entirely).
  t.ok('every guest read uses the anon key', reads.every(r => r.jwt === ANON));
  t.eq('no guest read touches the meetings table directly',
    calls.sbRest.filter(c => /^meetings/.test(c.pathq)).length, 0);
});

pending.push(async () => {
  t.group('what crosses the wire to a stranger');
  // share_view is what actually redacts, in SQL. This asserts the edge does not put any
  // of it back - a spread of the row plus a tweak is exactly how a field creeps in again.
  const leaky = {
    ...FULL,
    prep: 'INTERNAL COACHING BRIEF', user_id: 'u-1', deal_id: 'd-1',
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    organizer_email: 'owner@acme.com', attendees_emails: ['guest@acme.com'],
    bot_id: 'bot-9', error: 'nope',
  };
  const { meetings } = build({ rows: { [TOK]: leaky }, env: { RECORDING_PUBLIC_BASE: 'https://cdn.example.com' } });
  const r = await get(meetings, '/api/share/' + TOK);
  const wire = JSON.stringify(r.body);

  t.notMatch('the coaching brief does not travel', wire, /INTERNAL COACHING BRIEF/);
  t.notMatch('nor the live join link', wire, /meet\.google\.com/);
  t.notMatch('nor anybody email address', wire, /@acme\.com/);
  t.notMatch('nor the owner id', wire, /u-1/);

  t.eq('the storage key is replaced, not merely renamed', 'key' in r.body.recording, false);
  t.eq('a playable url is what the page gets', r.body.recording.url, 'https://cdn.example.com/rec/abc.mp4');
  t.eq('the readable parts survive', [r.body.title, r.body.summary, r.body.transcript.length],
    ['Discovery call', 'They are losing overnight calls.', 1]);
});

pending.push(async () => {
  t.group('turning a storage key into a url');
  const abs = { ...FULL, recording: { ...FULL.recording, key: 'https://r2.example.com/a.mp4' } };
  const slash = { ...FULL, recording: { ...FULL.recording, key: '/rec/abc.mp4' } };

  const none = build({ rows: { [TOK]: FULL } });
  const r1 = await get(none.meetings, '/api/share/' + TOK);
  // With no storage configured the page must say so rather than render a dead player.
  t.eq('no public base means no url', r1.body.recording.url, '');

  const based = build({ rows: { [TOK]: slash }, env: { RECORDING_PUBLIC_BASE: 'https://cdn.example.com/' } });
  const r2 = await get(based.meetings, '/api/share/' + TOK);
  t.eq('a trailing base slash and a leading key slash do not double up',
    r2.body.recording.url, 'https://cdn.example.com/rec/abc.mp4');

  const absolute = build({ rows: { [TOK]: abs } });
  const r3 = await get(absolute.meetings, '/api/share/' + TOK);
  t.eq('a key that is already a url is left alone', r3.body.recording.url, 'https://r2.example.com/a.mp4');

  const norec = build({ rows: { [TOK]: { ...FULL, recording: null } } });
  const r4 = await get(norec.meetings, '/api/share/' + TOK);
  t.eq('a meeting with no recording says null, not a broken object', r4.body.recording, null);
});

// ---------------------------------------------------------------- owner routes

pending.push(async () => {
  t.group('minting, rotating and revoking a link');
  const mk = async (b) => {
    b = b || {};
    const { meetings, calls } = build({ env: b.env, meeting: b.meeting });
    const res = {};
    await meetings.handle({ method: 'POST' }, res, '/api/meetings/m1/share',
      { id: 'u1' }, 'user-jwt', ['api', 'meetings', 'm1', 'share']);
    return { res, calls };
  };

  const a = await mk();
  t.ok('POST mints a token', typeof a.res.sent.token === 'string' && a.res.sent.token.length >= 22);
  t.match('url-safe characters only', a.res.sent.token, /^[A-Za-z0-9_-]+$/);
  t.eq('and reports it active', a.res.sent.state, 'active');
  t.eq('relative link when no origin is configured', a.res.sent.url, '/s/' + a.res.sent.token);
  t.eq('no expiry by default', a.res.sent.expires_at, null);
  t.eq('view count restarts with the new link', a.calls.patches[0].share_views, 0);

  // Rotation is the only way to cut off somebody who already holds the URL, so POST must
  // never hand back the token already on the row. Testing this against a meeting with no
  // token at all only proves the generator is random - the row has to arrive WITH one.
  const OLD = 'EXISTINGTOKEN012345678';
  const b = await mk({ meeting: { id: 'm1', share_token: OLD, share_views: 9 } });
  t.ok('POST on an already-shared meeting replaces the token', b.res.sent.token !== OLD);
  t.eq('and the new token is the one written to the row', b.calls.patches[0].share_token, b.res.sent.token);
  t.eq('the old one is gone from the response', b.res.sent.url.indexOf(OLD), -1);

  const c = await mk({ env: { APP_ORIGIN: 'https://app.example.com/' } });
  t.eq('an absolute origin is used when set and its trailing slash dropped',
    c.res.sent.url, 'https://app.example.com/s/' + c.res.sent.token);

  const d = await mk({ env: { SHARE_TTL_DAYS: '7' } });
  t.ok('a TTL produces a real future expiry',
    Date.parse(d.res.sent.expires_at) - Date.now() > 6.5 * 86400000);

  // Revoke nulls the token. That is what makes shareState read 'none' rather than
  // 'expired' - the link stops existing instead of merely looking stale.
  const { meetings, calls } = build({});
  const res = {};
  await meetings.handle({ method: 'DELETE' }, res, '/api/meetings/m1/share',
    { id: 'u1' }, 'user-jwt', ['api', 'meetings', 'm1', 'share']);
  t.eq('DELETE nulls the token', calls.patches[0].share_token, null);
  t.eq('and clears the expiry with it', calls.patches[0].share_expires_at, null);
  t.eq('reported as never-shared', res.sent.state, 'none');
});

pending.push(async () => {
  t.group('what the owner is told about a link');
  const live = { id: 'm1', share_token: TOK, share_expires_at: null, share_views: 12 };
  const { meetings } = build({ meeting: live });
  const res = {};
  await meetings.handle({ method: 'GET' }, res, '/api/meetings/m1/share',
    { id: 'u1' }, 'user-jwt', ['api', 'meetings', 'm1', 'share']);
  t.eq('state', res.sent.state, 'active');
  t.eq('the real view count, not a guess', res.sent.views, 12);
  t.eq('the url to copy', res.sent.url, '/s/' + TOK);

  const dead = { id: 'm1', share_token: TOK, share_expires_at: '2020-01-01T00:00:00Z', share_views: 3 };
  const g2 = build({ meeting: dead });
  const res2 = {};
  await g2.meetings.handle({ method: 'GET' }, res2, '/api/meetings/m1/share',
    { id: 'u1' }, 'user-jwt', ['api', 'meetings', 'm1', 'share']);
  t.eq('an expired link is reported expired', res2.sent.state, 'expired');
  t.eq('and no url is offered for copying', res2.sent.url, '');
});

// ---------------------------------------------------------------- the deploy traps

pending.push(() => {
  t.group('the page is somewhere that actually deploys');
  // public/ is the React build output and is gitignored IN FULL. A page placed there works
  // in local dev and 404s in production - the quietest possible failure, because tests pass
  // and the server runs. This is the guard.
  const page = path.join(ROOT, 'views', 'share.html');
  t.ok('views/share.html exists', fs.existsSync(page));
  t.no('and no copy was left behind in public/', fs.existsSync(path.join(ROOT, 'public', 'share.html')));

  const ignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  t.match('public/ is still ignored, so the rule above still matters', ignore, /^\/public\/$/m);
  t.no('views/ is not ignored', /^\/?views\/?$/m.test(ignore));

  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  t.match('the server reads the page from views/', server, /'views',\s*'share\.html'/);
  t.notMatch('and never from public/', server, /'public',\s*'share\.html'/);
});

pending.push(() => {
  t.group('the public routes are mounted ahead of the auth gate');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  const share = server.indexOf("urlPath.startsWith('/api/share/')");
  const page = server.indexOf("urlPath.startsWith('/s/')");
  const gate = server.indexOf("if (!user) return sendJson(res, { error: 'not signed in' }, 401)");
  t.ok('all three landmarks are present', share > -1 && page > -1 && gate > -1);
  // Order is the whole mechanism. Below the gate, a guest with a valid link gets a 401.
  t.ok('the share api is mounted before the gate', share < gate);
  t.ok('the page route is mounted before the gate', page < gate);
});

pending.push(() => {
  t.group('the SQL function is the real redaction boundary');
  // share_view is where expiry and field selection are actually enforced; the JS
  // allowlist is only the second lock. These assertions are structural - the live
  // behaviour was exercised against the real database on 2026-10-11 - but they stop the
  // properties being edited away without anyone noticing.
  const sql = fs.readFileSync(path.join(ROOT, 'share-schema.sql'), 'utf8');

  t.match('runs as definer, so it can read past RLS for a guest', sql, /security\s+definer/i);
  // A definer function without a pinned search_path is a privilege-escalation vector:
  // the caller can point `public` at their own objects.
  t.match('with a pinned search_path', sql, /set\s+search_path\s*=\s*public,\s*pg_temp/i);
  t.match('executable by anon, which is the whole point', sql, /grant\s+execute[\s\S]{0,80}to\s+anon/i);
  // Definer functions are executable by PUBLIC unless revoked.
  t.match('and revoked from PUBLIC first', sql, /revoke\s+all\s+on\s+function\s+public\.share_view/i);

  t.match('expiry is enforced in SQL, not in the caller', sql,
    /share_expires_at\s+is\s+null\s+or\s+share_expires_at\s*>\s*now\(\)/i);
  t.match('a token lookup is indexed', sql, /create\s+index[\s\S]{0,120}meetings\s*\(share_token\)/i);

  // What the function RETURNS is the contract. Each of these would be a leak.
  // Slice out the returned object rather than regex across newlines: what the function
  // RETURNS is the contract, and each absence below would otherwise be a leak.
  const built = sql.slice(sql.indexOf('jsonb_build_object('));
  for (const field of ['prep', 'meeting_url', 'user_id', 'deal_id', 'organizer_email', 'attendees_emails', 'bot_id']) {
    t.no('share_view never returns ' + field, new RegExp("'" + field + "'").test(built));
  }
  t.match('but it does return the summary', built, /'summary'/);
  t.match('and the transcript', built, /'transcript'/);
});

pending.push(() => {
  t.group('the page itself');
  const html = fs.readFileSync(path.join(ROOT, 'views', 'share.html'), 'utf8');

  // A video element with only width:100% keeps Chrome's default 150px height, so a 16:9
  // recording letterboxes into a 4.5:1 strip. Measured 682x152 before this rule existed.
  t.match('video is given an aspect ratio, not just a width', html, /video\.player\s*\{[^}]*aspect-ratio:\s*16\/9/);
  t.match('audio keeps its own compact height', html, /audio\.player\s*\{[^}]*height:\s*48px/);

  // A shared recording must not reach a search index or a referrer log.
  t.match('noindex', html, /name="robots"[^>]*noindex/);
  t.match('no referrer', html, /name="referrer"[^>]*no-referrer/);

  // Served by the raw node server with no bundler and read by strangers on strange
  // networks: everything inline, nothing fetched from a third party.
  t.no('no external script', /<script[^>]+src=/i.test(html));
  t.no('no external stylesheet', /<link[^>]+stylesheet/i.test(html));

  t.match('guest output is escaped before it reaches innerHTML', html, /function esc\(/);
  t.match('and the summary is escaped before newlines become breaks', html, /esc\(d\.summary\)\.split\(NL\)/);
  t.match('the phone gets a 16px gutter', html, /\.wrap\{[^}]*padding:32px 16px/);
});

module.exports = (async () => {
  // Awaiting every group is the difference between a suite that checks 80 things and one
  // that reports 40/40 because the rest had not finished. A short green suite is worse
  // than a red one, because nobody goes looking for the missing half.
  for (const group of pending) await group();
  const r = t.report();
  if (r.total < EXPECTED) {
    console.log(`  FAIL  only ${r.total} checks ran, expected >= ${EXPECTED} - a group did not finish`);
    return { name: 'share', passed: r.passed, total: r.total + 1 };
  }
  return r;
})();
