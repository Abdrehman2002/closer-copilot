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
- `product.md` — what you're selling. **Fill in the TODOs** — sharper input = sharper lines.
- `.env` — API keys and models (`LIVE_MODEL` = live whisper, `ANALYSIS_MODEL` = post-call, coming next).

## Roadmap (build order)

- [x] Live two-speaker transcript (mic + tab audio → Deepgram nova-3)
- [x] Whisper loop with playbook (gpt-4o-mini, one-line cards)
- [ ] Post-call deal-state extraction → Supabase
- [ ] Pre-call "where we left off" brief
- [ ] Deal memory fed into live prompts (the wedge)
