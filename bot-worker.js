// Self-hosted meeting notetaker bot — a small HTTP service that joins a Google Meet
// call, turns on live captions, and streams back a speaker-attributed transcript.
//
// WHY CAPTIONS AND NOT AUDIO
// The obvious design is "join, capture the audio, send it to Deepgram". In a headless
// container that means a virtual sound card (pulseaudio), a virtual display (xvfb) and a
// WebRTC audio tap — a lot of moving parts that break often. Google Meet already runs
// speech-to-text for its own captions and labels every line with the speaker. Scraping that
// is dramatically more reliable, costs nothing per minute, and gives us speaker names for
// free. It's the same mode Recall.ai calls `meeting_captions`.
//
// TRADE-OFFS, PLAINLY
//   * Google Meet only for now (Zoom/Teams web have captions too — see joinZoom stub).
//   * Caption text is Google's transcription, not Deepgram's. Good, not perfect.
//   * The bot appears in the participant list under BOT_NAME. It is visible, never covert.
//     Most hosts must admit it from the waiting room.
//   * Meet's DOM changes occasionally; the selectors below are defensive but will need
//     occasional maintenance. That is the cost of self-hosting instead of paying a vendor.
//
// RUN IT
//   npm i playwright && npx playwright install chromium
//   node bot-worker.js                      # listens on :7802
// then point the app at it:  BOT_WORKER_URL=http://localhost:7802
//
// API (deliberately shaped like Recall.ai so meetings.js can talk to either)
//   POST   /bot            {meeting_url, bot_name}  -> {id, status}
//   GET    /bot/:id                                 -> {id, status, transcript[], error}
//   DELETE /bot/:id                                 -> bot leaves the call
//   GET    /health
'use strict';

const http = require('http');

// Railway (and most PaaS) assign the listen port via $PORT and route to whatever's
// bound on 0.0.0.0 — BOT_PORT/BOT_HOST stay as an override for local dev.
const PORT = Number(process.env.PORT || process.env.BOT_PORT || 7802);
const HOST = process.env.BOT_HOST || '0.0.0.0';
const BOT_NAME = process.env.BOT_NAME || 'Closer Copilot Notetaker';
const HEADLESS = process.env.BOT_HEADLESS !== 'false';
const MAX_MIN = Number(process.env.BOT_MAX_MINUTES || 120);
const AUTH = process.env.BOT_SHARED_SECRET || '';

let chromium;
try { ({ chromium } = require('playwright')); }
catch { console.error('playwright is not installed — run:  npm i playwright && npx playwright install chromium'); }

const bots = new Map();   // id -> { id, status, transcript, error, browser, page, timer }
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

const json = (res, obj, code = 200) => {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
};
const body = (req) => new Promise((r) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => { try { r(JSON.parse(b || '{}')); } catch { r({}); } });
});

// ---------------------------------------------------------------- caption scraping
// Injected into the meeting page. Meet renders captions into a live region; each block
// carries the speaker's name and their current sentence, rewritten in place as they talk.
// We poll, keep the newest text per speaker, and emit a line once it stops changing.
const CAPTION_SCRAPER = `(() => {
  if (window.__ccScraper) return;
  window.__ccScraper = true;
  window.__ccLines = [];
  const pending = new Map();          // speaker -> { text, seen }
  const FLUSH_AFTER = 2;              // polls with no change before we commit a line

  const grab = () => {
    // Meet's caption region. Several selectors because the markup shifts between releases.
    const root =
      document.querySelector('[aria-live="polite"][role="region"]') ||
      document.querySelector('div[jsname="dsyhDe"]') ||
      document.querySelector('.a4cQT') ||
      document.querySelector('[data-self-name]')?.closest('[aria-live]');
    if (!root) return;

    // Each caption block: an image/name node followed by the spoken text.
    const blocks = root.querySelectorAll('div[class*="nMcdL"], div[jsname="tgaKEf"], .TBMuR, .iOzk7');
    const seen = new Set();
    blocks.forEach((b) => {
      const nameEl = b.querySelector('.zs7s8d, .KcIKyf, [class*="jxFHg"]') || b.previousElementSibling;
      const textEl = b.querySelector('[jsname="tgaKEf"], .iTTPOb, .bh44bd') || b;
      const speaker = (nameEl?.innerText || 'Speaker').trim().split('\\n')[0].slice(0, 60) || 'Speaker';
      const text = (textEl?.innerText || '').trim();
      if (!text) return;
      seen.add(speaker);
      const prev = pending.get(speaker);
      if (!prev || prev.text !== text) pending.set(speaker, { text, seen: 0 });
      else prev.seen++;
    });

    for (const [speaker, v] of [...pending]) {
      if (!seen.has(speaker) || v.seen >= FLUSH_AFTER) {
        if (v.text) window.__ccLines.push({ speaker, text: v.text, at: Date.now() });
        pending.delete(speaker);
      }
    }
  };
  setInterval(grab, 1000);
})()`;

// ---------------------------------------------------------------- joining
async function joinMeet(bot, url) {
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--use-fake-ui-for-media-stream',      // auto-accept the mic/cam prompt
      '--use-fake-device-for-media-stream',  // feed silence/black instead of real hardware
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox', '--disable-dev-shm-usage',
    ],
  });
  bot.browser = browser;

  const ctx = await browser.newContext({
    permissions: ['microphone', 'camera'],
    userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
  });
  const page = await ctx.newPage();
  bot.page = page;

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // type the bot's name if Meet asks (guest join)
  const nameBox = page.locator('input[placeholder*="name" i], input[aria-label*="name" i]').first();
  try { await nameBox.waitFor({ timeout: 8000 }); await nameBox.fill(BOT_NAME); } catch { /* signed-in or no prompt */ }

  // turn the camera and mic off before joining — the bot only listens
  for (const label of ['Turn off microphone', 'Turn off camera']) {
    try { await page.getByRole('button', { name: new RegExp(label, 'i') }).click({ timeout: 2500 }); } catch { /* already off */ }
  }

  // ask to join
  let joined = false;
  for (const label of ['Ask to join', 'Join now', 'Join meeting']) {
    try { await page.getByRole('button', { name: new RegExp(label, 'i') }).click({ timeout: 5000 }); joined = true; break; }
    catch { /* try the next label */ }
  }
  if (!joined) throw new Error('could not find a join button — the link may be invalid or Meet changed its UI');

  bot.status = 'joining';

  // wait to be admitted: the in-call toolbar (leave button) appearing is the signal
  try {
    await page.getByRole('button', { name: /leave call|end call/i }).waitFor({ timeout: 300000 });
  } catch {
    throw new Error('never admitted to the meeting (host did not let the bot in within 5 minutes)');
  }

  bot.status = 'recording';

  // switch captions on — this is the whole transcription pipeline
  try {
    await page.getByRole('button', { name: /captions|turn on captions/i }).click({ timeout: 8000 });
  } catch {
    try { await page.keyboard.press('c'); } catch { /* keyboard shortcut fallback */ }
  }

  await page.evaluate(CAPTION_SCRAPER);

  // pull new caption lines out of the page once a second
  bot.timer = setInterval(async () => {
    try {
      const lines = await page.evaluate('(() => { const l = window.__ccLines || []; window.__ccLines = []; return l; })()');
      if (lines && lines.length) bot.transcript.push(...lines);
      // has the call ended under us?
      const gone = await page.getByRole('button', { name: /leave call|end call/i }).count().catch(() => 0);
      if (!gone) await finish(bot, 'done');
    } catch { /* page navigated or closed */ }
  }, 1000);

  // hard stop so a forgotten bot can't sit in a room forever
  setTimeout(() => finish(bot, 'done').catch(() => {}), MAX_MIN * 60000);
}

async function finish(bot, status) {
  if (bot.status === 'done' || bot.status === 'failed') return;
  clearInterval(bot.timer);
  bot.status = status;
  try { await bot.page?.getByRole('button', { name: /leave call/i }).click({ timeout: 3000 }); } catch { /* ignore */ }
  try { await bot.browser?.close(); } catch { /* ignore */ }
  bot.browser = null; bot.page = null;
}

// ---------------------------------------------------------------- server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const seg = url.pathname.split('/').filter(Boolean);

  if (url.pathname === '/health') {
    return json(res, { ok: true, playwright: !!chromium, bots: bots.size, headless: HEADLESS, maxMinutes: MAX_MIN });
  }

  if (AUTH && req.headers['x-bot-secret'] !== AUTH) return json(res, { error: 'unauthorized' }, 401);
  if (!chromium) return json(res, { error: 'playwright not installed on the bot worker' }, 503);

  // POST /bot
  if (seg[0] === 'bot' && !seg[1] && req.method === 'POST') {
    const b = await body(req);
    if (!b.meeting_url) return json(res, { error: 'meeting_url required' }, 400);
    if (!/meet\.google\./i.test(b.meeting_url)) {
      return json(res, { error: 'this self-hosted worker currently supports Google Meet only — use Recall.ai for Zoom/Teams' }, 400);
    }
    const bot = { id: uid(), status: 'starting', transcript: [], error: '', createdAt: Date.now() };
    bots.set(bot.id, bot);
    joinMeet(bot, b.meeting_url).catch(async (e) => {
      bot.error = String(e.message || e).slice(0, 300);
      bot.status = 'failed';
      try { await bot.browser?.close(); } catch { /* ignore */ }
    });
    return json(res, { id: bot.id, status: bot.status });
  }

  // GET /bot/:id
  if (seg[0] === 'bot' && seg[1] && req.method === 'GET') {
    const bot = bots.get(seg[1]);
    if (!bot) return json(res, { error: 'not found' }, 404);
    return json(res, { id: bot.id, status: bot.status, error: bot.error, transcript: bot.transcript });
  }

  // DELETE /bot/:id
  if (seg[0] === 'bot' && seg[1] && req.method === 'DELETE') {
    const bot = bots.get(seg[1]);
    if (!bot) return json(res, { error: 'not found' }, 404);
    await finish(bot, 'done');
    return json(res, { ok: true, status: bot.status });
  }

  json(res, { error: 'not found' }, 404);
});

server.listen(PORT, HOST, () => {
  console.log(`meeting bot worker → http://${HOST}:${PORT}`);
  console.log(`playwright: ${chromium ? 'ready' : 'MISSING (npm i playwright && npx playwright install chromium)'}`);
  console.log(`bot name: ${BOT_NAME} · headless: ${HEADLESS} · max ${MAX_MIN} min`);
});
