import { CFG, saveCFG, addActivityLog } from './data.js';

// ── State ─────────────────────────────────────────────────────────────────────
let micActive = false;
let recognition = null;
let ampAF = null;
let analyser = null;
let _onAmplitude = null;
export function setAmplitudeCallback(cb) { _onAmplitude = cb; }

// ── Passive wake-word detection ───────────────────────────────────────────────
let passiveActive = false;
let passiveInstance = null;

function startPassive() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || passiveActive || micActive) return;
  try {
    passiveInstance = new SR();
    passiveInstance.continuous = true;
    passiveInstance.interimResults = true;
    passiveInstance.lang = 'en-US';
    passiveInstance.onresult = e => {
      const txt = Array.from(e.results).slice(-3).map(r => r[0].transcript).join(' ').toLowerCase();
      if ((txt.includes('hey jarvis') || txt.includes('jarvis')) && !micActive) {
        stopPassive();
        setTimeout(startMic, 300);
      }
    };
    passiveInstance.onend   = () => { passiveActive = false; if (!micActive) setTimeout(startPassive, 1500); };
    passiveInstance.onerror = () => { passiveActive = false; if (!micActive) setTimeout(startPassive, 3000); };
    passiveInstance.start();
    passiveActive = true;
  } catch { passiveActive = false; }
}

function stopPassive() {
  passiveActive = false;
  try { passiveInstance?.abort(); } catch {}
  passiveInstance = null;
}

export function initPassiveListening() { startPassive(); }

// ── Status dot ────────────────────────────────────────────────────────────────
function setStatus(state) {
  const dot = document.getElementById('status-dot');
  if (dot) dot.className = state ? state : '';
}

// ── Mic init ──────────────────────────────────────────────────────────────────
export function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    document.getElementById('mic-hint').textContent = 'SPEECH NOT SUPPORTED IN THIS BROWSER';
    return;
  }
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';

  recognition.onresult = e => {
    const text = e.results[0][0].transcript.trim();
    document.getElementById('mic-hint').textContent = `"${text}"`;
    stopMic();
    sendToJarvis(text);
  };
  recognition.onerror = err => {
    if (err.error !== 'aborted') {
      document.getElementById('mic-hint').textContent = 'MIC ERROR — TRY AGAIN';
    }
    stopMic();
  };
  recognition.onend = () => {
    if (micActive) stopMic();
  };
}

// ── Amplitude loop ────────────────────────────────────────────────────────────
async function startAmpLoop() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const src = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    function loop() {
      ampAF = requestAnimationFrame(loop);
      analyser.getByteFrequencyData(buf);
      const avg = buf.reduce((s, v) => s + v, 0) / buf.length;
      const norm = Math.min(1, avg / 60);
      if (_onAmplitude) _onAmplitude(norm);
    }
    loop();
  } catch {}
}

function stopAmpLoop() {
  if (ampAF) { cancelAnimationFrame(ampAF); ampAF = null; }
  if (_onAmplitude) _onAmplitude(0);
}

// ── Start / stop mic ──────────────────────────────────────────────────────────
export function startMic() {
  if (!recognition) return;
  micActive = true;
  document.getElementById('mic-btn').classList.add('active');
  document.getElementById('mic-icon').style.display = 'none';
  document.getElementById('stop-icon').style.display = '';
  document.getElementById('mic-hint').textContent = 'LISTENING…';
  setStatus('listening');
  recognition.start();
  startAmpLoop();
}

export function stopMic() {
  micActive = false;
  document.getElementById('mic-btn').classList.remove('active');
  document.getElementById('mic-icon').style.display = '';
  document.getElementById('stop-icon').style.display = 'none';
  setStatus('');
  stopAmpLoop();
  try { recognition && recognition.abort(); } catch {}
  setTimeout(startPassive, 1200);
}

// ── Send to Jarvis ────────────────────────────────────────────────────────────
export async function sendToJarvis(text) {
  setStatus('processing');
  addActivityLog(`You: "${text.slice(0, 60)}${text.length > 60 ? '…' : ''}"`);

  let reply = null;
  const ocBase = CFG.ocUrl.replace(/\/$/, '');
  const mcBase = CFG.mcApiUrl.replace(/\/$/, '');

  // 1. Try OpenClaw gateway
  if (ocBase) {
    try {
      const r = await fetch(`${ocBase}/v1/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, agent: CFG.agentName }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const d = await r.json();
        reply = d.response || d.text || d.message || null;
      }
    } catch {}
  }

  // 2. Try Mission Control voice relay
  if (!reply && mcBase) {
    try {
      const r = await fetch(`${mcBase}/api/jarvis/voice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const d = await r.json();
        reply = d.response || d.text || d.message || null;
      }
    } catch {}
  }

  // 3. Fallback to direct AI API
  if (!reply && CFG.aiKey && CFG.aiUrl) {
    reply = await callAI(text);
  }

  if (!reply) {
    reply = 'I couldn\'t reach the AI backend. Check your API settings.';
  }

  setStatus('speaking');
  addActivityLog(`Jarvis: "${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}"`);
  showCard(reply);
  speak(reply);
}

// ── Fallback AI call ──────────────────────────────────────────────────────────
async function callAI(text) {
  try {
    const r = await fetch(CFG.aiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${CFG.aiKey}` },
      body: JSON.stringify({
        model: CFG.aiModel,
        messages: [
          { role: 'system', content: CFG.sysPrompt },
          { role: 'user',   content: text },
        ],
        max_tokens: 300,
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return d.choices?.[0]?.message?.content?.trim() || null;
  } catch { return null; }
}

// ── TTS ───────────────────────────────────────────────────────────────────────
function doSpeak(text) {
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.05; u.pitch = 0.95; u.volume = 1;
  const voices = speechSynthesis.getVoices();
  const pref = voices.find(v => /Google US English|Daniel|Samantha/i.test(v.name));
  if (pref) u.voice = pref;
  u.onend = () => setStatus('');
  u.onerror = () => setStatus('');
  speechSynthesis.speak(u);
}

export function speak(text) {
  if (!window.speechSynthesis) { setStatus(''); return; }
  if (speechSynthesis.getVoices().length) {
    doSpeak(text);
  } else {
    speechSynthesis.addEventListener('voiceschanged', () => doSpeak(text), { once: true });
  }
}

// ── Response card ─────────────────────────────────────────────────────────────
let _cardEl = null;
export function showCard(text, label = 'Jarvis') {
  if (_cardEl) _cardEl.remove();
  _cardEl = document.createElement('div');
  _cardEl.className = 'resp-card';
  _cardEl.style.cssText = 'left:50%;bottom:144px;transform:translateX(-50%);width:340px;max-width:90vw;';
  _cardEl.innerHTML = `<div class="card-lbl">${label}</div><div class="card-val"></div><button class="card-x">✕</button>`;
  _cardEl.querySelector('.card-val').textContent = text;
  _cardEl.querySelector('.card-x').onclick = () => _cardEl.remove();
  document.body.appendChild(_cardEl);
  setTimeout(() => { if (_cardEl) _cardEl.remove(); }, 18000);
}

// ── Telegram quick-send ───────────────────────────────────────────────────────
export function initTelegram() {
  const input = document.getElementById('tg-input');
  const sendBtn = document.getElementById('tg-send');

  async function doSend() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    addActivityLog(`Telegram: "${text.slice(0,60)}"`);
    const mcBase = CFG.mcApiUrl.replace(/\/$/, '');
    if (!mcBase) { showCard('No Mission Control URL set. Configure in Settings.', 'System'); return; }
    try {
      const r = await fetch(`${mcBase}/api/summit/telegram/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
        signal: AbortSignal.timeout(10000),
      });
      showCard(r.ok ? `✓ Sent to Telegram` : `✗ Send failed (${r.status})`, 'Telegram');
    } catch {
      // also try sending to Jarvis as a message if Telegram fails
      sendToJarvis(text);
    }
  }

  sendBtn.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });
}

// ── Settings modal ────────────────────────────────────────────────────────────
export function initSettings() {
  const fields = { 's-mc': 'mcApiUrl', 's-oc': 'ocUrl', 's-name': 'agentName', 's-url': 'aiUrl', 's-key': 'aiKey', 's-model': 'aiModel', 's-prompt': 'sysPrompt' };

  function openSettings() {
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.value = CFG[key] ?? '';
    });
    document.getElementById('settings-modal').classList.add('open');
  }

  function saveSettings() {
    const patch = {};
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) patch[key] = el.value.trim();
    });
    saveCFG(patch);
    document.getElementById('settings-modal').classList.remove('open');
    applyAgentName();
  }

  document.getElementById('settings-btn')?.addEventListener('click', openSettings);
  document.getElementById('settings-close')?.addEventListener('click', () => document.getElementById('settings-modal').classList.remove('open'));
  document.getElementById('settings-save')?.addEventListener('click', saveSettings);
}

function applyAgentName() {
  const el = document.querySelector('[data-agent-name]');
  if (el && CFG.agentName) el.textContent = CFG.agentName;
}

// ── Members modal ─────────────────────────────────────────────────────────────
export function initMembersModal() {
  document.getElementById('members-btn')?.addEventListener('click', () => {
    document.getElementById('members-modal').classList.add('open');
  });
  document.getElementById('members-close')?.addEventListener('click', () => {
    document.getElementById('members-modal').classList.remove('open');
  });
  document.getElementById('members-modal')?.addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });
}

// ── Activity panel toggle ─────────────────────────────────────────────────────
export function initPanelToggle() {
  const panel  = document.getElementById('activity-panel');
  const toggle = document.getElementById('panel-toggle');
  const icon   = toggle?.querySelector('svg path');
  let collapsed = false;
  toggle?.addEventListener('click', () => {
    collapsed = !collapsed;
    panel.classList.toggle('collapsed', collapsed);
    if (icon) icon.setAttribute('d', collapsed ? 'M15 18l-6-6 6-6' : 'M9 18l6-6-6-6');
  });
}

// ── Mic button ────────────────────────────────────────────────────────────────
export function initMicButton() {
  const btn = document.getElementById('mic-btn');
  btn?.addEventListener('click', () => {
    if (micActive) stopMic();
    else startMic();
  });
}
