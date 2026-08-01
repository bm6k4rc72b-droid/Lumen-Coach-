/**
 * IndexedDB persistence for clients, training sessions and skin scans.
 * Everything stays on the device — no network, no accounts.
 */

const DB_NAME = 'lumen-coach';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('clients')) {
        const s = db.createObjectStore('clients', { keyPath: 'id' });
        s.createIndex('name', 'name');
      }
      if (!db.objectStoreNames.contains('sessions')) {
        const s = db.createObjectStore('sessions', { keyPath: 'id' });
        s.createIndex('clientId', 'clientId');
        s.createIndex('startedAt', 'startedAt');
      }
      if (!db.objectStoreNames.contains('scans')) {
        const s = db.createObjectStore('scans', { keyPath: 'id' });
        s.createIndex('clientId', 'clientId');
        s.createIndex('createdAt', 'createdAt');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
      void e;
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database upgrade blocked — close other tabs of this app.'));
  });
  return dbPromise;
}

/** Runs a synchronous callback inside a transaction and resolves when it commits. */
async function tx(storeNames, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    try {
      fn(Array.isArray(storeNames) ? storeNames.map((n) => t.objectStore(n)) : t.objectStore(storeNames));
    } catch (err) {
      try { t.abort(); } catch { /* already aborting */ }
      reject(err);
    }
  });
}

const wrap = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export function uid(prefix = 'id') {
  const rand = (crypto.randomUUID?.() || Math.random().toString(36).slice(2) + Date.now().toString(36))
    .replace(/-/g, '').slice(0, 12);
  return `${prefix}_${rand}`;
}

/* ------------------------------------------------------------------ clients */

export async function listClients() {
  const db = await openDB();
  const items = await wrap(db.transaction('clients').objectStore('clients').getAll());
  return items.sort((a, b) => (b.lastActiveAt || b.createdAt) - (a.lastActiveAt || a.createdAt));
}

export async function getClient(id) {
  if (!id) return null;
  const db = await openDB();
  return (await wrap(db.transaction('clients').objectStore('clients').get(id))) || null;
}

export async function saveClient(partial) {
  const now = Date.now();
  const existing = partial.id ? await getClient(partial.id) : null;
  const client = {
    id: partial.id || uid('cli'),
    name: (partial.name || '').trim() || 'Unnamed client',
    notes: partial.notes || '',
    goals: partial.goals || '',
    heightCm: partial.heightCm ?? existing?.heightCm ?? null,
    createdAt: existing?.createdAt || now,
    lastActiveAt: partial.lastActiveAt ?? existing?.lastActiveAt ?? now,
    updatedAt: now,
  };
  await tx('clients', 'readwrite', (s) => s.put(client));
  return client;
}

export async function touchClient(id) {
  const c = await getClient(id);
  if (!c) return;
  c.lastActiveAt = Date.now();
  await tx('clients', 'readwrite', (s) => s.put(c));
}

export async function deleteClient(id) {
  const [sessions, scans] = await Promise.all([listSessions(id), listScans(id)]);
  await tx(['clients', 'sessions', 'scans'], 'readwrite', ([c, se, sc]) => {
    c.delete(id);
    sessions.forEach((s) => se.delete(s.id));
    scans.forEach((s) => sc.delete(s.id));
  });
}

/* ----------------------------------------------------------------- sessions */

export async function listSessions(clientId = null, limit = Infinity) {
  const db = await openDB();
  const store = db.transaction('sessions').objectStore('sessions');
  const items = clientId
    ? await wrap(store.index('clientId').getAll(clientId))
    : await wrap(store.getAll());
  items.sort((a, b) => b.startedAt - a.startedAt);
  return limit === Infinity ? items : items.slice(0, limit);
}

export async function getSession(id) {
  const db = await openDB();
  return (await wrap(db.transaction('sessions').objectStore('sessions').get(id))) || null;
}

export async function saveSession(session) {
  const rec = { ...session, id: session.id || uid('ses'), updatedAt: Date.now() };
  await tx('sessions', 'readwrite', (s) => s.put(rec));
  if (rec.clientId) await touchClient(rec.clientId);
  return rec;
}

export async function deleteSession(id) {
  await tx('sessions', 'readwrite', (s) => s.delete(id));
}

/* -------------------------------------------------------------------- scans */

export async function listScans(clientId = null, limit = Infinity) {
  const db = await openDB();
  const store = db.transaction('scans').objectStore('scans');
  const items = clientId
    ? await wrap(store.index('clientId').getAll(clientId))
    : await wrap(store.getAll());
  items.sort((a, b) => b.createdAt - a.createdAt);
  return limit === Infinity ? items : items.slice(0, limit);
}

export async function getScan(id) {
  const db = await openDB();
  return (await wrap(db.transaction('scans').objectStore('scans').get(id))) || null;
}

export async function saveScan(scan) {
  const rec = { ...scan, id: scan.id || uid('scn'), createdAt: scan.createdAt || Date.now() };
  await tx('scans', 'readwrite', (s) => s.put(rec));
  if (rec.clientId) await touchClient(rec.clientId);
  return rec;
}

export async function deleteScan(id) {
  await tx('scans', 'readwrite', (s) => s.delete(id));
}

/* ----------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  activeClientId: null,
  modelQuality: 'lite',     // lite | full
  mirror: false,
  facing: 'environment',
  showSkeleton: true,
  showAngles: true,
  voiceCues: false,
  haptics: true,
  units: 'metric',          // metric | imperial
  keepAwake: true,
};

let settingsCache = null;

export async function getSettings() {
  if (settingsCache) return settingsCache;
  const db = await openDB();
  const rows = await wrap(db.transaction('settings').objectStore('settings').getAll());
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  settingsCache = { ...DEFAULT_SETTINGS, ...stored };
  return settingsCache;
}

export async function setSetting(key, value) {
  const s = await getSettings();
  s[key] = value;
  await tx('settings', 'readwrite', (store) => store.put({ key, value }));
  return s;
}

/* ------------------------------------------------------------------ backups */

export async function exportAll() {
  const [clients, sessions, scans, settings] = await Promise.all([
    listClients(), listSessions(), listScans(), getSettings(),
  ]);
  return {
    app: 'lumen-coach',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    clients, sessions, scans, settings,
  };
}

export async function importAll(data) {
  if (!data || data.app !== 'lumen-coach') throw new Error('Not a Lumen Coach backup file.');
  const counts = { clients: 0, sessions: 0, scans: 0 };
  await tx(['clients', 'sessions', 'scans'], 'readwrite', ([c, se, sc]) => {
    (data.clients || []).forEach((x) => { c.put(x); counts.clients++; });
    (data.sessions || []).forEach((x) => { se.put(x); counts.sessions++; });
    (data.scans || []).forEach((x) => { sc.put(x); counts.scans++; });
  });
  return counts;
}

export async function clearAll() {
  settingsCache = null;
  await tx(['clients', 'sessions', 'scans', 'settings'], 'readwrite', ([c, se, sc, st]) => {
    c.clear(); se.clear(); sc.clear(); st.clear();
  });
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
