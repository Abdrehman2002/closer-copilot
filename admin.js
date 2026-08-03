// Admin platform backend — roles, live users, metrics, analytics, telemetry/heatmap,
// a full activity log, API usage & credits, organizations, DB console, scheduled
// backups, feature flags, announcements, key reveal, and an audit trail.
//
// Access model: no separate admin password. An admin is a normal signed-in account
// listed in public.admin_users with a role (owner|admin|support|viewer). Postgres RLS
// enforces it, and every endpoint re-checks server-side against the verified JWT — a
// client can never assert "I am admin".
//
// The service_role key is optional and used for ONE thing: the unattended nightly
// backup (no user JWT exists at 3am). It is never sent to the browser.
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const BACKUP_DIR = path.join(__dirname, 'backups');
const BACKUP_KEEP_DAYS = 7;
const TABLES = ['profiles', 'products', 'deals', 'calls', 'documents', 'reminders', 'usage_events'];

// ---- in-process metrics ----
const started = Date.now();
const metrics = {
  requests: 0, errors: 0, apiRequests: 0,
  byPath: new Map(), recentErrors: [], statusCounts: new Map(),
};

function recordRequest(p, status, ms, err) {
  metrics.requests++;
  if (p.startsWith('/api/')) metrics.apiRequests++;
  const key = p.split('/').slice(0, 4).join('/') || '/';
  const e = metrics.byPath.get(key) || { n: 0, ms: 0, errors: 0 };
  e.n++; e.ms += ms;
  if (status >= 400) { e.errors++; metrics.errors++; }
  metrics.byPath.set(key, e);
  metrics.statusCounts.set(status, (metrics.statusCounts.get(status) || 0) + 1);
  if (err) {
    metrics.recentErrors.unshift({ at: new Date().toISOString(), path: p, msg: String(err).slice(0, 300) });
    metrics.recentErrors.length = Math.min(metrics.recentErrors.length, 50);
  }
}

const mask = (k) => {
  if (!k) return { set: false, masked: '—', length: 0 };
  const s = String(k);
  return { set: true, masked: s.slice(0, 6) + '…' + s.slice(-4), length: s.length };
};

async function timed(fn) {
  const t0 = Date.now();
  try { const detail = await fn(); return { ok: true, ms: Date.now() - t0, detail: detail || '' }; }
  catch (e) { return { ok: false, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 200) }; }
}

const PRICE = {
  'gpt-4o': [2.5, 10], 'gpt-4o-mini': [0.15, 0.6],
  'gpt-4.1': [2, 8], 'gpt-4.1-mini': [0.4, 1.6], 'gpt-4.1-nano': [0.1, 0.4],
  'gpt-4-turbo': [10, 30], 'o3-mini': [1.1, 4.4],
};
function costOf(model, p, c) { const x = PRICE[model] || [0, 0]; return (p * x[0] + c * x[1]) / 1e6; }

module.exports = function createAdmin(ctx) {
  const { sbRest, sessions, SUPA_URL, SUPA_KEY, sendJson, readBody } = ctx;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

  // ---------------------------------------------------------------- plumbing
  async function rpc(name, jwt, args) {
    const r = await fetch(SUPA_URL + '/rest/v1/rpc/' + name, {
      method: 'POST',
      headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + jwt, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t.slice(0, 300));
    return t ? JSON.parse(t) : null;
  }

  // service-key REST (server-only; used by the unattended backup)
  async function sbService(pathq, opts = {}) {
    if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY not configured');
    const r = await fetch(SUPA_URL + '/rest/v1/' + pathq, {
      method: opts.method || 'GET',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json', Prefer: opts.prefer || 'return=representation' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const t = await r.text();
    if (!r.ok) throw new Error('supabase ' + r.status + ': ' + t.slice(0, 200));
    return t ? JSON.parse(t) : null;
  }

  // ---- activity log: batched so logging never slows a request ----
  const logBuf = [];      // { jwt, row }
  let logTimer = null;
  function logActivity(jwt, row) {
    if (!jwt) return;
    logBuf.push({ jwt, row: { at: new Date().toISOString(), ...row } });
    if (logBuf.length >= 40) flushLogs();
    else if (!logTimer) logTimer = setTimeout(flushLogs, 3000);
  }
  async function flushLogs() {
    if (logTimer) { clearTimeout(logTimer); logTimer = null; }
    if (!logBuf.length) return;
    const batch = logBuf.splice(0, 200);
    const byJwt = new Map();
    for (const b of batch) { if (!byJwt.has(b.jwt)) byJwt.set(b.jwt, []); byJwt.get(b.jwt).push(b.row); }
    for (const [jwt, rows] of byJwt) {
      sbRest('activity_log', jwt, { method: 'POST', prefer: 'return=minimal', body: rows }).catch(() => {});
    }
  }
  setInterval(flushLogs, 10000).unref?.();

  function audit(jwt, adminId, action, target, detail) {
    sbRest('admin_audit', jwt, {
      method: 'POST', prefer: 'return=minimal',
      body: { admin_id: adminId, action, target: target || '', detail: detail || {} }
    }).catch(() => {});
    logActivity(jwt, { level: 'warn', category: 'admin', action, actor_id: adminId, target: target || '', detail: detail || {} });
  }

  // ---- who is this? ----
  let lastAdminJwt = null;   // used as a fallback for the nightly backup
  async function adminState(jwt, userId) {
    try {
      const rows = await sbRest('admin_users?select=user_id,role&user_id=eq.' + userId, jwt);
      const role = rows.length ? rows[0].role : null;
      if (role) lastAdminJwt = jwt;
      return {
        schemaReady: true, isAdmin: !!role, role,
        canWrite: role === 'owner' || role === 'admin',
        canBilling: role === 'owner' || role === 'admin' || role === 'support',
        isOwner: role === 'owner',
      };
    } catch (e) {
      if (/PGRST205|schema cache|does not exist/i.test(e.message)) return { schemaReady: false, isAdmin: false };
      return { schemaReady: true, isAdmin: false, error: e.message };
    }
  }

  // Which optional pieces of the schema are actually installed? Parts of admin-schema.sql
  // can be applied separately, so the UI states plainly what it can and can't show rather
  // than rendering empty panels that look broken.
  let capCache = null, capAt = 0;
  async function capabilities(jwt) {
    if (capCache && Date.now() - capAt < 60000) return capCache;
    const [listUsers, crossTenant] = await Promise.all([
      rpc('admin_list_users', jwt).then(() => true).catch(() => false),
      // if the cross-tenant policy is missing we only ever see our own rows
      (async () => {
        try {
          const r = await fetch(SUPA_URL + "/rest/v1/profiles?select=user_id&limit=200", {
            headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + jwt }
          });
          const rows = await r.json();
          return Array.isArray(rows) && new Set(rows.map(x => x.user_id)).size > 1;
        } catch { return false; }
      })(),
    ]);
    capCache = { listUsers, crossTenant, manageAccounts: !!SERVICE_KEY };
    capAt = Date.now();
    return capCache;
  }

  // ---------------------------------------------------------------- builders
  async function overview(jwt) {
    const [deals, calls, usage, tele, credits, docs, meets, logs] = await Promise.all([
      sbRest('deals?select=id,user_id,status,close_amount,created_at,memory_md', jwt),
      sbRest('calls?select=id,user_id,created_at,duration_sec,review_score,transcript,product_name', jwt),
      sbRest('usage_events?select=user_id,kind,model,prompt_tokens,completion_tokens,created_at&order=created_at.desc&limit=20000', jwt),
      sbRest('telemetry_events?select=user_id,created_at&order=created_at.desc&limit=5000', jwt).catch(() => []),
      sbRest('user_credits?select=user_id,credits,enforced', jwt).catch(() => []),
      sbRest('documents?select=id,scope', jwt).catch(() => []),
      sbRest('meetings?select=id,status,starts_at,auto_join', jwt).catch(() => []),
      sbRest('activity_log?select=level,at&order=at.desc&limit=2000', jwt).catch(() => []),
    ]);
    const now = Date.now(), dayAgo = now - 86400000, weekAgo = now - 7 * 86400000, monthAgo = now - 30 * 86400000;
    const since = (rows, t, k = 'created_at') => rows.filter(r => new Date(r[k]).getTime() >= t);

    let tokens = 0, cost = 0, costDay = 0;
    const modelSet = new Set();
    for (const u of usage) {
      const p = u.prompt_tokens || 0, c = u.completion_tokens || 0, k = costOf(u.model, p, c);
      tokens += p + c; cost += k; modelSet.add(u.model);
      if (new Date(u.created_at).getTime() >= dayAgo) costDay += k;
    }
    const won = deals.filter(d => d.status === 'won');
    const lost = deals.filter(d => d.status === 'lost');
    const scored = calls.filter(c => typeof c.review_score === 'number');
    const decided = won.length + lost.length;
    const revenue = won.reduce((a, d) => a + (Number(d.close_amount) || 0), 0);

    // talk ratio across every transcript we can see
    let meWords = 0, themWords = 0;
    for (const c of calls) {
      for (const t of (Array.isArray(c.transcript) ? c.transcript : [])) {
        const n = String(t.text || '').trim().split(/\s+/).filter(Boolean).length;
        if (t.ch === 'me') meWords += n; else themWords += n;
      }
    }
    const totalWords = meWords + themWords;

    // calls per day for the last 14 days (sparkline)
    const byDay = {};
    for (let i = 13; i >= 0; i--) byDay[new Date(now - i * 86400000).toISOString().slice(0, 10)] = 0;
    for (const c of since(calls, monthAgo)) {
      const d = String(c.created_at).slice(0, 10);
      if (d in byDay) byDay[d]++;
    }

    // retention: of accounts active last week, how many were also active this week
    const usersWeek = new Set(since(calls, weekAgo).map(c => c.user_id));
    const usersPrev = new Set(calls.filter(c => {
      const t = new Date(c.created_at).getTime();
      return t < weekAgo && t >= weekAgo - 7 * 86400000;
    }).map(c => c.user_id));
    const retained = [...usersPrev].filter(u => usersWeek.has(u)).length;

    const errors24 = logs.filter(l => l.level === 'error' && new Date(l.at).getTime() >= dayAgo).length;
    const warns24 = logs.filter(l => l.level === 'warn' && new Date(l.at).getTime() >= dayAgo).length;

    return {
      users: {
        total: new Set([...deals, ...calls].map(r => r.user_id)).size,
        activeDay: new Set(since(calls, dayAgo).map(c => c.user_id)).size,
        activeWeek: usersWeek.size,
        retentionPct: usersPrev.size ? Math.round((retained / usersPrev.size) * 100) : null,
      },
      calls: {
        total: calls.length, day: since(calls, dayAgo).length, week: since(calls, weekAgo).length,
        avgDuration: calls.length ? Math.round(calls.reduce((a, c) => a + (c.duration_sec || 0), 0) / calls.length) : 0,
        totalMinutes: Math.round(calls.reduce((a, c) => a + (c.duration_sec || 0), 0) / 60),
        avgScore: scored.length ? Math.round(scored.reduce((a, c) => a + c.review_score, 0) / scored.length) : null,
        scored: scored.length,
        timeline: Object.entries(byDay).map(([date, count]) => ({ date, count })),
      },
      talk: { me: meWords, them: themWords, ratio: totalWords ? Math.round((meWords / totalWords) * 100) : 0 },
      deals: {
        total: deals.length, open: deals.filter(d => d.status === 'open').length,
        won: won.length, lost: lost.length, revenue,
        winRate: decided ? Math.round((won.length / decided) * 100) : null,
        avgDealSize: won.length ? Math.round(revenue / won.length) : 0,
        withBrain: deals.filter(d => String(d.memory_md || '').trim()).length,
      },
      ai: {
        tokens, cost: Math.round(cost * 10000) / 10000, events: usage.length,
        tokensDay: since(usage, dayAgo).reduce((a, u) => a + (u.prompt_tokens || 0) + (u.completion_tokens || 0), 0),
        costDay: Math.round(costDay * 10000) / 10000,
        costPerCall: calls.length ? Math.round((cost / calls.length) * 10000) / 10000 : 0,
        models: modelSet.size,
      },
      telemetry: { events: tele.length, day: since(tele, dayAgo).length },
      credits: {
        accounts: credits.length, enforced: credits.filter(c => c.enforced).length,
        outstanding: Math.round(credits.reduce((a, c) => a + Number(c.credits || 0), 0) * 100) / 100,
        drained: credits.filter(c => c.enforced && Number(c.credits) <= 0).length,
      },
      knowledge: { docs: docs.length, byScope: docs.reduce((m, d) => ({ ...m, [d.scope]: (m[d.scope] || 0) + 1 }), {}) },
      meetings: {
        total: meets.length,
        upcoming: meets.filter(m => m.starts_at && new Date(m.starts_at).getTime() > now && !['done', 'cancelled'].includes(m.status)).length,
        done: meets.filter(m => m.status === 'done').length,
        autoJoin: meets.filter(m => m.auto_join).length,
      },
      health: { errors24, warns24, logRows: logs.length },
      liveNow: liveSessions().length,
    };
  }

  function liveSessions() {
    const out = [];
    for (const [userId, s] of sessions) {
      const listeners = s.events ? s.events.size : 0;
      if (!listeners && !s.callStartAt) continue;
      out.push({
        userId, connected: listeners > 0, sockets: listeners,
        onCall: !!(s.callStartAt && listeners > 0 && s.activeDealId),
        client: s.dealName || null, company: s.dealCompany || null,
        product: s.activeProductName || null, goal: s.callGoal || null,
        startedAt: s.callStartAt ? new Date(s.callStartAt).toISOString() : null,
        elapsedSec: s.callStartAt ? Math.round((Date.now() - s.callStartAt) / 1000) : 0,
        turns: (s.turns || []).length, cards: (s.cards || []).length,
        lastCardAt: s.lastCardAt ? new Date(s.lastCardAt).toISOString() : null,
      });
    }
    return out.sort((a, b) => (b.connected ? 1 : 0) - (a.connected ? 1 : 0));
  }

  async function users(jwt) {
    let accounts = [];
    try { accounts = await rpc('admin_list_users', jwt); } catch { accounts = []; }
    const [deals, calls, usage, profiles, admins, credits, members] = await Promise.all([
      sbRest('deals?select=user_id,status,close_amount', jwt),
      sbRest('calls?select=user_id,created_at,duration_sec,review_score', jwt),
      sbRest('usage_events?select=user_id,model,prompt_tokens,completion_tokens', jwt),
      sbRest('profiles?select=user_id,name', jwt).catch(() => []),
      sbRest('admin_users?select=user_id,role', jwt).catch(() => []),
      sbRest('user_credits?select=*', jwt).catch(() => []),
      sbRest('org_members?select=user_id,org_id,org_role,organizations(name)', jwt).catch(() => []),
    ]);
    const live = new Set(liveSessions().filter(l => l.connected).map(l => l.userId));
    const roll = new Map();
    const get = (id) => { if (!roll.has(id)) roll.set(id, { calls: 0, deals: 0, won: 0, revenue: 0, tokens: 0, cost: 0, lastCall: null, scores: [] }); return roll.get(id); };
    for (const d of deals) { const r = get(d.user_id); r.deals++; if (d.status === 'won') { r.won++; r.revenue += Number(d.close_amount) || 0; } }
    for (const c of calls) {
      const r = get(c.user_id); r.calls++;
      if (!r.lastCall || c.created_at > r.lastCall) r.lastCall = c.created_at;
      if (typeof c.review_score === 'number') r.scores.push(c.review_score);
    }
    for (const u of usage) { const r = get(u.user_id); const p = u.prompt_tokens || 0, cc = u.completion_tokens || 0; r.tokens += p + cc; r.cost += costOf(u.model, p, cc); }

    const nameOf = new Map(profiles.map(p => [p.user_id, p.name]));
    const roleOf = new Map(admins.map(a => [a.user_id, a.role]));
    const credOf = new Map(credits.map(c => [c.user_id, c]));
    const orgOf = new Map(members.map(m => [m.user_id, { id: m.org_id, name: m.organizations?.name || '', role: m.org_role }]));
    const ids = new Set([...accounts.map(a => a.id), ...roll.keys()]);

    return [...ids].map(id => {
      const a = accounts.find(x => x.id === id) || {};
      const r = roll.get(id) || { calls: 0, deals: 0, won: 0, revenue: 0, tokens: 0, cost: 0, lastCall: null, scores: [] };
      const c = credOf.get(id);
      return {
        id, email: a.email || null, name: nameOf.get(id) || '',
        createdAt: a.created_at || null, lastSignInAt: a.last_sign_in_at || null,
        confirmed: a.confirmed ?? null, banned: a.banned ?? false,
        adminRole: roleOf.get(id) || null, org: orgOf.get(id) || null,
        credits: c ? Number(c.credits) : null, creditsEnforced: c ? c.enforced : false, plan: c ? c.plan : null,
        live: live.has(id),
        calls: r.calls, deals: r.deals, won: r.won, revenue: r.revenue,
        tokens: r.tokens, cost: Math.round(r.cost * 10000) / 10000, lastCall: r.lastCall,
        avgScore: r.scores.length ? Math.round(r.scores.reduce((x, y) => x + y, 0) / r.scores.length) : null,
      };
    }).sort((x, y) => (y.calls - x.calls) || String(x.email).localeCompare(String(y.email)));
  }

  async function telemetry(jwt, q) {
    const hours = Math.min(24 * 30, Math.max(1, Number(q.get('hours')) || 24));
    const sinceIso = new Date(Date.now() - hours * 3600000).toISOString();
    let p = 'telemetry_events?select=*&created_at=gte.' + sinceIso + '&order=created_at.desc&limit=5000';
    const only = q.get('path');
    if (only) p += '&path=eq.' + encodeURIComponent(only);
    const rows = await sbRest(p, jwt);
    const byPath = {}, byKind = {}, byHour = {}, heat = [];
    for (const r of rows) {
      byPath[r.path] = (byPath[r.path] || 0) + 1;
      byKind[r.kind] = (byKind[r.kind] || 0) + 1;
      const h = String(r.created_at).slice(0, 13);
      byHour[h] = (byHour[h] || 0) + 1;
      if (r.kind === 'click' && r.x != null && r.vw) {
        heat.push({ x: Math.round((r.x / r.vw) * 1000) / 1000, y: Math.round((r.y / Math.max(1, r.vh)) * 1000) / 1000, path: r.path, el: r.element });
      }
    }
    return {
      total: rows.length, hours,
      paths: Object.entries(byPath).map(([k, n]) => ({ path: k, count: n })).sort((a, b) => b.count - a.count).slice(0, 20),
      kinds: Object.entries(byKind).map(([k, n]) => ({ kind: k, count: n })).sort((a, b) => b.count - a.count),
      timeline: Object.entries(byHour).map(([k, n]) => ({ hour: k, count: n })).sort((a, b) => a.hour < b.hour ? -1 : 1),
      heat,
      recent: rows.slice(0, 60).map(r => ({ at: r.created_at, kind: r.kind, path: r.path, element: r.element, userId: r.user_id })),
    };
  }

  async function usageBreakdown(jwt) {
    const rows = await sbRest('usage_events?select=user_id,deal_id,kind,model,prompt_tokens,completion_tokens,created_at&order=created_at.desc&limit=20000', jwt);
    const agg = (keyFn) => {
      const m = {};
      for (const r of rows) {
        const k = keyFn(r) || '(none)';
        const p = r.prompt_tokens || 0, c = r.completion_tokens || 0;
        (m[k] = m[k] || { tokens: 0, cost: 0, calls: 0 });
        m[k].tokens += p + c; m[k].cost += costOf(r.model, p, c); m[k].calls++;
      }
      return Object.entries(m).map(([k, v]) => ({ key: k, tokens: v.tokens, calls: v.calls, cost: Math.round(v.cost * 10000) / 10000 }))
        .sort((a, b) => b.tokens - a.tokens);
    };
    const byDay = {};
    for (const r of rows) {
      const d = String(r.created_at).slice(0, 10);
      byDay[d] = (byDay[d] || 0) + (r.prompt_tokens || 0) + (r.completion_tokens || 0);
    }
    return {
      byModel: agg(r => r.model), byKind: agg(r => r.kind), byUser: agg(r => r.user_id),
      timeline: Object.entries(byDay).map(([date, tokens]) => ({ date, tokens })).sort((a, b) => a.date < b.date ? -1 : 1),
      note: 'Cost is estimated from public list prices; unknown/local models count as $0.',
    };
  }

  function keyStatus() {
    return {
      keys: [
        { id: 'openai', name: 'OPENAI_API_KEY', ...mask(ctx.OPENAI_KEY), scope: 'secret — server only' },
        { id: 'deepgram', name: 'DEEPGRAM_API_KEY', ...mask(ctx.DG_KEY), scope: 'secret — server only' },
        { id: 'service', name: 'SUPABASE_SERVICE_KEY', ...mask(SERVICE_KEY), scope: 'secret — optional, nightly backup' },
        { id: 'supabase', name: 'SUPABASE_KEY (publishable)', ...mask(SUPA_KEY), scope: 'public — safe in the browser' },
        { id: 'url', name: 'SUPABASE_URL', set: !!SUPA_URL, masked: SUPA_URL, length: (SUPA_URL || '').length, scope: 'public' },
      ],
      models: { live: ctx.LIVE_MODEL, analysis: ctx.ANALYSIS_MODEL, prep: ctx.PREP_MODEL, base: ctx.OPENAI_BASE },
    };
  }

  // Full secret, fetched only on an explicit click. Owner-only and always audited.
  function revealKey(id) {
    const map = { openai: ctx.OPENAI_KEY, deepgram: ctx.DG_KEY, service: SERVICE_KEY, supabase: SUPA_KEY, url: SUPA_URL };
    if (!(id in map)) throw new Error('unknown key');
    return map[id] || '';
  }

  async function health() {
    const [supabase, openai, deepgram] = await Promise.all([
      timed(async () => {
        const r = await fetch(SUPA_URL + '/rest/v1/', { headers: { apikey: SUPA_KEY } });
        if (!r.ok && r.status >= 500) throw new Error('HTTP ' + r.status);
        return 'HTTP ' + r.status;
      }),
      timed(async () => {
        if (!ctx.OPENAI_KEY) throw new Error('no key configured');
        const r = await fetch(ctx.OPENAI_BASE + '/models', { headers: { Authorization: 'Bearer ' + ctx.OPENAI_KEY } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        return (j.data ? j.data.length : 0) + ' models';
      }),
      timed(async () => {
        if (!ctx.DG_KEY) throw new Error('no key configured');
        const r = await fetch('https://api.deepgram.com/v1/projects', { headers: { Authorization: 'Token ' + ctx.DG_KEY } });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return 'reachable';
      }),
    ]);
    return { supabase, openai, deepgram };
  }

  function system() {
    const mem = process.memoryUsage();
    return {
      uptimeSec: Math.round((Date.now() - started) / 1000),
      node: process.version, platform: process.platform, pid: process.pid,
      memoryMb: { rss: Math.round(mem.rss / 1048576), heapUsed: Math.round(mem.heapUsed / 1048576), heapTotal: Math.round(mem.heapTotal / 1048576) },
      loadAvg: os.loadavg().map(n => Math.round(n * 100) / 100),
      cpus: os.cpus().length, freeMemMb: Math.round(os.freemem() / 1048576),
      requests: metrics.requests, apiRequests: metrics.apiRequests, errors: metrics.errors,
      errorRate: metrics.requests ? Math.round((metrics.errors / metrics.requests) * 1000) / 10 : 0,
      statusCounts: [...metrics.statusCounts.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => a.status - b.status),
      paths: [...metrics.byPath.entries()].map(([p, e]) => ({ path: p, count: e.n, avgMs: Math.round(e.ms / e.n), errors: e.errors }))
        .sort((a, b) => b.count - a.count).slice(0, 15),
      recentErrors: metrics.recentErrors.slice(0, 20),
      sessionsInMemory: sessions.size,
      backupsConfigured: !!SERVICE_KEY,
    };
  }

  // ---------------------------------------------------------------- backups
  function ensureBackupDir() { fs.mkdirSync(BACKUP_DIR, { recursive: true }); }

  async function runBackup(kind, jwt) {
    ensureBackupDir();
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const file = `backup-${stamp}.json`;
    const full = path.join(BACKUP_DIR, file);
    const useService = !!SERVICE_KEY;
    const read = (t) => useService ? sbService(`${t}?select=*`) : sbRest(`${t}?select=*`, jwt);

    const out = { exportedAt: new Date().toISOString(), kind, tables: {} };
    let err = '';
    for (const t of TABLES) {
      try { out.tables[t] = await read(t); }
      catch (e) { out.tables[t] = []; err = e.message; }
    }
    out.counts = Object.fromEntries(Object.entries(out.tables).map(([k, v]) => [k, Array.isArray(v) ? v.length : 0]));
    fs.writeFileSync(full, JSON.stringify(out));
    const bytes = fs.statSync(full).size;

    pruneBackups();
    const meta = { file, bytes, counts: out.counts, kind, ok: !err, error: err.slice(0, 300) };
    if (jwt) sbRest('backup_runs', jwt, { method: 'POST', prefer: 'return=minimal', body: meta }).catch(() => {});
    else if (useService) sbService('backup_runs', { method: 'POST', prefer: 'return=minimal', body: meta }).catch(() => {});
    return meta;
  }

  // keep only the last BACKUP_KEEP_DAYS files
  function pruneBackups() {
    ensureBackupDir();
    const cutoff = Date.now() - BACKUP_KEEP_DAYS * 86400000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
      if (!f.startsWith('backup-')) continue;
      const p = path.join(BACKUP_DIR, f);
      try { if (fs.statSync(p).mtimeMs < cutoff) fs.unlinkSync(p); } catch { /* ignore */ }
    }
  }

  function listBackups() {
    ensureBackupDir();
    return fs.readdirSync(BACKUP_DIR).filter(f => f.startsWith('backup-')).map(f => {
      const st = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, bytes: st.size, at: new Date(st.mtimeMs).toISOString() };
    }).sort((a, b) => a.at < b.at ? 1 : -1);
  }

  // nightly scheduler — checks hourly, runs once per calendar day
  let lastBackupDay = '';
  async function backupTick() {
    const today = new Date().toISOString().slice(0, 10);
    if (lastBackupDay === today) return;
    if (listBackups().some(b => b.at.slice(0, 10) === today)) { lastBackupDay = today; return; }
    if (!SERVICE_KEY && !lastAdminJwt) return;   // nothing to authenticate with yet
    try {
      await runBackup('daily', SERVICE_KEY ? null : lastAdminJwt);
      lastBackupDay = today;
      console.log('[backup] daily snapshot written');
    } catch (e) { console.error('[backup]', e.message); }
  }
  setInterval(backupTick, 3600000).unref?.();
  setTimeout(backupTick, 30000).unref?.();

  // ---- Supabase Auth Admin API (create / delete / ban accounts) ----
  // Needs the service_role key: creating and deleting auth users is a privileged
  // operation that a user JWT can never perform. Stays server-side.
  async function authAdmin(path, opts = {}) {
    if (!SERVICE_KEY) throw new Error('SUPABASE_SERVICE_KEY not configured — add it to .env to manage accounts from here');
    const r = await fetch(SUPA_URL + '/auth/v1/admin' + path, {
      method: opts.method || 'GET',
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + SERVICE_KEY, 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const t = await r.text();
    if (!r.ok) {
      let m = t.slice(0, 300);
      try { const j = JSON.parse(t); m = j.msg || j.message || j.error_description || m; } catch { /* keep raw */ }
      throw new Error(m);
    }
    return t ? JSON.parse(t) : null;
  }

  // ---------------------------------------------------------------- actions
  async function runAction(jwt, adminId, st, body) {
    const { action, userId, table, id, days, role, amount, reason } = body || {};
    const needWrite = () => { if (!st.canWrite) throw new Error('your role cannot perform this action'); };

    switch (action) {
      case 'set_admin_role': {
        if (!st.isOwner) throw new Error('owner only');
        if (!userId) throw new Error('userId required');
        if (userId === adminId && role !== 'owner') throw new Error('refusing to demote yourself');
        if (!['owner', 'admin', 'support', 'viewer'].includes(role)) throw new Error('bad role');
        await sbRest('admin_users?on_conflict=user_id', jwt, {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal', body: { user_id: userId, role }
        });
        audit(jwt, adminId, 'set_admin_role', userId, { role });
        return { ok: true, msg: `Role set to ${role}.` };
      }
      case 'revoke_admin': {
        if (!st.isOwner) throw new Error('owner only');
        if (userId === adminId) throw new Error('refusing to revoke your own access');
        await sbRest('admin_users?user_id=eq.' + userId, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'revoke_admin', userId, {});
        return { ok: true, msg: 'Admin access revoked.' };
      }
      case 'adjust_credits': {
        if (!st.canBilling) throw new Error('your role cannot change credits');
        if (!userId || !amount) throw new Error('userId and amount required');
        const bal = await rpc('admin_adjust_credits', jwt, { target: userId, delta: Number(amount), why: reason || '' });
        audit(jwt, adminId, 'adjust_credits', userId, { amount, reason });
        return { ok: true, msg: `Credits updated — new balance ${bal}.` };
      }
      case 'set_credit_enforcement': {
        if (!st.canBilling) throw new Error('your role cannot change credits');
        await sbRest('user_credits?on_conflict=user_id', jwt, {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { user_id: userId, enforced: !!body.enforced }
        });
        audit(jwt, adminId, 'set_credit_enforcement', userId, { enforced: !!body.enforced });
        return { ok: true, msg: `Enforcement ${body.enforced ? 'on' : 'off'}.` };
      }
      case 'purge_telemetry': {
        needWrite();
        const d = Math.max(1, Number(days) || 30);
        const cutoff = new Date(Date.now() - d * 86400000).toISOString();
        await sbRest('telemetry_events?created_at=lt.' + cutoff, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'purge_telemetry', 'older_than_' + d + 'd', {});
        return { ok: true, msg: `Telemetry older than ${d} days purged.` };
      }
      case 'purge_logs': {
        needWrite();
        const d = Math.max(1, Number(days) || 30);
        const cutoff = new Date(Date.now() - d * 86400000).toISOString();
        await sbRest('activity_log?at=lt.' + cutoff, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'purge_logs', 'older_than_' + d + 'd', {});
        return { ok: true, msg: `Logs older than ${d} days purged.` };
      }
      case 'delete_user_calls': {
        needWrite();
        if (!userId) throw new Error('userId required');
        await sbRest('calls?user_id=eq.' + userId, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'delete_user_calls', userId, {});
        return { ok: true, msg: 'Calls deleted for that account.' };
      }
      case 'delete_row': {
        needWrite();
        const allowed = [...TABLES, 'telemetry_events', 'activity_log', 'organizations'];
        if (!allowed.includes(table)) throw new Error('table not allowed');
        if (!id) throw new Error('id required');
        await sbRest(`${table}?id=eq.${encodeURIComponent(id)}`, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'delete_row', `${table}:${id}`, {});
        return { ok: true, msg: `Deleted ${table} row.` };
      }
      case 'clear_sessions': {
        needWrite();
        const n = sessions.size; sessions.clear();
        audit(jwt, adminId, 'clear_sessions', String(n), {});
        return { ok: true, msg: `Cleared ${n} in-memory session(s).` };
      }

      // ---- account management (needs SUPABASE_SERVICE_KEY) ----
      case 'create_user': {
        needWrite();
        const email = String(body.email || '').trim();
        if (!email) throw new Error('email required');
        // The admin types the password in the panel; it is forwarded straight to Supabase
        // and never stored or logged here. Blank = send an invite instead.
        if (body.password) {
          const u = await authAdmin('/users', {
            method: 'POST',
            body: { email, password: body.password, email_confirm: true },
          });
          audit(jwt, adminId, 'create_user', email, { method: 'password', id: u.id });
          return { ok: true, msg: `Account created for ${email}.`, id: u.id };
        }
        await authAdmin('/invite', { method: 'POST', body: { email } });
        audit(jwt, adminId, 'invite_user', email, { method: 'invite' });
        return { ok: true, msg: `Invite email sent to ${email}.` };
      }
      case 'delete_user': {
        if (!st.isOwner) throw new Error('owner only');
        if (!userId) throw new Error('userId required');
        if (userId === adminId) throw new Error('refusing to delete your own account');
        await authAdmin('/users/' + userId, { method: 'DELETE' });
        audit(jwt, adminId, 'delete_user', userId, {});
        return { ok: true, msg: 'Account deleted.' };
      }
      case 'set_banned': {
        needWrite();
        if (!userId) throw new Error('userId required');
        if (userId === adminId) throw new Error('refusing to ban yourself');
        await authAdmin('/users/' + userId, {
          method: 'PUT', body: { ban_duration: body.banned ? '876000h' : 'none' },
        });
        audit(jwt, adminId, body.banned ? 'ban_user' : 'unban_user', userId, {});
        return { ok: true, msg: body.banned ? 'Account banned.' : 'Account unbanned.' };
      }
      case 'send_password_reset': {
        if (!st.canBilling) throw new Error('your role cannot do this');
        const email = String(body.email || '').trim();
        if (!email) throw new Error('email required');
        const r = await fetch(SUPA_URL + '/auth/v1/recover', {
          method: 'POST', headers: { apikey: SUPA_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        });
        if (!r.ok) throw new Error('could not send reset email');
        audit(jwt, adminId, 'send_password_reset', email, {});
        return { ok: true, msg: `Password reset sent to ${email}.` };
      }
      case 'run_backup': {
        needWrite();
        const meta = await runBackup('manual', jwt);
        audit(jwt, adminId, 'run_backup', meta.file, { counts: meta.counts });
        return { ok: true, msg: `Backup written (${Math.round(meta.bytes / 1024)} KB).`, meta };
      }
      case 'create_org': {
        needWrite();
        const row = (await sbRest('organizations', jwt, { method: 'POST', body: { name: body.name || 'New org', plan: body.plan || 'free' } }))[0];
        audit(jwt, adminId, 'create_org', row.id, { name: row.name });
        return { ok: true, msg: 'Organization created.', org: row };
      }
      case 'update_org': {
        needWrite();
        const patch = {};
        for (const k of ['name', 'plan', 'status', 'seats', 'notes']) if (k in body) patch[k] = body[k];
        await sbRest('organizations?id=eq.' + body.orgId, jwt, { method: 'PATCH', prefer: 'return=minimal', body: patch });
        audit(jwt, adminId, 'update_org', body.orgId, patch);
        return { ok: true, msg: 'Organization updated.' };
      }
      case 'add_org_member': {
        needWrite();
        await sbRest('org_members?on_conflict=org_id,user_id', jwt, {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { org_id: body.orgId, user_id: userId, org_role: body.orgRole || 'member' }
        });
        audit(jwt, adminId, 'add_org_member', `${body.orgId}:${userId}`, { role: body.orgRole || 'member' });
        return { ok: true, msg: 'Member added.' };
      }
      case 'set_org_member_role': {
        needWrite();
        await sbRest(`org_members?org_id=eq.${body.orgId}&user_id=eq.${userId}`, jwt, {
          method: 'PATCH', prefer: 'return=minimal', body: { org_role: body.orgRole }
        });
        audit(jwt, adminId, 'set_org_member_role', `${body.orgId}:${userId}`, { role: body.orgRole });
        return { ok: true, msg: 'Member role updated.' };
      }
      case 'set_credit_plan': {
        if (!st.canBilling) throw new Error('your role cannot change credits');
        await sbRest('user_credits?on_conflict=user_id', jwt, {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { user_id: userId, plan: body.plan }
        });
        audit(jwt, adminId, 'set_credit_plan', userId, { plan: body.plan });
        return { ok: true, msg: 'Plan updated.' };
      }
      case 'remove_org_member': {
        needWrite();
        await sbRest(`org_members?org_id=eq.${body.orgId}&user_id=eq.${userId}`, jwt, { method: 'DELETE', prefer: 'return=minimal' });
        audit(jwt, adminId, 'remove_org_member', `${body.orgId}:${userId}`, {});
        return { ok: true, msg: 'Member removed.' };
      }
      case 'set_flag': {
        needWrite();
        await sbRest('feature_flags?on_conflict=key', jwt, {
          method: 'POST', prefer: 'resolution=merge-duplicates,return=minimal',
          body: { key: body.key, enabled: !!body.enabled, description: body.description || '', rollout: body.rollout ?? 100, updated_at: new Date().toISOString() }
        });
        audit(jwt, adminId, 'set_flag', body.key, { enabled: !!body.enabled });
        return { ok: true, msg: 'Flag saved.' };
      }
      case 'post_announcement': {
        needWrite();
        await sbRest('announcements', jwt, { method: 'POST', prefer: 'return=minimal', body: { title: body.title, body: body.body || '', level: body.level || 'info' } });
        audit(jwt, adminId, 'post_announcement', body.title, {});
        return { ok: true, msg: 'Announcement posted.' };
      }
      case 'toggle_announcement': {
        needWrite();
        await sbRest('announcements?id=eq.' + id, jwt, { method: 'PATCH', prefer: 'return=minimal', body: { active: !!body.active } });
        return { ok: true, msg: 'Updated.' };
      }
      default: throw new Error('unknown action');
    }
  }

  // ---------------------------------------------------------------- router
  async function handle(req, res, urlPath, user, jwt) {
    if (!urlPath.startsWith('/api/admin')) return false;
    const q = new URL(req.url, 'http://x').searchParams;
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();

    // telemetry ingest — open to any signed-in user (that's the point)
    if (urlPath === '/api/admin/telemetry' && req.method === 'POST') {
      const b = await readBody(req);
      const rows = (Array.isArray(b.events) ? b.events : []).slice(0, 50).map(e => ({
        user_id: user.id, session_id: String(e.sid || '').slice(0, 64),
        kind: String(e.kind || 'event').slice(0, 32), path: String(e.path || '').slice(0, 200),
        element: String(e.el || '').slice(0, 200),
        x: e.x ?? null, y: e.y ?? null, vw: e.vw ?? null, vh: e.vh ?? null, meta: e.meta || {}
      }));
      if (rows.length) await sbRest('telemetry_events', jwt, { method: 'POST', prefer: 'return=minimal', body: rows }).catch(() => {});
      sendJson(res, { ok: true, accepted: rows.length });
      return true;
    }

    const st = await adminState(jwt, user.id);
    if (urlPath === '/api/admin/whoami') { sendJson(res, { ...st, userId: user.id, email: user.email }); return true; }
    if (!st.schemaReady) { sendJson(res, { error: 'admin schema not installed', schemaReady: false }, 503); return true; }
    if (!st.isAdmin) {
      logActivity(jwt, { level: 'warn', category: 'security', action: 'admin_denied', user_id: user.id, target: urlPath, ip });
      sendJson(res, { error: 'not authorized' }, 403); return true;
    }

    try {
      if (urlPath === '/api/admin/overview') { sendJson(res, await overview(jwt)); return true; }
      if (urlPath === '/api/admin/live') { sendJson(res, { sessions: liveSessions(), at: new Date().toISOString() }); return true; }
      if (urlPath === '/api/admin/users') {
        sendJson(res, { users: await users(jwt), role: st.role, caps: await capabilities(jwt) });
        return true;
      }
      if (urlPath === '/api/admin/capabilities') { sendJson(res, await capabilities(jwt)); return true; }

      // meeting/bot fleet view
      if (urlPath === '/api/admin/meetings') {
        const rows = await sbRest('meetings?select=id,title,status,platform,bot_provider,starts_at,transcript,summary,deals(name)&order=starts_at.desc.nullslast&limit=200', jwt).catch(() => []);
        const meetings = rows.map(m => ({
          id: m.id, title: m.title, status: m.status, platform: m.platform,
          bot_provider: m.bot_provider, starts_at: m.starts_at,
          client: m.deals ? m.deals.name : null,
          turns: Array.isArray(m.transcript) ? m.transcript.length : 0,
          hasNotes: !!String(m.summary || '').trim(),
        }));
        sendJson(res, {
          meetings, botMode: ctx.botMode ? ctx.botMode() : 'manual',
          stats: {
            total: meetings.length,
            upcoming: meetings.filter(m => !['done', 'cancelled', 'failed'].includes(m.status)).length,
            active: meetings.filter(m => ['joining', 'recording', 'processing'].includes(m.status)).length,
            done: meetings.filter(m => m.status === 'done').length,
            failed: meetings.filter(m => m.status === 'failed').length,
          },
        });
        return true;
      }
      if (urlPath === '/api/admin/telemetry') { sendJson(res, await telemetry(jwt, q)); return true; }
      if (urlPath === '/api/admin/usage') { sendJson(res, await usageBreakdown(jwt)); return true; }
      if (urlPath === '/api/admin/keys') { sendJson(res, keyStatus()); return true; }
      if (urlPath === '/api/admin/health') { sendJson(res, await health()); return true; }
      if (urlPath === '/api/admin/system') { sendJson(res, system()); return true; }

      // ---- logs (the firehose) ----
      if (urlPath === '/api/admin/logs') {
        const level = q.get('level'), category = q.get('category'), search = q.get('q');
        const hours = Math.min(24 * 30, Math.max(1, Number(q.get('hours')) || 24));
        let p = 'activity_log?select=*&at=gte.' + new Date(Date.now() - hours * 3600000).toISOString() + '&order=at.desc&limit=500';
        if (level) p += '&level=eq.' + level;
        if (category) p += '&category=eq.' + category;
        if (search) p += '&or=(action.ilike.*' + encodeURIComponent(search) + '*,target.ilike.*' + encodeURIComponent(search) + '*)';
        const rows = await sbRest(p, jwt);
        const counts = {};
        for (const r of rows) counts[r.category] = (counts[r.category] || 0) + 1;
        sendJson(res, { logs: rows, counts, hours });
        return true;
      }

      // ---- reveal a secret (owner only, always audited) ----
      if (urlPath === '/api/admin/keys/reveal' && req.method === 'POST') {
        if (!st.isOwner) { sendJson(res, { error: 'owner only' }, 403); return true; }
        const { id } = await readBody(req);
        const value = revealKey(id);
        audit(jwt, user.id, 'reveal_key', id, { ip });
        logActivity(jwt, { level: 'warn', category: 'security', action: 'key_revealed', actor_id: user.id, target: id, ip });
        sendJson(res, { id, value });
        return true;
      }

      // ---- credits ----
      if (urlPath === '/api/admin/credits') {
        const [credits, ledger] = await Promise.all([
          sbRest('user_credits?select=*&order=updated_at.desc', jwt),
          sbRest('credit_ledger?select=*&order=created_at.desc&limit=100', jwt),
        ]);
        sendJson(res, { credits, ledger });
        return true;
      }

      // ---- organizations ----
      if (urlPath === '/api/admin/orgs') {
        const [orgs, members] = await Promise.all([
          sbRest('organizations?select=*&order=created_at.desc', jwt),
          sbRest('org_members?select=org_id,user_id,org_role', jwt),
        ]);
        const byOrg = {};
        for (const m of members) (byOrg[m.org_id] = byOrg[m.org_id] || []).push(m);
        sendJson(res, { orgs: orgs.map(o => ({ ...o, members: byOrg[o.id] || [] })) });
        return true;
      }

      // ---- flags & announcements ----
      if (urlPath === '/api/admin/flags') {
        const [flags, announcements] = await Promise.all([
          sbRest('feature_flags?select=*&order=key', jwt),
          sbRest('announcements?select=*&order=created_at.desc&limit=50', jwt),
        ]);
        sendJson(res, { flags, announcements });
        return true;
      }

      // ---- backups ----
      if (urlPath === '/api/admin/backups') {
        let runs = [];
        try { runs = await sbRest('backup_runs?select=*&order=created_at.desc&limit=50', jwt); } catch { /* table may be new */ }
        sendJson(res, { files: listBackups(), runs, keepDays: BACKUP_KEEP_DAYS, scheduled: !!SERVICE_KEY, dir: BACKUP_DIR });
        return true;
      }
      if (urlPath === '/api/admin/backups/download') {
        const f = q.get('file') || '';
        if (!/^backup-[\w.-]+\.json$/.test(f)) { sendJson(res, { error: 'bad file' }, 400); return true; }
        const full = path.join(BACKUP_DIR, f);
        if (!full.startsWith(BACKUP_DIR) || !fs.existsSync(full)) { sendJson(res, { error: 'not found' }, 404); return true; }
        audit(jwt, user.id, 'download_backup', f, {});
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${f}"` });
        fs.createReadStream(full).pipe(res);
        return true;
      }

      if (urlPath === '/api/admin/audit') {
        const rows = await sbRest('admin_audit?select=*&order=created_at.desc&limit=200', jwt);
        sendJson(res, { audit: rows }); return true;
      }

      if (urlPath === '/api/admin/db/query' && req.method === 'POST') {
        const { sql } = await readBody(req);
        if (!sql || !sql.trim()) { sendJson(res, { error: 'sql required' }, 400); return true; }
        const t0 = Date.now();
        const rows = await rpc('admin_query_sql', jwt, { q: sql });
        audit(jwt, user.id, 'db_query', '', { sql: String(sql).slice(0, 500) });
        sendJson(res, { rows: rows || [], ms: Date.now() - t0, count: (rows || []).length });
        return true;
      }
      if (urlPath === '/api/admin/db/action' && req.method === 'POST') {
        const body = await readBody(req);
        sendJson(res, await runAction(jwt, user.id, st, body));
        return true;
      }

      sendJson(res, { error: 'not found' }, 404);
      return true;
    } catch (e) {
      logActivity(jwt, { level: 'error', category: 'admin', action: 'admin_error', actor_id: user.id, target: urlPath, detail: { msg: e.message } });
      sendJson(res, { error: e.message }, 500);
      return true;
    }
  }

  // meetings.js is created after this module, so it hands its botMode() back here
  const setBotMode = (fn) => { ctx.botMode = fn; };

  return { handle, recordRequest, adminState, logActivity, costOf, setBotMode };
};

module.exports.costOf = costOf;
module.exports.recordRequest = recordRequest;
