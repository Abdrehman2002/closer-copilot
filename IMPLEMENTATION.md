# Implementation guide — for Claude (or whoever applies this next)

Instructions for wiring this changeset into a Closer Copilot checkout server-side.
Read the whole file before running anything. Steps are ordered; step 3 is the only one
that needs a human decision.

---

## 0. What this changeset adds

| Area | Files |
|---|---|
| Admin platform (13 tabs) | `admin.js`, `client/src/pages/Admin.tsx` |
| Meeting notetaker | `meetings.js`, `client/src/pages/Meetings.tsx` |
| Self-hosted meeting bot | `bot-worker.js` |
| Product telemetry / heatmap | `client/src/lib/telemetry.ts` |
| DB objects | `admin-schema.sql` |
| Wiring | `server.js`, `client/src/App.tsx`, `client/src/components/AppShell.tsx`, `package.json` |

Design rule used throughout: **the `service_role` key is never required for the app to
work, and never reaches the browser.** Admin authority is a row in `public.admin_users`
enforced by Postgres RLS. The service key is only for two things that genuinely cannot be
done with a user token (creating auth accounts, and an unattended 3am backup).

---

## 1. Copy files in

Drop every file from the zip over the checkout, preserving paths. `server.js`,
`client/src/App.tsx`, `client/src/components/AppShell.tsx` and `package.json` are
**modified** versions of existing files — diff them if the checkout has moved on.

The four edits inside `server.js`, if you'd rather re-apply them by hand:

```js
// 1) near the top requires — shared token-pricing table
const { costOf: adminCostOf } = require('./admin');

// 2) after the http helpers (readBody/sendJson/bearer) are defined
const admin = require('./admin')({
  sbRest, sessions, SUPA_URL, SUPA_KEY, OPENAI_KEY, DG_KEY,
  OPENAI_BASE: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
  LIVE_MODEL, ANALYSIS_MODEL, PREP_MODEL, sendJson, readBody,
});
const meetings = require('./meetings')({
  sbRest, chatOnce, sendJson, readBody,
  logActivity: (jwt, row) => admin.logActivity(jwt, row),
  ANALYSIS_MODEL, PREP_MODEL,
});
admin.setBotMode(meetings.botMode);

// 3) inside the authenticated /api/ block, immediately after `const seg = ...`
if (await admin.handle(req, res, urlPath, user, jwt)) return;
meetings.remember(user.id, jwt);
if (await meetings.handle(req, res, urlPath, user, jwt, seg)) return;

// 4) at the top of the request handler, for metrics + the activity log
const reqStart = Date.now();
let logCtx = null;                        // set to {jwt, userId} once the user resolves
res.on('finish', () => { /* see server.js — logs mutations and failures */ });
```

`chatOnce()` and `creditsExhausted()` are new helpers in `server.js`; copy them if
re-applying by hand. `logUsage()` gains a `consume_credits` RPC call.

---

## 2. Install and build

```bash
npm install                 # playwright is an optionalDependency — fine if it fails
cd client && npm install && npm run build && cd ..
node --check server.js && node --check admin.js && node --check meetings.js
node server.js
```

> **Node 20.17 gotcha:** if the client build dies with
> `Cannot find module './rolldown-binding.win32-x64-msvc.node'`, run
> `cd client && npm install @rolldown/binding-win32-x64-msvc --no-save` once.
> Proper fix is Node ≥20.19.

---

## 3. Database — REQUIRES A HUMAN DECISION

Run `admin-schema.sql` in the Supabase SQL editor. It is idempotent.

**Do not apply section 3 automatically.** It creates `"admin full access"` policies that let
any admin read *every* account's call transcripts, client records and notes. On a project
with real users that is a privacy decision the owner has to make knowingly. Automated
migration attempts for this section were (correctly) refused by a safety gate three times.
Surface it, explain it, let a human run it.

Sections 1, 2, 4 and 5 are safe to apply — they create new, self-contained tables.

Then seed the first admin:

```sql
insert into public.admin_users (user_id, role)
select id, 'owner' from auth.users where email = 'REPLACE@ME.com'
on conflict (user_id) do update set role = 'owner';
```

Everything after that is done from the Accounts tab.

### Graceful degradation
`/api/admin/capabilities` probes what's actually installed and the UI states it plainly:

| Missing | Effect | UI |
|---|---|---|
| whole schema | panel won't load | "install schema" screen (detects `PGRST205`) |
| section 3 policies | admin sees only own rows | amber banner on Accounts |
| `admin_list_users()` | no email addresses, IDs only | same banner |
| `SUPABASE_SERVICE_KEY` | no account create/delete/ban, no nightly backup | inline notice + Backups tab |
| bot provider | no auto-join | notice on Meetings |

Never let these render as empty panels — the whole point is that a missing capability
looks like a missing capability, not a bug.

---

## 4. Environment

```bash
# required (already present in a working checkout)
OPENAI_API_KEY=          DEEPGRAM_API_KEY=
SUPABASE_URL=            SUPABASE_KEY=            # publishable

# optional — unlocks admin account management + unattended nightly backups
SUPABASE_SERVICE_KEY=                             # Supabase → Settings → API → service_role

# optional — meeting bot. Pick ONE.
BOT_WORKER_URL=http://localhost:7802              # self-hosted, free, Google Meet only
BOT_SHARED_SECRET=                                # if set, worker requires x-bot-secret
RECALL_API_KEY=                                   # managed, also does Zoom/Teams
RECALL_REGION=us-west-2
BOT_NAME=Closer Copilot Notetaker
```

`meetings.js` picks the provider: `BOT_WORKER_URL` → `self`, else `RECALL_API_KEY` →
`recall`, else `manual`. Manual still does prep briefs and notes; only auto-join is absent.

---

## 5. The meeting bot

```bash
npm i playwright && npx playwright install chromium
node bot-worker.js            # :7802
```

**How it works, and why.** The obvious design is join-and-capture-audio, which in a
container means pulseaudio + xvfb + a WebRTC tap — lots of moving parts that break. Instead
the bot joins, switches on Google Meet's own live captions, and scrapes them. Meet already
runs speech-to-text and labels every line with the speaker, so this is far more reliable,
free per minute, and gives speaker attribution. It's the same approach as Recall's
`meeting_captions` mode.

Honest limits:
* **Google Meet only.** Zoom/Teams web have captions too but different DOM — use Recall, or
  extend `joinMeet()`.
* Transcription quality is Google's, not Deepgram's.
* The bot is **visible** in the participant list as `BOT_NAME` and usually needs admitting
  from the waiting room. It is never a covert recorder — keep it that way.
* Meet's DOM shifts occasionally; `CAPTION_SCRAPER` uses several fallback selectors but will
  need maintenance now and then. That's the price of not paying a vendor.

API (shaped like Recall's so the adapter can target either):

```
POST   /bot          {meeting_url, bot_name}  -> {id, status}
GET    /bot/:id                               -> {id, status, transcript[], error}
DELETE /bot/:id                               -> leave the call
GET    /health                                -> {ok, playwright, bots}
```

Statuses: `starting → joining → recording → done`, or `failed` with a readable `error`.
The app polls `/api/meetings/:id/sync` every 30s and writes notes when the call ends.

Deployment note: the worker needs a real Chromium, so a slim Node image won't do — use
`mcr.microsoft.com/playwright:v1.62.0-jammy` or run it on a VM. Keep it on a private
network or set `BOT_SHARED_SECRET`.

---

## 6. Verification to run after applying

```bash
node --check server.js && node --check admin.js && node --check meetings.js && node --check bot-worker.js
cd client && npm run build && cd ..

# every admin route must be auth-gated
for e in whoami overview live users credits orgs logs flags backups capabilities meetings; do
  curl -s -o /dev/null -w "$e %{http_code}\n" localhost:7801/api/admin/$e; done   # expect 401

# UI ↔ server parity: these two lists must match exactly
grep -o "action: '[a-z_]*'" client/src/pages/Admin.tsx | sort -u
grep -o "case '[a-z_]*':"   admin.js                   | sort -u
```

In SQL, with an admin's uid:

```sql
select set_config('request.jwt.claims','{"sub":"<ADMIN_UUID>","role":"authenticated"}', true);
select public.is_admin(auth.uid()), public.admin_role(auth.uid());
select public.admin_query_sql('select 1 as ok');      -- works
select public.admin_query_sql('delete from calls');   -- must raise 'read-only'
```

**Clean up any test data.** A credits test leaves a row at zero with `enforced = true`,
which will block that account's calls until deleted.

---

## 7. Things deliberately NOT done

* **No account creation by the assistant.** No passwords generated, stored, or printed.
  Admins are granted to accounts that already exist; new accounts are created by a human
  through the panel (password typed by them, forwarded straight to Supabase) or by invite.
* **No secret ever rendered by default.** Keys show masked. Reveal is owner-only, audited to
  two tables, and auto-hides after 30 s.
* **The SQL console is read-only.** `admin_query_sql` rejects anything but a single
  SELECT/WITH. All writes go through a fixed whitelist in `runAction()` so a typo can't drop
  a table.
* **Credit enforcement defaults to off.** Turning it on is deliberate per-account, so nobody
  is locked out by accident.
