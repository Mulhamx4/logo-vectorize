// The last batch (source files + applied settings), kept in this browser only so a refresh
// or a closed tab can resume. Nothing leaves the device. Every call fails soft: private
// windows and blocked storage just mean there is nothing to resume.
const DB = 'logo-vectorize', STORE = 'session', KEY = 'last';
export const SESSION_TTL = 24 * 60 * 60 * 1000;

// opens without a fixed version; if the database exists without our store (created by
// something else on this origin), reopen one version up to add it
function openDB(version) {
  return new Promise((resolve, reject) => {
    const req = version ? indexedDB.open(DB, version) : indexedDB.open(DB);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onsuccess = () => {
      const db = req.result;
      if (db.objectStoreNames.contains(STORE)) return resolve(db);
      const next = db.version + 1; db.close(); openDB(next).then(resolve, reject);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  });
}

async function run(mode, op) {
  const db = await openDB();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), req = op(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}

// a batch this large is not worth holding in storage; it is simply not offered for resume
export const MAX_SESSION_BYTES = 64 * 1024 * 1024;
let generation = 0;   // bumped by clearSession so a save still reading files can't bring a cleared session back

/** @param {{items:{file:Blob,name:string,options:object}[], active:number}} data */
export async function saveSession(data) {
  const gen = ++generation;
  try {
    if (data.items.reduce((n, it) => n + it.file.size, 0) > MAX_SESSION_BYTES) { await clearSession(); return false; }
    // raw bytes, not Blobs: WebKit refuses Blobs in IndexedDB in private windows
    const items = await Promise.all(data.items.map(async ({ file, ...rest }) => ({
      ...rest, file: { bytes: await file.arrayBuffer(), type: file.type, fileName: file.name || 'logo', lastModified: file.lastModified || Date.now() },
    })));
    if (gen !== generation) return false;
    await run('readwrite', s => s.put({ items, active: data.active, savedAt: Date.now() }, KEY));
    return true;
  } catch { return false; }
}

/** The saved batch, or null when there is none, it expired, or storage is unavailable. */
export async function loadSession() {
  try {
    const v = await run('readonly', s => s.get(KEY));
    if (!v?.items?.length || !v.items.every(it => it.file?.bytes)) return null;
    if (Date.now() - v.savedAt > SESSION_TTL) { await clearSession(); return null; }
    const items = v.items.map(({ file: f, ...rest }) => ({ ...rest, file: new File([f.bytes], f.fileName, { type: f.type, lastModified: f.lastModified }) }));
    return { ...v, items };
  } catch { return null; }
}

export async function clearSession() {
  generation++;
  try { await run('readwrite', s => s.delete(KEY)); } catch {}
}
