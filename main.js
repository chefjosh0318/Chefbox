import {
  loadCFG, CFG, addActivityLog,
  fetchMRR, fetchMembers, fetchBookings, fetchAuraEvents, fetchBlogPosts,
  AGENTS, CRONS, MEMBERS_STATIC, fmtMRR
} from './data.js';
import { initScene } from './scene.js';
import {
  initMic, initMicButton, initPassiveListening, initSettings,
  startMic, stopMic, sendToJarvis, setStatus
} from './voice.js';

// ── Boot ──────────────────────────────────────────────────────────────────────
loadCFG();
initScene();
initMic();
initMicButton();
initPassiveListening();
initSettings();

// ── Space bar PTT ─────────────────────────────────────────────────────────────
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

// ── Chat bar ──────────────────────────────────────────────────────────────────
document.getElementById('chat-go')?.addEventListener('click', doChat);
document.getElementById('chat-in')?.addEventListener('keydown', e => { if (e.key==='Enter') doChat(); });
function doChat() {
  const inp = document.getElementById('chat-in');
  const txt = inp?.value.trim();
  if (!txt) return;
  inp.value = '';
  sendToJarvis(txt);
}

// ── Activity feed ─────────────────────────────────────────────────────────────
window.addEventListener('j-activity', e => {
  const feed = document.getElementById('act-feed');
  if (!feed) return;
  const d = document.createElement('div');
  d.className = 'act-e';
  const ts = new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
  d.innerHTML = `${escHtml(e.detail.msg)}<span class="act-t">${ts}</span>`;
  feed.prepend(d);
  while (feed.children.length > 40) feed.lastChild.remove();
  const cnt = document.getElementById('act-cnt');
  if (cnt) cnt.textContent = feed.children.length;
});

function escHtml(s) {
  return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Brand tabs ────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
  });
});

// ── Render agents ─────────────────────────────────────────────────────────────
function renderAgents() {
  const grid = document.getElementById('agent-grid');
  if (!grid) return;
  grid.innerHTML = AGENTS.map(a => {
    const nc = CRONS.filter(c => c.agent === a.id).length;
    return `
    <div class="ac">
      <div class="ac-bar" style="background:${a.color}"></div>
      <div class="ac-top">
        <div class="ac-ico" style="background:${a.color}18;border:1px solid ${a.color}28">${a.icon}</div>
        <div>
          <div class="ac-n">${a.name}</div>
          <div class="ac-r" style="color:${a.color}">${a.role}</div>
        </div>
      </div>
      <div class="ac-desc">${a.desc}</div>
      <div class="ac-foot">
        <div class="ac-cron">${nc} cron${nc!==1?'s':''}</div>
        <button class="run-btn" data-id="${a.id}"
          style="background:${a.color}16;color:${a.color};border:1px solid ${a.color}28">
          ▶ Run
        </button>
      </div>
    </div>`;
  }).join('');

  grid.querySelectorAll('.run-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.id;
      addActivityLog(`Manual run: ${id} triggered`);
      btn.textContent = '…';
      btn.disabled = true;
      setTimeout(() => { btn.textContent = '▶ Run'; btn.disabled = false; }, 3000);
    });
  });
}

// ── Render crons ──────────────────────────────────────────────────────────────
function renderCrons() {
  const card = document.getElementById('cron-card');
  if (!card) return;
  const colors = {JARVIS:'#2DD4A8',CIPHER:'#7c6bff',FORGE:'#f59e0b',SCOUT:'#34d399',NOVA:'#fb7185',ATLAS:'#a78bfa',TITAN:'#60a5fa'};
  card.innerHTML = CRONS.map(c => `
    <div class="cron-r">
      <div class="cron-dot" style="background:${colors[c.agent]||'#666'}"></div>
      <div>
        <div class="cron-n">${c.name}</div>
        <div class="cron-s">${c.sched} · ${c.desc}</div>
      </div>
    </div>
  `).join('');
}

// ── Render members ────────────────────────────────────────────────────────────
function renderMembers(members) {
  const card = document.getElementById('members-card');
  if (!card) return;
  card.innerHTML = members.map(m => {
    const pillClass = m.status === 'active' ? 'pill-g' : 'pill-y';
    return `
    <div class="row">
      <div>
        <div class="row-name">${escHtml(m.name)}</div>
        ${m.note ? `<div class="row-sub">${escHtml(m.note)}</div>` : ''}
      </div>
      <div style="display:flex;align-items:center;gap:7px">
        <div style="font-size:11px;color:rgba(255,255,255,.35)">${m.plan}</div>
        <div class="pill ${pillClass}">${m.status}</div>
      </div>
    </div>`;
  }).join('');
}

// ── Render bookings ───────────────────────────────────────────────────────────
function renderBookings(sprig, aura) {
  const tbody = document.getElementById('bk-body');
  if (!tbody) return;
  const all = [...sprig, ...aura];
  if (!all.length) {
    tbody.innerHTML = '<tr><td colspan="5" class="empty">No confirmed bookings found</td></tr>';
    return;
  }
  tbody.innerHTML = all.map(b => `
    <tr>
      <td>${escHtml(b.client)}</td>
      <td>${escHtml(b.date)}</td>
      <td>${b.amount || '—'}</td>
      <td style="font-size:10px;color:rgba(255,255,255,.4)">${escHtml(b.brand)}</td>
      <td><div class="pill pill-g">${escHtml(b.status)}</div></td>
    </tr>`).join('');
}

// ── Render aura events ────────────────────────────────────────────────────────
function renderEvents(events) {
  const el = document.getElementById('evt-list');
  if (!el) return;
  if (!events.length) { el.innerHTML = '<div class="empty">No upcoming events</div>'; return; }
  el.innerHTML = events.map(e => `
    <div class="row">
      <div><div class="row-name">${escHtml(e.client)}</div><div class="row-sub">${escHtml(e.brand)}</div></div>
      <div class="pill pill-g">${escHtml(e.date)}</div>
    </div>`).join('');
}

// ── Render MRR ────────────────────────────────────────────────────────────────
function renderMRR(d) {
  const TARGET = 20236;
  const pct = Math.min(100, Math.round((d.mrr/TARGET)*100));
  document.getElementById('mrr-v').textContent    = fmtMRR(d.mrr);
  document.getElementById('mrr-tab').textContent  = fmtMRR(d.mrr);
  document.getElementById('mrr-pct').textContent  = `${pct}% of target`;
  document.getElementById('mrr-bar').style.width  = `${pct}%`;
  document.getElementById('k-active').textContent = d.active;
  document.getElementById('k-paused').textContent = d.paused;
  addActivityLog(`Revenue: MRR ${fmtMRR(d.mrr)} · ${d.active} active · ${d.paused} paused${d.source==='fallback'?' (estimated)':''}`);
}

// ── Render blog ───────────────────────────────────────────────────────────────
function renderBlog(b) {
  document.getElementById('bl-cb').textContent = b.chefbox;
  document.getElementById('bl-au').textContent = b.aura;
  document.getElementById('bl-sp').textContent = b.sprig;
}

// ── Load all live data ────────────────────────────────────────────────────────
async function loadData() {
  addActivityLog('Fetching live data from Supabase…');
  setStatus('processing', 'Loading…');

  try {
    const [mrr, members, bookings, events, blog] = await Promise.all([
      fetchMRR(),
      fetchMembers(),
      fetchBookings(),
      fetchAuraEvents(),
      fetchBlogPosts(),
    ]);

    renderMRR(mrr);
    renderMembers(members.length ? members : MEMBERS_STATIC);
    renderBookings(bookings, events);
    renderEvents(events);
    renderBlog(blog);

    addActivityLog(`Data loaded: ${bookings.length} Sprig bookings · ${events.length} Aura events · ${blog.total} posts`);
  } catch (err) {
    addActivityLog(`Data load error: ${err.message}`);
    renderMembers(MEMBERS_STATIC);
    renderBookings([], []);
    renderEvents([]);
    renderBlog({ chefbox:3, aura:3, sprig:3, total:9 });
    renderMRR({ mrr: Math.round((6*175+214)*4.33), active:7, paused:2, source:'fallback' });
  }

  setStatus('online', 'Ready');
}

// ── Init ──────────────────────────────────────────────────────────────────────
renderAgents();
renderCrons();
loadData();
setInterval(loadData, 5 * 60 * 1000);

addActivityLog('Jarvis Mission Control v2 online — 7 agents · 21 crons active');
addActivityLog('Voice ready — say "Hey Jarvis" or press Space');
