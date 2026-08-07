/**
 * Knowledge base loader and retrieval.
 *
 * The KB is a plain JSON file served alongside the app. It is fetched
 * network-first on every launch with cache-busting, so editing
 * knowledge/kb.json and redeploying updates every device the next time it
 * is online — no app release needed. The last good copy is kept in
 * localStorage so the assistant still answers offline.
 */

const KB_PATH = 'knowledge/kb.json';
const CACHE_KEY = 'krysaril.kb';
const CHECKED_KEY = 'krysaril.kb.checkedAt';

let loaded = null;
let loadPromise = null;

const appUrl = (path) => new URL(path, document.baseURI).href;

/**
 * @returns {Promise<{version:string, updated:string, entries:Array, source:'network'|'cache'|'none', checkedAt:number}>}
 */
export function loadKnowledge({ force = false } = {}) {
  if (loaded && !force) return Promise.resolve(loaded);
  if (loadPromise && !force) return loadPromise;

  loadPromise = (async () => {
    // Network first — the whole point is that this stays current.
    try {
      const res = await fetch(`${appUrl(KB_PATH)}?v=${Date.now()}`, { cache: 'no-store' });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.entries) && data.entries.length) {
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(data));
            localStorage.setItem(CHECKED_KEY, String(Date.now()));
          } catch { /* storage full or private mode */ }
          loaded = { ...data, source: 'network', checkedAt: Date.now() };
          return loaded;
        }
      }
    } catch { /* offline — fall through */ }

    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        loaded = {
          ...data,
          source: 'cache',
          checkedAt: Number(localStorage.getItem(CHECKED_KEY)) || 0,
        };
        return loaded;
      }
    } catch { /* corrupt cache */ }

    loaded = { version: '—', updated: '—', entries: [], source: 'none', checkedAt: 0 };
    return loaded;
  })();

  return loadPromise;
}

export function knowledgeStatus() {
  if (!loaded) return null;
  return {
    version: loaded.version,
    updated: loaded.updated,
    entries: loaded.entries.length,
    source: loaded.source,
    checkedAt: loaded.checkedAt,
  };
}

/* ------------------------------------------------------------ retrieval */

const STOP = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'do', 'does', 'did',
  'i', 'my', 'me', 'you', 'your', 'it', 'its', 'to', 'of', 'in', 'on', 'for', 'with',
  'and', 'or', 'but', 'if', 'so', 'that', 'this', 'these', 'those', 'what', 'how',
  'why', 'when', 'can', 'should', 'would', 'could', 'about', 'from', 'at', 'as',
  'have', 'has', 'had', 'get', 'got', 'am', 'will', 'just', 'any', 'some',
]);

export function tokenise(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Crude singulariser. People type "my knees hurt" and the tag says "knee";
 * without this the two only meet as a weak substring match and a generic
 * entry that happens to share one exact word outranks the specific one.
 */
function stem(w) {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * Scores entries against a query.
 *
 * Tag hits weigh heaviest because tags are curated; topic next; body text
 * last. Multi-word tag phrases matched inside the raw query score highest
 * of all, so "waist to height" finds the right entry even though each word
 * on its own is common. A multi-word tag whose words all appear in the
 * question but not adjacently ("knees cave in when I squat" against the tag
 * "squat knees") still counts for most of that — word order is not a signal.
 *
 * @returns {Array<{entry: object, score: number}>} best first
 */
export function search(entries, query, { limit = 3, minScore = 2 } = {}) {
  const raw = String(query || '').toLowerCase();
  const words = tokenise(query);
  if (!words.length) return [];
  const stems = words.map(stem);

  const scored = entries.map((entry) => {
    let score = 0;

    for (const tag of entry.tags || []) {
      const t = tag.toLowerCase();
      const parts = t.split(/\s+/).map(stem);
      if (t.includes(' ') && raw.includes(t)) score += 8;                 // adjacent phrase
      else if (parts.length > 1 && parts.every((p) => stems.includes(p))) score += 6;
      else if (parts.length === 1 && stems.includes(parts[0])) score += 5;
      else if (words.some((w) => t.includes(w) || w.includes(t))) score += 2;
    }

    const topic = (entry.topic || '').toLowerCase();
    const topicStems = tokenise(topic).map(stem);
    for (const s of stems) if (topicStems.includes(s) || topic.includes(s)) score += 3;

    const body = (entry.answer || '').toLowerCase();
    for (const w of words) if (body.includes(w)) score += 1;

    return { entry, score };
  });

  return scored
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Topic suggestions for the empty state. */
export function suggestedTopics(entries, n = 6) {
  return entries.slice(0, n).map((e) => e.topic);
}
