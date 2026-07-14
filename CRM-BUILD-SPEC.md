# Closer Copilot — Build Spec: Client Brain + Onboarding (hand to Claude Code / Fable 5)

*Written 2026-07-15. Scope decided with Abdur. Implement in the EXISTING stack — do not rewrite.*

---

## 0. What we're building (and NOT building)

**The product stays what it is:** a live sales coach that whispers coaching cards on a video call.
We are adding a real, accumulating **per-client memory** so a closer gets smarter about each client
every meeting, and a clean **onboarding wizard** so new salespeople can self-serve.

**Decisions (locked):**
- ✅ **Keep the live whisper coaching** (the existing Deepgram + GPT card engine). Do not touch the
  coach loop except to feed it the new memory.
- ✅ **Hosted, multi-user, per-user isolation** (the current Supabase + RLS model). Each salesperson
  signs up, has their OWN clients / playbooks / memory. Nobody sees anyone else's data.
- ✅ **Per-client memory = an AI-maintained Markdown "Client Brain"**, auto-updated after every call,
  stored in the cloud, injected into the pre-call brief AND the live coach prompt. **AI-maintained only
  (no manual editing UI).** Downloadable as a `.md` file (nice-to-have).
- ✅ Every user creates their **own** product/objection playbooks. **Multiple playbooks**; pick which
  one you're selling at the start of each call (this already exists — keep it, surface it clearly).
- ✅ **Onboarding wizard:** Name → create first playbook → add first client → start first call.
- ❌ **NOT building:** teams, orgs, roles, manager/rep hierarchy, a team dashboard, or a leaderboard.
  Ignore any earlier "team CRM" version of this spec. This is per-user only.

---

## 1. Current architecture (reuse, don't rebuild)

- `server.js` — Node `http` + `ws`. Talks to Supabase REST with the user's JWT. Per-user in-memory
  call session. Live-call engine (Deepgram relay → GPT coach cards → post-call extraction) is DONE.
- `public/index.html` + `app.js` (vanilla ESM SPA, hash router) + `app.css` (design system — reuse it).
- Supabase project ref `ceyoflkazsnwzltdeefx`. Tables today: `products`, `deals` (= clients), `calls`,
  all per-user via RLS (`auth.uid() = user_id`).

**Already works — do NOT rebuild:** auth, per-user RLS, products CRUD, product-select-per-call,
add client (deal), save transcript + fired cards per call, pre-call brief, the live coach.

---

## 2. The one real change: per-client memory becomes a Markdown Client Brain

Today, post-call memory is opaque JSON in `deals.state`, and it's injected as a JSON blob. Replace that
with a human-readable Markdown document per client that the AI rewrites after every call.

### 2.1 Schema (apply on `ceyoflkazsnwzltdeefx`)
```sql
alter table public.deals add column if not exists memory_md text not null default '';

-- display name for onboarding / who the user is
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy profiles_owner on public.profiles for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
```
> Keep the existing `products`/`deals`/`calls` per-user RLS from the first migration. Do NOT apply the
> team/org migration.

### 2.2 The Client Brain generator (replaces `extractDealState`)
New function `extractClientBrain(prevMemoryMd, transcript, productName)`:
- One LLM call (`ANALYSIS_MODEL`). Input: the previous Client Brain markdown + the transcript of the
  call that just ended. Output: the UPDATED, FULL Client Brain in Markdown (merge — carry forward what
  still holds, update objection status, add new facts). Factual only, no invention.
- **Fixed section template** the model must fill (so the brief is scannable and the coach can rely on it):
  ```
  # {Client name} — {Company}
  **Snapshot:** one-line status + how warm the deal is.
  ## Their situation & pain
  ## Objections raised  (each: the objection — status: open / handled, and how)
  ## What they care about / buying signals
  ## Stakeholders & decision process
  ## Commitments  (Us: … | Them: …)
  ## Where we left off / agreed next step
  ## How to close them next call  (the strategy, using what they've told us)
  ```
- Keep each line short. This doc is read live, mid-call.

### 2.3 Wiring
- **`/api/call/end`**: after the call, call `extractClientBrain(deal.memory_md, turns, productName)` and
  save the result to `deals.memory_md`. (You can drop the old `state` JSON, or keep the column unused.)
  Still save the `calls` row (transcript + cards + duration) as today.
- **`/api/call/start`**: load `deals.memory_md`; set `session.memory = memory_md`; include it in
  `buildSystemPrompt` as the `DEAL MEMORY` section (replace the JSON blob with the markdown). Return
  `memory_md` as the `brief` so the live screen shows it. First call → a "no history yet" message.
- **`GET /api/clients/:id`**: include `memory_md`.
- **(nice-to-have) `GET /api/clients/:id/memory.md`**: return `memory_md` raw as `text/markdown` with a
  `Content-Disposition: attachment` header → the "download the MD file" ask.

---

## 3. Onboarding wizard (Name → playbook → client → first call)

### 3.1 Detect first run
- New endpoint **`GET /api/me`** → `{ email, name, hasProducts: bool, hasClients: bool }`
  (name from `profiles`; counts from `products`/`deals`). If `!name` → launch wizard.
- New endpoint **`POST /api/profile`** → `{ name }` upsert into `profiles`.

### 3.2 Wizard UI (new flow, reuse `.card-panel`, `.wide` buttons, design system)
Four light steps, one card at a time, a progress hint (1/4 … 4/4):
1. **"Welcome — what should we call you?"** → `POST /api/profile`.
2. **"Create your first playbook."** Product name + knowledge textarea prefilled with the existing
   `PRODUCT_TEMPLATE` (offer, pricing, objections + answers, proof, the close). → `POST /api/products`.
   Copy: "The coach reads this on every call. The sharper this is, the sharper your lines."
3. **"Add your first client."** Name + company. → `POST /api/clients`.
4. **"Start your first call."** Button → `#/new` with that product + client preselected and the **Test ⚡**
   button highlighted so they can feel it work immediately.
- After completion, land on Home.

---

## 4. Client detail = the Client Brain

Rewrite `viewClient` to lead with the rendered Client Brain:
- Header: client name + company + status badge + "New call with {first name}".
- **Client Brain card:** render `memory_md` (markdown → HTML). Read-only. Small "⬇ Download .md" link
  (hits the memory.md endpoint). If empty: "No history yet — your first call will build this."
- Keep: call history list (each call → transcript + cards viewer, already built).
- Remove the old structured mem-panel grid (objections/stakeholders/etc.) — the Brain replaces it.

**Markdown rendering:** add a tiny inline renderer in `app.js` (headings `#`,`##`, `**bold**`, `-` lists,
line breaks). Do NOT pull a heavy dependency; ~30 lines of regex is enough for this fixed template.

**Live screen pre-call brief:** render `memory_md` (same renderer) in the existing `.brief` panel so the
closer reads the Brain before/while the call runs.

---

## 5. Multiple playbooks per call (confirm, minor polish)
- Already supported: `products` list + `selProduct` dropdown in New Call. Ensure onboarding creates the
  first playbook, the Products screen lets them add/edit more, and the New Call product selector is
  obvious ("Which playbook are you selling on this call?"). No new backend.

---

## 6. Acceptance criteria (what the build must pass)
1. Brand-new user → onboarding wizard (name → playbook → client → first call), lands on Home.
2. Run a call with a client (Test button ok) → on End, that client's **Client Brain** markdown is created.
3. Start a **second** call with the SAME client → the pre-call brief shows the accumulated Client Brain,
   and the live coach references it in its lines.
4. User can create multiple playbooks and choose which to sell per call.
5. Client detail renders the Brain as formatted markdown; "Download .md" returns the file.
6. Isolation holds: each user sees only their own clients/playbooks/memory (RLS), verified via API too.
7. The live whisper coach still fires cards exactly as before.
8. Everything matches the existing design system.

---

## 7. Build order
1. Schema: `deals.memory_md` + `profiles` (§2.1).
2. `extractClientBrain` + wire into `/api/call/end`, `/api/call/start`, `GET /api/clients/:id`,
   and the memory.md download (§2).
3. `/api/me` + `/api/profile` + onboarding wizard (§3).
4. Client detail Brain rendering + markdown renderer + live-screen brief (§4).
5. Confirm multi-playbook selection + isolation (§5, §6).
6. Run the §6 acceptance script end to end.

## 8. Gotchas
- Do NOT touch the coach loop, the Deepgram relay, or the `/events` `/audio` sockets.
- Supabase project ref `ceyoflkazsnwzltdeefx`; turn OFF Auth "Confirm email" for smooth onboarding.
- Reuse `app.css` tokens/components; no restyle, no framework.
- Keep the publishable-key flow; RLS is the security boundary; every table stays RLS-on.
- `extractClientBrain` must MERGE (carry forward prior Brain), not overwrite from scratch each call.
