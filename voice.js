import { CFG, saveCFG, addActivityLog } from './data.js';

// ── State ─────────────────────────────────────────────────────────────────────
let micActive = false;
let recog     = null;
let _onAmp    = null;
export function setAmplitudeCallback(cb) { _onAmp = cb; }

// ── Status ────────────────────────────────────────────────────────────────────
export function setStatus(state, label) {
  const dot = document.getElementById('sdot');
  const lbl = document.getElementById('slabel');
  if (dot) dot.className = state || '';
  if (lbl && label) lbl.textContent = label;
}

// ── Response card ─────────────────────────────────────────────────────────────
let _card = null;
export function showCard(text) {
  if (_card) _card.remove();
  _card = document.createElement('div');
  _card.className = 'resp';
  _card.innerHTML = `
    <button class="resp-x">✕</button>
    <div class="resp-lbl">Jarvis</div>
    <div class="resp-txt">${text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
  `;
  _card.querySelector('.resp-x').onclick = () => { _card.remove(); _card = null; };
  document.body.appendChild(_card);
  setTimeout(() => { if (_card) { _card.remove(); _card = null; } }, 30000);
}

// ── TTS ───────────────────────────────────────────────────────────────────────
export function speak(text) {
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 400));
    u.rate  = 1.05;
    u.pitch = 1.0;
    // pick a deeper voice if available
    const voices = window.speechSynthesis.getVoices();
    const pref = voices.find(v => /google us english|alex|daniel|en-us/i.test(v.name + v.lang));
    if (pref) u.voice = pref;
    u.onend = () => setStatus('online', 'Ready');
    window.speechSynthesis.speak(u);
  } catch {}
}

// ── Core send ────────────────────────────────────────────────────────────────
export async function sendToJarvis(text) {
  setStatus('processing', 'Thinking…');
  addActivityLog(`You: "${text.slice(0,60)}${text.length>60?'…':''}"`);

  let reply = null;

  // 1. OpenClaw tunnel — POST to /api/chat (standard OpenClaw REST endpoint)
  const base = (CFG.ocUrl || '').replace(/\/$/, '');
  if (base) {
    // Try the OpenClaw gateway chat sessions endpoint
    const endpoints = [
      { url: `${base}/api/chat`, body: { message: text, session: 'mc-voice' } },
      { url: `${base}/api/message`, body: { text, channel: 'voice' } },
      { url: `${base}/v1/chat/completions`, body: {
          model: 'claude-sonnet',
          messages: [{ role:'user', content: text }]
        }
      },
    ];

    for (const ep of endpoints) {
      if (reply) break;
      try {
        const r = await fetch(ep.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(ep.body),
          signal: AbortSignal.timeout(18000),
        });
        if (r.ok) {
          const d = await r.json();
          reply = d.response || d.text || d.message || d.content
                 || d.choices?.[0]?.message?.content
                 || null;
        }
      } catch {}
    }
  }

  // 2. Fallback: direct AI API (user provides key in settings)
  if (!reply && CFG.aiKey && CFG.aiUrl) {
    try {
      const r = await fetch(CFG.aiUrl, {
        method: 'POST',
        headers: { 'Content-Type':'application/json', 'Authorization': `Bearer ${CFG.aiKey}` },
        body: JSON.stringify({
          model: CFG.aiModel || 'gpt-4o',
          messages: [
            { role: 'system', content: CFG.sysPrompt },
            { role: 'user',   content: text },
          ],
          max_tokens: 350,
        }),
        signal: AbortSignal.timeout(22000),
      });
      if (r.ok) {
        const d = await r.json();
        reply = d.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch {}
  }

  if (!reply) {
    reply = `I heard you, but couldn't reach my backend. Check Settings — add an OpenAI key as a fallback, or make sure the tunnel URL is correct: ${base || 'not set'}`;
  }

  setStatus('speaking', 'Speaking…');
  addActivityLog(`Jarvis: "${reply.slice(0,80)}${reply.length>80?'…':''}"`);
  showCard(reply);
  speak(reply);
  setTimeout(() => setStatus('online', 'Ready'), 4000);
}

// ── Speech recognition init ────────────────────────────────────────────────────
export function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const h = document.getElementById('vc-hint');
    if (h) h.textContent = 'Speech API not supported — use chat input above';
    return;
  }
  recog = new SR();
  recog.continuous      = false;
  recog.interimResults  = false;
  recog.lang            = 'en-US';

  recog.onresult = e => {
    const txt = e.results[0][0].transcript.trim();
    const h = document.getElementById('vc-hint');
    if (h) h.textContent = `"${txt}"`;
    stopMic();
    sendToJarvis(txt);
  };
  recog.onerror = err => {
    if (err.error !== 'aborted') {
      const h = document.getElementById('vc-hint');
      if (h) h.textContent = 'Mic error — try again';
    }
    stopMic();
  };
  recog.onend = () => { if (micActive) stopMic(); };
}

// ── Start / stop mic ──────────────────────────────────────────────────────────
export function startMic() {
  if (micActive || !recog) return;
  micActive = true;
  const btn = document.getElementById('mic');
  const h   = document.getElementById('vc-hint');
  if (btn) btn.classList.add('active');
  if (h)   h.textContent = 'Listening…';
  setStatus('listening', 'Listening…');
  try { recog.start(); } catch {}
}

export function stopMic() {
  micActive = false;
  const btn = document.getElementById('mic');
  const h   = document.getElementById('vc-hint');
  if (btn) { btn.classList.remove('active'); btn.style.boxShadow = ''; }
  if (h)   h.textContent = 'Say "Hey Jarvis" or press Space';
  setStatus('online', 'Ready');
  try { recog.stop(); } catch {}
}

// ── Mic button ────────────────────────────────────────────────────────────────
export function initMicButton() {
  const btn = document.getElementById('mic');
  if (!btn) return;
  btn.addEventListener('click', () => { micActive ? stopMic() : startMic(); });
}

// ── Passive "Hey Jarvis" wake word ────────────────────────────────────────────
let passiveOn = false;
let passive   = null;

function startPassive() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || passiveOn || micActive) return;
  try {
    passive = new SR();
    passive.continuous     = true;
    passive.interimResults = true;
    passive.lang           = 'en-US';
    passive.onresult = e => {
      const txt = Array.from(e.results).slice(-2).map(r=>r[0].transcript).join(' ').toLowerCase();
      if ((txt.includes('hey jarvis') || txt.includes('hey, jarvis')) && !micActive) {
        stopPassive();
        setTimeout(startMic, 300);
      }
    };
    passive.onend   = () => { passiveOn = false; if (!micActive) setTimeout(startPassive, 2000); };
    passive.onerror = () => { passiveOn = false; if (!micActive) setTimeout(startPassive, 4000); };
    passive.start();
    passiveOn = true;
  } catch {}
}

function stopPassive() {
  passiveOn = false;
  try { passive?.abort(); } catch {};
  passive = null;
}

export function initPassiveListening() { setTimeout(startPassive, 1500); }

// ── Settings modal ────────────────────────────────────────────────────────────
export function initSettings() {
  const modal  = document.getElementById('cfg-modal');
  const openB  = document.getElementById('cfg-btn');
  const closeB = document.getElementById('cfg-x');
  const saveB  = document.getElementById('cfg-save');
  if (!modal) return;

  const fields = { 's-oc':'ocUrl', 's-url':'aiUrl', 's-key':'aiKey', 's-model':'aiModel', 's-prompt':'sysPrompt' };

  openB?.addEventListener('click', () => {
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.value = CFG[key] || '';
    });
    modal.classList.add('on');
  });
  closeB?.addEventListener('click', () => modal.classList.remove('on'));
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('on'); });

  saveB?.addEventListener('click', () => {
    const patch = {};
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) patch[key] = el.value.trim();
    });
    saveCFG(patch);
    modal.classList.remove('on');
    addActivityLog('Settings saved');
  });
}
