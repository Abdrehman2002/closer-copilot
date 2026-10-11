// Meeting notetaker — the Fireflies-style half of Closer Copilot.
//
// Schedule a meeting (paste the Meet/Zoom/Teams link), the copilot writes a pre-call
// prep brief from the Client Brain, then either:
//   * a recorder bot joins the call for you (needs a provider — see BOT PROVIDER below), or
//   * you run it yourself with the existing tab-share Live Call flow,
// and afterwards it produces a summary + action items from the transcript.
//
// BOT PROVIDER. Actually joining a Google Meet / Zoom / Teams call means driving a real
// meeting client. Nobody does that from a plain Node server — Fireflies, Otter, Fathom and
// Gong all run fleets of headless browser workers, and the practical way to buy that is a
// meeting-bot API (Recall.ai is the common one). So this module talks to a provider through
// a small adapter:
//   RECALL_API_KEY set  -> real bot joins, records and transcribes
//   not set             -> 'manual' mode: everything works except the bot; you join and
//                          share the tab as usual, and notes/summary still get generated.
// Nothing here silently pretends a bot joined when it didn't — status shows which mode ran.
'use strict';

const crypto = require('node:crypto');

const RECALL_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;
// self-hosted bot-worker.js — free, Google Meet only, no third party involved
const WORKER_URL = (process.env.BOT_WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.BOT_SHARED_SECRET || '';

// Where a recording actually lives once uploaded. A share page shows a player ONLY when
// both a ready recording row and this base exist - otherwise it says the recording is not
// available, because a <video> pointing at a storage key is a broken player, not a feature.
const MEDIA_BASE = (process.env.RECORDING_PUBLIC_BASE || process.env.R2_PUBLIC_BASE || '').replace(/\/$/, '');
// Absolute origin for the links we hand out. Railway sets neither, so it falls back to a
// relative path, which still works when the recipient opens it in a browser.
const APP_ORIGIN = (process.env.APP_ORIGIN || process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
const SHARE_TTL_DAYS = Number(process.env.SHARE_TTL_DAYS || 0);   // 0 = no expiry

const platformOf = (url = '') => {
  const u = url.toLowerCase();
  if (u.includes('meet.google.')) return 'meet';
  if (u.includes('zoom.')) return 'zoom';
  if (u.includes('teams.microsoft.') || u.includes('teams.live.')) return 'teams';
  return 'other';
};

// ------------------------------------------------------------------ pure helpers
// Hung off module.exports below so the suite can reach them without constructing the
// factory (which would need a ctx full of live Supabase and OpenAI handles). Everything
// in this block is a pure function: same input, same output, no clock, no network.

// Meet links only. The self-hosted worker refuses anything else (see bot-worker.js), so a
// Zoom or Teams invite is not something we can join and must not become an auto_join row.
const MEET_RE = /https:\/\/meet\.google\.com\/[a-z0-9-]{3,}(?:\?[^\s"'<>]*)?/i;

function meetLinkFrom(event = {}) {
  const direct = String(event.hangoutLink || '').match(MEET_RE);
  if (direct) return direct[0];

  const eps = event.conferenceData && event.conferenceData.entryPoints;
  if (Array.isArray(eps)) {
    for (const ep of eps) {
      if (!ep || ep.entryPointType !== 'video') continue;
      const m = String(ep.uri || '').match(MEET_RE);
      if (m) return m[0];
    }
  }

  // Plenty of invites paste the link into the body or the location field instead.
  for (const field of [event.location, event.description]) {
    const m = String(field || '').match(MEET_RE);
    if (m) return m[0];
  }
  return '';
}

// Google Calendar event -> a row for `meetings`. Returns null for anything we should not
// join, which is the common case: declined, all-day, no video link, not a Meet link.
function calendarEventToMeeting(event, opts = {}) {
  if (!event || typeof event !== 'object') return null;
  if (event.status === 'cancelled') return null;

  const url = meetLinkFrom(event);
  if (!url) return null;

  // All-day events carry start.date, never start.dateTime. There is no moment to join.
  const startMs = Date.parse(String((event.start && event.start.dateTime) || ''));
  if (!Number.isFinite(startMs)) return null;

  const endMs = Date.parse(String((event.end && event.end.dateTime) || ''));
  const duration = Number.isFinite(endMs) && endMs > startMs
    ? Math.round((endMs - startMs) / 60000)
    : 30;

  const emails = [];
  for (const a of (Array.isArray(event.attendees) ? event.attendees : [])) {
    if (!a || a.resource) continue;              // a booked room is not an attendee
    const e = String(a.email || '').trim().toLowerCase();
    if (e && !emails.includes(e)) emails.push(e);
  }

  return {
    user_id: opts.userId || null,
    calendar_account_id: opts.calendarAccountId || null,
    calendar_event_id: String(event.id || '') || null,
    title: String(event.summary || '').trim() || 'Untitled meeting',
    meeting_url: url,
    platform: platformOf(url),
    starts_at: new Date(startMs).toISOString(),
    duration_min: duration,
    attendees_emails: emails,
    organizer_email: String((event.organizer && event.organizer.email) || '').trim().toLowerCase() || null,
    auto_join: true,
    status: 'scheduled',
  };
}

// 128 bits, url-safe, 22 characters. Unguessable is the only thing protecting a share link.
function newShareToken() {
  return crypto.randomBytes(16).toString('base64url');
}

// 'none' | 'active' | 'expired'. A null share_token IS the revoked state — see the DELETE
// handler — so absence and expiry are deliberately two different answers.
function shareState(meeting = {}, now = Date.now()) {
  if (!meeting || !meeting.share_token) return 'none';
  const exp = Date.parse(String(meeting.share_expires_at || ''));
  if (Number.isFinite(exp) && exp <= now) return 'expired';
  return 'active';
}

// recordings.status lifecycle. Both ends are terminal: a finished upload never re-opens,
// and a failure is kept rather than retried in place, so the row stays an honest record.
const RECORDING_STATES = Object.freeze(['pending', 'uploading', 'ready', 'failed']);
const RECORDING_NEXT = Object.freeze({
  pending: ['uploading', 'failed'],
  uploading: ['ready', 'failed'],
  ready: [],
  failed: [],
});

function canRecordingTransition(from, to) {
  if (!RECORDING_STATES.includes(to)) return false;
  if (from === null || from === undefined || from === '') return to === 'pending';
  if (!RECORDING_STATES.includes(from)) return false;
  // A repeated write of the same status is a caller bug, not progress. Check before writing.
  if (from === to) return false;
  return RECORDING_NEXT[from].includes(to);
}

module.exports = function createMeetings(ctx) {
  const { sbRest, sbAdmin, hasServiceKey, chatOnce, sendJson, readBody, logActivity, ANALYSIS_MODEL, PREP_MODEL, anonKey } = ctx;

  // One accessor for both paths: a request carries a user jwt; the background loop has none
  // and runs as the service role. Explicit, so a handler can never fall into service access.
  const db = (jwt, path, opts) => (jwt ? sbRest(path, jwt, opts) : sbAdmin(path, opts));

  // self-hosted worker wins if configured — it's free; Recall is the managed fallback
  const botMode = () => (WORKER_URL ? 'self' : RECALL_KEY ? 'recall' : 'manual');

  async function recall(path, opts = {}) {
    const r = await fetch(RECALL_BASE + path, {
      method: opts.method || 'GET',
      headers: { Authorization: 'Token ' + RECALL_KEY, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const t = await r.text();
    if (!r.ok) throw new Error('recall ' + r.status + ': ' + t.slice(0, 300));
    return t ? JSON.parse(t) : null;
  }

  async function worker(path, opts = {}) {
    const r = await fetch(WORKER_URL + path, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(WORKER_SECRET ? { 'x-bot-secret': WORKER_SECRET } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const t = await r.text();
    if (!r.ok) {
      let m = t.slice(0, 300);
      try { m = JSON.parse(t).error || m; } catch { /* keep raw */ }
      throw new Error(m);
    }
    return t ? JSON.parse(t) : null;
  }

  // ---- pre-call prep, written from the Client Brain before the meeting starts ----
  async function buildPrep(jwt, userId, meeting) {
    if (!meeting.deal_id) return '';
    const deal = (await sbRest(`deals?id=eq.${meeting.deal_id}&select=name,company,memory_md`, jwt))[0];
    if (!deal) return '';
    const brain = String(deal.memory_md || '').trim();
    if (!brain) {
      return `First meeting with ${deal.name}${deal.company ? ' (' + deal.company + ')' : ''} — no history yet. Get their situation, pain and decision process on record.`;
    }
    const out = await chatOnce({
      model: PREP_MODEL, temperature: 0.3, max_tokens: 600,
      messages: [
        { role: 'system', content: 'You brief a salesperson in the two minutes before a call. Given their accumulated notes on this client, output a tight prep sheet: where things stand, the open objections, what to ask, and the one outcome to drive for. Short bullets, no preamble, no headings beyond a couple of bold labels.' },
        { role: 'user', content: `MEETING: ${meeting.title || 'call'}\nCLIENT: ${deal.name}${deal.company ? ' — ' + deal.company : ''}\n\nCLIENT BRAIN:\n${brain}` },
      ],
    }, { jwt, userId, dealId: meeting.deal_id, kind: 'meeting_prep' });
    return out;
  }

  // ---- post-meeting notes: summary + action items from whatever transcript we have ----
  async function summarise(jwt, userId, meeting) {
    const turns = Array.isArray(meeting.transcript) ? meeting.transcript : [];
    if (!turns.length) return { summary: '', action_items: [] };
    const text = turns.map(t => `${t.speaker || (t.ch === 'me' ? 'Me' : 'Them')}: ${t.text}`).join('\n').slice(0, 40000);
    const raw = await chatOnce({
      model: ANALYSIS_MODEL, temperature: 0.2, max_tokens: 900,
      messages: [
        { role: 'system', content: `You write meeting notes a salesperson actually reads. Return ONLY JSON, no prose or fences:
{"summary":"<6-10 sentence recap: what was discussed, what they said they need, objections, where it landed>",
 "action_items":[{"who":"me|them","what":"<specific commitment>","due":"<when, or empty>"}],
 "decisions":["<anything explicitly agreed>"],
 "risks":["<what could kill this deal>"]}` },
        { role: 'user', content: `MEETING: ${meeting.title || 'call'}\n\nTRANSCRIPT:\n${text}` },
      ],
    }, { jwt, userId, dealId: meeting.deal_id, kind: 'meeting_notes' });
    try {
      const j = JSON.parse(String(raw).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim());
      return { summary: j.summary || '', action_items: j.action_items || [], decisions: j.decisions || [], risks: j.risks || [] };
    } catch {
      return { summary: String(raw).slice(0, 4000), action_items: [] };
    }
  }

  // ---- bot lifecycle ----
  async function dispatchBot(jwt, meeting) {
    const mode = botMode();
    if (mode === 'manual') {
      throw new Error('No meeting-bot provider configured — set BOT_WORKER_URL (self-hosted, free) or RECALL_API_KEY.');
    }
    if (!meeting.meeting_url) throw new Error('this meeting has no link to join');

    let botId;
    if (mode === 'self') {
      const bot = await worker('/bot', {
        method: 'POST',
        body: { meeting_url: meeting.meeting_url, bot_name: process.env.BOT_NAME || 'Closer Copilot Notetaker' },
      });
      botId = bot.id;
    } else {
      const bot = await recall('/bot/', {
        method: 'POST',
        body: {
          meeting_url: meeting.meeting_url,
          bot_name: process.env.BOT_NAME || 'Closer Copilot Notetaker',
          transcription_options: { provider: 'meeting_captions' },
        },
      });
      botId = bot.id;
    }

    await db(jwt, `meetings?id=eq.${meeting.id}`, {
      method: 'PATCH', prefer: 'return=minimal',
      body: { bot_id: botId, bot_provider: mode, status: 'joining', error: '' },
    });
    return botId;
  }

  // pull the bot's state + transcript; when the call is over, write the notes
  async function syncBot(jwt, userId, meeting) {
    if (!meeting.bot_id) return meeting;

    // ---- self-hosted worker ----
    if (meeting.bot_provider === 'self') {
      const bot = await worker(`/bot/${meeting.bot_id}`);
      const patch = { status: bot.status === 'failed' ? 'failed' : bot.status === 'done' ? 'processing' : bot.status };
      if (bot.error) patch.error = bot.error;
      const turns = (bot.transcript || []).map((l) => ({ speaker: l.speaker, text: l.text }));
      if (turns.length) patch.transcript = turns;
      if (bot.status === 'done' && turns.length) {
        const notes = await summarise(jwt, userId, { ...meeting, transcript: turns });
        patch.summary = notes.summary;
        patch.action_items = notes.action_items;
        patch.status = 'done';
      } else if (bot.status === 'done') {
        patch.status = 'done';
        if (!turns.length) patch.error = 'the bot joined but captured no captions — were captions available in that call?';
      }
      await db(jwt, `meetings?id=eq.${meeting.id}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
      return { ...meeting, ...patch };
    }

    if (meeting.bot_provider !== 'recall') return meeting;
    const bot = await recall(`/bot/${meeting.bot_id}/`);
    const code = (bot.status_changes || []).slice(-1)[0]?.code || '';
    const map = { joining_call: 'joining', in_waiting_room: 'joining', in_call_not_recording: 'joining', in_call_recording: 'recording', call_ended: 'processing', done: 'processing', fatal: 'failed' };
    const status = map[code] || meeting.status;
    const patch = { status };

    if (status === 'processing' || code === 'done' || code === 'call_ended') {
      let turns = [];
      try {
        const tr = await recall(`/bot/${meeting.bot_id}/transcript/`);
        turns = (tr || []).flatMap((seg) =>
          (seg.words ? [{ speaker: seg.speaker || 'Speaker', text: seg.words.map((w) => w.text).join(' ') }] : []));
      } catch { /* transcript may not be ready yet */ }
      if (turns.length) {
        patch.transcript = turns;
        const notes = await summarise(jwt, userId, { ...meeting, transcript: turns });
        patch.summary = notes.summary;
        patch.action_items = notes.action_items;
        patch.status = 'done';
      }
    }
    if (code === 'fatal') patch.error = 'bot failed to join';

    await db(jwt, `meetings?id=eq.${meeting.id}`, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    return { ...meeting, ...patch };
  }

  // ---- sharing: one page a stranger can open, no account ----
  //
  // The guest read does NOT go through sbRest-with-a-user-jwt (there is no user) and does
  // NOT go through sbAdmin (a request handler must never hold the service role). It calls
  // the share_view SQL function with the ANON key; that function is `security definer`,
  // enforces expiry in SQL and returns only guest-safe fields. Widening what a guest sees
  // means editing the migration, not this file.
  async function shareRead(token) {
    const out = await sbRest('rpc/share_view', anonKey, { method: 'POST', body: { tok: token } });
    return out || null;
  }

  function shareLink(token) { return (APP_ORIGIN || '') + '/s/' + token; }

  // A storage key becomes a URL only if a public base is configured. Returns '' otherwise,
  // and the page renders an honest "not available" instead of a dead player.
  function mediaUrl(rec) {
    if (!rec || !rec.key) return '';
    if (/^https?:\/\//i.test(rec.key)) return rec.key;
    if (!MEDIA_BASE) return '';
    return MEDIA_BASE + '/' + String(rec.key).replace(/^\/+/, '');
  }

  // Public, unauthenticated. Mounted ahead of the auth gate in server.js.
  async function handlePublic(req, res, urlPath) {
    if (!urlPath.startsWith('/api/share/')) return false;
    if (req.method !== 'GET') { sendJson(res, { error: 'not found' }, 404); return true; }
    // Own every /api/share/ path, valid token or not. Falling through to the auth gate
    // would answer a truncated link - a normal copy-paste accident - with "not signed
    // in", which sends a guest looking for a login that does not exist.
    const m = urlPath.slice('/api/share/'.length).match(/^[A-Za-z0-9_-]{16,64}$/);
    if (!m) { sendJson(res, { error: 'This link is no longer available.' }, 404); return true; }
    try {
      const data = await shareRead(m[0]);
      if (!data) {
        // One answer for "never existed", "revoked" and "expired". A guest learns nothing
        // about which, so the link cannot be used to probe for valid tokens.
        sendJson(res, { error: 'This link is no longer available.' }, 404);
        return true;
      }
      // Build the response field by field rather than spreading `data`. share_view
      // already redacts in SQL, so this is the second lock on the same door: if that
      // function is ever widened, or another caller is wired up, a spread would carry
      // `prep` and everyone's email addresses out to a stranger and nothing here would
      // notice. An allowlist fails closed instead.
      const rec = data.recording || null;
      sendJson(res, {
        title: data.title || '',
        platform: data.platform || '',
        starts_at: data.starts_at || null,
        duration_min: data.duration_min || null,
        status: data.status || '',
        summary: data.summary || '',
        action_items: Array.isArray(data.action_items) ? data.action_items : [],
        transcript: Array.isArray(data.transcript) ? data.transcript : [],
        recording: rec ? {
          url: mediaUrl(rec),
          mime: rec.mime || '',
          duration_sec: rec.duration_sec || null,
          bytes: rec.bytes || null,
        } : null,
      });
    } catch (e) {
      console.error('[share]', e.message);
      sendJson(res, { error: 'This link is no longer available.' }, 404);
    }
    return true;
  }

  // ---- router ----
  async function handle(req, res, urlPath, user, jwt, seg) {
    if (!urlPath.startsWith('/api/meetings')) return false;

    // list
    if (urlPath === '/api/meetings' && req.method === 'GET') {
      const rows = await sbRest('meetings?select=*,deals(name,company)&order=starts_at.desc.nullslast&limit=100', jwt);
      sendJson(res, { meetings: rows, botMode: botMode() });
      return true;
    }

    // create
    if (urlPath === '/api/meetings' && req.method === 'POST') {
      const b = await readBody(req);
      if (!b.title && !b.meeting_url) { sendJson(res, { error: 'title or meeting link required' }, 400); return true; }
      const row = (await sbRest('meetings', jwt, {
        method: 'POST',
        body: {
          user_id: user.id, deal_id: b.dealId || null, product_id: b.productId || null,
          title: b.title || 'Untitled meeting', meeting_url: b.meeting_url || '',
          platform: platformOf(b.meeting_url || ''), goal: b.goal || null,
          starts_at: b.starts_at || null, duration_min: b.duration_min || 30,
          auto_join: !!b.auto_join && botMode() !== 'manual',
        },
      }))[0];
      logActivity(jwt, { category: 'call', action: 'meeting_scheduled', user_id: user.id, target: row.id, detail: { platform: row.platform } });
      // generate the prep brief in the background — never block the create
      buildPrep(jwt, user.id, row)
        .then((prep) => prep && sbRest(`meetings?id=eq.${row.id}`, jwt, { method: 'PATCH', prefer: 'return=minimal', body: { prep } }))
        .catch(() => {});
      sendJson(res, { ok: true, meeting: row });
      return true;
    }

    const id = seg[2];
    if (!id) { sendJson(res, { error: 'not found' }, 404); return true; }
    const meeting = (await sbRest(`meetings?id=eq.${id}&select=*`, jwt))[0];
    if (!meeting) { sendJson(res, { error: 'not found' }, 404); return true; }

    if (req.method === 'GET' && !seg[3]) { sendJson(res, { meeting, botMode: botMode() }); return true; }

    if (req.method === 'PATCH' && !seg[3]) {
      const b = await readBody(req);
      const patch = {};
      for (const k of ['title', 'meeting_url', 'starts_at', 'duration_min', 'auto_join', 'status', 'deal_id', 'product_id', 'goal']) if (k in b) patch[k] = b[k];
      if (patch.meeting_url) patch.platform = platformOf(patch.meeting_url);
      const row = (await sbRest(`meetings?id=eq.${id}`, jwt, { method: 'PATCH', body: patch }))[0];
      sendJson(res, { ok: true, meeting: row });
      return true;
    }

    if (req.method === 'DELETE' && !seg[3]) {
      await sbRest(`meetings?id=eq.${id}`, jwt, { method: 'DELETE', prefer: 'return=minimal' });
      sendJson(res, { ok: true });
      return true;
    }

    // regenerate the prep brief on demand
    if (seg[3] === 'prep' && req.method === 'POST') {
      const prep = await buildPrep(jwt, user.id, meeting);
      await sbRest(`meetings?id=eq.${id}`, jwt, { method: 'PATCH', prefer: 'return=minimal', body: { prep } });
      sendJson(res, { ok: true, prep });
      return true;
    }

    // send the bot in now
    if (seg[3] === 'join' && req.method === 'POST') {
      try {
        const botId = await dispatchBot(jwt, meeting);
        logActivity(jwt, { category: 'call', action: 'bot_dispatched', user_id: user.id, target: id });
        sendJson(res, { ok: true, botId });
      } catch (e) { sendJson(res, { error: e.message }, 400); }
      return true;
    }

    // poll the bot / finish up
    if (seg[3] === 'sync' && req.method === 'POST') {
      try { sendJson(res, { ok: true, meeting: await syncBot(jwt, user.id, meeting) }); }
      catch (e) { sendJson(res, { error: e.message }, 400); }
      return true;
    }

    // attach a transcript captured by the normal Live Call flow, then write the notes.
    // This is what makes the notetaker useful without any bot provider at all.
    if (seg[3] === 'notes' && req.method === 'POST') {
      const b = await readBody(req);
      const turns = Array.isArray(b.transcript) && b.transcript.length ? b.transcript : meeting.transcript;
      const notes = await summarise(jwt, user.id, { ...meeting, transcript: turns });
      await sbRest(`meetings?id=eq.${id}`, jwt, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { transcript: turns, summary: notes.summary, action_items: notes.action_items, status: 'done' },
      });
      logActivity(jwt, { category: 'call', action: 'meeting_notes_generated', user_id: user.id, target: id });
      sendJson(res, { ok: true, ...notes });
      return true;
    }

    // create or rotate the share link. Rotating is how you cut off someone who already
    // has the old URL, so this always mints a fresh token rather than returning the old one.
    if (seg[3] === 'share' && req.method === 'POST') {
      const token = newShareToken();
      const expires = SHARE_TTL_DAYS > 0
        ? new Date(Date.now() + SHARE_TTL_DAYS * 86400000).toISOString()
        : null;
      await sbRest(`meetings?id=eq.${id}`, jwt, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { share_token: token, share_expires_at: expires, share_views: 0 },
      });
      logActivity(jwt, { category: 'call', action: 'meeting_shared', user_id: user.id, target: id });
      sendJson(res, { ok: true, token, url: shareLink(token), expires_at: expires, state: 'active' });
      return true;
    }

    // revoke. Nulling the token is what makes shareState() read 'none' rather than
    // 'expired' - the link stops existing instead of looking merely stale.
    if (seg[3] === 'share' && req.method === 'DELETE') {
      await sbRest(`meetings?id=eq.${id}`, jwt, {
        method: 'PATCH', prefer: 'return=minimal',
        body: { share_token: null, share_expires_at: null },
      });
      logActivity(jwt, { category: 'call', action: 'meeting_share_revoked', user_id: user.id, target: id });
      sendJson(res, { ok: true, state: 'none' });
      return true;
    }

    // what the owner sees next to the Share button
    if (seg[3] === 'share' && req.method === 'GET') {
      const state = shareState(meeting);
      sendJson(res, {
        state,
        url: state === 'active' ? shareLink(meeting.share_token) : '',
        expires_at: meeting.share_expires_at || null,
        views: meeting.share_views || 0,
      });
      return true;
    }

    sendJson(res, { error: 'not found' }, 404);
    return true;
  }

  // Background loop: dispatch bots for meetings that are due, and poll running ones.
  //
  // With a service key this runs across ALL users from one query and survives restarts.
  // Without one it can only act for users who have made a request recently, because the
  // only credential available is a cached user JWT that expires in about an hour - which
  // meant auto-join silently did nothing after any redeploy.
  const seen = new Map();   // userId -> jwt, the no-service-key fallback only
  function remember(userId, jwt) { seen.set(userId, jwt); }

  const DUE = (soon) => `meetings?select=*&auto_join=is.true&status=eq.scheduled` +
    `&starts_at=lte.${soon}&meeting_url=neq.`;
  const RUNNING = 'meetings?select=*&status=in.(joining,recording,processing)';

  async function tick() {
    if (botMode() === 'manual') return;
    const soon = new Date(Date.now() + 2 * 60000).toISOString();

    if (hasServiceKey) {
      try {
        const due = await sbAdmin(DUE(soon));
        for (const m of due) { try { await dispatchBot(null, m); } catch (e) { console.error('[meet dispatch]', e.message); } }
        const running = await sbAdmin(RUNNING);
        for (const m of running) { try { await syncBot(null, m.user_id, m); } catch (e) { console.error('[meet sync]', e.message); } }
      } catch (e) { console.error('[meet tick]', e.message); }
      return;
    }

    if (seen.size === 0) return;
    for (const [userId, jwt] of seen) {
      try {
        const due = await sbRest(DUE(soon), jwt);
        for (const m of due) { try { await dispatchBot(jwt, m); } catch { /* keep going */ } }
        const running = await sbRest(RUNNING, jwt);
        for (const m of running) { try { await syncBot(jwt, userId, m); } catch { /* keep going */ } }
      } catch { /* token expired - refreshes on their next request */ }
    }
  }
  setInterval(tick, 30000).unref?.();

  return { handle, handlePublic, remember, botMode, platformOf };
};

// Pure helpers, reachable without building the factory. Tested in tests/meetings.test.js.
module.exports.platformOf = platformOf;
module.exports.meetLinkFrom = meetLinkFrom;
module.exports.calendarEventToMeeting = calendarEventToMeeting;
module.exports.newShareToken = newShareToken;
module.exports.shareState = shareState;
module.exports.canRecordingTransition = canRecordingTransition;
module.exports.RECORDING_STATES = RECORDING_STATES;
