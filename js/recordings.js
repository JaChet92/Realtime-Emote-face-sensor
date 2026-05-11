const DB_NAME = "face.detect.recordings.v1";
const STORE = "recordings";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db, mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

export async function listRecordings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = txStore(db).getAll();
    req.onsuccess = () => resolve(req.result.sort((a, b) => b.createdAt - a.createdAt));
    req.onerror = () => reject(req.error);
  });
}

export async function saveRecording(recording) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = txStore(db, "readwrite").put(recording);
    req.onsuccess = () => resolve(recording);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteRecording(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = txStore(db, "readwrite").delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearRecordings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = txStore(db, "readwrite").clear();
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function makeRecordingName(createdAt = Date.now(), mimeType = "video/webm") {
  const safe = new Date(createdAt).toISOString().replace(/[:.]/g, "-");
  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  return `face-detect-${safe}.${ext}`;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
