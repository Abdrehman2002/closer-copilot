# Admin panel + Meeting notetaker — setup & deployment

Everything below is already applied to your **live Supabase project**, so locally you only need
to pull the code and run. The "when you push" section covers a fresh/other environment.

---

## 1. Run it locally (nothing else needed)

```bash
npm install
cd client && npm install && npm run build && cd ..
node server.js
```

Open <http://localhost:7801> and sign in with either admin account:

| Account | Role | Notes |
|---|---|---|
| `vextriaai@gmail.com` | owner | seeded first |
| `nerdatronic03@gmail.com` | owner | added for local testing |

An **Admin** link appears in the sidebar under *System*. If it doesn't, you're signed in as
someone else — the panel re-checks server-side, the link is not the security boundary.

> Node 20.17 quirk: if `npm run build` fails with `rolldown-binding...node not found`, run
> `cd client && npm install @rolldown/binding-win32-x64-msvc --no-save` once.

---

## 2. What's live vs. what needs one more step

### Working right now
Overview · Live sessions · Credits · Organizations · API & Cost · Telemetry + heatmap · Logs ·
SQL console · Keys & Health (incl. reveal) · Backups (manual) · Flags · Announcements · Audit ·
Meetings (prep briefs + notes)

### Needs the service key — 2 minutes
Supabase → **Project Settings → API → `service_role`** → copy → add to `.env`:

```
SUPABASE_SERVICE_KEY=eyJhbGciOi...
```

Restart. This switches on:
- **Create / delete / ban accounts** from the Accounts tab
- **Unattended nightly backups** (a 3am job has no user token to authenticate with)

It is read only by the server and never sent to the browser.

### Needs 2 SQL statements — the cross-tenant grant
Three of my migration attempts were refused by a safety gate, because this is the piece that
lets an admin read **every** account's call transcripts and client data. It's your call, so it
has to be your hand on the trigger. Supabase → **SQL Editor** → paste **section 3** of
[`admin-schema.sql`](admin-schema.sql) → Run.

Until you do, the Accounts tab shows an amber banner and:
- you only see **your own** rows (RLS still scopes everything to you)
- accounts show as IDs, not email addresses

Everything else on the page is unaffected.

### Needs a provider — auto-joining meeting bot
See section 4.

---

## 3. When you push (fresh environment)

1. **Deploy the code.** One Node process, no build step server-side (`public/` is prebuilt).
   Render/Railway/Fly all work. Vercel **cannot** host the backend — the live coach holds
   WebSockets and in-memory call state; see `DEPLOY-VERCEL.md` if you want the split deploy.

2. **Environment variables** on the host:
   ```
   OPENAI_API_KEY=...
   DEEPGRAM_API_KEY=...
   SUPABASE_URL=https://<project>.supabase.co
   SUPABASE_KEY=<publishable key>
   SUPABASE_SERVICE_KEY=<service_role>     # account management + nightly backups
   RECALL_API_KEY=<optional>               # auto-joining notetaker bot
   HOST=0.0.0.0
   ```

3. **Run the schema** against that project: paste all of `admin-schema.sql` into the SQL editor.
   It's idempotent — safe to re-run.

4. **Seed your first admin** (edit the email first):
   ```sql
   insert into public.admin_users (user_id, role)
   select id, 'owner' from auth.users where email = 'you@company.com'
   on conflict (user_id) do update set role = 'owner';
   ```
   After that you can promote anyone from the Accounts tab — no SQL needed again.

5. **Backups write to `./backups`** on the server's disk. On an ephemeral host (Render free,
   Heroku) that disk is wiped on redeploy — attach a volume, or treat Supabase's own
   point-in-time backups as the real safety net and use these as exports.

### Roles
| Role | Can |
|---|---|
| `owner` | everything — change roles, reveal keys, delete accounts |
| `admin` | everything except managing other admins / revealing keys |
| `support` | read all, adjust credits, send password resets |
| `viewer` | read-only |

---

## 4. Meeting notetaker (the Fireflies part)

**Honest scope.** Actually joining a Google Meet / Zoom / Teams call means driving a real
meeting client. Fireflies, Otter, Fathom and Gong all run fleets of headless browser workers to
do it; there is no way to do it from a plain Node process. The practical route is a meeting-bot
API. So the bot is behind an adapter:

| `RECALL_API_KEY` | Behaviour |
|---|---|
| **not set** (now) | *Manual mode.* Prep briefs, notes, summaries and action items all work. You join the call yourself and use **Start Call** exactly as before. |
| **set** | A bot joins the link, records, transcribes, and notes are generated automatically. |

To switch it on: sign up at [recall.ai](https://recall.ai), then

```
RECALL_API_KEY=...
RECALL_REGION=us-west-2      # optional
BOT_NAME=Closer Copilot Notetaker   # optional
```

The background loop then dispatches a bot ~2 minutes before any meeting flagged **auto-join**,
polls it, and writes the summary + action items when the call ends.

**What the Meetings tab does today, with no provider:**
- schedule a meeting, paste the link, link it to a client
- auto-generates a **pre-call prep brief** from that client's Client Brain
- **Start** hands off to the live coach
- **Generate notes** turns any captured transcript into a summary, decisions, risks and
  action items split by who owes what

Swapping providers means editing `dispatchBot()` / `syncBot()` in `meetings.js` — about 30 lines.

---

## 5. Files added / changed

| File | What |
|---|---|
| `admin.js` | **new** — admin backend: roles, metrics, logs, credits, orgs, backups, keys, SQL console |
| `meetings.js` | **new** — notetaker: scheduling, prep, bot adapter, notes |
| `admin-schema.sql` | **new** — all admin/meeting DB objects (idempotent) |
| `client/src/pages/Admin.tsx` | **new** — 13-tab admin UI |
| `client/src/pages/Meetings.tsx` | **new** — meetings UI |
| `client/src/lib/telemetry.ts` | **new** — page-view + click capture for the heatmap |
| `server.js` | wires both modules, request logging, credit enforcement, `/api/notices` |
| `client/src/App.tsx` | `/admin` and `/meetings` routes |
| `client/src/components/AppShell.tsx` | Admin/Meetings nav, announcement banner, flag-gated items |
| `ADMIN-SETUP.md` | this file |

---

## 6. Verification performed

Run against the live database on 2026-08-02:

| Check | Result |
|---|---|
| `is_admin` / role / permission helpers | ✅ owner, can_write |
| SQL console runs `select 1` | ✅ `[{"ok":1}]` |
| SQL console rejects `delete from calls` | ✅ `read-only: SELECT or WITH only` |
| Grant $5 → consume $1.25 | ✅ balance 3.75, used 1.25, ledger row w/ actor |
| Credit enforcement off / on+funded / on+drained / no row | ✅ false / false / **true** / false |
| Both admin accounts resolve as `owner` | ✅ |
| 19 UI endpoints → server routes | ✅ all present |
| 23 UI actions → server handlers | ✅ exact match, no orphans |
| `server.js` / `admin.js` / `meetings.js` syntax | ✅ |
| Client production build | ✅ |
| Browser console on load | ✅ no errors |
| All API routes gated when signed out | ✅ 401 |

Test data was removed afterwards, including resetting the credit row the enforcement test
had left at zero (which would otherwise have blocked that account's calls).
