import { loadCFG, CFG, saveCFG, addActivityLog, getActivityLog,
         fetchMembers, fetchMRR, fetchBookings, fetchAuraEvents,
         fetchBlogPosts, fetchPipeline, AGENTS, CRON_DEFS, MEMBERS_FALLBACK, fmtMRR } from './data.js';
import { initScene } from './scene.js';
import { initMic, initMicButton, initPassiveListening, setAmplitudeCallback,
         startMic, stopMic, sendToJarvis, speak, showCard, initTelegram, initSettings } from './voice.js';

// ── Boot ──────────────────────────────────────────────────────────────────────
loadCFG();
initScene();
initMic();
initMicButton();
initPassiveListening();
initTelegram();
initSettings();

setAmplitudeCallback(amp => {
  const btn = document.getElementById('mic-btn');
  if (btn && btn.classList.contains('active')) {
    btn.style.boxShadow = `0 0 ${8 + amp * 32}px rgba(45,212,168,${0.2 + amp * 0.5})`;
  }
});

// ── Space bar push-to-talk ────────────────────────────────────────────────────
let spaceHeld = false;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !e.target.matches('input,textarea') && !spaceHeld) {
    e.preventDefault();
    spaceHeld = true;
    startMic();
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && !e.target.matches('input,textarea')) {
    spaceHeld = false;
    stopMic();
  }
});

// ── Chat bar ──────────────────────────────────────────────────────────────────
const chatInput = document.getElementById('chat-input');
const chatSend  = document.getElementById('chat-send');

function doChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  chatInput.value = '';
  addActivityLog(`You: "${text.slice(0,60)}${text.length>60?'…':''}"`);
  sendToJarvis(text);
}
chatSend.addEventListener('click', doChat);
chatInput.addEventListener('keydown', e => { if (e.key === 'Enter') doChat(); });

// ── Activity feed ─────────────────────────────────────────────────────────────
window.addEventListener('activity', e => {
  const feed = document.getElementById('activity-feed');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = 'act-entry';
  div.innerHTML = `${e.detail.msg}<span class="act-ts">${new Date().toLocaleTimeString()}</span>`;
  feed.prepend(div);
  // trim to 40
  while (feed.children.length > 40) feed.lastChild.remove();
  const cnt = document.getElementById('act-count');
  if (cnt) cnt.textContent = feed.children.length;
});

// ── Brand tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.btab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.btab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    // future: filter panels by brand
  });
});

// ── Render agents ─────────────────────────────────────────────────────────────
function renderAgents() {
  const grid = document.getElementById('agent-grid');
  if (!grid) return;
  grid.innerHTML = '';
  AGENTS.forEach(a => {
    const cronCount = CRON_DEFS.filter(c => c.agent === a.id).length;
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty('--agent-color', a.color);
    card.innerHTML = `
      <div style="position:absolute;top:0;left:0;right:0;height:2px;background:${a.color};border-radius:14px 14px 0 0"></div>
      <div class="agent-top">
        <div class="agent-icon" style="background:${a.color}18;border:1px solid ${a.color}30">${a.icon}</div>
        <div>
          <div class="agent-name">${a.name}</div>
          <div class="agent-role" style="color:${a.color}">${a.role}</div>
        </div>
      </div>
      <div class="agent-desc">${a.desc}</div>
      <div class="agent-footer">
        <div class="agent-crons">${cronCount} cron${cronCount!==1?'s':''} active</div>
        <button class="run-btn" style="background:${a.color}18;color:${a.color};border:1px solid ${a.color}30" data-agent="${a.id}">▶ Run Now</button>
      </div>
    `;
    card.querySelector('.run-btn').addEventListener('click', async () => {
      addActivityLog(`Manual run: ${a.name} triggered`);
      const btn = card.querySelector('.run-btn');
      const orig = btn.textContent;
      btn.textContent = '…Running';
      btn.disabled = true;
      try {
        const r = await fetch(`${CFG.mcApiUrl}/api/jarvis/run-agent`, {
          method: 'POST',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({agent: a.id}),
          signal: AbortSignal.timeout(8000),
        });
        btn.textContent = r.ok ? '✓ Done' : '✗ Failed';
      } catch {
        btn.textContent = '✗ No relay';
      }
      setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 3000);
    });
    grid.appendChild(card);
  });
}

// ── Render crons ──────────────────────────────────────────────────────────────
function renderCrons() {
  const wrap = document.getElementById('cron-wrap');
  if (!wrap) return;
  const agentColors = {JARVIS:'#2DD4A8',CIPHER:'#7c6bff',FORGE:'#f59e0b',SCOUT:'#34d399',NOVA:'#fb7185',ATLAS:'#a78bfa',TITAN:'#60a5fa'};
  wrap.innerHTML = CRON_DEFS.map(c => `
    <div class="cron-row">
      <div class="cron-dot" style="background:${agentColors[c.agent]||'#888'}"></div>
      <div style="flex:1">
        <div class="cron-name">${c.name}</div>
        <div class="cron-sched">${c.schedule} · ${c.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── Render members ────────────────────────────────────────────────────────────
function renderMembers(members) {
  const wrap = document.getElementById('members-wrap');
  if (!wrap) return;
  if (!members.length) { wrap.innerHTML = '<div class="empty">No members found</div>'; return; }
  wrap.innerHTML = members.map(m => `
    <div class="member-row">
      <div>
        <div class="member-name">${m.name}</div>
        ${m.note ? `<div class="member-note">${m.note}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <div style="font-size:11px;color:rgba(255,255,255,.4)">${m.plan}</div>
        <div class="pill ${m.status}">${m.status}</div>
      </div>
    </div>
  `).join('');
}

// ── Render bookings ───────────────────────────────────────────────────────────
function renderBookings(bookings, events) {
  const tbody = document.getElementById('bookings-body');
  if (!tbody) return;
  const rows = [...bookings, ...events];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No active bookings</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(b => `
    <tr>
      <td>${b.client}</td>
      <td>${b.date}</td>
      <td>${b.amount || '—'}</td>
      <td><span style="font-size:10px;color:rgba(255,255,255,.5)">${b.brand}</span></td>
      <td><span class="pill ok">${b.status}</span></td>
    </tr>
  `).join('');
}

// ── Render aura events ────────────────────────────────────────────────────────
function renderAuraEvents(events) {
  const wrap = document.getElementById('aura-events');
  if (!wrap) return;
  if (!events.length) { wrap.innerHTML = '<div class="empty">No upcoming events</div>'; return; }
  wrap.innerHTML = events.map(e => `
    <div class="member-row">
      <div><div class="member-name">${e.client}</div><div class="member-note">${e.brand}</div></div>
      <div class="pill ok">${e.date}</div>
    </div>
  `).join('');
}

// ── Render pipeline ───────────────────────────────────────────────────────────
function renderPipeline(p) {
  const max = p.total || 1;
  document.getElementById('pv-total').textContent = p.total;
  document.getElementById('pv-att').textContent   = p.attempted;
  document.getElementById('pv-conn').textContent  = p.connected;
  document.getElementById('pv-deal').textContent  = p.deals;
  document.getElementById('pp-total').style.width = '100%';
  document.getElementById('pp-att').style.width   = `${(p.attempted/max)*100}%`;
  document.getElementById('pp-conn').style.width  = `${(p.connected/max)*100}%`;
  document.getElementById('pp-deal').style.width  = `${Math.max(4,(p.deals/max)*100)}%`;
}

// ── Render blog ───────────────────────────────────────────────────────────────
function renderBlog(b) {
  document.getElementById('blog-cb').textContent = b.chefbox;
  document.getElementById('blog-au').textContent = b.aura;
  document.getElementById('blog-sp').textContent = b.sprig;
}

// ── Render MRR ────────────────────────────────────────────────────────────────
function renderMRR(d) {
  const TARGET = 20236;
  const pct = Math.min(100, Math.round((d.mrr / TARGET) * 100));
  document.getElementById('mrr-val').textContent     = fmtMRR(d.mrr);
  document.getElementById('mrr-hdr').textContent     = fmtMRR(d.mrr);
  document.getElementById('mrr-loading').textContent = `${pct}% of target`;
  document.getElementById('mrr-prog').style.width    = `${pct}%`;
  document.getElementById('stat-active').textContent = d.active;
  document.getElementById('stat-paused').textContent = d.paused;
}

// ── Load all live data ────────────────────────────────────────────────────────
async function loadData() {
  addActivityLog('Jarvis: Loading live data from Supabase…');

  const [members, mrr, bookings, auraEvents, blog, pipeline] = await Promise.all([
    fetchMembers(),
    fetchMRR(),
    fetchBookings(),
    fetchAuraEvents(),
    fetchBlogPosts(),
    fetchPipeline(),
  ]);

  renderMRR(mrr);
  renderMembers(members.length ? members : MEMBERS_FALLBACK);
  renderBookings(bookings, auraEvents);
  renderAuraEvents(auraEvents);
  renderBlog(blog);
  renderPipeline(pipeline);

  addActivityLog(`Jarvis: ${mrr.active} active members · MRR ${fmtMRR(mrr.mrr)} · ${bookings.length + auraEvents.length} active bookings`);
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderAgents();
renderCrons();
loadData();

// refresh data every 5 minutes
setInterval(loadData, 5 * 60 * 1000);

// initial activity
addActivityLog('Jarvis: Mission Control online — all systems nominal');
addActivityLog('Jarvis: 7 agents active · Cloudflare tunnel healthy');
