/**
 * IndexedDB persistence for clients, training sessions, posture assessments,
 * body scans, strike rounds and skin scans.
 *
 * Everything stays on the device — no network, no accounts.
 */

const DB_NAME = 'krysaril';
const LEGACY_DB_NAME = 'lumen-coach';
const DB_VERSION = 1;

const STORES = {
  clients: { keyPath: 'id', indexes: [['name', 'name']] },
  sessions: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['startedAt', 'startedAt']] },
  scans: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  postures: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  bodyscans: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  rounds: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  labs: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  vitals: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  programs: { keyPath: 'id', indexes: [['clientId', 'clientId'], ['createdAt', 'createdAt']] },
  settings: { keyPath: 'key', indexes: [] },
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = (async () => {
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [name, spec] of Object.entries(STORES)) {
          const store = d.objectStoreNames.contains(name)
            ? req.transaction.objectStore(name)
            : d.createObjectStore(name, { keyPath: spec.keyPath });
          for (const [idxName, keyPath] of spec.indexes) {
            if (!store.indexNames.contains(idxName)) store.createIndex(idxName, keyPath);
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database upgrade blocked — close other tabs of this app.'));
    });
    await migrateLegacy(db);
    return db;
  })();
  return dbPromise;
}

/**
 * One-time import from the pre-rename database, so anything recorded as
 * "Lumen Coach" carries over rather than being orphaned.
 */
async function migrateLegacy(db) {
  try {
    const done = await new Promise((resolve) => {
      const req = db.transaction('settings').objectStore('settings').get('legacyImported');
      req.onsuccess = () => resolve(!!req.result?.value);
      req.onerror = () => resolve(true);          // don't block startup on this
    });
    if (done) return;

    const legacy = await new Promise((resolve) => {
      const req = indexedDB.open(LEGACY_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onupgradeneeded = () => {               // did not exist — nothing to import
        try { req.transaction.abort(); } catch { /* ignore */ }
        resolve(null);
      };
    });

    const names = ['clients', 'sessions', 'scans'];
    const carried = {};
    if (legacy) {
      for (const name of names) {
        if (!legacy.objectStoreNames.contains(name)) continue;
        carried[name] = await new Promise((resolve) => {
          const req = legacy.transaction(name).objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        });
      }
      legacy.close();
    }

    await new Promise((resolve, reject) => {
      const t = db.transaction([...names, 'settings'], 'readwrite');
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error);
      for (const name of names) {
        const rows = carried[name] || [];
        const store = t.objectStore(name);
        rows.forEach((row) => store.put(row));
      }
      t.objectStore('settings').put({ key: 'legacyImported', value: true });
    });
  } catch (err) {
    console.warn('Legacy import skipped', err);
  }
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
    notes: partial.notes ?? existing?.notes ?? '',
    goals: partial.goals ?? existing?.goals ?? '',
    heightCm: partial.heightCm ?? existing?.heightCm ?? null,
    weightKg: partial.weightKg ?? existing?.weightKg ?? null,
    sex: partial.sex ?? existing?.sex ?? null,
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
  const owned = await Promise.all([
    listSessions(id), listScans(id), listPostures(id), listBodyScans(id), listRounds(id),
    listLabs(id), listVitals(id), listPrograms(id),
  ]);
  const names = ['sessions', 'scans', 'postures', 'bodyscans', 'rounds', 'labs', 'vitals', 'programs'];
  await tx(['clients', ...names], 'readwrite', ([clients, ...rest]) => {
    clients.delete(id);
    rest.forEach((store, i) => owned[i].forEach((row) => store.delete(row.id)));
  });
}

/* ------------------------------------------------- generic record accessors */

function makeStore(name, prefix, dateKey = 'createdAt') {
  return {
    async list(clientId = null, limit = Infinity) {
      const db = await openDB();
      const store = db.transaction(name).objectStore(name);
      const items = clientId
        ? await wrap(store.index('clientId').getAll(clientId))
        : await wrap(store.getAll());
      items.sort((a, b) => (b[dateKey] || 0) - (a[dateKey] || 0));
      return limit === Infinity ? items : items.slice(0, limit);
    },
    async get(id) {
      const db = await openDB();
      return (await wrap(db.transaction(name).objectStore(name).get(id))) || null;
    },
    async save(record) {
      const rec = { ...record, id: record.id || uid(prefix), [dateKey]: record[dateKey] || Date.now() };
      await tx(name, 'readwrite', (s) => s.put(rec));
      if (rec.clientId) await touchClient(rec.clientId);
      return rec;
    },
    async remove(id) {
      await tx(name, 'readwrite', (s) => s.delete(id));
    },
  };
}

const sessionStore = makeStore('sessions', 'ses', 'startedAt');
const scanStore = makeStore('scans', 'scn');
const postureStore = makeStore('postures', 'pos');
const bodyStore = makeStore('bodyscans', 'bod');
const roundStore = makeStore('rounds', 'rnd');
const labStore = makeStore('labs', 'lab');
const vitalStore = makeStore('vitals', 'vit');
const programStore = makeStore('programs', 'prg');

export const listSessions = sessionStore.list;
export const getSession = sessionStore.get;
export const saveSession = sessionStore.save;
export const deleteSession = sessionStore.remove;

export const listScans = scanStore.list;
export const getScan = scanStore.get;
export const saveScan = scanStore.save;
export const deleteScan = scanStore.remove;

export const listPostures = postureStore.list;
export const getPosture = postureStore.get;
export const savePosture = postureStore.save;
export const deletePosture = postureStore.remove;

export const listBodyScans = bodyStore.list;
export const getBodyScan = bodyStore.get;
export const saveBodyScan = bodyStore.save;
export const deleteBodyScan = bodyStore.remove;

export const listRounds = roundStore.list;
export const getRound = roundStore.get;
export const saveRound = roundStore.save;
export const deleteRound = roundStore.remove;

export const listLabs = labStore.list;
export const getLabs = labStore.get;
export const saveLabs = labStore.save;
export const deleteLabs = labStore.remove;

export const listVitals = vitalStore.list;
export const getVitals = vitalStore.get;
export const saveVitals = vitalStore.save;
export const deleteVitals = vitalStore.remove;

export const listPrograms = programStore.list;
export const getProgram = programStore.get;
export const saveProgram = programStore.save;
export const deleteProgram = programStore.remove;

/** Everything currently known about a client, for the coach and programs. */
export async function latestFor(clientId = null) {
  const [posture, body, sessions, skin, vitals, labs, program] = await Promise.all([
    listPostures(clientId, 1), listBodyScans(clientId, 1), listSessions(clientId, 8),
    listScans(clientId, 1), listVitals(clientId, 20), listLabs(clientId, 1), listPrograms(clientId, 1),
  ]);
  return {
    posture: posture[0] || null,
    body: body[0] || null,
    sessions,
    skin: skin[0] || null,
    vitals: vitals[0] || null,
    vitalsHistory: vitals,
    labs: labs[0] || null,
    program: program[0] || null,
  };
}

/* ----------------------------------------------------------------- settings */

const DEFAULT_SETTINGS = {
  activeClientId: null,
  modelQuality: 'lite',
  mirror: false,
  facing: 'environment',
  showSkeleton: true,
  showAngles: true,
  haptics: true,
  units: 'metric',
  keepAwake: true,
  roundLengthSec: 180,
  restLengthSec: 60,
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
  const [clients, sessions, scans, postures, bodyscans, rounds, labs, vitals, programs, settings] =
    await Promise.all([
      listClients(), listSessions(), listScans(), listPostures(), listBodyScans(),
      listRounds(), listLabs(), listVitals(), listPrograms(), getSettings(),
    ]);
  return {
    app: 'krysaril',
    version: DB_VERSION,
    exportedAt: new Date().toISOString(),
    clients, sessions, scans, postures, bodyscans, rounds, labs, vitals, programs, settings,
  };
}

export async function importAll(data) {
  if (!data || (data.app !== 'krysaril' && data.app !== 'lumen-coach')) {
    throw new Error('Not a Krysaril backup file.');
  }
  const names = ['clients', 'sessions', 'scans', 'postures', 'bodyscans', 'rounds', 'labs', 'vitals', 'programs'];
  const counts = {};
  await tx(names, 'readwrite', (stores) => {
    names.forEach((name, i) => {
      const rows = data[name] || [];
      counts[name] = rows.length;
      rows.forEach((row) => stores[i].put(row));
    });
  });
  return counts;
}

export async function clearAll() {
  settingsCache = null;
  const names = [...Object.keys(STORES)];
  await tx(names, 'readwrite', (stores) => stores.forEach((s) => s.clear()));
}

export async function estimateUsage() {
  if (!navigator.storage?.estimate) return null;
  try { return await navigator.storage.estimate(); } catch { return null; }
}
