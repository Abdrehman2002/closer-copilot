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

const RECALL_KEY = process.env.RECALL_API_KEY || '';
const RECALL_REGION = process.env.RECALL_REGION || 'us-west-2';
const RECALL_BASE = `https://${RECALL_REGION}.recall.ai/api/v1`;
// self-hosted bot-worker.js — free, Google Meet only, no third party involved
const WORKER_URL = (process.env.BOT_WORKER_URL || '').replace(/\/$/, '');
const WORKER_SECRET = process.env.BOT_SHARED_SECRET || '';

const platformOf = (url = '') => {
  const u = url.toLowerCase();
  if (u.includes('meet.google.')) return 'meet';
  if (u.includes('zoom.')) return 'zoom';
  if (u.includes('teams.microsoft.') || u.includes('teams.live.')) return 'teams';
  return 'other';
};

module.exports = function createMeetings(ctx) {
  const { sbRest, chatOnce, sendJson, readBody, logActivity, ANALYSIS_MODEL, PREP_MODEL } = ctx;

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

    await sbRest(`meetings?id=eq.${meeting.id}`, jwt, {
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
      await sbRest(`meetings?id=eq.${meeting.id}`, jwt, { method: 'PATCH', prefer: 'return=minimal', body: patch });
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

    await sbRest(`meetings?id=eq.${meeting.id}`, jwt, { method: 'PATCH', prefer: 'return=minimal', body: patch });
    return { ...meeting, ...patch };
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
          platform: platformOf(b.meeting_url || ''),
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
      for (const k of ['title', 'meeting_url', 'starts_at', 'duration_min', 'auto_join', 'status', 'deal_id', 'product_id']) if (k in b) patch[k] = b[k];
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

    sendJson(res, { error: 'not found' }, 404);
    return true;
  }

  // Background loop: dispatch bots for meetings that are due, and poll running ones.
  // Only does anything when a provider is configured.
  const seen = new Map();   // jwt cache per user so the loop can act between requests
  function remember(userId, jwt) { seen.set(userId, jwt); }

  async function tick() {
    if (botMode() === 'manual' || seen.size === 0) return;
    for (const [userId, jwt] of seen) {
      try {
        const soon = new Date(Date.now() + 2 * 60000).toISOString();
        const due = await sbRest(
          `meetings?select=*&auto_join=is.true&status=eq.scheduled&starts_at=lte.${soon}&meeting_url=neq.`, jwt);
        for (const m of due) { try { await dispatchBot(jwt, m); } catch { /* keep going */ } }

        const running = await sbRest(`meetings?select=*&status=in.(joining,recording,processing)`, jwt);
        for (const m of running) { try { await syncBot(jwt, userId, m); } catch { /* keep going */ } }
      } catch { /* user's token expired — it refreshes on their next request */ }
    }
  }
  setInterval(tick, 30000).unref?.();

  return { handle, remember, botMode, platformOf };
};
