/* Client-side PDF of a completed inspection (jsPDF, loaded only when needed), built on the phone
   at the Send step and uploaded by src/lib/send.ts. Photos are embedded at 1200px / JPEG 0.6
   (a second, smaller pass is used if the file would be over the send cap).
   Letter portrait, white paper, AA colour logo, navy rules, text-first tables (conditions are
   written out, never colour-only), photo appendix with numbered captions, signatures, page footer. */
import { jsPDF } from "jspdf"; // static: this whole module is the lazy PDF chunk, warmed at app start
import type { Item, Report } from "./types";
import { BASE, COMPANY, COMPANY_ADDRESS, OFFICE_PHONE_DISPLAY, addressLine, condLabel, fmtDate, fmtDateTime, typeLabel } from "./template";
import { getPhoto, blobToDataUrl, photoBlob } from "./store";
import { shrinkForPdf } from "./photos";

export interface PdfOptions { edge: number; q: number }
export const PDF_PHOTO = { edge: 1200, q: 0.6 };

const NAVY: [number, number, number] = [0, 29, 51];
const INK: [number, number, number] = [11, 27, 43];
const MUTED: [number, number, number] = [86, 97, 108];
const RULE: [number, number, number] = [210, 214, 219];
const TINT: [number, number, number] = [241, 240, 236];
const ALERT: [number, number, number] = [176, 0, 10];

const W = 612, H = 792, M = 48, CW = W - M * 2, FOOT = 40;

/** jsPDF core fonts are WinAnsi: normalise typography and drop anything they can't draw. */
const t = (s: string | undefined | null) =>
  String(s ?? "")
    .replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, "-").replace(/\u2026/g, "...").replace(/\u00A0|\u202F/g, " ")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");

async function logoPng(): Promise<string | null> {
  try {
    const img = new Image();
    img.src = `${BASE}/brand/logo-pdf.png`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    const g = c.getContext("2d")!;
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 0, 0);
    return c.toDataURL("image/png");
  } catch { return null; }
}

interface PhotoRef { n: number; id: string; caption: string }

export async function buildPdf(r: Report, opt: PdfOptions = PDF_PHOTO): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "letter", compress: true });
  doc.setProperties({ title: `${typeLabel(r.type)} inspection report ${r.id}`, subject: addressLine(r.details), author: COMPANY, creator: "AA Property Management inspections (preview)" });
  let y = M;

  const font = (style: "normal" | "bold" | "italic" = "normal", size = 9.5, color = INK, family = "helvetica") => { doc.setFont(family, style); doc.setFontSize(size); doc.setTextColor(...color); };
  const ensure = (h: number) => { if (y + h > H - M - FOOT) { doc.addPage(); y = M; return true; } return false; };
  const rule = (yy: number, color = RULE, w = 0.6) => { doc.setDrawColor(...color); doc.setLineWidth(w); doc.line(M, yy, W - M, yy); };
  const lines = (s: string, width: number) => doc.splitTextToSize(t(s), width) as string[];
  const eyebrow = (s: string, x = M) => { font("bold", 7.5, MUTED); doc.setCharSpace(1.1); doc.text(s.toUpperCase(), x, y); doc.setCharSpace(0); };
  const sectionTitle = (s: string, keep = 60) => {
    ensure(keep + 30);
    y += 10;
    font("normal", 15, NAVY, "times"); doc.text(t(s), M, y);
    y += 7; rule(y, NAVY, 0.9); y += 15;
  };

  /* ---------- header ---------- */
  const logo = await logoPng();
  if (logo) doc.addImage(logo, "PNG", M, y - 10, 58, 57.6);
  font("normal", 8, MUTED);
  doc.text([t(COMPANY), t(COMPANY_ADDRESS), `${OFFICE_PHONE_DISPLAY}  |  aapm.ca`], W - M, y + 4, { align: "right" });
  y += 66;
  eyebrow(`${typeLabel(r.type)} inspection report`);
  y += 24;
  font("normal", 22, INK, "times");
  const title = addressLine(r.details) || "Condominium suite";
  const tl = lines(title, CW).slice(0, 2);
  doc.setFont("times", "normal"); doc.text(tl, M, y);
  y += tl.length * 24 - 6;
  rule(y + 6, INK, 0.9);
  y += 24;

  /* ---------- details ---------- */
  const det: [string, string][] = [
    ["Report ID", r.id],
    ["Inspection type", `${typeLabel(r.type)} condition inspection`],
    ["Suite / building", addressLine(r.details)],
    ["Resident(s)", r.details.tenants],
    ["Property manager", COMPANY],
    ["Inspected by", r.details.inspector],
    ["Inspection date", fmtDate(r.details.date)],
    ["Started", fmtDateTime(r.createdAt)],
    ["Completed", fmtDateTime(r.completedAt)],
    ["Resident present", r.details.tenantPresent ? "Yes" : "No, inspected without the resident present"],
  ];
  if (r.type === "out") {
    if (r.details.forwardingAddress.trim()) det.push(["Forwarding address", r.details.forwardingAddress]);
  }
  const colW = CW / 2 - 10;
  for (let i = 0; i < det.length; i += 2) {
    const pair = det.slice(i, i + 2);
    font("normal", 9.5, INK);
    const hts = pair.map(([, v]) => lines(v || "-", colW - 96).length);
    const h = Math.max(...hts) * 12 + 8;
    ensure(h);
    pair.forEach(([k, v], j) => {
      const x = M + j * (colW + 20);
      font("normal", 8.5, MUTED); doc.text(t(k), x, y);
      font("normal", 9.5, INK); doc.text(lines(v || "-", colW - 96), x + 96, y);
    });
    y += h;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(M, y - 8, W - M, y - 8);
  }

  /* ---------- summary ---------- */
  const std = r.rooms.filter((x) => x.kind === "std");
  const all = std.flatMap((x) => x.items);
  const count = (c: string) => all.filter((i) => i.cond === c).length;
  y += 8;
  sectionTitle("Summary");
  font("normal", 9.5, INK);
  const sumText = `${r.rooms.length} areas and ${all.length} items inspected. Good: ${count("good")}. Fair: ${count("fair")}. Poor: ${count("poor")}. Not applicable: ${count("na")}.`;
  doc.text(lines(sumText, CW), M, y); y += 14;
  const flagged = std.flatMap((room) => room.items.filter((i) => i.cond === "fair" || i.cond === "poor").map((i) => ({ room, i })));
  if (flagged.length) {
    y += 6; font("bold", 9.5, INK); doc.text(`Items noted as Fair or Poor (${flagged.length})`, M, y); y += 14;
    for (const { room, i } of flagged) {
      const s = `${room.name} - ${i.label}: ${condLabel(i.cond)}${i.issues.length ? ` (${i.issues.join(", ").toLowerCase()})` : ""}${i.comment ? `. ${i.comment}` : ""}`;
      const ls = lines(s, CW - 14); ensure(ls.length * 12);
      font("normal", 9.5, INK); doc.text("-", M, y); doc.text(ls, M + 12, y); y += ls.length * 12 + 2;
    }
  }

  /* ---------- photo numbering ---------- */
  const photos: PhotoRef[] = [];
  const refs = new Map<string, string>();
  const addRefs = (ids: string[], caption: string) => ids.map((id) => { const n = photos.length + 1; photos.push({ n, id, caption }); return `P${n}`; }).join(", ");
  for (const room of r.rooms) {
    if (room.photoIds.length) refs.set(room.id, addRefs(room.photoIds, `${room.name} - overview`));
    for (const it of room.items) {
      const parts: string[] = [];
      if (it.photoIds.length) parts.push(addRefs(it.photoIds, `${room.name} - ${it.label}${it.cond ? ` - ${condLabel(it.cond)}` : ""}${it.comment ? `: ${it.comment}` : ""}`));
      if (parts.length) refs.set(it.id, parts.join(", "));
    }
  }

  /* ---------- rooms ---------- */
  const out = r.type === "out";
  type Col = { h: string; w: number };
  const tableHead = (cols: Col[]) => {
    ensure(40);
    doc.setFillColor(...TINT); doc.rect(M, y - 10, CW, 16, "F");
    let x = M + 6;
    font("bold", 7.5, MUTED);
    cols.forEach((c) => { doc.text(c.h.toUpperCase(), x, y); x += c.w; });
    y += 14;
  };
  let roomName = "";
  const tableRow = (cols: Col[], cells: { s: string; color?: [number, number, number]; bold?: boolean }[], head: Col[]) => {
    font("normal", 9);
    const wrapped = cells.map((c, i) => lines(c.s || "-", cols[i].w - 10));
    const h = Math.max(...wrapped.map((w) => w.length)) * 11.5 + 7;
    if (ensure(h + 4)) {
      font("normal", 12.5, INK, "times"); doc.text(t(`${roomName} (continued)`), M, y); y += 14;
      tableHead(head);
    }
    let x = M + 6;
    wrapped.forEach((w, i) => { font(cells[i].bold ? "bold" : "normal", 9, cells[i].color ?? INK); doc.text(w, x, y); x += cols[i].w; });
    y += h - 4;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.4); doc.line(M, y - 6, W - M, y - 6);
    y += 4;
  };
  const condCell = (it: Item) => ({ s: condLabel(it.cond), bold: it.cond === "poor" || it.cond === "fair", color: it.cond === "poor" ? ALERT : INK });
  const noteOf = (it: Item) => [it.issues.join(", "), it.comment].filter(Boolean).join(". ");

  sectionTitle("Room by room", 120);
  for (const room of r.rooms) {
    ensure(70);
    roomName = room.name;
    font("normal", 12.5, INK, "times"); doc.text(t(room.name), M, y);
    y += 14;
    if (room.kind === "std") {
      const cols: Col[] = [{ h: "Item", w: 160 }, { h: "Condition", w: 70 }, { h: "Notes", w: CW - 160 - 70 - 60 }, { h: "Photos", w: 60 }];
      tableHead(cols);
      for (const it of room.items) {
        tableRow(cols, [{ s: it.label }, condCell(it), { s: [noteOf(it), out && it.cost ? `Est. cost $${it.cost}` : ""].filter(Boolean).join(". ") }, { s: refs.get(it.id) ?? "" }], cols);
      }
    } else if (room.kind === "keys") {
      const cols: Col[] = [{ h: "Key / remote", w: 220 }, { h: out ? "Number returned" : "Number issued", w: 100 }, { h: "Notes", w: CW - 320 }];
      tableHead(cols);
      for (const it of room.items) tableRow(cols, [{ s: it.label }, { s: it.count || "0" }, { s: it.comment }], cols);
    } else {
      const cols: Col[] = [{ h: "Meter", w: 120 }, { h: "Reading", w: 110 }, { h: "Notes", w: CW - 230 - 50 }, { h: "Photos", w: 50 }];
      tableHead(cols);
      for (const it of room.items) tableRow(cols, [{ s: it.label }, { s: it.reading || "-" }, { s: it.comment }, { s: refs.get(it.id) ?? "" }], cols);
    }
    if (room.notes.trim() || refs.get(room.id)) {
      const s = [room.notes.trim() && `Notes: ${room.notes.trim()}`, refs.get(room.id) && `Overview photos: ${refs.get(room.id)}`].filter(Boolean).join("   ");
      const ls = lines(s, CW); ensure(ls.length * 12 + 4);
      font("italic", 9, INK); doc.text(ls, M, y + 2); y += ls.length * 12 + 4;
    }
    y += 12;
  }

  /* ---------- move-out notes ---------- */
  if (r.type === "out") {
    sectionTitle("Move-out notes", 90);
    const total = r.rooms.flatMap((x) => x.items).reduce((s, i) => s + (parseFloat((i.cost || "").replace(/[^0-9.]/g, "")) || 0), 0);
    const blocks: [string, string][] = [
      ["Comparison with move-in", r.moveOut.comparison],
      ["Damage noted", r.moveOut.damages],
      ["Charges note", r.moveOut.charges + (total ? `${r.moveOut.charges ? "\n" : ""}Estimated cost of items listed: $${total.toFixed(2)}` : "")],
    ];
    for (const [k, v] of blocks) {
      const ls = lines(v.trim() || "None recorded.", CW);
      ensure(ls.length * 12 + 24);
      eyebrow(k); y += 13;
      font("normal", 9.5, INK); doc.text(ls, M, y); y += ls.length * 12 + 12;
    }
    font("italic", 8, MUTED);
    const nb = lines("Estimated costs are the inspector's notes for the office. They are not an invoice or a final determination.", CW);
    ensure(nb.length * 10); doc.text(nb, M, y); y += nb.length * 10 + 6;
  }

  /* ---------- signatures ---------- */
  sectionTitle("Signatures", 200);
  font("normal", 9.5, INK);
  const stmt = lines(`By signing, each person confirms they took part in this ${typeLabel(r.type).toLowerCase()} inspection of the condominium suite on the date shown. A resident (owner or tenant) may record that they do not agree with the report and give reasons.`, CW);
  doc.text(stmt, M, y); y += stmt.length * 12 + 10;
  const sigBlock = (role: string, name: string, dataUrl: string, at: string, extra?: string) => {
    const ex = extra ? lines(extra, CW - 220) : [];
    ensure(96 + ex.length * 12);
    eyebrow(role); y += 8;
    doc.setDrawColor(...RULE); doc.setLineWidth(0.6); doc.rect(M, y, 200, 64);
    if (dataUrl) { try { doc.addImage(dataUrl, "PNG", M + 4, y + 4, 192, 56); } catch { /* ignore */ } }
    font("normal", 10, INK); doc.text(t(name || "-"), M + 220, y + 16);
    font("normal", 8.5, MUTED); doc.text(at ? `Signed ${t(fmtDateTime(at))}` : "Not signed", M + 220, y + 30);
    if (ex.length) { font("normal", 9, INK); doc.text(ex, M + 220, y + 44); }
    y += Math.max(64, 44 + ex.length * 12) + 18;
  };
  if (!r.tenantSigs.length) {
    font("italic", 9.5, MUTED); doc.text(r.details.tenantPresent ? "No resident signature recorded." : "Resident not present at the inspection.", M, y); y += 18;
  }
  r.tenantSigs.forEach((s, i) => sigBlock(`Resident${r.tenantSigs.length > 1 ? ` ${i + 1}` : ""}`, s.name, s.dataUrl, s.at,
    s.agree === "agree" ? "Agrees that this report fairly represents the condition of the unit." : s.agree === "disagree" ? `Does not agree, for these reasons: ${s.reason || "(none given)"}` : s.agree === "declined" ? "Resident was present and declined to sign." : ""));
  if (r.landlordSig) sigBlock("Property manager", `${r.landlordSig.name}, for ${COMPANY}`, r.landlordSig.dataUrl, r.landlordSig.at);

  /* ---------- photo appendix ---------- */
  if (photos.length) {
    doc.addPage(); y = M;
    sectionTitle(`Photographs (${photos.length})`, 40);
    const gw = (CW - 18) / 2, gh = 168;
    let col = 0;
    for (const p of photos) {
      const rec = await getPhoto(p.id).catch(() => undefined);
      const cap = lines(`P${p.n}. ${p.caption}`, gw);
      const capH = Math.min(cap.length, 4) * 10.5;
      const stamp = rec?.takenAt ? `Taken ${t(fmtDateTime(rec.takenAt))}` : "";
      const cellH = gh + capH + (stamp ? 12 : 0) + 18;
      if (col === 0) ensure(cellH);
      const x = M + col * (gw + 18);
      doc.setFillColor(...TINT); doc.rect(x, y, gw, gh, "F");
      const blob = rec && photoBlob(rec);
      if (rec && blob) {
        const url = await blobToDataUrl(await shrinkForPdf(blob, opt.edge, opt.q).catch(() => blob));
        const ratio = rec.w / rec.h || 4 / 3;
        let w = gw, h = gw / ratio; if (h > gh) { h = gh; w = gh * ratio; }
        try { doc.addImage(url, "JPEG", x + (gw - w) / 2, y + (gh - h) / 2, w, h, undefined, "FAST"); } catch { /* skip */ }
      } else { font("italic", 8.5, MUTED); doc.text("Photo not available on this device", x + gw / 2, y + gh / 2, { align: "center" }); }
      font("normal", 8.5, INK); doc.text(cap.slice(0, 4), x, y + gh + 12);
      if (stamp) { font("normal", 7.5, MUTED); doc.text(stamp, x, y + gh + 12 + capH + 1); }
      if (col === 1) y += cellH;
      col = 1 - col;
      if (col === 0) continue;
    }
    if (col === 1) y += gh + 50;
  }

  /* ---------- footer on every page ---------- */
  const pages = doc.getNumberOfPages();
  const gen = `Generated ${t(fmtDateTime(new Date().toISOString()))}`;
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setDrawColor(...RULE); doc.setLineWidth(0.5); doc.line(M, H - M + 6, W - M, H - M + 6);
    font("normal", 7.5, MUTED);
    doc.text(t(`${COMPANY}  |  ${typeLabel(r.type)} inspection ${r.id}  |  ${gen}`), M, H - M + 20);
    doc.text(`Page ${i} of ${pages}`, W - M, H - M + 20, { align: "right" });
  }
  return doc.output("blob");
}

export const pdfFileName = (r: Report) => {
  const a = `${r.details.unit ? `Suite ${r.details.unit} ` : ""}${r.details.address}`.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ").slice(0, 60);
  return `${typeLabel(r.type)} inspection - ${a || "unit"} - ${r.details.date}.pdf`;
};

