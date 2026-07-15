# Closer Copilot — Build Spec V2 (the update)

*Written 2026-07-15. What to change to go from the current prototype to the Founding-20 product. The wedge (live whisper + deal memory) already exists — this sharpens the lines, wires in real intake, picks the models, and instruments the YC proof metrics.*

Companion docs (in AIOS repo): the offer is `references/closer-copilot-founding-offer.md`; the intake schema + niche brain is `references/closer-copilot-intake-form.md`.

---

## 1. Model choices (decided)

Current code uses `gpt-4o-mini` for the whisper. **Switch to Claude** — this is a Claude-first stack and the quality/latency tiers line up cleanly. Add `@anthropic-ai/sdk` to deps.

| Role | Model | Model ID | Why | Price (in/out per 1M) |
|---|---|---|---|---|
| **LIVE_MODEL** — in-call whisper | Claude Haiku 4.5 | `claude-haiku-4-5` | Fastest tier, streaming, sub-second first token. Runs every few seconds of a call, so cost + latency dominate. Thinking OFF for speed. | $1 / $5 |
| **PREP_MODEL** — between-call Client Brain synthesis + per-call battle plan | Claude Opus 4.8 | `claude-opus-4-8` | Best reasoning, not latency-sensitive (runs between calls). This is the moat — spend quality here. | $5 / $25 |
| **ANALYSIS_MODEL** — post-call structured extraction → Supabase | Claude Sonnet 5 | `claude-sonnet-5` | Strong structured output at lower cost, runs once per call. | $3 / $15 (intro $2 / $10 through 2026-08-31) |

**Latency rule:** whisper with the fast model, think with the smart model. Never put Opus in the live path — a line that arrives 3s late is a line the moment already passed.

**STT stays Deepgram nova-3** — already wired, low-latency streaming, two-speaker. No change.

Cost-down option if margins bite: use `claude-sonnet-5` for PREP too (it's near-Opus on reasoning). Keep Haiku on live regardless.

`.env` keys:
```
LIVE_MODEL=claude-haiku-4-5
PREP_MODEL=claude-opus-4-8
ANALYSIS_MODEL=claude-sonnet-5
ANTHROPIC_API_KEY=...
DEEPGRAM_API_KEY=...   (unchanged)
```

### API shapes to use (from claude-api reference)
- **Live whisper (Haiku 4.5):** `client.messages.stream({ model: LIVE_MODEL, max_tokens: 120, messages, system })`. Keep `max_tokens` tiny — a whisper is one line. No `thinking`, no `effort` (Haiku doesn't take effort). Stream the first tokens straight to the panel.
- **Prep + battle plan (Opus 4.8):** `client.messages.create({ model: PREP_MODEL, max_tokens: 4000, thinking: { type: "adaptive" }, output_config: { effort: "high" }, ... })`. Runs before the call; latency is fine.
- **Post-call extraction (Sonnet 5):** use structured outputs — `output_config: { format: { type: "json_schema", schema: DEAL_STATE_SCHEMA } }` so the Client Brain update is always valid JSON. No prefill (400 on these models).

---

## 2. The big gap: real intake → prompt context

Today `product.md` has TODO placeholders. The whole thesis is "great context in → great line out," so this is the highest-leverage change. Replace the single `product.md` with the 3-object model from `references/closer-copilot-intake-form.md`:

- **`profiles/closer.json`** — filled once (tone, framework, signature phrases, never-say list).
- **`products/<slug>.json`** — one per product (offer, buyer psychology, objections+rebuttals, deal context). A closer picks which product at call start.
- **Client Brain** — already in Supabase per prospect; keep, and grow it every call.

**Onboarding UX (per the locked decision — detailed form, not 4 questions):** a simple web form at `/onboard` that writes `closer.json` + one `products/<slug>.json`. Fields = Form 1 + Form 2 in the intake doc. Optional: paste a past call transcript → PREP_MODEL auto-drafts the product profile for the closer to correct (v2 fast-follow).

**At call start:** closer selects the product → server loads `closer.json` + that `products/<slug>.json` + the prospect's Client Brain, and builds the system prompt.

---

## 3. Line-generation system prompt (the engine)

Rebuild the whisper system prompt around the layered context. Structure:

```
You are a live sales copilot whispering the next line to {closer.name}, a {closer.tone} closer
who runs {closer.framework}. Output ONE line they can say right now. Match their voice.
Never use: {closer.never_say}.

THE OFFER: {product.offer summary + price + transformation + mechanism + proof + guarantee}
THE BUYER'S PSYCHOLOGY: surface pain {..}, deep pain {..}, dream {..}, #1 fear {..}, buying trigger {..}
OBJECTION PLAYBOOK: {product.objections → best rebuttal, each}
THIS PROSPECT (Client Brain): {name, role, stated pain, budget/authority/timeline signals,
  objections raised so far + reactions, emotional temp, promised next steps, rapport hooks}
LIVE TRIGGER: {detected from last 20s of transcript: objection type / sentiment drop / buying signal / stall}

Rules: hit an EMOTION not a fact. Use dream-pull, cost-of-inaction, emotion-labeling, reframe,
or future-pace. If a buying signal fires, move to close and stop selling. One line. In their voice.
```

Prompt-cache the stable prefix (closer + product profiles rarely change mid-call) so only the rolling transcript + Client Brain vary — big latency + cost win on Haiku. Put `cache_control: {type:"ephemeral"}` on the last product-profile block.

---

## 4. Multi-product support

Current build assumes one product (`product.md`). Add:
- Product picker on the call-start screen (reads `products/*.json`).
- `deals` table already keys by prospect — add a `product_slug` column so each deal's Client Brain knows which product it's for.
- Pre-call brief and battle plan load the matching product profile.

---

## 5. Instrument the YC proof metrics (do this now, not later)

Every metric in `references/closer-copilot-founding-offer.md` has to generate itself from real usage. Add lightweight logging:

- **Line-acceptance %** — add a one-tap "used it 👍" on each whispered card. Log `{call_id, line, used: bool}`. This is your PMF metric — nobody else has it.
- **Saved-deal flag** — post-call one-question prompt to the closer: "Did the copilot save a deal you were losing? y/n + which line." Log it. These become testimonials.
- **Before/after close rate** — record each call's outcome (`closed / lost / follow-up`) + which product. Week-1 close-rate-with vs the closer's stated baseline = the single most powerful YC number.
- **Rate-of-change** — daily counts of active closers + calls run. Store per-day; the slope is the pitch.

Log to Supabase; a `/metrics` page renders the founding-cohort dashboard for the application.

---

## 6. Ordered task list (the 5-day build)

1. **Add `@anthropic-ai/sdk`; swap whisper `gpt-4o-mini` → Haiku 4.5 streaming.** Wire `.env` model keys. (Day 1)
2. **Rebuild the whisper system prompt** around the layered context above; prompt-cache the stable prefix. (Day 1)
3. **Build `/onboard`** → writes `closer.json` + one `products/<slug>.json` (Form 1+2). (Day 2)
4. **Multi-product picker + `product_slug` on deals.** (Day 2)
5. **PREP_MODEL battle plan** (Opus 4.8) before each call from Client Brain; **ANALYSIS_MODEL** (Sonnet 5) structured post-call Brain update. (Day 3)
6. **Metrics instrumentation** — line-acceptance tap, saved-deal prompt, outcome logging, `/metrics` dashboard. (Day 4)
7. **Onboard the first real closer live, watch, fix.** (Day 4–5)

---

## Decisions locked (2026-07-15)
- Live = Haiku 4.5; prep = Opus 4.8; post-call = Sonnet 5. STT = Deepgram nova-3 (unchanged). ✅
- Whisper switches from OpenAI gpt-4o-mini to Claude. ✅
- Intake = 3-object model (closer / product / Client Brain), detailed form. ✅
- Metrics instrumented from day one — they ARE the YC application. ✅
