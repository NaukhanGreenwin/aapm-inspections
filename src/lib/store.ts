/* In-progress autosave only. Nothing here is a saved report: a finished inspection leaves the
   app only through the Send step (src/lib/send.ts), then everything of it is deleted.
   - The inspection in progress (text, choices, signatures) lives in localStorage: small,
     synchronous, survives a refresh. Saved on every change.
   - Its photos are JPEG bytes (ArrayBuffer, never Blob: Safari private mode cannot store Blobs)
     in IndexedDB "photos" (localStorage tops out around 5 MB).
   - "outbox" holds the finished PDF of a report waiting to send, so every retry uploads the same
     bytes. Deleted with the draft once the office copy is confirmed sent.
   v3 removed the "saved reports" store and the move-in .json file; DB v2 drops the old store. */
import type { PhotoRecord, Report } from "./types";

const DRAFT_KEY = "aapm-inspection-draft-v1";
const DB_NAME = "aapm-inspections";
const DB_VER = 3;

export function loadDraft(): Report | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as Report;
    return r && r.v === 1 && r.id ? r : null;
  } catch { return null; }
}
export function saveDraft(r: Report | null): boolean {
  try {
    if (!r) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify(r));
    return true;
  } catch { return false; }
}

let dbp: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("photos")) d.createObjectStore("photos", { keyPath: "id" }).createIndex("reportId", "reportId");
      if (!d.objectStoreNames.contains("outbox")) d.createObjectStore("outbox", { keyPath: "id" });
      if (d.objectStoreNames.contains("reports")) d.deleteObjectStore("reports"); // v1/v2 saved-reports list, retired in v3
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => { dbp = null; rej(req.error); };
    req.onblocked = () => { dbp = null; rej(new Error("blocked")); };
  });
  return dbp;
}
function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => res(r ? (r as IDBRequest<T>).result : (undefined as T));
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const putPhoto = (p: PhotoRecord) => tx<IDBValidKey>("photos", "readwrite", (s) => s.put(p));
export const getPhoto = (id: string) => tx<PhotoRecord | undefined>("photos", "readonly", (s) => s.get(id));
export const deletePhoto = (id: string) => { revokePhotoUrls(id); return tx<undefined>("photos", "readwrite", (s) => s.delete(id)); };

/** JPEG bytes of a stored photo as a Blob (new ArrayBuffer records and old Blob records). */
export function photoBlob(p: PhotoRecord, thumb = false): Blob | null {
  const data = thumb ? p.thumbData ?? p.data : p.data;
  if (data) return new Blob([data], { type: "image/jpeg" });
  return (thumb ? p.thumb ?? p.blob : p.blob) ?? null;
}

export async function photosFor(reportId: string): Promise<PhotoRecord[]> {
  return tx<PhotoRecord[]>("photos", "readonly", (s) => s.index("reportId").getAll(reportId));
}
export async function deletePhotosFor(reportId: string) {
  const ids = await tx<IDBValidKey[]>("photos", "readonly", (s) => s.index("reportId").getAllKeys(reportId));
  ids.forEach((id) => revokePhotoUrls(String(id)));
  await tx<undefined>("photos", "readwrite", (s) => { ids.forEach((id) => s.delete(id)); });
}

/** Drop photos that belong to no inspection in progress (left over from retired saved reports). */
export async function prunePhotos(keepReportId: string | null) {
  const ids = await tx<IDBValidKey[]>("photos", "readonly", (s) => s.getAllKeys());
  const keep = keepReportId ? new Set(await tx<IDBValidKey[]>("photos", "readonly", (s) => s.index("reportId").getAllKeys(keepReportId))) : new Set();
  const drop = ids.filter((id) => !keep.has(id));
  if (drop.length) await tx<undefined>("photos", "readwrite", (s) => { drop.forEach((id) => s.delete(id)); });
  const out = await tx<IDBValidKey[]>("outbox", "readonly", (s) => s.getAllKeys());
  const stale = out.filter((id) => id !== keepReportId);
  if (stale.length) await tx<undefined>("outbox", "readwrite", (s) => { stale.forEach((id) => s.delete(id)); });
}

/* ---------- outbox: the finished PDF, kept until the office copy is confirmed ---------- */
export interface OutboxRecord { id: string; data: ArrayBuffer; sha256: string; name: string; photos: number; at: string }
export const putOutbox = (o: OutboxRecord) => tx<IDBValidKey>("outbox", "readwrite", (s) => s.put(o));
export const getOutbox = (id: string) => tx<OutboxRecord | undefined>("outbox", "readonly", (s) => s.get(id));
export const deleteOutbox = (id: string) => tx<undefined>("outbox", "readwrite", (s) => s.delete(id));

/** Delete every trace of one inspection from this phone and wait until it is gone. */
export async function eraseInspection(reportId: string) {
  saveDraft(null);
  await deletePhotosFor(reportId).catch(() => {});
  await deleteOutbox(reportId).catch(() => {});
  revokeAllPhotoUrls();
}

/** Can this browser keep photos at all? (Private Browsing on some iPhones cannot.) */
export async function storageWorks(): Promise<boolean> {
  try {
    const id = "probe-" + Math.random().toString(36).slice(2);
    await tx("photos", "readwrite", (s) => s.put({ id, reportId: "probe", data: new ArrayBuffer(8), w: 1, h: 1, takenAt: "" }));
    await tx("photos", "readwrite", (s) => s.delete(id));
    return true;
  } catch { return false; }
}

export async function requestPersistence() {
  try { if (navigator.storage?.persist) await navigator.storage.persist(); } catch { /* ignore */ }
}

/* ---------- object URLs for photos, cached per session, revoked on delete/reset ---------- */
const urlCache = new Map<string, string>();
export async function photoUrl(id: string, thumb = true): Promise<string | null> {
  const k = `${id}:${thumb ? "t" : "f"}`;
  if (urlCache.has(k)) return urlCache.get(k)!;
  const p = await getPhoto(id).catch(() => undefined);
  const b = p && photoBlob(p, thumb);
  if (!b) return null;
  const u = URL.createObjectURL(b);
  urlCache.set(k, u);
  return u;
}
function revokePhotoUrls(id: string) {
  for (const k of [`${id}:t`, `${id}:f`]) { const u = urlCache.get(k); if (u) { URL.revokeObjectURL(u); urlCache.delete(k); } }
}
export function revokeAllPhotoUrls() { urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear(); }

export const blobToDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
