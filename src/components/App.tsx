"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Condition, InspectionType, Item, Report, Room, TenantSignature } from "@/lib/types";
import {
  BASE, CONDITIONS, COMPANY, ISSUES, MAIN_SITE, OFFICE_PHONE_DISPLAY, OFFICE_PHONE_TEL, PRIVACY_URL, ROOM_DEFS,
  addressLine, contentHash, fmtDate, fmtDateTime, insertRoom, makeItem, newReport, renumber, typeLabel, unmarked,
} from "@/lib/template";
import { deletePhoto, eraseInspection, loadDraft, photoUrl, prunePhotos, putPhoto, requestPersistence, saveDraft, storageWorks } from "@/lib/store";
import { PhotoError, processPhoto } from "@/lib/photos";
import { MAX_PDF, mb, preparePdf, sendReport, type Progress, type SendResult } from "@/lib/send";
import PhotoStrip from "./PhotoStrip";
import SignaturePad from "./SignaturePad";
import { IconArrowLeft, IconArrowRight, IconCamera, IconCheck, IconClose, IconList, IconNote, IconPhone, IconShield } from "./icons";

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */
interface Step { key: string; label: string }
const splitTenants = (s: string) => s.split(/\s*(?:,|&|\band\b|\n|;)\s*/i).map((x) => x.trim()).filter(Boolean).slice(0, 6);

function stepsFor(r: Report): Step[] {
  const names = splitTenants(r.details.tenants);
  return [
    { key: "details", label: "Inspection details" },
    { key: "layout", label: "Rooms in this suite" },
    ...r.rooms.map((x) => ({ key: `room:${x.id}`, label: x.name })),
    ...(r.type === "out" ? [{ key: "notes", label: "Move-out notes" }] : []),
    { key: "review", label: "Review" },
    ...(r.details.tenantPresent ? names.map((n, i) => ({ key: `sign:t${i}`, label: `Signature: ${n}` })) : []),
    { key: "sign:ll", label: "Signature: property manager" },
    { key: "email", label: "Email report" },
  ];
}
const CONTENT_STEP = /^(details|layout|room:|notes)/;
const hasSignature = (r: Report) => r.tenantSigs.some((s) => s.dataUrl) || !!r.landlordSig?.dataUrl;
/** A signature counts only if the report has not changed since that person signed. */
const sigValid = (s: { dataUrl: string; hash?: string }, hash: string) => !!s.dataUrl && s.hash === hash;
function clearSigs(r: Report, onlyStale = false): Report {
  const h = contentHash(r);
  const keep = (s: { dataUrl: string; hash?: string }) => onlyStale && (!s.dataUrl || s.hash === h);
  return {
    ...r,
    tenantSigs: r.tenantSigs.map((s) => (keep(s) ? s : { ...s, dataUrl: "", at: "", hash: "", agree: s.agree === "declined" ? s.agree : "" })),
    landlordSig: r.landlordSig && !keep(r.landlordSig) ? { ...r.landlordSig, dataUrl: "", at: "", hash: "" } : r.landlordSig,
  };
}
const HOUR = 3600_000;
const SENT_KEY = "aapm-sent";
const timeET = (iso: string) => new Date(iso).toLocaleTimeString("en-CA", { timeZone: "America/Toronto", hour: "numeric", minute: "2-digit" }).replace(/\./g, "").toUpperCase();

/** One inspection per phone at a time: a second tab of the app waits instead of overwriting the first. */
function acquireTabLock(): Promise<boolean> {
  const locks = typeof navigator !== "undefined" ? (navigator as Navigator & { locks?: LockManager }).locks : undefined;
  if (!locks?.request) return Promise.resolve(true);
  return new Promise((res) => {
    locks.request("aapm-inspection-tab", { ifAvailable: true }, (lock) => {
      if (!lock) { res(false); return; }
      res(true);
      return new Promise<void>(() => {}); // held until this tab closes
    }).catch(() => res(true));
  });
}
/** One signature block per resident name entered on the details screen, plus the property manager. */
function syncSigs(r: Report): Report {
  const names = splitTenants(r.details.tenants);
  if (r.tenantSigs.length === names.length && r.landlordSig) return r;
  return {
    ...r,
    tenantSigs: names.map((n, i) => r.tenantSigs[i] ?? { name: n, dataUrl: "", at: "", agree: "", reason: "" }),
    landlordSig: r.landlordSig ?? { name: r.details.inspector, dataUrl: "", at: "" },
  };
}

function validateDetails(r: Report): Record<string, string> {
  const d = r.details, e: Record<string, string> = {};
  if (!d.address.trim()) e.address = "Enter the building address.";
  if (!d.tenants.trim()) e.tenants = "Enter the resident name(s).";
  if (!d.inspector.trim()) e.inspector = "Enter who is inspecting.";
  if (!d.date) e.date = "Choose the date.";
  return e;
}
function validateSign(r: Report): Record<string, string> {
  const e: Record<string, string> = {};
  const h = contentHash(r);
  if (r.details.tenantPresent) {
    r.tenantSigs.forEach((s, i) => {
      if (!s.name.trim()) e[`tn${i}`] = "Enter the resident's name.";
      if (!s.agree) e[`ta${i}`] = "Choose one.";
      if (s.agree !== "declined" && !sigValid(s, h)) e[`ts${i}`] = "Signature needed, or choose Declined.";
    });
  }
  if (!r.landlordSig?.name.trim()) e.ln = "Enter the property manager's name.";
  if (!r.landlordSig || !sigValid(r.landlordSig, h)) e.ls = "Property manager signature needed.";
  return e;
}
/** Error keys that belong to one signature screen. */
const signKeyOf = (errKey: string) => (/^t[nas](\d+)$/.test(errKey) ? `sign:t${errKey.replace(/^t[nas]/, "")}` : "sign:ll");
/** Older drafts: v1 single "sign" screen, v2 move-out "baseline" step and finished reports, v3 email fields. */
function migrate(d: Report): Report {
  const { email: _old, ...rest } = d as Report & { email?: unknown };
  void _old; // v3 recipient fields: retired, the recipient is fixed on the relay
  let r: Report = { ...rest, updatedAt: d.updatedAt || d.createdAt };
  if (r.screen === "baseline") r = { ...r, screen: "details" };
  if (r.status === "complete" || r.screen === "done") r = { ...r, status: "draft", screen: "email" };
  if (r.screen === "sign") { r = syncSigs(r); r = { ...r, screen: stepsFor(r).find((s) => s.key.startsWith("sign:"))!.key }; }
  return r;
}
const errorsFor = (all: Record<string, string>, screen: string) => Object.fromEntries(Object.entries(all).filter(([k]) => signKeyOf(k) === screen));

type Dialog = { title: string; body: ReactNode; actions: { label: string; kind?: "primary" | "quiet" | "alert"; run: () => void }[] } | null;
type Opener = (id: string, remove?: () => void) => void;

/* ------------------------------------------------------------------ */
export default function App() {
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [home, setHome] = useState(true);
  const [sendUi, setSendUi] = useState<{ busy: boolean; text: string }>({ busy: false, text: "" });
  const [blocked, setBlocked] = useState(false); // the app is open in another tab of this phone
  const [noStorage, setNoStorage] = useState(false); // private browsing: photos cannot be kept
  const [stale, setStale] = useState(false); // unsigned draft idle 12-24 h: ask resume or discard
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [lightbox, setLightbox] = useState<{ id: string; remove?: () => void } | null>(null);
  const [sheet, setSheet] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<"saved" | "error" | "">("");
  const headingRef = useRef<HTMLHeadingElement>(null);

  /* ---------- autosave (every change, debounced) ---------- */
  const pending = useRef<Report | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const erased = useRef(false); // set once a sent report is being wiped: nothing may write it back
  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (pending.current && !erased.current) { setSaveState(saveDraft(pending.current) ? "saved" : "error"); }
    pending.current = null;
  }, []);
  const reportRef = useRef<Report | null>(null);
  reportRef.current = report;
  const swReg = useRef<ServiceWorkerRegistration | null>(null);

  /* ---------- send: queued report -> PDF -> preview relay -> wipe ---------- */
  const busy = useRef(false);
  const progressText = (p: Progress) => p.phase === "pdf" ? "Making the PDF…" : p.phase === "upload" ? `Sending… ${mb(p.done)} of ${mb(p.total)}` : "Handing it to the mailbox…";
  const finishSent = useCallback(async (r: Report, res: Extract<SendResult, { sent: true }>) => {
    erased.current = true;
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    await eraseInspection(r.id);
    sessionStorage.setItem(SENT_KEY, JSON.stringify({ id: r.id, at: res.at, test: res.test }));
    location.replace(`${BASE}/`); // fresh page: no in-memory or back-button copy of the inspection remains
  }, []);
  const processQueue = useCallback(async (r: Report | null) => {
    if (!r || r.status !== "queued" || busy.current || erased.current) return;
    busy.current = true;
    const fail = (msg: string) => setReport((cur) => (cur && cur.id === r.id ? { ...cur, send: { ...cur.send, triedAt: new Date().toISOString(), lastError: msg } } : cur));
    try {
      setSendUi({ busy: true, text: "Making the PDF…" });
      let ob;
      try { ob = await preparePdf(r, (p) => setSendUi({ busy: true, text: progressText(p) })); }
      catch (e) { console.error("aapm: PDF build failed", String(e).slice(0, 200)); fail("The PDF could not be made on this phone. Close other apps and try again."); return; }
      if (ob.data.byteLength > MAX_PDF) {
        setReport((cur) => (cur ? { ...cur, status: "draft", screen: "review", send: undefined } : cur));
        setHome(false);
        setDialog({ title: "The report is too big to email", body: <p>With all its photos the report is {mb(ob.data.byteLength)}; the preview limit is {mb(MAX_PDF)}. Remove some photos (tap a photo, then Remove), then sign again and send.</p>, actions: [{ label: "OK", kind: "primary", run: () => setDialog(null) }] });
        return;
      }
      const res = await sendReport(r, ob, (p) => setSendUi({ busy: true, text: progressText(p) }));
      if (res.sent) { await finishSent(r, res); return; }
      fail(res.message);
    } finally { busy.current = false; if (!erased.current) setSendUi({ busy: false, text: "" }); }
  }, [finishSent]);

  /* ---------- boot: tab lock, restore draft (age rules), service worker ---------- */
  useEffect(() => {
    void (async () => {
      if (!(await acquireTabLock())) { setBlocked(true); setReady(true); return; }
      const sent = sessionStorage.getItem(SENT_KEY);
      if (sent) {
        sessionStorage.removeItem(SENT_KEY);
        try {
          const x = JSON.parse(sent) as { id: string; at: string; test: boolean };
          setDialog({ title: "Report sent", body: <p>Report {x.id} was emailed as a PDF at {timeET(x.at)} ET. Preview: it went to the ITRS demo inbox only. Nothing of this inspection is left on this phone.</p>, actions: [{ label: "OK", kind: "primary", run: () => setDialog(null) }] });
        } catch { /* ignore */ }
      }
      const raw = loadDraft();
      let d = raw ? migrate(raw) : null;
      let ask = false;
      if (d && d.status === "draft" && !hasSignature(d)) {
        const idle = Date.now() - Date.parse(d.updatedAt || d.createdAt);
        if (idle > 24 * HOUR) {
          await eraseInspection(d.id);
          d = null;
          setNotice("An unfinished inspection over 24 hours old was cleared from this phone.");
        } else if (idle > 12 * HOUR) { ask = true; setStale(true); }
      }
      if (d) { setReport(d); setHome(d.status !== "draft" || ask); }
      setReady(true);
      void prunePhotos(d?.id ?? null).catch(() => {});
      void requestPersistence();
      void storageWorks().then((ok) => setNoStorage(!ok));
      if ("serviceWorker" in navigator && location.hostname !== "localhost") navigator.serviceWorker.register(`${BASE}/sw.js`, { scope: `${BASE}/` }).then((reg) => { swReg.current = reg; }).catch(() => {});
      // warm the PDF code while the signal is good, then keep every app file in the offline cache so a
      // reload in a dead zone, or a deploy in the middle of an inspection, can still build and send
      setTimeout(() => {
        void import("@/lib/pdf").then(() => caches.open("aapm-insp-v1")).then((c) => c.addAll([...new Set(performance.getEntriesByType("resource").map((e) => e.name).filter((u) => u.startsWith(`${location.origin}${BASE}/_next/static/`)))])).catch(() => {});
      }, 1500);
      if (d?.status === "queued") {
        void processQueue(d);
      }
    })();
  }, [processQueue]);

  // a queued report keeps trying: when the signal returns, when the app comes back, and every 2 minutes
  const queued = report?.status === "queued";
  useEffect(() => {
    if (!queued) return;
    const kick = () => { if (document.visibilityState === "visible") void processQueue(reportRef.current); };
    window.addEventListener("online", kick);
    document.addEventListener("visibilitychange", kick);
    const iv = setInterval(kick, 120_000);
    return () => { window.removeEventListener("online", kick); document.removeEventListener("visibilitychange", kick); clearInterval(iv); };
  }, [queued, processQueue]);

  // a new version of the app takes over only from the home screen, never in the middle of an inspection
  useEffect(() => {
    if (!home) return;
    const reg = swReg.current;
    const activate = () => reg?.waiting?.postMessage("activate");
    activate();
    reg?.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", activate));
  }, [home, ready]);
  useEffect(() => {
    if (!ready || !report) return;
    pending.current = report;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, 250);
  }, [report, ready, flush]);
  useEffect(() => {
    const h = () => flush();
    window.addEventListener("pagehide", h);
    document.addEventListener("visibilitychange", h);
    return () => { window.removeEventListener("pagehide", h); document.removeEventListener("visibilitychange", h); };
  }, [flush]);

  const update = useCallback((fn: (r: Report) => Report) => setReport((r) => {
    if (!r || r.status !== "draft") return r; // a queued (signed, sending) report is locked
    const n = fn(r);
    return n === r ? r : { ...n, updatedAt: new Date().toISOString() };
  }), []);
  const screen = report?.screen ?? "";

  // signature screens need one block per resident name (names can change on the details screen)
  useEffect(() => {
    if (report && report.status === "draft" && screen.startsWith("sign:") && syncSigs(report) !== report) update(syncSigs);
  }, [report, screen, update]);

  // once errors are on screen, re-check on every edit so fixed fields clear straight away
  useEffect(() => {
    if (!report || !Object.keys(errors).length) return;
    const e = report.screen === "details" ? validateDetails(report) : report.screen.startsWith("sign:") ? errorsFor(validateSign(report), report.screen) : null;
    if (e && JSON.stringify(e) !== JSON.stringify(errors)) setErrors(e);
  }, [report, errors]);

  const steps = useMemo(() => (report ? stepsFor(report) : []), [report]);
  const stepIdx = Math.max(0, steps.findIndex((s) => s.key === screen));

  // safety net: a signature given before the report changed no longer counts (H3)
  useEffect(() => {
    if (!report || report.status !== "draft" || !hasSignature(report)) return;
    const h = contentHash(report);
    if (report.tenantSigs.some((x) => x.dataUrl && x.hash !== h) || (report.landlordSig?.dataUrl && report.landlordSig.hash !== h)) {
      update((r) => clearSigs(r, true));
      setNotice("The report changed after it was signed, so those signatures were cleared. Ask them to sign again.");
    }
  }, [report, update]);

  const goNow = (key: string) => {
    setErrors({}); setSheet(false);
    update((r) => ({ ...(key.startsWith("sign:") ? syncSigs(r) : r), screen: key }));
    setTimeout(() => headingRef.current?.focus({ preventScroll: true }), 30);
  };
  /** Going back to change the report after someone signed clears the signatures (asked first). */
  const go = (key: string) => {
    if (report && CONTENT_STEP.test(key) && hasSignature(report)) {
      setSheet(false);
      setDialog({
        title: "Changing the report clears the signatures",
        body: <p>Everyone who signed agreed to the report as it is now. If you change it, they need to sign again.</p>,
        actions: [
          { label: "Keep the signatures", kind: "primary", run: () => setDialog(null) },
          { label: "Change it and clear signatures", kind: "alert", run: () => { setDialog(null); update((r) => clearSigs(r)); goNow(key); } },
        ],
      });
      return;
    }
    goNow(key);
  };

  /* ---------- start / resume / exit ---------- */
  const discard = async () => {
    if (!report) return;
    const id = report.id;
    pending.current = null; if (timer.current) clearTimeout(timer.current);
    setReport(null); setStale(false); setDialog(null);
    await eraseInspection(id);
  };
  const confirmDiscard = () => {
    if (!report) return;
    const unsent = report.status === "queued" || hasSignature(report);
    setDialog({
      title: unsent ? "Delete this signed report without sending it?" : "Discard this inspection?",
      body: <p>{unsent ? "It has NOT been sent. Its photos and signatures will be deleted from this phone and cannot be recovered." : "Its answers and photos will be deleted from this phone."}</p>,
      actions: [
        { label: "Keep it", kind: "primary", run: () => setDialog(null) },
        { label: unsent ? "Delete without sending" : "Discard it", kind: "alert", run: () => void discard() },
      ],
    });
  };
  const begin = (type: InspectionType) => {
    const start = async () => {
      if (report) await eraseInspection(report.id);
      const r = newReport(type);
      setReport(r); saveDraft(r); setHome(false); setDialog(null); setStale(false); setNotice("");
    };
    if (report && report.status === "queued") {
      setDialog({
        title: "A signed report is waiting to send",
        body: <p>Send report {report.id} first. A new inspection can start once it has gone.</p>,
        actions: [
          { label: "Send it now", kind: "primary", run: () => { setDialog(null); void processQueue(report); } },
          { label: "Not now", kind: "quiet", run: () => setDialog(null) },
        ],
      });
      return;
    }
    if (report && report.status === "draft") {
      setDialog({
        title: `You have an unfinished ${typeLabel(report.type).toLowerCase()} inspection`,
        body: <p>{addressLine(report.details) || "No address entered yet"}. Started {fmtDateTime(report.createdAt)}.</p>,
        actions: [
          { label: "Resume it", kind: "primary", run: () => { setDialog(null); setHome(false); } },
          { label: `Discard it and start a ${typeLabel(type).toLowerCase()}`, kind: "alert", run: () => void start() },
        ],
      });
    } else void start();
  };
  const exitToHome = () => { flush(); setHome(true); setSheet(false); };

  /* ---------- photo plumbing ---------- */
  const addPhotos = useCallback(async (files: File[], attach: (ids: string[]) => void) => {
    if (!report) return;
    const ids: string[] = [];
    const failed: { name: string; kind: PhotoError["kind"] }[] = [];
    for (const f of files) {
      let p;
      try { p = await processPhoto(f, report.id); }
      catch (e) { failed.push({ name: f.name, kind: e instanceof PhotoError ? e.kind : "decode" }); continue; }
      try { await putPhoto(p); ids.push(p.id); attach([p.id]); } // attach each one as it lands: a reload mid-batch keeps them
      catch { failed.push({ name: f.name, kind: "storage" }); }
    }
    if (failed.length) {
      const why = (k: PhotoError["kind"]) => failed.filter((x) => x.kind === k);
      const lines = [
        why("storage").length > 0 && "This browser could not save the photo. If this is a Private Browsing tab, open the site in a normal Safari or Chrome tab.",
        why("heic").length > 0 && `${why("heic").length} HEIC photo${why("heic").length > 1 ? "s" : ""} cannot be opened in this browser. Choose JPEG photos, or take the photo with the camera.`,
        why("decode").length > 0 && `${why("decode").map((x) => x.name).join(", ")} could not be opened. Take the photo again with the camera.`,
      ].filter(Boolean) as string[];
      setDialog({ title: `${failed.length} of ${files.length} photo${files.length > 1 ? "s" : ""} could not be added`, body: <>{lines.map((l) => <p key={l}>{l}</p>)}</>, actions: [{ label: "OK", kind: "primary", run: () => setDialog(null) }] });
    }
  }, [report]);
  const removePhoto = (id: string, detach: () => void) => { detach(); void deletePhoto(id); };
  const openPhoto: Opener = (id, remove) => setLightbox({ id, remove });

  /* ---------- room/item updates ---------- */
  const patchRoom = (roomId: string, fn: (room: Room) => Room) => update((r) => ({ ...r, rooms: r.rooms.map((x) => (x.id === roomId ? fn(x) : x)) }));
  const patchItem = (roomId: string, itemId: string, patch: Partial<Item>) =>
    patchRoom(roomId, (room) => ({ ...room, items: room.items.map((i) => (i.id === itemId ? { ...i, ...patch } : i)) }));
  const markAllGood = (roomId: string) => patchRoom(roomId, (room) => ({ ...room, items: room.items.map((i) => (i.cond ? i : { ...i, cond: "good" as Condition })) }));

  /* ---------- navigation with validation ---------- */
  const isLast = stepIdx === steps.length - 1;
  const next = () => {
    if (!report) return;
    const r = report;
    if (screen === "details") {
      const e = validateDetails(r);
      setErrors(e);
      if (Object.keys(e).length) { setTimeout(() => document.querySelector<HTMLElement>(".has-error input, .has-error textarea")?.focus(), 20); return; }
    }
    if (screen.startsWith("room:")) {
      const room = r.rooms.find((x) => `room:${x.id}` === screen);
      const n = room ? unmarked(room) : 0;
      if (room && n > 0) {
        setDialog({
          title: `${n} item${n > 1 ? "s" : ""} not marked`,
          body: <p>{room.items.filter((i) => !i.cond).map((i) => i.label).join(", ")}.</p>,
          actions: [
            { label: `Mark ${n > 1 ? "them" : "it"} Good and continue`, kind: "primary", run: () => { setDialog(null); markAllGood(room.id); go(steps[stepIdx + 1].key); } },
            { label: "Leave blank and continue", kind: "quiet", run: () => { setDialog(null); go(steps[stepIdx + 1].key); } },
            { label: "Stay on this room", kind: "quiet", run: () => setDialog(null) },
          ],
        });
        return;
      }
    }
    if (screen.startsWith("sign:")) {
      const e = errorsFor(validateSign(r), screen);
      if (Object.keys(e).length) { setErrors(e); return; }
      if (steps[stepIdx + 1]?.key === "email") return finishSigning();
    }
    if (screen === "email") return void submit();
    if (stepIdx < steps.length - 1) go(steps[stepIdx + 1].key);
  };
  const back = () => { if (stepIdx > 0) go(steps[stepIdx - 1].key); else exitToHome(); };

  /* ---------- signatures done -> Email report (the only way out) ---------- */
  const signErrorsFirst = (r: Report) => {
    const e = validateSign(r);
    if (!Object.keys(e).length) return false;
    const first = signKeyOf(Object.keys(e)[0]);
    go(first); setTimeout(() => setErrors(errorsFor(e, first)), 40);
    return true;
  };
  const finishSigning = () => {
    if (!report || signErrorsFirst(report)) return;
    update((r) => ({ ...r, completedAt: r.completedAt || new Date().toISOString() }));
    go("email");
  };
  /** Lock the signed report and send it. From here it can only be sent, or deleted on purpose. */
  const submit = () => {
    if (!report || sendUi.busy) return;
    if (signErrorsFirst(report)) return;
    setDialog({
      title: "Email the signed report?",
      body: <p>It is emailed as a PDF with its photos. After this it cannot be changed. Preview: it goes only to the ITRS demo inbox.</p>,
      actions: [
        { label: "Email report", kind: "primary", run: () => {
          setDialog(null);
          const now = new Date().toISOString();
          const q: Report = { ...report, status: "queued", completedAt: report.completedAt || now, send: { queuedAt: now } };
          setReport(q); saveDraft(q); setHome(true);
          void processQueue(q);
        } },
        { label: "Not yet", kind: "quiet", run: () => setDialog(null) },
      ],
    });
  };

  if (!ready) return <div className="page app"><Masthead onHome={() => {}} /></div>;
  if (blocked) return (
    <div className="page app"><Masthead onHome={() => {}} />
      <main id="main" className="main"><div className="screen landing step">
        <h1 className="mobile-title">Open in another tab</h1>
        <p className="lede-sm">The inspection app is already open in another tab or window on this phone. Close the other one so the two do not overwrite each other, then try again.</p>
        <button type="button" className="btn btn-primary" onClick={() => location.reload()}>Try again</button>
      </div></main>
    </div>
  );

  /* ---------- which view ---------- */
  const inFlow = !!report && !home && report.status === "draft";
  const curStep = steps[stepIdx];
  const curRoom = screen.startsWith("room:") ? report?.rooms.find((x) => `room:${x.id}` === screen) ?? null : null;
  const roomPos = curRoom && report ? report.rooms.indexOf(curRoom) + 1 : 0;
  const signSteps = steps.filter((s) => s.key.startsWith("sign:"));
  const signPos = signSteps.findIndex((s) => s.key === screen) + 1;
  const where = curRoom && report ? `Room ${roomPos} of ${report.rooms.length}` : signPos ? `Signature ${signPos} of ${signSteps.length}` : `Step ${stepIdx + 1} of ${steps.length}`;
  const nextLabel = isLast ? "Email report" : screen === "review" ? "Sign" : steps[stepIdx + 1]?.key === "review" ? "Review" : "Next";

  return (
    <div className={`page app${inFlow ? " in-flow" : ""}`}>
      <a className="skip" href="#main">Skip to the checklist</a>
      <Masthead onHome={exitToHome} onSteps={inFlow ? () => setSheet(true) : undefined} />
      {inFlow && <div className="progress-bar progress-top" aria-hidden="true"><span style={{ width: `${((stepIdx + 1) / steps.length) * 100}%` }} /></div>}

      <div className="layout">
        <aside className="rail" aria-label="Inspection outline">
          <div className="rail-inner">
            {inFlow && report ? (
              <>
                <p className="eyebrow">{typeLabel(report.type)} inspection</p>
                <h1 className="rail-title rail-title-sm">{addressLine(report.details) || "New inspection"}</h1>
                <ol className="rail-steps rail-steps-scroll">
                  {steps.map((s, i) => {
                    const room = s.key.startsWith("room:") ? report.rooms.find((x) => `room:${x.id}` === s.key) : null;
                    const state = i === stepIdx ? "current" : i < stepIdx ? "done" : "todo";
                    return (
                      <li key={s.key} className={`rail-step is-${state}`} aria-current={i === stepIdx ? "step" : undefined}>
                        <button type="button" className="rail-jump" onClick={() => go(s.key)}>
                          <span className="rail-num tnum">{state === "done" ? <IconCheck size={14} /> : String(i + 1).padStart(2, "0")}</span>
                          <span className="rail-label">{s.label}</span>
                          {room && room.kind === "std" && <span className="rail-meta tnum">{room.items.length - unmarked(room)}/{room.items.length}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </>
            ) : (
              <>
                <p className="eyebrow">Property management</p>
                <h1 className="rail-title">Suite condition inspection</h1>
                <p className="rail-lede">Walk the suite room by room, mark each item, add photos, and the resident and property manager sign on the phone. The finished report is emailed as a PDF.</p>
                <ol className="rail-steps">
                  {["Details and rooms", "Room-by-room checklist", "Review", "Signatures", "Email report"].map((s, i) => (
                    <li key={s} className="rail-step"><span className="rail-num tnum">{String(i + 1).padStart(2, "0")}</span><span className="rail-label">{s}</span></li>
                  ))}
                </ol>
              </>
            )}
            <div className="rail-foot"><TrustLine /></div>
          </div>
        </aside>

        <main id="main" className="main" tabIndex={-1}>
          {!inFlow || !report ? (
            <Landing draft={report && report.status === "draft" ? report : null} queued={report && report.status === "queued" ? report : null}
              stale={stale} notice={notice} noStorage={noStorage} sendUi={sendUi} onStart={begin}
              onResume={() => { setHome(false); setStale(false); setNotice(""); }} onDiscard={confirmDiscard} onSend={() => void processQueue(report)} />
          ) : (
            <form className="screen flow" noValidate onSubmit={(e) => { e.preventDefault(); next(); }}>
              <header className={`screen-head${curRoom ? " is-room" : ""}`}>
                <div className="screen-head-text">
                  <p className="screen-eyebrow tnum">{typeLabel(report.type)}{addressLine(report.details) ? ` · ${addressLine(report.details)}` : ""}</p>
                  <h2 id="step-title" ref={headingRef} tabIndex={-1} className="screen-title">{titleFor(report, curStep)}</h2>
                </div>
                {curRoom && curRoom.kind === "std" && <MarkAll room={curRoom} onMark={() => markAllGood(curRoom.id)} />}
              </header>

              <section key={screen} className={`screen-body step${curRoom ? " is-split" : ""}`} aria-labelledby="step-title">
                {screen === "details" && <DetailsStep r={report} update={update} errors={errors} />}
                {screen === "layout" && <LayoutStep r={report} update={update} setDialog={setDialog} />}
                {screen.startsWith("room:") && (curRoom
                  ? <RoomStep r={report} room={curRoom} patchRoom={patchRoom} patchItem={patchItem} addPhotos={addPhotos} removePhoto={removePhoto} onOpen={openPhoto} />
                  : <p className="lede-sm">This room was removed. <button type="button" className="link" onClick={() => go("layout")}>Back to rooms</button></p>)}
                {screen === "notes" && <NotesStep r={report} update={update} />}
                {screen === "review" && <ReviewStep r={report} go={go} />}
                {screen.startsWith("sign:") && <SignStep key={screen} r={report} screen={screen} update={update} errors={errors}
                  onNotPresent={() => { update((cur) => ({ ...cur, details: { ...cur.details, tenantPresent: false } })); go("sign:ll"); }} />}
                {screen === "email" && <SendStep r={report} />}
                {notice && <p className="note note-tight note-alert" role="status">{notice}</p>}
                {!steps.some((s) => s.key === screen) && <p className="lede-sm">This step is no longer in the report. <button type="button" className="link" onClick={() => go("review")}>Go to the review</button></p>}
              </section>

              <div className="bar">
                <div className="bar-inner">
                  <button type="button" className="btn btn-ghost bar-back" onClick={back}><IconArrowLeft size={20} /><span>Back</span></button>
                  <button type="button" className="bar-where" onClick={() => setSheet(true)} aria-label={`${where}. Show all steps`}>
                    <span className="bar-where-main tnum">{where}</span>
                    <span className={`bar-where-sub${saveState === "error" ? " is-alert" : ""}`} aria-live="polite">{saveState === "error" ? "Not saved: storage full" : "Progress saved"}</span>
                  </button>
                  <button type="submit" className="btn btn-primary bar-next" disabled={sendUi.busy}>
                    <span>{nextLabel}</span>{!isLast && <IconArrowRight size={20} />}
                  </button>
                </div>
              </div>
            </form>
          )}
        </main>
      </div>

      <footer className="footer">
        <div className="footer-inner">
          <p>{COMPANY}</p>
          <p><a href={PRIVACY_URL} target="_blank" rel="noopener">Privacy</a><span aria-hidden="true"> · </span><a href={MAIN_SITE}>aapm.ca</a><span aria-hidden="true"> · </span>Preview by IT Rapid Support</p>
        </div>
      </footer>

      {sheet && report && (
        <div className="sheet-wrap" role="dialog" aria-modal="true" aria-label="All steps" onClick={() => setSheet(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head"><h2>All steps</h2><button type="button" className="icon-btn" onClick={() => setSheet(false)} aria-label="Close"><IconClose size={20} /></button></div>
            <ol className="sheet-list">
              {steps.map((s, i) => {
                const room = s.key.startsWith("room:") ? report.rooms.find((x) => `room:${x.id}` === s.key) : null;
                const left = room ? unmarked(room) : 0;
                return (
                  <li key={s.key}>
                    <button type="button" className={`sheet-row${i === stepIdx ? " is-current" : ""}`} onClick={() => go(s.key)}>
                      <span className="rail-num tnum">{String(i + 1).padStart(2, "0")}</span>
                      <span className="sheet-label">{s.label}</span>
                      {room && room.kind === "std" && <span className={`sheet-meta tnum${left ? "" : " is-done"}`}>{left ? `${left} left` : <IconCheck size={16} />}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}

      {lightbox && <Lightbox id={lightbox.id} onClose={() => setLightbox(null)}
        onRemove={lightbox.remove ? () => { lightbox.remove!(); setLightbox(null); } : undefined} />}
      {dialog && (
        <div className="sheet-wrap is-center" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title">
          <div className="dialog">
            <h2 id="dlg-title" className="dialog-title">{dialog.title}</h2>
            <div className="dialog-body">{dialog.body}</div>
            <div className="dialog-actions">
              {dialog.actions.map((a) => <button key={a.label} type="button" className={`btn btn-block btn-${a.kind ?? "quiet"}`} onClick={a.run}>{a.label}</button>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function titleFor(r: Report, s: Step | undefined): string {
  if (!s) return "";
  if (s.key === "email") return "Email report";
  if (s.key === "details") return "Inspection details";
  if (s.key === "layout") return "Rooms in this suite";
  if (s.key === "notes") return "Move-out notes";
  if (s.key === "review") return "Review";
  if (s.key === "sign:ll") return "Property manager signs";
  if (s.key.startsWith("sign:t")) { const i = Number(s.key.slice(6)); return r.tenantSigs.length > 1 ? `Resident ${i + 1} signs` : "Resident signs"; }
  return s.label;
}

/* ------------------------------------------------------------------ */
/* shell pieces                                                        */
/* ------------------------------------------------------------------ */
function Masthead({ onHome, onSteps }: { onHome: () => void; onSteps?: () => void }) {
  return (
    <header className="masthead">
      <div className="masthead-inner">
        <button type="button" className="brand brand-btn" onClick={onHome} aria-label="AA Property Management inspections, home">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <span className="wordmark">
            <img src={`${BASE}/brand/mark.svg`} alt="" width={143} height={103} />
            <span className="wordmark-text"><span className="wordmark-name">AA Property Management</span><span className="wordmark-sub">&amp; Associates Inc.</span></span>
          </span>
        </button>
        <div className="masthead-tools">
          {onSteps && <button type="button" className="masthead-call masthead-steps" onClick={onSteps}><IconList size={18} /><span>Steps</span></button>}
          <a className="masthead-call" href={`tel:${OFFICE_PHONE_TEL}`} aria-label={`Call AA Property Management, ${OFFICE_PHONE_DISPLAY}`}>
            <IconPhone size={18} /><span className="masthead-call-text">{OFFICE_PHONE_DISPLAY}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
function TrustLine() {
  return (
    <div>
      <p className="trust-row"><IconShield size={18} /> Progress autosaves while you work</p>
      <p className="trust-note">Nothing is uploaded while you inspect. The signed report is emailed as a PDF, then it is deleted from this phone.</p>
    </div>
  );
}
function Lightbox({ id, onClose, onRemove }: { id: string; onClose: () => void; onRemove?: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { photoUrl(id, false).then(setSrc); }, [id]);
  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label="Photo" onClick={onClose}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {src && <img src={src} alt="Inspection photo, full size" />}
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close photo"><IconClose size={22} /></button>
      {onRemove && <button type="button" className="btn btn-quiet lightbox-remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>Remove this photo</button>}
    </div>
  );
}

function Field({ id, label, optional, error, className, children }: { id: string; label: string; optional?: boolean; error?: string; className?: string; children: ReactNode }) {
  return (
    <div className={`field field-c${error ? " has-error" : ""}${className ? ` ${className}` : ""}`}>
      <label className="field-label" htmlFor={id}>{label}{optional && <span className="field-optional"> (optional)</span>}</label>
      {children}
      {error && <p className="field-error" id={`${id}-error`}>{error}</p>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* landing                                                             */
/* ------------------------------------------------------------------ */
interface LandingProps {
  draft: Report | null; queued: Report | null; stale: boolean; notice: string; noStorage: boolean; sendUi: { busy: boolean; text: string };
  onStart: (t: InspectionType) => void; onResume: () => void; onDiscard: () => void; onSend: () => void;
}
function Landing({ draft, queued, stale, notice, noStorage, sendUi, onStart, onResume, onDiscard, onSend }: LandingProps) {
  const waitedDays = queued?.send?.queuedAt ? (Date.now() - Date.parse(queued.send.queuedAt)) / 86_400_000 : 0;
  const progress = draft ? (() => { const s = stepsFor(draft); const i = s.findIndex((x) => x.key === draft.screen); return `Step ${Math.max(1, i + 1)} of ${s.length}`; })() : "";
  return (
    <div className="screen landing step">
      <div className="landing-intro">
        <p className="eyebrow">Suite inspections · Preview</p>
        <h1 className="mobile-title">Condition inspection</h1>
      </div>

      {notice && <p className="note note-tight" role="status">{notice}</p>}
      {noStorage && <p className="note note-tight note-alert" role="alert">This browser cannot save photos (Private Browsing?). Open this page in a normal Safari or Chrome tab.</p>}

      {queued && (
        <section className="waiting" role="alert" aria-live="polite">
          <p className="eyebrow waiting-eyebrow">{sendUi.busy ? "Sending the report" : "1 report waiting to send"}</p>
          <p className="resume-title">{typeLabel(queued.type)} · {addressLine(queued.details) || queued.id}</p>
          <p className="resume-meta tnum">Report {queued.id} · signed {fmtDateTime(queued.send?.queuedAt || queued.completedAt)}</p>
          <p className="waiting-status" role="status">{sendUi.busy ? sendUi.text : queued.send?.lastError || "Not sent yet."}</p>
          {waitedDays >= 7 && !sendUi.busy && <p className="waiting-status">Still not sent after 7 days. Call AA Property Management at <a href={`tel:${OFFICE_PHONE_TEL}`}>{OFFICE_PHONE_DISPLAY}</a>.</p>}
          {!sendUi.busy && (
            <div className="waiting-actions">
              <button type="button" className="btn btn-primary" onClick={onSend}>Send now</button>
              <button type="button" className="link" onClick={onDiscard}>Delete without sending</button>
            </div>
          )}
        </section>
      )}

      {draft && (
        <div className={`resume-wrap${stale ? " is-stale" : ""}`}>
          {stale && <p className="note note-tight">This inspection has not been touched for over 12 hours. Resume it, or discard it?</p>}
          <button type="button" className="resume" onClick={onResume}>
            <span className="resume-text">
              <span className="eyebrow eyebrow-accent">Continue · {typeLabel(draft.type)}</span>
              <span className="resume-title">{addressLine(draft.details) || "No address yet"}</span>
              <span className="resume-meta tnum">{progress} · started {fmtDateTime(draft.createdAt)}</span>
            </span>
            <IconArrowRight size={22} />
          </button>
          <button type="button" className="link fine-link" onClick={onDiscard}>Discard this inspection</button>
        </div>
      )}

      <div className="big-choices">
        <button type="button" className="big-choice" onClick={() => onStart("in")}>
          <span className="big-kicker">Resident moving in</span>
          <span className="big-label">Move In</span>
          <span className="big-sub">Record every room of the suite before the owner or tenant moves in.</span>
          <span className="big-arrow" aria-hidden="true"><IconArrowRight size={26} /></span>
        </button>
        <button type="button" className="big-choice big-choice-alt" onClick={() => onStart("out")}>
          <span className="big-kicker">Resident moving out</span>
          <span className="big-label">Move Out</span>
          <span className="big-sub">Record every room of the suite when the owner or tenant moves out.</span>
          <span className="big-arrow" aria-hidden="true"><IconArrowRight size={26} /></span>
        </button>
      </div>

      <p className="mobile-trust trust-row"><IconShield size={18} /> Signed reports leave only by email, as a PDF with photos.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* steps                                                               */
/* ------------------------------------------------------------------ */
type Upd = (fn: (r: Report) => Report) => void;

function DetailsStep({ r, update, errors }: { r: Report; update: Upd; errors: Record<string, string> }) {
  const d = r.details;
  const set = (k: keyof Report["details"], v: string | boolean) => update((cur) => ({ ...cur, details: { ...cur.details, [k]: v } }));
  return (
    <div className="form-grid">
      <Field id="address" label="Building address" error={errors.address} className="span-2">
        <input id="address" type="text" autoComplete="street-address" placeholder="Street address" value={d.address} onChange={(e) => set("address", e.target.value)} aria-invalid={!!errors.address} />
      </Field>
      <Field id="unit" label="Suite / unit" optional>
        <input id="unit" type="text" value={d.unit} onChange={(e) => set("unit", e.target.value)} />
      </Field>
      <Field id="city" label="City" optional>
        <input id="city" type="text" autoComplete="address-level2" value={d.city} onChange={(e) => set("city", e.target.value)} />
      </Field>
      <Field id="tenants" label="Resident(s), owner or tenant" error={errors.tenants} className="span-2">
        <input id="tenants" type="text" autoComplete="off" placeholder="Names, separated by commas" value={d.tenants} onChange={(e) => set("tenants", e.target.value)} aria-invalid={!!errors.tenants} />
      </Field>
      <Field id="inspector" label="Inspector" error={errors.inspector}>
        <input id="inspector" type="text" autoComplete="name" value={d.inspector} onChange={(e) => set("inspector", e.target.value)} aria-invalid={!!errors.inspector} />
      </Field>
      <Field id="date" label="Date" error={errors.date}>
        <input id="date" type="date" value={d.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!errors.date} />
      </Field>
      {r.type === "out" && (
        <Field id="fwd" label="Resident forwarding address" optional className="span-2">
          <input id="fwd" type="text" value={d.forwardingAddress} onChange={(e) => set("forwardingAddress", e.target.value)} />
        </Field>
      )}
      <label className="check check-row span-2">
        <input type="checkbox" checked={d.tenantPresent} onChange={(e) => set("tenantPresent", e.target.checked)} />
        <span className="check-box" aria-hidden="true"><IconCheck size={14} /></span>
        <span className="check-text"><span className="check-label">Resident is here for the inspection</span></span>
      </label>
    </div>
  );
}

function Stepper({ value, min, max, onChange, label }: { value: number; min: number; max: number; onChange: (n: number) => void; label: string }) {
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" className="stepper-btn" onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Fewer ${label.toLowerCase()}`}>−</button>
      <span className="stepper-val tnum" aria-live="polite">{value}</span>
      <button type="button" className="stepper-btn" onClick={() => onChange(value + 1)} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>+</button>
    </div>
  );
}

function LayoutStep({ r, update, setDialog }: { r: Report; update: Upd; setDialog: (d: Dialog) => void }) {
  const count = (g: string) => r.rooms.filter((x) => x.group === g).length;
  const hasWork = (room: Room) => room.items.some((i) => i.cond || i.comment || i.photoIds.length || i.count) || !!room.notes || room.photoIds.length > 0;
  const confirmRemove = (room: Room, run: () => void) => {
    if (!hasWork(room)) return run();
    setDialog({ title: `Remove ${room.name}?`, body: <p>It already has marks or photos. They will be removed from this report.</p>,
      actions: [{ label: "Remove", kind: "alert", run: () => { run(); setDialog(null); } }, { label: "Keep it", kind: "quiet", run: () => setDialog(null) }] });
  };
  const setGroup = (g: string, n: number) => {
    const cur = r.rooms.filter((x) => x.group === g);
    if (n > cur.length) update((x) => ({ ...x, rooms: insertRoom(x.rooms, g) }));
    else { const last = cur[cur.length - 1]; confirmRemove(last, () => update((x) => ({ ...x, rooms: renumber(x.rooms.filter((y) => y.id !== last.id)) }))); }
  };
  const fixed = ["entry", "kitchen", "systems", "keys", "meters"];
  const toggles = ROOM_DEFS.filter((d) => !d.group?.match(/^(bedroom|bathroom)$/) && !fixed.includes(d.key));
  return (
    <div className="stack-sm">
      <div className="counts-grid">
        <div className="count-cell"><span className="count-label">Bedrooms</span><Stepper label="Bedrooms" value={count("bedroom")} min={0} max={8} onChange={(n) => setGroup("bedroom", n)} /></div>
        <div className="count-cell"><span className="count-label">Bathrooms</span><Stepper label="Bathrooms" value={count("bathroom")} min={0} max={6} onChange={(n) => setGroup("bathroom", n)} /></div>
      </div>
      <p className="group-label">Other areas</p>
      <div className="toggle-grid">
        {toggles.map((d) => {
          const room = r.rooms.find((x) => x.group === d.key);
          return (
            <label key={d.key} className="toggle">
              <input type="checkbox" checked={!!room} onChange={(e) => {
                if (e.target.checked) update((x) => ({ ...x, rooms: insertRoom(x.rooms, d.key) }));
                else if (room) confirmRemove(room, () => update((x) => ({ ...x, rooms: x.rooms.filter((y) => y.id !== room.id) })));
              }} />
              <span className="check-box" aria-hidden="true"><IconCheck size={14} /></span>
              <span className="toggle-label">{d.name.replace("Basement / storage / locker", "Storage / locker")}</span>
            </label>
          );
        })}
      </div>
      <p className="fine">Always included: entry, kitchen, systems and safety, keys, meters. {r.rooms.length} screens in total.</p>
    </div>
  );
}

function MarkAll({ room, onMark }: { room: Room; onMark: () => void }) {
  const left = unmarked(room);
  return (
    <div className="markall">
      <button type="button" className={`btn btn-sm ${left ? "btn-primary" : "btn-done"}`} onClick={onMark} disabled={!left}>
        <IconCheck size={18} /><span>{!left ? "All marked" : left === room.items.length ? "All Good" : `Rest Good (${left})`}</span>
      </button>
      <span className="markall-meta tnum">{room.items.length - left}/{room.items.length} marked</span>
    </div>
  );
}

interface RoomProps {
  r: Report; room: Room;
  patchRoom: (id: string, fn: (room: Room) => Room) => void;
  patchItem: (roomId: string, itemId: string, patch: Partial<Item>) => void;
  addPhotos: (files: File[], attach: (ids: string[]) => void) => Promise<void>;
  removePhoto: (id: string, detach: () => void) => void;
  onOpen: Opener;
}

function RoomStep({ r, room, patchRoom, patchItem, addPhotos, removePhoto, onOpen }: RoomProps) {
  const [newItem, setNewItem] = useState("");
  const [adding, setAdding] = useState(false);
  const [notesOpen, setNotesOpen] = useState(!!room.notes);
  const moveOut = r.type === "out";
  const addItem = () => { const l = newItem.trim(); if (!l) return; patchRoom(room.id, (x) => ({ ...x, items: [...x.items, makeItem(l, true)] })); setNewItem(""); setAdding(false); };
  const attachTo = (itemId: string) => (ids: string[]) => patchRoom(room.id, (x) => ({ ...x, items: x.items.map((i) => (i.id === itemId ? { ...i, photoIds: [...i.photoIds, ...ids] } : i)) }));

  return (
    <div className="room-scroll">
      {room.kind === "keys" && <p className="fine fine-top">{moveOut ? "How many of each the resident hands back." : "How many of each the resident receives."}</p>}
      {room.kind === "meters" && <p className="fine fine-top">Reading plus a photo of each meter. Not metered? Say so in a note.</p>}
      <ul className="rows">
        {room.items.map((it) => (
          <ItemRow key={it.id} it={it} room={room} moveOut={moveOut}
            onPatch={(p) => patchItem(room.id, it.id, p)}
            onRemove={it.custom ? () => patchRoom(room.id, (x) => ({ ...x, items: x.items.filter((i) => i.id !== it.id) })) : undefined}
            onAddPhotos={(files) => addPhotos(files, attachTo(it.id))}
            onRemovePhoto={(pid) => removePhoto(pid, () => patchRoom(room.id, (x) => ({ ...x, items: x.items.map((i) => (i.id === it.id ? { ...i, photoIds: i.photoIds.filter((p) => p !== pid) } : i)) })))}
            onOpen={onOpen} />
        ))}
      </ul>

      <div className="room-tools">
        {adding ? (
          <div className="add-item-row">
            <label className="sr-only" htmlFor={`add-${room.id}`}>New item</label>
            <input id={`add-${room.id}`} type="text" autoFocus value={newItem} placeholder={room.kind === "keys" ? "e.g. Garage key" : "e.g. Wine fridge"} onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addItem(); } }} />
            <button type="button" className="btn btn-quiet btn-sm" onClick={addItem} disabled={!newItem.trim()}>Add</button>
            <button type="button" className="icon-btn" onClick={() => { setAdding(false); setNewItem(""); }} aria-label="Cancel"><IconClose size={18} /></button>
          </div>
        ) : (
          <div className="tool-row">
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAdding(true)}>+ Item</button>
            {room.kind === "std" && <button type="button" className={`btn btn-quiet btn-sm${room.notes ? " has-value" : ""}`} onClick={() => setNotesOpen((o) => !o)}><IconNote size={18} /><span>Room note</span></button>}
            {room.kind === "std" && (
              <PhotoStrip inline ids={room.photoIds} label={`${room.name} overview`} buttonLabel="Room photo" onOpen={onOpen}
                onAdd={(files) => addPhotos(files, (ids) => patchRoom(room.id, (x) => ({ ...x, photoIds: [...x.photoIds, ...ids] })))}
                onRemove={(pid) => removePhoto(pid, () => patchRoom(room.id, (x) => ({ ...x, photoIds: x.photoIds.filter((p) => p !== pid) })))} />
            )}
          </div>
        )}
        {room.kind === "std" && notesOpen && (
          <div className="field">
            <label className="sr-only" htmlFor={`notes-${room.id}`}>Room notes</label>
            <textarea id={`notes-${room.id}`} className="ta-xs" placeholder="Notes for the whole room" value={room.notes} onChange={(e) => patchRoom(room.id, (x) => ({ ...x, notes: e.target.value }))} />
          </div>
        )}
      </div>
    </div>
  );
}

function ItemRow({ it, room, moveOut, onPatch, onRemove, onAddPhotos, onRemovePhoto, onOpen }: {
  it: Item; room: Room; moveOut: boolean; onPatch: (p: Partial<Item>) => void; onRemove?: () => void;
  onAddPhotos: (f: File[]) => Promise<void>; onRemovePhoto: (id: string) => void; onOpen: Opener;
}) {
  const flagged = it.cond === "fair" || it.cond === "poor";
  const [open, setOpen] = useState<boolean | null>(null);
  const show = open ?? flagged;
  const extras = it.photoIds.length + (it.comment ? 1 : 0);

  const label = (
    <button type="button" className="row-label" onClick={() => setOpen(!show)} aria-expanded={show} id={`l-${it.id}`}>
      <span className="row-name">{it.label}</span>
      {!show && extras > 0 && <span className="row-has" aria-label={`${extras} note or photo`}>{it.comment && <IconNote size={14} />}{it.photoIds.length > 0 && <IconCamera size={14} />}</span>}
    </button>
  );
  const note = (
    <>
      <label className="sr-only" htmlFor={`n-${it.id}`}>Note for {it.label}</label>
      <input id={`n-${it.id}`} className="row-note" type="text" enterKeyHint="done" placeholder={flagged ? "What and where" : "Note"} value={it.comment} onChange={(e) => onPatch({ comment: e.target.value })} />
    </>
  );
  const removeBtn = onRemove ? <button type="button" className="link row-remove" onClick={onRemove}>Remove item</button> : null;

  if (room.kind === "keys") {
    const n = parseInt(it.count || "0", 10) || 0;
    return (
      <li className="row">
        <div className="row-main">{label}<Stepper label={it.label} value={n} min={0} max={20} onChange={(v) => onPatch({ count: String(v) })} /></div>
        {show && <div className="row-extra"><div className="row-tools">{note}</div>{removeBtn}</div>}
      </li>
    );
  }
  if (room.kind === "meters") {
    return (
      <li className="row">
        <div className="row-main">
          {label}
          <label className="sr-only" htmlFor={`m-${it.id}`}>{it.label} reading</label>
          <input id={`m-${it.id}`} className="row-reading tnum" type="text" inputMode="decimal" placeholder="Reading" value={it.reading ?? ""} onChange={(e) => onPatch({ reading: e.target.value })} />
          <PhotoStrip inline ids={it.photoIds} label={it.label} onAdd={onAddPhotos} onRemove={onRemovePhoto} onOpen={onOpen} />
        </div>
        {show && <div className="row-extra"><div className="row-tools">{note}</div>{removeBtn}</div>}
      </li>
    );
  }

  return (
    <li className={`row${flagged ? " is-flagged" : ""}`}>
      <div className="row-main">
        {label}
        <div className="seg seg-inline" role="radiogroup" aria-labelledby={`l-${it.id}`}>
          {CONDITIONS.map((c) => (
            <label key={c.value} className={`seg-opt seg-${c.value}`}>
              <input type="radio" name={`c-${it.id}`} value={c.value} checked={it.cond === c.value}
                onChange={() => { onPatch({ cond: c.value, issues: c.value === "fair" || c.value === "poor" ? it.issues : [] }); if (c.value === "fair" || c.value === "poor") setOpen(null); }} />
              <span>{c.label}</span>
            </label>
          ))}
        </div>
      </div>
      {show && (
        <div className="row-extra">
          {flagged && (
            <div className="chips chips-row" role="group" aria-label={`What is wrong with ${it.label}`}>
              {ISSUES.map((s) => (
                <label key={s} className="chip">
                  <input type="checkbox" checked={it.issues.includes(s)} onChange={() => onPatch({ issues: it.issues.includes(s) ? it.issues.filter((x) => x !== s) : [...it.issues, s] })} />
                  <span className="chip-tick" aria-hidden="true"><IconCheck size={14} /></span>{s}
                </label>
              ))}
            </div>
          )}
          <div className="row-tools">
            {note}
            {moveOut && flagged && (
              <span className="row-cost"><span aria-hidden="true">$</span>
                <label className="sr-only" htmlFor={`cost-${it.id}`}>Estimated cost, optional, for the management office</label>
                <input id={`cost-${it.id}`} type="text" inputMode="decimal" placeholder="Est." value={it.cost ?? ""} onChange={(e) => onPatch({ cost: e.target.value.replace(/[^0-9.]/g, "") })} />
              </span>
            )}
            <PhotoStrip inline ids={it.photoIds} label={it.label} onAdd={onAddPhotos} onRemove={onRemovePhoto} onOpen={onOpen} />
          </div>
          {removeBtn}
        </div>
      )}
    </li>
  );
}

function NotesStep({ r, update }: { r: Report; update: Upd }) {
  const set = (k: keyof Report["moveOut"], v: string) => update((cur) => ({ ...cur, moveOut: { ...cur.moveOut, [k]: v } }));
  const flagged = r.rooms.flatMap((room) => room.items.filter((i) => i.cond === "fair" || i.cond === "poor").map((i) => `${room.name}: ${i.label}`));
  const total = r.rooms.flatMap((x) => x.items).reduce((s, i) => s + (parseFloat(i.cost || "") || 0), 0);
  return (
    <div className="stack-sm">
      <p className={`note note-tight${flagged.length ? " note-alert" : ""}`}>
        {flagged.length ? `${flagged.length} Fair or Poor: ${flagged.join("; ")}.` : "Nothing marked Fair or Poor."}{total ? ` Estimates: $${total.toFixed(2)}.` : ""}
      </p>
      <Field id="cmp" label="Notes compared with the move-in report (from the management office copy)" optional>
        <textarea id="cmp" className="ta-xs" placeholder="Overall differences" value={r.moveOut.comparison} onChange={(e) => set("comparison", e.target.value)} />
      </Field>
      <Field id="dmg" label="Damage noted" optional>
        <textarea id="dmg" className="ta-xs" placeholder="Beyond normal wear, in the inspector's view" value={r.moveOut.damages} onChange={(e) => set("damages", e.target.value)} />
      </Field>
      <Field id="chg" label="Charges note" optional>
        <textarea id="chg" className="ta-xs" placeholder="Repairs or cleaning to follow up" value={r.moveOut.charges} onChange={(e) => set("charges", e.target.value)} />
      </Field>
    </div>
  );
}

function ReviewStep({ r, go }: { r: Report; go: (k: string) => void }) {
  const std = r.rooms.filter((x) => x.kind === "std");
  const total = std.reduce((s, x) => s + x.items.length, 0);
  const marked = total - std.reduce((s, x) => s + unmarked(x), 0);
  const flagged = std.reduce((s, x) => s + x.items.filter((i) => i.cond === "fair" || i.cond === "poor").length, 0);
  const photos = r.rooms.reduce((s, x) => s + x.photoIds.length + x.items.reduce((a, i) => a + i.photoIds.length, 0), 0);
  const blanks = r.rooms.filter((x) => unmarked(x) > 0);
  return (
    <div className="stack-sm">
      <p className="review-line tnum"><strong>{marked}</strong> of {total} items marked · <strong>{flagged}</strong> Fair or Poor · <strong>{photos}</strong> photo{photos === 1 ? "" : "s"}</p>
      {blanks.length > 0 && <p className="note note-tight note-alert">{total - marked} not marked. Tap a red room to finish it, or leave them as “Not marked”.</p>}
      <section className="review-block">
        <div className="review-head"><h3>Details</h3><button type="button" className="link link-edit" onClick={() => go("details")}>Edit</button></div>
        <p className="review-details">{addressLine(r.details)}<br /><span>{r.details.tenants} · {fmtDate(r.details.date)} · by {r.details.inspector}{r.details.tenantPresent ? "" : " · resident not present"}</span></p>
      </section>
      <section className="review-block">
        <div className="review-head"><h3>Rooms ({r.rooms.length})</h3><button type="button" className="link link-edit" onClick={() => go("layout")}>Edit rooms</button></div>
        <ul className="room-grid">
          {r.rooms.map((room) => {
            const c = (k: string) => room.items.filter((i) => i.cond === k).length;
            const left = unmarked(room);
            const meta = room.kind === "keys" ? `${room.items.reduce((s, i) => s + (parseInt(i.count || "0", 10) || 0), 0)} keys/fobs`
              : room.kind === "meters" ? `${room.items.filter((i) => i.reading).length} of ${room.items.length} read`
              : left ? `${left} not marked` : c("fair") + c("poor") ? `${c("fair") + c("poor")} Fair/Poor` : "All Good";
            return (
              <li key={room.id}>
                <button type="button" className={`room-tile${left ? " is-alert" : c("fair") + c("poor") ? " is-flag" : ""}`} onClick={() => go(`room:${room.id}`)}>
                  <span className="room-tile-name">{room.name}</span>
                  <span className="room-tile-meta">{meta}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
      {r.type === "out" && (
        <section className="review-block">
          <div className="review-head"><h3>Move-out notes</h3><button type="button" className="link link-edit" onClick={() => go("notes")}>Edit</button></div>
          <p className="review-details"><span>{[r.moveOut.comparison, r.moveOut.damages, r.moveOut.charges].filter(Boolean).join(" · ") || "None"}</span></p>
        </section>
      )}
    </div>
  );
}

function SignStep({ r, screen, update, errors, onNotPresent }: { r: Report; screen: string; update: Upd; errors: Record<string, string>; onNotPresent: () => void }) {
  const kind = typeLabel(r.type).toLowerCase();
  if (screen === "sign:ll") {
    const s = r.landlordSig;
    if (!s) return null;
    return (
      <div className="sign-screen">
        <Field id="ln" label={`Name, for ${COMPANY.replace(" Inc.", "")}`} error={errors.ln}>
          <input id="ln" type="text" value={s.name} onChange={(e) => update((cur) => ({ ...cur, landlordSig: { ...cur.landlordSig!, name: e.target.value } }))} />
        </Field>
        {!r.details.tenantPresent && <p className="fine">Resident not present: the report records that. <button type="button" className="link" onClick={() => update((cur) => ({ ...cur, details: { ...cur.details, tenantPresent: true } }))}>Resident is here</button></p>}
        <div className={`sig-wrap${errors.ls ? " has-error" : ""}`}>
          <SignaturePad label="Property manager" value={s.dataUrl} onChange={(d) => update((cur) => ({ ...cur, landlordSig: { ...cur.landlordSig!, dataUrl: d, at: d ? new Date().toISOString() : "", hash: d ? contentHash(cur) : "" } }))} />
          {errors.ls && <p className="field-error">{errors.ls}</p>}
        </div>
      </div>
    );
  }
  const i = Number(screen.slice(6));
  const s = r.tenantSigs[i];
  if (!s) return null;
  const setT = (p: Partial<TenantSignature>) => update((cur) => ({ ...cur, tenantSigs: cur.tenantSigs.map((x, j) => (j === i ? { ...x, ...p, ...("dataUrl" in p ? { hash: p.dataUrl ? contentHash(cur) : "" } : {}) } : x)) }));
  return (
    <div className="sign-screen">
      <Field id={`tn${i}`} label="Resident name" error={errors[`tn${i}`]}>
        <input id={`tn${i}`} type="text" value={s.name} onChange={(e) => setT({ name: e.target.value })} />
      </Field>
      <div className={`group${errors[`ta${i}`] ? " has-error" : ""}`}>
        <p className="sign-q" id={`q${i}`}>Does this {kind} report ({fmtDate(r.details.date)}) fairly show the suite&apos;s condition?</p>
        <div className="seg seg-3" role="radiogroup" aria-labelledby={`q${i}`}>
          {([["agree", "I agree"], ["disagree", "I disagree"], ["declined", "Won't sign"]] as const).map(([v, l]) => (
            <label key={v} className={`seg-opt seg-${v}`}>
              <input type="radio" name={`agree${i}`} checked={s.agree === v} onChange={() => setT({ agree: v, ...(v === "declined" ? { dataUrl: "", at: "" } : {}) })} />
              <span>{l}</span>
            </label>
          ))}
        </div>
        {errors[`ta${i}`] && <p className="field-error">{errors[`ta${i}`]}</p>}
      </div>
      {s.agree === "disagree" && (
        <div className="field">
          <label className="sr-only" htmlFor={`tr${i}`}>Reasons</label>
          <textarea id={`tr${i}`} className="ta-xs" placeholder="Why the resident disagrees" value={s.reason} onChange={(e) => setT({ reason: e.target.value })} />
        </div>
      )}
      {s.agree === "declined" ? (
        <p className="note note-tight">Recorded as declined to sign. No signature needed.</p>
      ) : (
        <div className={`sig-wrap${errors[`ts${i}`] ? " has-error" : ""}`}>
          <SignaturePad label={`Resident ${s.name}`} value={s.dataUrl} onChange={(d) => setT({ dataUrl: d, at: d ? new Date().toISOString() : "" })} />
          {errors[`ts${i}`] && <p className="field-error">{errors[`ts${i}`]}</p>}
        </div>
      )}
      {i === 0 && <button type="button" className="link fine-link" onClick={onNotPresent}>Resident not here? Skip resident signatures</button>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* email report: the only way a finished report leaves the app        */
/* ------------------------------------------------------------------ */
function SendStep({ r }: { r: Report }) {
  const std = r.rooms.filter((x) => x.kind === "std");
  const flagged = std.reduce((s, x) => s + x.items.filter((i) => i.cond === "fair" || i.cond === "poor").length, 0);
  const signed = r.tenantSigs.filter((s) => s.dataUrl).length + (r.landlordSig?.dataUrl ? 1 : 0);
  return (
    <div className="stack-sm">
      <p className="review-line tnum"><strong>{r.id}</strong> · {flagged} Fair or Poor · {signed} signature{signed === 1 ? "" : "s"}</p>
      <p className="note note-tight">The signed report is emailed as a PDF with its photos. Preview build: it goes only to the ITRS demo inbox, never to AA staff, owners or tenants.</p>
      <p className="fine">If the signal is weak it keeps trying, and the report stays on this phone until the email has gone. Once it is sent, nothing of this inspection is left on this phone.</p>
    </div>
  );
}
