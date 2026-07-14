'use strict';
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const $ = id => document.getElementById(id);
const el = (h) => { const d = document.createElement('div'); d.innerHTML = h; return d.firstElementChild; };
const esc = s => { const d = document.createElement('div'); d.textContent = s == null ? '' : s; return d.innerHTML; };
const view = () => $('view');

const cfg = await (await fetch('/api/config')).json();
const sb = createClient(cfg.url, cfg.key);

async function token(){ const { data } = await sb.auth.getSession(); return data.session ? data.session.access_token : null; }
async function api(path, body, method){
  const t = await token();
  const r = await fetch(path, {
    method: method || (body !== undefined ? 'POST' : 'GET'),
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  return r.json();
}
const fmtDate = s => { try { return new Date(s).toLocaleString([], { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }); } catch { return s; } };
const fmtDur = n => n ? Math.floor(n/60) + 'm ' + (n%60) + 's' : '—';

// ---------- tiny Markdown renderer (Client Brain uses a fixed template) ----------
function mdToHtml(md){
  if (!md) return '';
  const inline = s => esc(s).replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/\*([^*]+)\*/g,'<em>$1</em>');
  let html = '', inList = false;
  const closeList = () => { if (inList){ html += '</ul>'; inList = false; } };
  for (const raw of String(md).split(/\r?\n/)){
    const line = raw.trimEnd();
    if (/^###\s+/.test(line))      { closeList(); html += '<h4>' + inline(line.replace(/^###\s+/,'')) + '</h4>'; }
    else if (/^##\s+/.test(line))  { closeList(); html += '<h3>' + inline(line.replace(/^##\s+/,'')) + '</h3>'; }
    else if (/^#\s+/.test(line))   { closeList(); html += '<h2>' + inline(line.replace(/^#\s+/,'')) + '</h2>'; }
    else if (/^[-*]\s+/.test(line)){ if (!inList){ html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^[-*]\s+/,'')) + '</li>'; }
    else if (line === '')          { closeList(); }
    else                           { closeList(); html += '<p>' + inline(line) + '</p>'; }
  }
  closeList();
  return html;
}

// ---------- delivery-mark rendering ----------
function renderLine(raw){
  let h = esc(raw);
  h = h.replace(/\|\|\|\|/g, '<span class="pause long">‖‖ 2s</span>');
  h = h.replace(/\|\|/g, '<span class="pause">‖</span>');
  h = h.replace(/\[([^\]]+)\]/g, '<span class="cue">$1</span>');
  h = h.replace(/↘/g, '<span class="down">↘</span>');
  h = h.replace(/↗/g, '<span class="up">↗</span>');
  h = h.replace(/\*([^*]+)\*/g, '<b>$1</b>');
  return h;
}
function cardHtml(c, done){
  const silent = /silent/i.test(c.tone);
  let h = '<span class="tone' + (silent ? ' silent' : '') + '">' + esc(c.tone) + '</span>' +
          '<div class="line">' + renderLine(c.line) + '</div>';
  if (done && (c.technique || c.why)) h += '<div class="why"><em>' + esc(c.technique) + '</em>' + (c.why ? ' — ' + esc(c.why) : '') + '</div>';
  return h;
}

// ---------- live-call shared state (survives view switches) ----------
const call = {
  active: false, dealId: null, productId: null, brief: null, clientName: null, productName: null,
  transcript: [], cards: [], streaming: null,
  recs: [], socks: [], streams: []
};

function setCallbar(){ $('callbar').classList.toggle('hidden', !call.active); }

// events socket — connected once signed in, stays open
let ev = null, srvOn = false;
async function connectEvents(){
  if (ev && (ev.readyState === 0 || ev.readyState === 1)) return;
  const t = await token(); if (!t) return;
  ev = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/events?t=' + encodeURIComponent(t));
  ev.onopen = () => { srvOn = true; markDots(); };
  ev.onclose = () => { srvOn = false; markDots(); setTimeout(connectEvents, 1500); };
  ev.onmessage = m => {
    const d = JSON.parse(m.data);
    if (d.type === 'transcript') pushTurn(d.ch, d.text);
    else if (d.type === 'interim') { const i = $('interim'); if (i) i.textContent = (d.ch==='me'?'ME: ':'PROSPECT: ') + d.text; }
    else if (d.type === 'card-stream') pushCard(d);
    else if (d.type === 'status') { const st = $('livestatus'); if (st) st.textContent = d.msg; }
  };
}
function markDots(){ const s=$('d-srv'); if(s) s.classList.toggle('on', srvOn); }

function pushTurn(ch, text){
  const last = call.transcript[call.transcript.length-1];
  if (last && last.ch === ch) last.text += ' ' + text; else call.transcript.push({ ch, text });
  const box = $('transcript'); if (box){ renderTranscript(box); const i=$('interim'); if(i) i.textContent=''; }
}
function pushCard(c){
  if (!c.done){ call.streaming = c; }
  else { call.streaming = null; if (c.line) call.cards.push(c); }
  const box = $('cards'); if (box) renderCards(box);
  updatePip(c);
}
function renderTranscript(box){
  box.innerHTML = call.transcript.map(t =>
    '<div class="t ' + t.ch + '"><span class="who2">' + (t.ch==='me'?'ME':'PROSPECT') + '</span>' + esc(t.text) + '</div>').join('');
  box.scrollTop = box.scrollHeight;
}
function renderCards(box){
  const list = call.cards.slice(-4).map(c => '<div class="card old">' + cardHtml(c, true) + '</div>');
  if (call.streaming) list.push('<div class="card">' + cardHtml(call.streaming, false) + '</div>');
  else if (list.length) list[list.length-1] = list[list.length-1].replace('card old', 'card');
  box.innerHTML = list.join('') || '<div class="muted" style="margin:auto;text-align:center;max-width:320px">Coached lines appear here the moment they matter. Small talk stays silent.</div>';
  box.scrollTop = box.scrollHeight;
}

// ---------- floating overlay (Document PiP) ----------
let pipWin = null;
async function popOut(){
  if (pipWin){ pipWin.focus(); return; }
  if (!('documentPictureInPicture' in window)){ alert('Overlay needs Chrome 116+.'); return; }
  pipWin = await documentPictureInPicture.requestWindow({ width: 620, height: 210 });
  const b = pipWin.document.body;
  b.style.cssText = 'margin:0;background:#fff;color:#0e1524;font:15px/1.5 "Inter","Segoe UI",system-ui,sans-serif;overflow:hidden;border-top:3px solid #5b5bef';
  b.innerHTML = '<div id="pc" style="padding:14px 18px;color:#64748b">Overlay live — the next card appears here, on top of everything.</div>';
  pipWin.addEventListener('pagehide', () => { pipWin = null; });
}
function updatePip(c){
  if (!pipWin) return;
  const silent = /silent/i.test(c.tone);
  pipWin.document.getElementById('pc').innerHTML =
    '<div style="padding:12px 18px"><span style="display:inline-block;font-size:12px;font-weight:700;letter-spacing:.6px;color:#fff;background:' + (silent?'#b7791f':'#5b5bef') + ';border-radius:6px;padding:2px 10px;margin-bottom:8px;text-transform:uppercase">' + esc(c.tone) + '</span>' +
    '<div style="font-size:22px;font-weight:600;line-height:1.5">' + renderLine(c.line)
      .replace(/class="pause long"/g,'style="color:#4b3fe0;font-weight:800;font-size:13px;background:#eef0fe;border-radius:5px;padding:2px 7px"')
      .replace(/class="pause"/g,'style="color:#5b5bef;font-weight:800;padding:0 3px"')
      .replace(/class="cue"/g,'style="font-size:12px;font-style:italic;color:#475569;background:#eef2f7;border-radius:5px;padding:1px 8px;margin:0 3px"')
      .replace(/class="down"/g,'style="color:#2563eb"').replace(/class="up"/g,'style="color:#b45309"') + '</div></div>';
}

// ================= VIEWS =================
async function viewHome(){
  view().innerHTML = '<div class="muted">Loading…</div>';
  const d = await api('/api/home');
  view().innerHTML = `
    <div class="page-h"><h1>Home</h1><div class="spacer"></div>
      <button onclick="location.hash='#/new'">＋ New Call</button></div>
    <div class="grid stats">
      <div class="stat"><div class="n">${d.stats.total||0}</div><div class="l">Clients</div></div>
      <div class="stat"><div class="n">${d.stats.open||0}</div><div class="l">Open</div></div>
      <div class="stat won"><div class="n">${d.stats.won||0}</div><div class="l">Won</div></div>
      <div class="stat lost"><div class="n">${d.stats.lost||0}</div><div class="l">Lost</div></div>
    </div>
    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
      <div><h3 style="margin-bottom:10px">Recent clients</h3><div class="rowlist" id="rc">${
        d.recentClients.length ? d.recentClients.map(c => rowClient(c)).join('') : '<div class="muted">No clients yet — start a call to create one.</div>'
      }</div></div>
      <div><h3 style="margin-bottom:10px">Recent calls</h3><div class="rowlist" id="rk">${
        d.recentCalls.length ? d.recentCalls.map(c => rowCall(c)).join('') : '<div class="muted">No calls yet.</div>'
      }</div></div>
    </div>`;
  wireRows();
}
function rowClient(c){
  return `<div class="row" data-go="#/clients/${c.id}"><div><div class="title">${esc(c.name)}</div>
    <div class="meta">${esc(c.company||'')} · ${c.calls} call${c.calls===1?'':'s'}</div></div>
    <div class="spacer"></div><span class="badge ${c.status}">${c.status}</span></div>`;
}
function rowCall(c){
  return `<div class="row" data-go="#/calls/${c.id}"><div><div class="title">${esc(c.client)}</div>
    <div class="meta">${esc(c.product_name||'')} · ${fmtDate(c.created_at)}</div></div></div>`;
}

async function viewClients(){
  view().innerHTML = `<div class="page-h"><h1>Clients</h1><div class="spacer"></div>
    <button id="addc">＋ Add client</button></div><div class="rowlist" id="list"><div class="muted">Loading…</div></div>`;
  $('addc').onclick = addClientFlow;
  const d = await api('/api/clients');
  $('list').innerHTML = d.clients.length ? d.clients.map(rowClient).join('') : '<div class="muted">No clients yet.</div>';
  wireRows();
}
async function addClientFlow(){
  const name = prompt('Client name (the person on the call):'); if (!name) return;
  const company = prompt('Company (optional):') || '';
  const r = await api('/api/clients', { name, company });
  if (r.client) location.hash = '#/clients/' + r.client.id;
}

async function viewClient(id){
  view().innerHTML = '<div class="muted">Loading…</div>';
  const d = await api('/api/clients/' + id);
  if (d.error){ view().innerHTML = '<div class="muted">Not found.</div>'; return; }
  const c = d.client;
  const brain = (c.memory_md || '').trim();
  view().innerHTML = `
    <div class="page-h"><a href="#/clients" class="muted">← Clients</a></div>
    <div class="page-h"><h1>${esc(c.name)}</h1><span class="badge ${c.status}">${c.status}</span>
      <div class="spacer"></div>
      <button class="ghost sm" data-st="open">Open</button>
      <button class="ghost sm" data-st="won">Mark Won</button>
      <button class="ghost sm" data-st="lost">Mark Lost</button>
      <button data-newcall>＋ New call with ${esc(c.name.split(' ')[0])}</button></div>
    <div class="muted" style="margin-bottom:16px">${esc(c.company||'')}</div>

    <div class="page-h" style="margin-bottom:8px"><h3>🧠 Client Brain</h3>
      <span class="muted" style="font-size:12px">auto-updated after every call</span><div class="spacer"></div>
      ${brain?'<button class="ghost sm" id="dlmd">⬇ Download .md</button>':''}</div>
    <div class="card-panel brain">${ brain ? mdToHtml(brain) : '<span class="muted">No history yet — your first call will build this.</span>' }</div>

    <label>Your notes</label>
    <textarea id="notes" placeholder="Anything you want to remember about this client…">${esc(c.notes||'')}</textarea>
    <button class="ghost sm" id="savenotes" style="margin-top:8px">Save notes</button>

    <h3 style="margin:24px 0 10px">Call history (${(c.calls||[]).length})</h3>
    <div class="rowlist">${
      (c.calls||[]).length ? c.calls.map(k => `<div class="row" data-go="#/calls/${k.id}">
        <div><div class="title">${fmtDate(k.created_at)}</div><div class="meta">${esc(k.summary||'').slice(0,120)}</div></div>
        <div class="spacer"></div><span class="meta">${fmtDur(k.duration_sec)}</span></div>`).join('')
      : '<div class="muted">No calls yet.</div>'
    }</div>`;
  view().querySelector('[data-newcall]').onclick = () => { call.dealId = id; location.hash = '#/new'; };
  view().querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
    await api('/api/clients/' + id, { status: b.dataset.st }, 'PATCH'); viewClient(id);
  });
  $('savenotes').onclick = async () => { await api('/api/clients/' + id, { notes: $('notes').value }, 'PATCH'); $('savenotes').textContent = 'Saved ✓'; };
  if ($('dlmd')) $('dlmd').onclick = () => {
    const blob = new Blob([c.memory_md], { type:'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = (c.name||'client').replace(/[^\w]+/g,'_') + '.md'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  wireRows();
}

async function viewCalls(){
  view().innerHTML = `<div class="page-h"><h1>Calls</h1></div><div class="rowlist" id="list"><div class="muted">Loading…</div></div>`;
  const d = await api('/api/calls');
  $('list').innerHTML = d.calls.length ? d.calls.map(c => `<div class="row" data-go="#/calls/${c.id}">
    <div><div class="title">${esc(c.client)}</div><div class="meta">${esc(c.product_name||'')} · ${fmtDate(c.created_at)} · ${fmtDur(c.duration_sec)}</div></div>
    <div class="spacer"></div><span class="meta">${esc((c.summary||'').slice(0,60))}</span></div>`).join('')
    : '<div class="muted">No calls recorded yet.</div>';
  wireRows();
}

async function viewCall(id){
  view().innerHTML = '<div class="muted">Loading…</div>';
  const d = await api('/api/calls/' + id);
  const c = d.call;
  if (!c){ view().innerHTML = '<div class="muted">Not found.</div>'; return; }
  const tr = (c.transcript||[]).map(t => '<div class="t ' + t.ch + '"><span class="who2">' + (t.ch==='me'?'ME':'PROSPECT') + '</span>' + esc(t.text) + '</div>').join('');
  const cards = (c.cards||[]).map(k => '<div class="card old">' + cardHtml(k, true) + '</div>').join('') || '<div class="muted">No cards fired.</div>';
  view().innerHTML = `
    <div class="page-h"><a href="#/calls" class="muted">← Calls</a></div>
    <div class="page-h"><h1>${esc(c.deals?c.deals.name:'Call')}</h1><div class="spacer"></div>
      ${c.deal_id?`<button class="ghost sm" onclick="location.hash='#/clients/${c.deal_id}'">View client</button>`:''}</div>
    <div class="muted" style="margin-bottom:14px">${esc(c.product_name||'')} · ${fmtDate(c.created_at)} · ${fmtDur(c.duration_sec)}</div>
    <div class="card-panel" style="margin-bottom:16px"><b>Summary</b><br>${esc(c.summary||'—')}</div>
    <div class="grid" style="grid-template-columns:1fr 1fr;align-items:start">
      <div><h3 style="margin-bottom:8px">Transcript</h3><div class="tscroll">${tr||'<div class="muted">—</div>'}</div></div>
      <div><h3 style="margin-bottom:8px">Coaching that fired</h3><div class="tscroll">${cards}</div></div>
    </div>`;
}

// ---------- conversational playbook interview ----------
const INTERVIEW = [
  { key:'name', short:true, required:true, q:"What should we call this playbook? (usually the product or offer name)", ph:"e.g. Vextria HVAC" },
  { key:'offer', required:true, q:"In a sentence or two, what exactly do you sell?", ph:"An AI voice receptionist for HVAC companies that answers every call 24/7 and books the job." },
  { key:'outcome', q:"What's the real outcome or transformation the customer gets — the 'after' state?", ph:"They never miss a job again; every call is answered and booked, even after hours." },
  { key:'buyer', q:"Who's on the other end of the call — their role, industry, and what their world looks like?", ph:"Owner-operator HVAC, out on jobs all day, answers the phone himself between calls." },
  { key:'pain', q:"What's the #1 problem you solve — and what does NOT solving it cost them, in their own terms (money, time, jobs, stress)?", ph:"Missed calls = lost jobs to competitors — 5-6 a week, ~$300 each = real money walking away." },
  { key:'objections', big:true, q:"Now the important part — your objections. List the ones you hear most, in the prospect's own words, each with your best answer. Add as many as you can.", ph:"\"It's too expensive\" → Compared to one missed job a week? It pays for itself...\n\"AI sounds robotic\" → ...\n\"I already have an answering service\" → ..." },
  { key:'proof', q:"What proof do you have — results, numbers, testimonials — and any guarantee or risk-reversal?", ph:"One client recovered 8 jobs in month one. 30-day money-back guarantee." },
  { key:'competition', q:"What else might they consider (including doing nothing), and why are you the better choice?", ph:"Cheap answering services just take messages; voicemail loses the job; we actually book it." },
  { key:'close', q:"What EXACTLY are you asking them to do on the call — and your price, plus any REAL urgency?", ph:"Start a paid pilot today. $1,400 setup + first month. Only a few onboarding slots left this month." },
  { key:'voice', q:"Last one — how do you want to SOUND on these calls? Any phrases you always or never use?", ph:"Calm, confident, consultative — never pushy. I always say 'makes sense?'" }
];

function renderInterview(container, onComplete){
  const answers = {}; let qi = 0;
  const step = () => {
    if (qi >= INTERVIEW.length){ compileAndSave(); return; }
    const item = INTERVIEW[qi];
    const prior = INTERVIEW.slice(0, qi).filter(it=>answers[it.key]).map(it =>
      `<div class="iv-qa"><div class="iv-q">${esc(it.q)}</div><div class="iv-a">${esc(answers[it.key]).replace(/\n/g,'<br>')}</div></div>`).join('');
    container.innerHTML = `
      <div class="iv-progress">Question ${qi+1} of ${INTERVIEW.length}</div>
      ${prior ? `<div class="iv-history">${prior}</div>` : ''}
      <div class="iv-current">
        <div class="iv-q big">${esc(item.q)}</div>
        <div class="msg" id="ivMsg"></div>
        ${item.short ? `<input id="ivInput" placeholder="${esc(item.ph||'')}">`
                     : `<textarea id="ivInput" style="min-height:${item.big?170:110}px" placeholder="${esc(item.ph||'')}"></textarea>`}
        <div style="margin-top:10px;display:flex;gap:8px">
          ${qi>0 ? '<button class="ghost" id="ivBack">← Back</button>' : ''}
          <button id="ivNext">${qi===INTERVIEW.length-1 ? 'Build my playbook →' : 'Next →'}</button>
          ${item.required ? '' : '<button class="ghost" id="ivSkip">Skip</button>'}
        </div>
      </div>`;
    const input = container.querySelector('#ivInput');
    input.value = answers[item.key] || ''; input.focus();
    if (item.short) input.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); container.querySelector('#ivNext').click(); } });
    const advance = () => { answers[item.key] = input.value.trim(); qi++; step(); };
    container.querySelector('#ivNext').onclick = () => {
      if (item.required && !input.value.trim()){ const m=container.querySelector('#ivMsg'); m.className='msg err'; m.textContent='This one is needed to build a useful playbook.'; return; }
      advance();
    };
    if (qi>0) container.querySelector('#ivBack').onclick = () => { answers[item.key]=input.value.trim(); qi--; step(); };
    const skip = container.querySelector('#ivSkip'); if (skip) skip.onclick = () => { answers[item.key]=''; qi++; step(); };
  };
  const compileAndSave = async () => {
    container.innerHTML = `<div class="iv-progress">Building your playbook…</div>
      <div class="muted">Turning your answers into a coaching playbook — this takes a few seconds.</div>`;
    try {
      const name = answers.name || 'My playbook';
      const c = await api('/api/playbook/compile', { answers });
      const r = await api('/api/products', { name, content: c.content });
      onComplete(r.product.id, name);
    } catch(e){
      container.innerHTML = `<div class="msg err">Couldn't build it: ${esc(e.message)}</div>`;
    }
  };
  step();
}

function viewPlaybookNew(){
  view().innerHTML = `<div class="page-h"><a href="#/products" class="muted">← Products</a></div>
    <div class="page-h"><h1>Build a playbook</h1></div>
    <p class="muted" style="margin-bottom:16px;max-width:640px">I'll ask you a few questions about what you sell, then compile them into a coaching playbook. The sharper your answers, the sharper your lines on the call.</p>
    <div class="card-panel" id="ivHost" style="max-width:720px"></div>`;
  renderInterview($('ivHost'), (id) => { location.hash = '#/products/' + id; });
}

async function viewProducts(){
  view().innerHTML = `<div class="page-h"><h1>Products</h1><div class="spacer"></div>
    <button onclick="location.hash='#/playbook/new'">＋ Add playbook</button></div>
    <div class="rowlist" id="list"><div class="muted">Loading…</div></div>`;
  const d = await api('/api/products');
  $('list').innerHTML = d.products.map(p => `<div class="row" data-go="#/products/${p.id}">
    <div class="title">${esc(p.name)}</div></div>`).join('');
  wireRows();
}
async function viewProduct(id){
  const isNew = id === 'new';
  let p = { name:'', content:'' };
  if (!isNew){ p = await api('/api/products/' + id); }
  view().innerHTML = `
    <div class="page-h"><a href="#/products" class="muted">← Products</a></div>
    <div class="page-h"><h1>${isNew?'New product':'Edit product'}</h1></div>
    <div class="msg" id="pmsg"></div>
    <label>Product name</label><input id="pname" value="${esc(p.name)}" placeholder="e.g. Vextria HVAC">
    <label>Product knowledge <span class="muted">(offer, pricing, common objections + your best answers, proof — the coach reads this every call)</span></label>
    <textarea id="pcontent" style="min-height:340px">${esc(p.content)}</textarea>
    <div style="margin-top:12px;display:flex;gap:8px">
      <button id="psave">Save</button>
      ${isNew?'':'<button class="ghost" id="pdel">Delete</button>'}
    </div>`;
  $('psave').onclick = async () => {
    const name = $('pname').value.trim();
    if (!name){ $('pmsg').className='msg err'; $('pmsg').textContent='Name required'; return; }
    await api('/api/products', { id: isNew?null:id, name, content: $('pcontent').value });
    location.hash = '#/products';
  };
  if (!isNew) $('pdel').onclick = async () => { if (confirm('Delete this product?')){ await api('/api/products/'+id, undefined, 'DELETE'); location.hash='#/products'; } };
}

async function viewNew(){
  const pd = await api('/api/products');
  const cd = await api('/api/clients');
  if (!pd.products.length){
    view().innerHTML = `<div class="page-h"><h1>New Call</h1></div>
      <div class="card-panel" style="max-width:560px">
        <p style="margin-bottom:14px">You need at least one <b>playbook</b> (what you're selling) before starting a call.</p>
        <button onclick="location.hash='#/products/new'">Create your first playbook →</button></div>`;
    return;
  }
  view().innerHTML = `
    <div class="page-h"><h1>New Call</h1></div>
    <div class="card-panel" style="max-width:640px">
      <div class="setup-row">
        <div><label>Which playbook are you selling on this call?</label>
          <select id="selProduct">${pd.products.map(p=>`<option value="${p.id}" ${call.productId===p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Client</label>
          <select id="selClient"><option value="">＋ New client…</option>${
            cd.clients.map(c=>`<option value="${c.id}" ${call.dealId===c.id?'selected':''}>${esc(c.name)}${c.company?' — '+esc(c.company):''} (${c.calls})</option>`).join('')
          }</select></div>
      </div>
      <div id="newClientFields" class="setup-row hidden" style="margin-top:10px">
        <div><label>New client name</label><input id="ncName" placeholder="Person on the call"></div>
        <div><label>Company (optional)</label><input id="ncCompany"></div>
      </div>
      <div class="consent">Tip: at the start of the call, say "I use an AI assistant that transcribes our conversation — is that okay?" Then share your <b>Meet tab</b> with <b>"Also share tab audio"</b> ticked.</div>
      <div style="margin-top:16px"><button id="startBtn">Start Call →</button>
        <span class="muted" id="startMsg" style="margin-left:10px"></span></div>
    </div>`;
  const selClient = $('selClient');
  const toggleNew = () => $('newClientFields').classList.toggle('hidden', selClient.value !== '');
  selClient.onchange = toggleNew; toggleNew();
  $('startBtn').onclick = startCall;
}

// ---------- start / end a live call ----------
async function startCall(){
  const btn = $('startBtn'); btn.disabled = true;
  const msg = $('startMsg'); msg.textContent = '';
  try {
    let dealId = $('selClient').value;
    if (!dealId){
      const name = ($('ncName').value||'').trim();
      if (!name){ msg.textContent = 'Enter a client name or pick one.'; btn.disabled=false; return; }
      const r = await api('/api/clients', { name, company: ($('ncCompany').value||'').trim() });
      dealId = r.client.id;
    }
    const productId = $('selProduct').value;
    const r = await api('/api/call/start', { dealId, productId });

    msg.textContent = 'Allow mic, then pick your Meet tab with "share tab audio"…';
    const mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation:true, noiseSuppression:true } });
    const disp = await navigator.mediaDevices.getDisplayMedia({ video:true, audio:true });
    if (!disp.getAudioTracks().length){
      alert('No tab audio. Pick the MEET TAB and tick "Also share tab audio", then Start Call again.');
      mic.getTracks().forEach(t=>t.stop()); disp.getTracks().forEach(t=>t.stop()); btn.disabled=false; return;
    }
    disp.getVideoTracks()[0].onended = () => { if (call.active) endCall(); };

    call.active = true; call.dealId = dealId; call.productId = productId;
    call.brief = r.brief; call.clientName = r.clientName; call.productName = r.productName;
    call.transcript = []; call.cards = []; call.streaming = null;
    call.streams = [mic, disp];
    await connectEvents();
    const t = await token();
    pipeAudio(mic, 'me', t);
    pipeAudio(new MediaStream(disp.getAudioTracks()), 'prospect', t);
    setCallbar();
    location.hash = '#/live';
  } catch(e){ msg.textContent = 'Could not start: ' + e.message; btn.disabled = false; }
}
function pipeAudio(stream, ch, t){
  const ws = new WebSocket((location.protocol==='https:'?'wss://':'ws://') + location.host + '/audio?ch=' + ch + '&t=' + encodeURIComponent(t));
  const rec = new MediaRecorder(stream, { mimeType:'audio/webm;codecs=opus', audioBitsPerSecond:64000 });
  rec.ondataavailable = e => { if (e.data.size && ws.readyState===1) e.data.arrayBuffer().then(b=>ws.send(b)); };
  ws.onopen = () => rec.start(250);
  call.socks.push(ws); call.recs.push(rec);
}
async function endCall(){
  call.recs.forEach(r=>{ try{ r.state!=='inactive'&&r.stop(); }catch{} });
  call.socks.forEach(w=>{ try{ w.close(); }catch{} });
  call.streams.forEach(s=>s.getTracks().forEach(t=>t.stop()));
  call.recs=[]; call.socks=[]; call.streams=[];
  const wasActive = call.active; call.active = false; setCallbar();
  if (!wasActive) return;
  const st = $('livestatus'); if (st) st.textContent = 'analyzing & saving memory…';
  const r = await api('/api/call/end', {});
  if (r.dealId) location.hash = '#/clients/' + r.dealId;
  else location.hash = '#/home';
}

function viewLive(){
  if (!call.active && !call.transcript.length){ location.hash = '#/new'; return; }
  view().innerHTML = `
    <div class="page-h"><h1>Live Call${call.clientName?' — '+esc(call.clientName):''}</h1>
      <div class="spacer"></div>
      <span class="pill"><span class="dot on" id="d-srv"></span>coach</span>
      ${call.active?'<span class="rec">● transcribing</span>':''}
      <button class="ghost sm" id="overlayBtn">Overlay ⇱</button>
      <button class="ghost sm" id="testBtn">Test ⚡</button>
      ${call.active?'<button class="stop" id="endBtn">End Call</button>':''}</div>
    ${call.brief?`<div class="brief brainbrief" style="margin-bottom:14px"><b>Pre-call brief — Client Brain</b><div class="brief-body">${mdToHtml(call.brief)}</div></div>`:''}
    <div class="live-wrap">
      <div class="live-left"><div id="cards"></div></div>
      <div class="live-right">
        <div class="tr-head">LIVE TRANSCRIPT</div>
        <div id="transcript"></div>
        <div id="interim"></div>
        <div class="tr-head" id="livestatus" style="border-top:1px solid var(--line);border-bottom:none">${call.active?'live — listening on both channels':'call ended'}</div>
      </div>
    </div>`;
  markDots();
  renderCards($('cards')); renderTranscript($('transcript'));
  $('overlayBtn').onclick = popOut;
  $('testBtn').onclick = () => api('/simulate', {});
  if ($('endBtn')) $('endBtn').onclick = endCall;
}

// ================= ROUTER =================
const routes = [
  [/^#\/home$/, viewHome],
  [/^#\/new$/, viewNew],
  [/^#\/live$/, viewLive],
  [/^#\/clients$/, viewClients],
  [/^#\/clients\/(.+)$/, m => viewClient(m[1])],
  [/^#\/calls$/, viewCalls],
  [/^#\/calls\/(.+)$/, m => viewCall(m[1])],
  [/^#\/products$/, viewProducts],
  [/^#\/playbook\/new$/, viewPlaybookNew],
  [/^#\/products\/(.+)$/, m => viewProduct(m[1])],
];
function router(){
  const h = location.hash || '#/home';
  document.querySelectorAll('#sidebar nav a').forEach(a => a.classList.toggle('active', h.startsWith(a.getAttribute('href'))));
  for (const [re, fn] of routes){ const m = h.match(re); if (m){ fn(m); return; } }
  location.hash = '#/home';
}
function wireRows(){ view().querySelectorAll('[data-go]').forEach(r => r.onclick = () => location.hash = r.dataset.go); }

$('navNew').onclick = () => location.hash = '#/new';
$('signout').onclick = async () => { await sb.auth.signOut(); location.reload(); };
window.addEventListener('hashchange', router);

// ================= ONBOARDING WIZARD =================
function finishWizard(){ const w = $('wizard'); if (w) w.remove(); }
function startWizard(me){
  const steps = ['name'];
  if (!me.hasProducts) steps.push('product');
  if (!me.hasClients) steps.push('client');
  steps.push('done');
  let i = 0;
  const data = { productId: null, dealId: null };

  const veil = document.createElement('div');
  veil.className = 'veil'; veil.id = 'wizard';
  document.body.appendChild(veil);

  const render = () => {
    const step = steps[i];
    veil.innerHTML = `<div class="authwrap" style="width:560px;height:auto">
      <div class="authform" style="width:100%;padding:38px">
        <div class="loginbox" style="max-width:100%">
          <div class="brand" style="margin-bottom:6px"><span class="bdot"></span>Closer <b>Copilot</b></div>
          <div class="muted" style="font-size:12px;margin-bottom:16px">Setup · step ${i+1} of ${steps.length}</div>
          <div class="msg" id="wmsg"></div>
          <div id="wzbody"></div>
        </div></div></div>`;
    const body = veil.querySelector('#wzbody');
    const wmsg = t => { const m = veil.querySelector('#wmsg'); m.className='msg err'; m.textContent = t; };

    if (step === 'name'){
      body.innerHTML = `<h1 class="auth-h">Welcome 👋</h1><p class="sub">What should we call you?</p>
        <label>Your name</label><input id="wname" placeholder="e.g. Abdur" value="${esc(me.name||'')}">
        <button class="wide" id="wnext">Continue →</button>`;
      veil.querySelector('#wnext').onclick = async () => {
        const name = veil.querySelector('#wname').value.trim();
        if (!name) return wmsg('Enter your name');
        await api('/api/profile', { name });
        $('whoami').textContent = name;
        i++; render();
      };
      veil.querySelector('#wname').focus();
    }
    else if (step === 'product'){
      body.innerHTML = `<h1 class="auth-h">Build your first playbook</h1>
        <p class="sub">I'll ask you a few quick questions about what you sell, then turn them into your coaching playbook.</p>
        <div id="ivHost"></div>`;
      renderInterview(veil.querySelector('#ivHost'), (id) => { data.productId = id; i++; render(); });
    }
    else if (step === 'client'){
      body.innerHTML = `<h1 class="auth-h">Add your first client</h1>
        <p class="sub">The person you'll be selling to. Their memory builds from your first call.</p>
        <label>Client name</label><input id="wcname" placeholder="Person on the call">
        <label>Company (optional)</label><input id="wccompany" placeholder="Their company">
        <button class="wide" id="wnext">Continue →</button>`;
      veil.querySelector('#wnext').onclick = async () => {
        const name = veil.querySelector('#wcname').value.trim();
        if (!name) return wmsg('Enter a client name');
        const r = await api('/api/clients', { name, company: veil.querySelector('#wccompany').value.trim() });
        data.dealId = r.client && r.client.id;
        i++; render();
      };
    }
    else {
      body.innerHTML = `<h1 class="auth-h">You're all set 🎉</h1>
        <p class="sub">Start your first call. On the call screen, hit <b>Test ⚡</b> to feel the coaching instantly — no real call needed.</p>
        <button class="wide" id="wgo">Start my first call →</button>
        <button class="wide ghost" id="wskip">Go to Home</button>`;
      veil.querySelector('#wgo').onclick = () => {
        if (data.dealId) call.dealId = data.dealId;
        if (data.productId) call.productId = data.productId;
        finishWizard(); location.hash = '#/new'; router();
      };
      veil.querySelector('#wskip').onclick = () => { finishWizard(); location.hash = '#/home'; router(); };
    }
  };
  render();
}

// ================= AUTH =================
function lmsg(t, ok){ const m=$('lmsg'); m.className='msg '+(ok?'ok':'err'); m.textContent=t; }
async function enterApp(){
  $('login').classList.add('hidden'); $('app').classList.remove('hidden');
  const { data:{ user } } = await sb.auth.getUser();
  const av = $('avatar'); if (av) av.textContent = (user && user.email ? user.email[0] : '?').toUpperCase();
  connectEvents();
  const me = await api('/api/me');
  $('whoami').textContent = (me && me.name) ? me.name : (user ? user.email : '');
  if (me && !me.name){ startWizard(me); return; }
  if (!location.hash) location.hash = '#/home'; else router();
}
$('lsignin').onclick = async () => {
  lmsg('signing in…', true);
  const { error } = await sb.auth.signInWithPassword({ email:$('lemail').value.trim(), password:$('lpass').value });
  if (error) return lmsg(error.message);
  enterApp();
};
$('lsignup').onclick = async () => {
  lmsg('creating account…', true);
  const { data, error } = await sb.auth.signUp({ email:$('lemail').value.trim(), password:$('lpass').value });
  if (error) return lmsg(error.message);
  if (data.session) enterApp();
  else lmsg('Account created — check your email to confirm, then sign in.', true);
};
$('lpass').addEventListener('keydown', e => { if (e.key==='Enter') $('lsignin').click(); });

const { data:{ session } } = await sb.auth.getSession();
if (session) enterApp();
