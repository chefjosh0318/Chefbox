import {
  loadCFG, CFG, addActivityLog,
  fetchBookings, AGENTS, DAILY, WEEKLY, ACOLORS
} from './data.js';
import { initScene } from './scene.js';
import { initMic, initMicButton, initPassiveListening, initSettings, startMic, stopMic, sendToJarvis } from './voice.js';

// ── Boot ──────────────────────────────────────────────────────────────────
loadCFG();
initScene();
initMic();
initMicButton();
initPassiveListening();
initSettings();

// ── Space PTT ─────────────────────────────────────────────────────────────
let held = false;
document.addEventListener('keydown', e => {
  if (e.code === 'Space' && !held && !e.target.matches('input,textarea')) {
    e.preventDefault(); held = true; startMic();
  }
});
document.addEventListener('keyup', e => {
  if (e.code === 'Space' && !e.target.matches('input,textarea')) {
    held = false; stopMic();
  }
});

// ── Chat bar ──────────────────────────────────────────────────────────────
document.getElementById('chat-go')?.addEventListener('click', doChat);
document.getElementById('chat-in')?.addEventListener('keydown', e => { if (e.key === 'Enter') doChat(); });
function doChat() {
  const el = document.getElementById('chat-in');
  const t  = el?.value.trim();
  if (!t) return;
  el.value = '';
  sendToJarvis(t);
}

// ── Activity feed ─────────────────────────────────────────────────────────
window.addEventListener('jact', e => {
  const feed = document.getElementById('act-feed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = 'acte';
  const ts = new Date().toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' });
  d.innerHTML = `${esc(e.detail.msg)}<span class="actts">${ts}</span>`;
  feed.prepend(d);
  while (feed.children.length > 40) feed.lastChild.remove();
  const cnt = document.getElementById('act-cnt');
  if (cnt) cnt.textContent = feed.children.length;
});

function esc(s) { return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

// ── Brand tabs ────────────────────────────────────────────────────────────
document.querySelectorAll('.btab').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.btab').forEach(x => x.classList.remove('on'));
  b.classList.add('on');
}));

// ── Agents ────────────────────────────────────────────────────────────────
function renderAgents() {
  const g = document.getElementById('agent-grid');
  if (!g) return;
  g.innerHTML = AGENTS.map(a => `
    <div class="ac">
      <div class="ac-glow" style="background:${a.color}"></div>
      <div class="ac-top">
        <div class="ac-ico" style="background:${a.color}14;border:1px solid ${a.color}28">${a.icon}</div>
        <div>
          <div class="ac-name">${a.name}</div>
          <div class="ac-role" style="color:${a.color}">${a.role}</div>
        </div>
      </div>
      <div class="ac-desc">${a.desc}</div>
      <div class="ac-foot">
        <div class="ac-tag">${a.crons} cron${a.crons!==1?'s':''} · <span style="color:${a.color}">●</span> ${a.status}</div>
        <button class="rbtn" data-id="${a.id}"
          style="background:${a.color}14;color:${a.color};border:1px solid ${a.color}28">▶ Run</button>
      </div>
    </div>
  `).join('');
  g.querySelectorAll('.rbtn').forEach(btn => btn.addEventListener('click', () => {
    addActivityLog(`Manual run: ${btn.dataset.id} triggered`);
    btn.textContent = '…';
    btn.disabled = true;
    setTimeout(() => { btn.textContent = '▶ Run'; btn.disabled = false; }, 3000);
  }));
}

// ── Daily schedule ────────────────────────────────────────────────────────
function renderDaily() {
  const el = document.getElementById('daily-sched');
  if (!el) return;
  el.innerHTML = DAILY.map(s => `
    <div class="sched-row">
      <div class="sched-time">${s.time}</div>
      <div class="sched-dot" style="background:${ACOLORS[s.agent]||'#666'}"></div>
      <div class="sched-info">
        <div class="sched-name">${s.name}</div>
        <div class="sched-agent" style="color:${ACOLORS[s.agent]||'#888'}">${s.agent} · ${s.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── Weekly schedule ───────────────────────────────────────────────────────
function renderWeekly() {
  const el = document.getElementById('weekly-sched');
  if (!el) return;
  el.innerHTML = WEEKLY.map(s => `
    <div class="sched-row">
      <div class="sched-time">${s.day}</div>
      <div class="sched-dot" style="background:${ACOLORS[s.agent]||'#666'}"></div>
      <div class="sched-info">
        <div class="sched-name">${s.name}</div>
        <div class="sched-agent" style="color:${ACOLORS[s.agent]||'#888'}">${s.agent} · ${s.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── Bookings ──────────────────────────────────────────────────────────────
async function loadBookings() {
  const tbody = document.getElementById('bk-body');
  if (!tbody) return;
  const rows = await fetchBookings();
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No confirmed bookings in Supabase yet</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(b => `
    <tr>
      <td>${esc(b.client)}</td>
      <td>${esc(b.date)}</td>
      <td style="font-weight:600;color:var(--g)">${b.amount}</td>
      <td style="font-size:10px;color:rgba(255,255,255,.35)">${esc(b.brand)}</td>
      <td><div class="pill pg">${esc(b.status)}</div></td>
    </tr>
  `).join('');
  addActivityLog(`Bookings loaded: ${rows.length} active`);
}

// ── Init ──────────────────────────────────────────────────────────────────
renderAgents();
renderDaily();
renderWeekly();
loadBookings();

// Refresh bookings every 5 min
setInterval(loadBookings, 5 * 60 * 1000);

// Boot log
setTimeout(() => {
  addActivityLog('Jarvis OS online — 7 agents · 21 crons · Stripe MRR $13,094');
  addActivityLog('Voice: add OpenAI key in Settings (⚙) to enable');
}, 300);

// Prompt for key if not set
setTimeout(() => {
  if (!CFG.aiKey) {
    addActivityLog('⚠ No API key set — open Settings to enable voice');
  }
}, 1500);
