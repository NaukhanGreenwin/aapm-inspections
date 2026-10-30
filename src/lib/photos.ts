import type { PhotoRecord } from "./types";
import { uid } from "./template";

/* Photos are compressed on the phone before they are stored: max 1600px long edge at JPEG 0.72
   (typically 150-350 KB) plus a 320px thumbnail for the screens and the PDF grid. */
const FULL = 1600, THUMB = 320;

async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await Promise.race([img.decode(), new Promise((_, rej) => setTimeout(() => rej(new Error("decode timeout")), 20_000))]);
      return img;
    } finally { setTimeout(() => URL.revokeObjectURL(url), 2000); }
  }
}

export function draw(src: ImageBitmap | HTMLImageElement, edge: number, q: number): Promise<{ blob: Blob; w: number; h: number }> {
  const sw = "naturalWidth" in src ? src.naturalWidth : src.width;
  const sh = "naturalHeight" in src ? src.naturalHeight : src.height;
  const s = Math.min(1, edge / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  // release the canvas memory straight away: iOS caps the total canvas memory per page
  return new Promise((res, rej) => c.toBlob((b) => { c.width = c.height = 0; if (b) res({ blob: b, w, h }); else rej(new Error("encode")); }, "image/jpeg", q));
}

/** Why a photo could not be added, in words the inspector can act on. */
export class PhotoError extends Error {
  kind: "heic" | "decode" | "storage";
  constructor(kind: "heic" | "decode" | "storage", msg: string) { super(msg); this.kind = kind; }
}

/** Re-encode a stored photo smaller for the PDF (the 1600px original stays for on-screen zoom). */
export async function shrinkForPdf(b: Blob, edge: number, q: number): Promise<Blob> {
  const work = (async () => {
    const src = await decode(b);
    try { return (await draw(src, edge, q)).blob; } finally { if ("close" in src) src.close(); }
  })();
  // never let one stuck photo hold up the send: fall back to the stored 1600px JPEG
  return Promise.race([work, new Promise<Blob>((res) => setTimeout(() => res(b), 20_000))]);
}

export const isHeic = (f: File) => /\.(heic|heif)$/i.test(f.name) || /hei[cf]/i.test(f.type);

export async function processPhoto(file: File, reportId: string): Promise<PhotoRecord> {
  let src: ImageBitmap | HTMLImageElement;
  try { src = await decode(file); }
  catch { throw new PhotoError(isHeic(file) ? "heic" : "decode", isHeic(file) ? "HEIC photos cannot be opened in this browser" : "the photo could not be opened"); }
  try {
    const full = await draw(src, FULL, 0.72);
    const thumb = await draw(src, THUMB, 0.7);
    const [data, thumbData] = await Promise.all([full.blob.arrayBuffer(), thumb.blob.arrayBuffer()]);
    return { id: uid("p"), reportId, data, thumbData, w: full.w, h: full.h, takenAt: new Date().toISOString() };
  } catch { throw new PhotoError("decode", "the photo could not be processed"); }
  finally { if ("close" in src) src.close(); }
}
