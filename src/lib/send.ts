/* send.ts - the ONLY way a finished inspection leaves the app (AAPM PREVIEW build).
   The phone builds the signed PDF (src/lib/pdf.ts), keeps it in the IndexedDB outbox, and posts it to
   the ITRS relay (itrs-form-relay /aapm-inspection). PREVIEW: the relay mails it from the ITRS mailbox
   to nauman.khan@itrapidsupport.com ONLY - the recipient is a server constant, nothing here can change
   it, and nothing is ever sent to aapm.ca, AA staff, owners or tenants. Idempotent by report id.
   Nothing is deleted from the phone until the relay confirms the send. */
import type { Report } from "./types";
import { addressLine, fmtDate } from "./template";
import { getOutbox, photosFor, putOutbox, type OutboxRecord } from "./store";

export const RELAY = "https://itrs-form-relay.onrender.com/aapm-inspection";
export const MAX_PDF = 2800 * 1024; // preview relay attaches the PDF inline (Graph sendMail < 4 MB)

export type SendResult =
  | { sent: true; at: string; messageId: string; test: boolean }
  | { sent: false; reason: "offline" | "auth" | "too-large" | "rate" | "failed"; message: string };

export interface Progress { phase: "pdf" | "upload" | "send"; done: number; total: number }

const hex = (buf: ArrayBuffer) => Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;

/** Build the PDF once and keep it: every retry uploads the same bytes. Photos shrink until it fits. */
export async function preparePdf(r: Report, onProgress?: (p: Progress) => void): Promise<OutboxRecord> {
  const have = await getOutbox(r.id).catch(() => undefined);
  if (have) return have;
  onProgress?.({ phase: "pdf", done: 0, total: 1 });
  const { buildPdf, pdfFileName } = await import("./pdf");
  let blob = await buildPdf(r);
  for (const o of [{ edge: 900, q: 0.5 }, { edge: 640, q: 0.45 }, { edge: 480, q: 0.4 }]) {
    if (blob.size <= MAX_PDF * 0.97) break;
    blob = await buildPdf(r, o);
  }
  const data = await blob.arrayBuffer();
  const photos = (await photosFor(r.id).catch(() => [])).length;
  const rec: OutboxRecord = { id: r.id, data, sha256: hex(await crypto.subtle.digest("SHA-256", data)), name: pdfFileName(r), photos, at: new Date().toISOString() };
  if (data.byteLength <= MAX_PDF) await putOutbox(rec);
  return rec;
}

export async function sendReport(r: Report, ob: OutboxRecord, onProgress?: (p: Progress) => void): Promise<SendResult> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return { sent: false, reason: "offline", message: "No signal. The report will send when the phone is back online." };
  const size = ob.data.byteLength;
  if (size > MAX_PDF) return { sent: false, reason: "too-large", message: `The report is ${mb(size)}, over the ${mb(MAX_PDF)} preview limit.` };
  const form = () => {
    const f = new FormData();
    f.set("id", r.id);
    f.set("address", addressLine(r.details));
    f.set("date", fmtDate(r.details.date));
    f.set("inspector", r.details.inspector);
    f.set("photos", String(ob.photos));
    f.set("filename", ob.name);
    f.set("pdf", new Blob([ob.data], { type: "application/pdf" }), ob.name);
    return f;
  };
  for (const wait of [0, 2000, 5000, 12000]) {
    if (wait) await sleep(wait);
    onProgress?.({ phase: "upload", done: 0, total: size });
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 90_000); // the first request may wake the relay
    try {
      const res = await fetch(RELAY, { method: "POST", body: form(), signal: ctl.signal, cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (body.sent) return { sent: true, at: String(body.at || new Date().toISOString()), messageId: "", test: true };
      if (res.status === 429) return { sent: false, reason: "rate", message: "Too many sends in the last hour. Try again later." };
      if (res.status === 413) return { sent: false, reason: "too-large", message: "The report is over the preview size limit." };
      if (res.status >= 400 && res.status < 500) return { sent: false, reason: "failed", message: "The email service refused the report." };
    } catch { /* network drop: retry */ } finally { clearTimeout(t); }
  }
  return { sent: false, reason: navigator.onLine === false ? "offline" : "failed", message: "The report could not be sent. It will try again when the signal is back." };
}
