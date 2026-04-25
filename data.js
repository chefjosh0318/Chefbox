// ── Config ────────────────────────────────────────────────────────────────────
export const CFG = {
  mcApiUrl:   '',
  ocUrl:      'http://127.0.0.1:18789',
  agentName:  'Jarvis',
  aiUrl:      '',
  aiKey:      '',
  aiModel:    'gpt-4o',
  sysPrompt:  'You are Jarvis, the AI CEO of Summit Brands Inc. You help manage ChefBox Reserve, Aura, and Sprig & Fork. Be concise and decisive.',
};

export function loadCFG() {
  try {
    const s = JSON.parse(localStorage.getItem('jarvis_cfg') || '{}');
    Object.assign(CFG, s);
  } catch {}
}

export function saveCFG(patch) {
  Object.assign(CFG, patch);
  localStorage.setItem('jarvis_cfg', JSON.stringify(CFG));
}

// ── Static data ───────────────────────────────────────────────────────────────
export const MEMBERS = [
  { name: 'Marcus R.',   svc: 'ChefBox Reserve', plan: '$97/mo',  status: 'active' },
  { name: 'Priya T.',    svc: 'ChefBox Reserve', plan: '$197/mo', status: 'active' },
  { name: 'Devon K.',    svc: 'Aura',            plan: '$49/mo',  status: 'active' },
  { name: 'Aaliyah S.', svc: 'Aura',            plan: '$99/mo',  status: 'active' },
  { name: 'Jonah W.',   svc: 'Sprig & Fork',    plan: '$29/mo',  status: 'active' },
  { name: 'Camille N.', svc: 'ChefBox Reserve', plan: '$97/mo',  status: 'active' },
  { name: 'Rafael G.',  svc: 'Sprig & Fork',    plan: '$49/mo',  status: 'active' },
  { name: 'Tasha B.',   svc: 'Aura',            plan: '$49/mo',  status: 'paused' },
  { name: 'Owen M.',    svc: 'ChefBox Reserve', plan: '$97/mo',  status: 'paused' },
];

export const CRON_DEFS = [
  // Jarvis
  { id:'j1', agent:'JARVIS', name:'Daily Briefing',       schedule:'06:00 daily',  desc:'Pull KPIs, summarise overnight activity' },
  { id:'j2', agent:'JARVIS', name:'Revenue Snapshot',     schedule:'08:00 daily',  desc:'MRR delta + churn check across all brands' },
  { id:'j3', agent:'JARVIS', name:'Weekly CEO Report',    schedule:'Mon 07:00',    desc:'Full week wrap, goals vs actuals, priorities' },
  // Cipher
  { id:'c1', agent:'CIPHER', name:'Lead Scrape — Apollo', schedule:'09:00 daily',  desc:'Pull 50 fresh ICP leads per brand from Apollo' },
  { id:'c2', agent:'CIPHER', name:'Outreach Sequences',   schedule:'10:00 daily',  desc:'Send personalised cold emails via Gmail SMTP' },
  { id:'c3', agent:'CIPHER', name:'Pipeline Sync',        schedule:'14:00 daily',  desc:'Sync HubSpot deals with Google Sheets tracker' },
  // Forge
  { id:'f1', agent:'FORGE',  name:'Content Calendar',     schedule:'Mon 08:00',    desc:'Generate 7-day social + blog content plan' },
  { id:'f2', agent:'FORGE',  name:'Draft Posts',          schedule:'Tue 09:00',    desc:'Write IG + LinkedIn posts for all brands' },
  { id:'f3', agent:'FORGE',  name:'Email Newsletter',     schedule:'Wed 10:00',    desc:'Draft weekly member newsletter per brand' },
  // Nova
  { id:'n1', agent:'NOVA',   name:'Engagement Monitor',   schedule:'Every 4 hrs',  desc:'Watch brand mentions, reply to comments' },
  { id:'n2', agent:'NOVA',   name:'Member Check-in',      schedule:'Thu 09:00',    desc:'Proactive outreach to at-risk members' },
  // Titan
  { id:'t1', agent:'TITAN',  name:'Ops Health Check',     schedule:'Every 6 hrs',  desc:'Verify API integrations, flag errors' },
  { id:'t2', agent:'TITAN',  name:'Billing Reconcile',    schedule:'1st of month', desc:'Match Stripe charges to membership records' },
];

const AGENT_COLORS = { JARVIS:'#2DD4A8', CIPHER:'#7c6bff', FORGE:'#f59e0b', NOVA:'#fb7185', TITAN:'#60a5fa' };

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function apiFetch(path) {
  const base = CFG.mcApiUrl.replace(/\/$/, '');
  if (!base) return null;
  const r = await fetch(base + path, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(r.status);
  return r.json();
}

export async function fetchAll() {
  const [stripe, pipe, crons] = await Promise.allSettled([
    apiFetch('/api/summit/stripe'),
    apiFetch('/api/summit/pipeline'),
    apiFetch('/api/summit/crons'),
  ]);
  return {
    stripe: stripe.status === 'fulfilled' ? stripe.value : null,
    pipe:   pipe.status   === 'fulfilled' ? pipe.value   : null,
    crons:  crons.status  === 'fulfilled' ? crons.value  : null,
  };
}

// ── Render: Revenue panel ─────────────────────────────────────────────────────
export function renderRevenue(data) {
  const el = document.getElementById('rev-content');
  if (!el) return;
  const mrr = data?.mrr ?? 10236;
  const goal = data?.goal ?? 20000;
  const pct = Math.min(100, Math.round(mrr / goal * 100));
  const active = data?.active_count ?? 7;
  const total  = data?.total_count  ?? 9;
  const gap    = Math.max(0, goal - mrr);
  el.innerHTML = `
    <div class="mrr-big">$${mrr.toLocaleString()}</div>
    <div class="mrr-sub">MRR · Goal $${(goal/1000).toFixed(0)}k</div>
    <div class="prog-bar"><div class="prog-fill" style="width:${pct}%"></div></div>
    <div class="srow"><span class="slabel">To goal</span><span class="sval warn">$${gap.toLocaleString()}</span></div>
    <div class="srow"><span class="slabel">Members</span><span class="sval ok">${active} active · ${total-active} paused</span></div>
    <div class="srow"><span class="slabel">Progress</span><span class="sval">${pct}%</span></div>
  `;
}

// ── Render: Pipeline panel ────────────────────────────────────────────────────
const BRANDS = [
  { name:'ChefBox Reserve', color:'#2DD4A8', key:'chefbox' },
  { name:'Aura',            color:'#a78bfa', key:'aura'    },
  { name:'Sprig & Fork',    color:'#f59e0b', key:'sprig'   },
];

export function renderPipeline(data) {
  const el = document.getElementById('pipe-content');
  if (!el) return;
  el.innerHTML = BRANDS.map(b => {
    const d = data?.[b.key];
    const leads   = d?.leads   ?? '—';
    const convs   = d?.convs   ?? '—';
    const rev_str = d?.revenue != null ? `$${Number(d.revenue).toLocaleString()}` : '—';
    return `<div class="brand-row">
      <div class="bdot" style="background:${b.color}"></div>
      <div>
        <div class="bname">${b.name}</div>
        <div class="bsub">${leads} leads · ${convs} convs · ${rev_str}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Render: Agent / Cron panel ────────────────────────────────────────────────
let _confirmPending = null;

export function renderAgents(cronStatus) {
  const el = document.getElementById('panel-content');
  if (!el) return;

  const grouped = {};
  CRON_DEFS.forEach(c => { (grouped[c.agent] ||= []).push(c); });

  const agents = Object.keys(grouped);
  let html = '';
  agents.forEach(agent => {
    const crons = grouped[agent];
    const errCount = crons.filter(c => cronStatus?.[c.id]?.status === 'error').length;
    const col = AGENT_COLORS[agent] || '#fff';
    html += `<div class="sec-hdr">
      <span style="color:${col}">${agent}</span>
      ${errCount ? `<span class="sec-cnt has-err">${errCount} err</span>` : `<span class="sec-cnt">${crons.length}</span>`}
    </div>`;
    crons.forEach(c => {
      const st = cronStatus?.[c.id];
      const dotCls = st?.status === 'error' ? 'error' : st?.status === 'ok' ? 'ok' : 'idle';
      const lastRun = st?.last_run ? new Date(st.last_run).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'}) : '';
      html += `<div class="entry">
        <div class="entry-top">
          <div class="entry-left"><div class="cdot ${dotCls}"></div><span class="etitle">${c.name}</span></div>
          <button class="run-btn" data-cron-id="${c.id}" data-cron-name="${c.name}">▶ Run</button>
        </div>
        <div class="esub">${c.schedule}${lastRun ? ' · ran '+lastRun : ''}</div>
      </div>`;
    });
  });
  el.innerHTML = html;

  el.querySelectorAll('.run-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id   = btn.dataset.cronId;
      const name = btn.dataset.cronName;
      showConfirm(`Run "${name}"?`, `This will immediately trigger the ${name} cron job.`, () => runCron(id, name));
    });
  });
}

function showConfirm(title, msg, onOk) {
  document.getElementById('confirm-ttl').textContent = title;
  document.getElementById('confirm-msg').textContent = msg;
  _confirmPending = onOk;
  document.getElementById('confirm-modal').classList.add('open');
}

async function runCron(id, name) {
  try {
    const base = CFG.mcApiUrl.replace(/\/$/, '');
    if (!base) { addActivityLog(`No API URL set — can't run ${name}`); return; }
    const r = await fetch(`${base}/api/summit/crons/${id}/run`, { method: 'POST', signal: AbortSignal.timeout(10000) });
    addActivityLog(r.ok ? `✓ Triggered: ${name}` : `✗ Error running: ${name} (${r.status})`);
  } catch (e) {
    addActivityLog(`✗ Failed to reach API for ${name}`);
  }
}

// ── Activity log ──────────────────────────────────────────────────────────────
const activityLog = [];
export function addActivityLog(msg) {
  const ts = new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
  activityLog.unshift({ msg, ts });
  if (activityLog.length > 30) activityLog.pop();
  const el = document.getElementById('log-section');
  if (el) el.insertAdjacentHTML('afterend', `<div class="entry"><div class="entry-top"><div class="entry-left"><div class="cdot ok"></div><span class="etitle" style="font-size:10px">${msg}</span></div><span class="esub">${ts}</span></div></div>`);
}

// ── Render: Members modal ─────────────────────────────────────────────────────
export function renderMembers(liveData) {
  const el = document.getElementById('members-list');
  if (!el) return;
  const members = liveData ?? MEMBERS;
  const active = members.filter(m => m.status === 'active');
  const mrr = active.reduce((s, m) => s + parseInt(m.plan), 0);
  const goal = CFG.mrrGoal ?? 20000;

  const bar = document.querySelector('#members-modal .mrr-bar');
  if (bar) bar.innerHTML = `
    <div class="mrr-cell"><div class="mrr-cell-v">$${mrr.toLocaleString()}</div><div class="mrr-cell-l">Active MRR</div></div>
    <div class="mrr-cell"><div class="mrr-cell-v">$${Math.max(0,goal-mrr).toLocaleString()}</div><div class="mrr-cell-l">Gap to Goal</div></div>
    <div class="mrr-cell"><div class="mrr-cell-v">${active.length} / ${members.length}</div><div class="mrr-cell-l">Active / Total</div></div>
  `;

  el.innerHTML = members.map(m => `
    <div class="mem-row">
      <div><div class="mem-name">${m.name}</div><div class="mem-svc">${m.svc}</div></div>
      <div class="mem-rate">${m.plan}</div>
      <div class="mbadge ${m.status}">${m.status}</div>
    </div>
  `).join('');
}

// ── Confirm modal wiring ──────────────────────────────────────────────────────
export function initConfirmModal() {
  document.getElementById('confirm-ok').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('open');
    if (_confirmPending) { _confirmPending(); _confirmPending = null; }
  });
  document.getElementById('confirm-cancel').addEventListener('click', () => {
    document.getElementById('confirm-modal').classList.remove('open');
    _confirmPending = null;
  });
}

// ── Poll loop ─────────────────────────────────────────────────────────────────
let _pollTimer = null;
export function startPolling(intervalMs = 60000) {
  async function poll() {
    const data = await fetchAll();
    renderRevenue(data.stripe);
    renderPipeline(data.pipe);
    renderAgents(data.crons);
  }
  poll();
  _pollTimer = setInterval(poll, intervalMs);
}

export function stopPolling() {
  clearInterval(_pollTimer);
}
