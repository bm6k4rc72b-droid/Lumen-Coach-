/**
 * Voice in and out for the coach.
 *
 * Speech recognition uses the Web Speech API, which on iOS Safari is
 * `webkitSpeechRecognition` and requires a user gesture to start. Speech
 * synthesis is broadly supported but iOS needs the first `speak()` call to
 * happen inside a gesture too, so we prime it on the first tap.
 */

const SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;

export const voiceSupport = {
  listen: !!SR,
  speak: typeof window.speechSynthesis !== 'undefined',
};

/* ------------------------------------------------------------ listening */

export class Listener {
  /**
   * @param {{onResult, onPartial, onEnd, onError, lang?}} handlers
   */
  constructor({ onResult, onPartial, onEnd, onError, lang = 'en-GB' } = {}) {
    this.onResult = onResult || (() => {});
    this.onPartial = onPartial || (() => {});
    this.onEnd = onEnd || (() => {});
    this.onError = onError || (() => {});
    this.lang = lang;
    this.recognition = null;
    this.listening = false;
    this.finalText = '';
  }

  start() {
    if (!SR) { this.onError(new Error('Speech recognition is not available in this browser.')); return false; }
    if (this.listening) return true;

    const r = new SR();
    r.lang = this.lang;
    r.continuous = false;          // one utterance per tap — cleaner on mobile
    r.interimResults = true;
    r.maxAlternatives = 1;

    this.finalText = '';

    r.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) this.finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) this.onPartial(interim);
      if (this.finalText) this.onPartial(this.finalText);
    };

    r.onerror = (event) => {
      this.listening = false;
      const map = {
        'no-speech': 'I did not catch anything — try again.',
        'not-allowed': 'Microphone access was blocked. Allow it in your browser settings.',
        'service-not-allowed': 'Speech recognition is not permitted on this device.',
        'audio-capture': 'No microphone was found.',
        network: 'Speech recognition needs a connection on this device.',
      };
      this.onError(new Error(map[event.error] || `Speech error: ${event.error}`));
    };

    r.onend = () => {
      this.listening = false;
      const text = this.finalText.trim();
      if (text) this.onResult(text);
      this.onEnd(text);
    };

    try {
      r.start();
      this.recognition = r;
      this.listening = true;
      return true;
    } catch (err) {
      this.onError(err);
      return false;
    }
  }

  stop() {
    if (!this.recognition) return;
    try { this.recognition.stop(); } catch { /* already stopped */ }
    this.listening = false;
  }

  abort() {
    if (!this.recognition) return;
    try { this.recognition.abort(); } catch { /* already stopped */ }
    this.listening = false;
  }
}

/* -------------------------------------------------------------- speaking */

let primed = false;
let preferredVoice = null;

/** iOS refuses to speak unless the first utterance came from a gesture. */
export function primeSpeech() {
  if (primed || !voiceSupport.speak) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    primed = true;
  } catch { /* ignore */ }
}

function pickVoice() {
  if (preferredVoice) return preferredVoice;
  if (!voiceSupport.speak) return null;
  const voices = window.speechSynthesis.getVoices() || [];
  if (!voices.length) return null;
  // Prefer a natural-sounding English voice; fall back to any English one.
  preferredVoice =
    voices.find((v) => /en-GB/i.test(v.lang) && /(Serena|Kate|Daniel|Google UK)/i.test(v.name))
    || voices.find((v) => /en-GB/i.test(v.lang))
    || voices.find((v) => /^en/i.test(v.lang))
    || voices[0];
  return preferredVoice;
}

if (voiceSupport.speak && typeof window.speechSynthesis.addEventListener === 'function') {
  window.speechSynthesis.addEventListener('voiceschanged', () => { preferredVoice = null; });
}

/**
 * Speaks text, stripping the markdown-ish bullets so it reads naturally.
 * @returns {Promise<void>} resolves when finished or cancelled
 */
export function speak(text, { rate = 1.02, pitch = 1 } = {}) {
  if (!voiceSupport.speak || !text) return Promise.resolve();
  cancelSpeech();

  const spoken = String(text)
    .replace(/\n+/g, '. ')
    .replace(/[•·]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/(\d)–(\d)/g, '$1 to $2')
    .trim();

  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(spoken);
    const v = pickVoice();
    if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
    u.rate = rate;
    u.pitch = pitch;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    try { window.speechSynthesis.speak(u); } catch { resolve(); }
  });
}

export function cancelSpeech() {
  if (!voiceSupport.speak) return;
  try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
}

export function isSpeaking() {
  return voiceSupport.speak ? window.speechSynthesis.speaking : false;
}

/** Trims a long answer down to something bearable to listen to. */
export function spokenSummary(text, maxSentences = 4) {
  const clean = String(text).replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  const sentences = clean.match(/[^.!?]+[.!?]+/g) || [clean];
  if (sentences.length <= maxSentences) return clean;
  return `${sentences.slice(0, maxSentences).join(' ').trim()} There is more detail on screen.`;
}
