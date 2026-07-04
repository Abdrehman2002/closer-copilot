# Deploying Closer Copilot (for pilots)

The app is one Node server (no build step). Any Node host with WebSocket + HTTPS
support works. Easiest: **Render** or **Railway** (~$5/mo, HTTPS automatic).

## Steps (Render)

1. Push this folder to a **private** GitHub repo (`.env` is gitignored — never commit it).
2. render.com → New → Web Service → connect the repo.
3. Settings: Runtime **Node**, Build command `npm install`, Start command `node server.js`.
4. Environment variables (Render dashboard → Environment):
   - `DEEPGRAM_API_KEY` — **rotate first** at console.deepgram.com
   - `OPENAI_API_KEY` — **rotate first** at platform.openai.com
   - `SUPABASE_URL` = https://ceyoflkazsnwzltdeefx.supabase.co
   - `SUPABASE_KEY` = (the sb_publishable_… key)
   - `LIVE_MODEL` = gpt-4o-mini
   - `ANALYSIS_MODEL` = gpt-4o
   - `HOST` = 0.0.0.0
5. Deploy → you get `https://closer-copilot.onrender.com`. Give that URL to pilots.

## Supabase settings for pilots (dashboard, one time)

- Auth → Providers → Email: if the "confirm email" step annoys pilots, either
  disable **Confirm email**, or (better) configure custom SMTP (Auth → SMTP settings)
  because the built-in email service is rate-limited to a few emails per hour.

## Pilot onboarding (send them this)

1. Open the app URL in **Chrome**, create an account.
2. Click **✎** next to the product dropdown and paste in what you sell:
   offer, pricing, common objections + your answers, proof points.
3. Before a call: **+ Client** → add who you're meeting.
4. Join the Meet, then in the app: **Start Call** → allow mic → pick the **Meet tab**
   and tick **"Also share tab audio"** → click **Overlay ⇱** and drag it under your camera.
5. Say at the start of the call: "I use an AI assistant that transcribes our call —
   that okay?" (recording-consent hygiene).
6. **End Call** when done — the deal memory saves automatically; next call with the
   same client starts with "Where we left off".

## Notes

- Test account exists: pilot-test@example.com / Test1234! (delete before real launch:
  Supabase dashboard → Authentication → Users).
- Local dev still works: `node server.js` → http://localhost:7801.
