# Closer Copilot

Live AI sales whisper + deal memory for a solo closer on Google Meet.

## Run it

```
cd "C:\Users\Thinkbook 16 G6\Desktop\closer-copilot"
node server.js
```

Then open **http://localhost:7801** in Chrome.

## Use it on a call

1. Join your Google Meet in one Chrome tab.
2. Open http://localhost:7801 in another window, click **Start Call**.
3. Allow the microphone, then in the share picker choose the **Meet tab**
   (the "Chrome Tab" option, not a window/screen) and tick **"Also share tab audio"**.
4. Left panel = coached lines (`[TONE]` first, `‖` = pause, `↘/↗` = pitch, bold = stress).
   Right panel = live two-speaker transcript. Transcripts save to `calls/`.

## Test without a real call

Play any YouTube sales-call recording in a tab and share THAT tab as the
"prospect" — talk back to it yourself.

## Files that shape the coaching

- `playbook.md` — sales-psychology rules (moment → technique map). Edit in plain English.
- Per-user products/playbooks live in Supabase, built via the in-app Interview (Playbooks → + Add playbook) — no local `product.md` anymore.
- `.env` — API keys and models: `LIVE_MODEL` (live whisper), `PREP_MODEL` (pre-call battle plan), `ANALYSIS_MODEL` (post-call Client Brain extraction).

## Roadmap (build order)

- [x] Live two-speaker transcript (mic + tab audio → Deepgram nova-3)
- [x] Whisper loop with playbook (one-line cards, delivery marks)
- [x] Post-call Client Brain extraction (Markdown) → Supabase
- [x] Pre-call "where we left off" brief + PREP_MODEL battle plan
- [x] Deal memory fed into live prompts (the wedge)
- [x] React UI (dashboard = ranked "next moves", Client Brain, Metrics, Settings)
- [x] Metrics instrumentation (line-acceptance, saved-deal, close rate)
- [ ] Usage/margin tracking per user; billing; polish for paid launch

**Demo note:** the Supabase project auto-pauses after ~7 days idle (free tier).
If login hangs, un-pause it in the Supabase dashboard (Restore) before demoing.
Use the **Test** button (`/simulate`) to rehearse coaching without a live call.
