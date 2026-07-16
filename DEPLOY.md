# Deploying Closer Copilot (for pilots)

The backend is one Node server (`server.js`) that ALSO serves the built React
frontend from `public/` — one process, one URL. Any Node host with WebSocket +
HTTPS support works (needed for mic/tab-audio capture, which requires HTTPS).
Not Vercel — it can't hold the live call's WebSocket connection open. Easiest:
**Render** or **Railway** (Starter tier ~$7/mo so it doesn't sleep between calls),
or your own VPS with Node 20+.

## Steps (Render)

1. Repo is on GitHub: `Abdrehman2002/closer-copilot` (public — `.env` is
   gitignored and was scanned clean before making it public; never commit it).
2. render.com → New → Web Service → connect the repo.
3. Settings: Runtime **Node**.
   - Build command: `npm install && cd client && npm install && npm run build`
   - Start command: `node server.js`
4. Environment variables (Render dashboard → Environment):
   - `DEEPGRAM_API_KEY` — **rotate first** at console.deepgram.com
   - `OPENAI_API_KEY` — **rotate first** at platform.openai.com
   - `SUPABASE_URL` = https://ceyoflkazsnwzltdeefx.supabase.co
   - `SUPABASE_KEY` = (the sb_publishable_… key)
   - `LIVE_MODEL` = gpt-4.1-mini
   - `PREP_MODEL` = gpt-4.1
   - `ANALYSIS_MODEL` = gpt-4.1-mini
   - `HOST` = 0.0.0.0   ← required or Render's health check can't reach it. Do NOT set `PORT` (Render provides it).
5. Deploy → you get `https://closer-copilot.onrender.com`. Give that URL to pilots.
6. On the VPS instead: `git clone` the repo, add `.env` by hand (the one file
   not in git), run the same build command, then `node server.js` behind a
   reverse proxy (Caddy/nginx) that terminates HTTPS.

## Steps (Railway) — this is what we're actually hosting on

1. Repo is on GitHub: `Abdrehman2002/closer-copilot` (public).
2. railway.app → New Project → Deploy from GitHub repo → pick this repo.
3. Railway auto-detects Node; override the build/start commands under
   Settings → Deploy (same as Render):
   - Build command: `npm install && cd client && npm install && npm run build`
   - Start command: `node server.js`
4. Settings → Networking → **Generate Domain** (this gives you the public
   `https://….up.railway.app` URL and terminates HTTPS automatically — same
   requirement as Render, mic/tab-audio capture needs HTTPS).
5. Variables tab — same list as the Render env vars above:
   `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_KEY`,
   `LIVE_MODEL=gpt-4.1-mini`, `PREP_MODEL=gpt-4.1`, `ANALYSIS_MODEL=gpt-4.1-mini`,
   `HOST=0.0.0.0`. Do **not** set `PORT` — Railway injects it, same as Render.
6. Deploy. Railway keeps the service always-on by default (no free-tier sleep
   like Render's free tier), which matters here — a closer opening the app
   right before a call shouldn't hit a cold-start delay.

## Supabase settings for pilots (dashboard, one time)

- Auth → Providers → Email: if the "confirm email" step annoys pilots, either
  disable **Confirm email**, or (better) configure custom SMTP (Auth → SMTP settings)
  because the built-in email service is rate-limited to a few emails per hour.

## Pilot onboarding (send them this)

1. Open the app URL in **Chrome**, create an account. The setup wizard walks through:
   your name, how you sell (tone/framework/phrases — editable later in Settings),
   your first playbook (a short interview about what you sell), and your first client.
2. From the dashboard, **New Call** → pick the playbook + client → **Start Call** →
   allow mic → pick the **Meet tab** and tick **"Also share tab audio"** → click
   **Overlay** and drag it under your camera.
3. Say at the start of the call: "I use an AI assistant that transcribes our call —
   that okay?" (recording-consent hygiene).
4. **End Call** when done → the quick wrap-up (outcome + amount/reason + did it save a
   deal) → the Client Brain and a private AI review of your own delivery both save
   automatically; next call with the same client starts with a pre-call brief + battle plan.
5. Check **Metrics** anytime for your own line-acceptance rate, close rate, revenue
   won, and saved-deal count. Check **Billing** for real token/cost spend. Add
   reference docs (pricing sheets, competitor comparisons) under **Knowledge** —
   the coach pulls from them live when relevant.

## Notes

- Test account exists: pilot-test@example.com / Test1234! (delete before real launch:
  Supabase dashboard → Authentication → Users).
- Local dev still works: `node server.js` → http://localhost:7801.
