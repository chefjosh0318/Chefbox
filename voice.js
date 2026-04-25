import { CFG, saveCFG, addActivityLog } from './data.js';

let micActive = false;
let recog     = null;

export function setStatus(state, label) {
  const dot = document.getElementById('sdot');
  const lbl = document.getElementById('slbl');
  if (dot) { dot.className = state || ''; }
  if (lbl && label) lbl.textContent = label;
}

// ── Response card ──────────────────────────────────────────────────────────
let _card = null;
export function showCard(text) {
  if (_card) _card.remove();
  _card = document.createElement('div');
  _card.className = 'resp-card';
  _card.innerHTML = `
    <button class="rc-x">✕</button>
    <div class="rc-lbl">Jarvis</div>
    <div class="rc-txt">${(text||'').replace(/</g,'&lt;').replace(/\n/g,'<br>')}</div>
  `;
  _card.querySelector('.rc-x').onclick = () => { _card?.remove(); _card = null; };
  document.body.appendChild(_card);
  setTimeout(() => { _card?.remove(); _card = null; }, 28000);
}

// ── TTS ────────────────────────────────────────────────────────────────────
export function speak(text) {
  if (!text) return;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.slice(0, 500));
    u.rate  = 1.0;
    u.pitch = 0.95;
    const voices = window.speechSynthesis.getVoices();
    const pick = voices.find(v => /Google US English|Aaron|Alex|Daniel|Samantha/i.test(v.name))
              || voices.find(v => /en-US/i.test(v.lang));
    if (pick) u.voice = pick;
    u.onend = () => setStatus('', 'Ready');
    window.speechSynthesis.speak(u);
  } catch {}
}

// ── Core AI call (OpenAI direct — fast, no tunnel needed) ──────────────────
export async function sendToJarvis(text) {
  if (!text.trim()) return;
  setStatus('proc', 'Thinking…');
  addActivityLog(`You: "${text.slice(0,65)}${text.length>65?'…':''}"`);

  let reply = null;

  // Primary: OpenAI API directly from browser (user key in settings)
  if (CFG.aiKey) {
    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CFG.aiKey}`,
        },
        body: JSON.stringify({
          model: CFG.aiModel || 'gpt-4o',
          messages: [
            { role: 'system', content: CFG.sysPrompt },
            { role: 'user',   content: text },
          ],
          max_tokens: 400,
          temperature: 0.7,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (r.ok) {
        const d = await r.json();
        reply = d.choices?.[0]?.message?.content?.trim() || null;
      }
    } catch (e) {
      console.warn('OpenAI error:', e.message);
    }
  }

  // Fallback: try tunnel relay
  if (!reply) {
    const base = (CFG.ocUrl||'').replace(/\/$/, '');
    if (base) {
      try {
        const r = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: text }),
          signal: AbortSignal.timeout(12000),
        });
        if (r.ok) {
          const d = await r.json();
          reply = d.response || d.text || d.message || null;
        }
      } catch {}
    }
  }

  if (!reply) {
    reply = CFG.aiKey
      ? 'OpenAI returned an error — check your API key in Settings.'
      : 'Add your OpenAI API key in Settings (gear icon) to enable voice responses.';
  }

  setStatus('talk', 'Speaking…');
  addActivityLog(`Jarvis: "${reply.slice(0,80)}${reply.length>80?'…':''}"`);
  showCard(reply);
  speak(reply);
  setTimeout(() => setStatus('', 'Ready'), 5000);
}

// ── Speech recognition ─────────────────────────────────────────────────────
export function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const h = document.getElementById('vhint');
    if (h) h.textContent = 'Use chat bar above — speech not supported here';
    return;
  }
  recog = new SR();
  recog.continuous     = false;
  recog.interimResults = false;
  recog.lang           = 'en-US';
  recog.onresult = e => {
    const txt = e.results[0][0].transcript.trim();
    const h = document.getElementById('vhint');
    if (h) h.textContent = `"${txt}"`;
    stopMic();
    sendToJarvis(txt);
  };
  recog.onerror = err => {
    if (err.error !== 'aborted') {
      const h = document.getElementById('vhint');
      if (h) h.textContent = 'Mic error — try again';
    }
    stopMic();
  };
  recog.onend = () => { if (micActive) stopMic(); };
}

export function startMic() {
  if (micActive || !recog) return;
  micActive = true;
  document.getElementById('mic')?.classList.add('on');
  const h = document.getElementById('vhint');
  if (h) h.textContent = 'Listening…';
  setStatus('hear', 'Listening…');
  try { recog.start(); } catch {}
}

export function stopMic() {
  if (!micActive) return;
  micActive = false;
  document.getElementById('mic')?.classList.remove('on');
  const h = document.getElementById('vhint');
  if (h) h.textContent = 'Say "Hey Jarvis" or press Space';
  setStatus('', 'Ready');
  try { recog.stop(); } catch {}
}

export function initMicButton() {
  document.getElementById('mic')?.addEventListener('click', () => {
    micActive ? stopMic() : startMic();
  });
}

// ── Passive "Hey Jarvis" ───────────────────────────────────────────────────
let pOn = false, pInst = null;
function startPassive() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || pOn || micActive) return;
  try {
    pInst = new SR();
    pInst.continuous = true; pInst.interimResults = true; pInst.lang = 'en-US';
    pInst.onresult = e => {
      const txt = Array.from(e.results).slice(-2).map(r=>r[0].transcript).join(' ').toLowerCase();
      if ((txt.includes('hey jarvis')||txt.includes('hey, jarvis')) && !micActive) {
        pOn = false; try { pInst?.abort(); } catch {}
        setTimeout(startMic, 300);
      }
    };
    pInst.onend   = () => { pOn = false; if (!micActive) setTimeout(startPassive, 2000); };
    pInst.onerror = () => { pOn = false; if (!micActive) setTimeout(startPassive, 4000); };
    pInst.start(); pOn = true;
  } catch {}
}
export function initPassiveListening() { setTimeout(startPassive, 2000); }

// ── Settings ───────────────────────────────────────────────────────────────
export function initSettings() {
  const modal = document.getElementById('cfg-modal');
  const fields = { 's-key':'aiKey', 's-model':'aiModel', 's-oc':'ocUrl', 's-prompt':'sysPrompt' };

  document.getElementById('cfg-btn')?.addEventListener('click', () => {
    Object.entries(fields).forEach(([id,key]) => {
      const el = document.getElementById(id);
      if (el) el.value = CFG[key] || '';
    });
    modal?.classList.add('on');
  });
  document.getElementById('cfg-x')?.addEventListener('click', () => modal?.classList.remove('on'));
  modal?.addEventListener('click', e => { if (e.target===modal) modal.classList.remove('on'); });
  document.getElementById('cfg-save')?.addEventListener('click', () => {
    const patch = {};
    Object.entries(fields).forEach(([id,key]) => {
      const el = document.getElementById(id);
      if (el) patch[key] = el.value.trim();
    });
    saveCFG(patch);
    modal?.classList.remove('on');
    addActivityLog('Settings saved — voice ready');
  });
}
