import type { Condition, Details, InspectionType, Item, Report, Room, RoomKind } from "./types";

/* Room and item list: built from the BC RTB-27 Condition Inspection Report, the SingleKey
   Canada move-in/move-out report and the CMHC inspection guide (see SPEC.md). */

export const OFFICE_PHONE_DISPLAY = "905-763-0677";
export const OFFICE_PHONE_TEL = "+19057630677";
/* PREVIEW: reports go to the ITRS demo inbox only (fixed on the relay), never to aapm.ca. */
export const OFFICE_EMAIL = "the ITRS preview inbox";
export const COMPANY = "AA Property Management & Associates Inc.";
export const COMPANY_ADDRESS = "86 Audia Court, Concord, ON";
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || "";
export const MAIN_SITE = "https://aapm.ca";
export const PRIVACY_URL = "https://aapm.ca";

export const CONDITIONS: { value: Exclude<Condition, "">; label: string; short: string }[] = [
  { value: "good", label: "Good", short: "Good" },
  { value: "fair", label: "Fair", short: "Fair" },
  { value: "poor", label: "Poor", short: "Poor" },
  { value: "na", label: "N/A", short: "N/A" },
];
export const condLabel = (c: Condition) => CONDITIONS.find((x) => x.value === c)?.label ?? "Not marked";

export const ISSUES = ["Dirty", "Scratched", "Stained", "Damaged", "Broken", "Missing", "Not working"];

interface RoomDef { key: string; name: string; kind?: RoomKind; group?: string; items: string[]; optional?: boolean; }

export const ROOM_DEFS: RoomDef[] = [
  { key: "entry", name: "Entry and hall", items: ["Door, lock and hardware", "Walls and trim", "Ceiling", "Floor", "Closet", "Lighting", "Outlets and switches", "Intercom / doorbell"] },
  { key: "living", name: "Living room", items: ["Walls and trim", "Ceiling", "Floor / carpet", "Windows, screens and coverings", "Lighting / ceiling fan", "Outlets and switches", "Closet", "Heating / A/C unit", "Fireplace"] },
  { key: "dining", name: "Dining area", optional: true, items: ["Walls and trim", "Ceiling", "Floor", "Windows and coverings", "Lighting", "Outlets and switches"] },
  { key: "kitchen", name: "Kitchen", items: ["Walls and trim", "Ceiling", "Floor", "Countertop", "Cabinets and drawers", "Sink, taps and drain", "Stove / cooktop", "Oven", "Range hood and fan", "Fridge", "Freezer", "Dishwasher", "Microwave", "Windows and coverings", "Lighting", "Outlets and switches"] },
  { key: "bedroom", name: "Bedroom", group: "bedroom", items: ["Door and hardware", "Walls and trim", "Ceiling", "Floor / carpet", "Closet, doors and shelf", "Windows, screens and coverings", "Lighting", "Outlets and switches"] },
  { key: "bathroom", name: "Bathroom", group: "bathroom", items: ["Door and hardware", "Walls and trim", "Ceiling", "Floor", "Vanity, mirror and cabinet", "Sink, taps and drain", "Tub / shower and enclosure", "Toilet", "Exhaust fan", "Towel bars and accessories", "Lighting", "Outlets (GFCI)"] },
  { key: "stairs", name: "Stairs (townhouse / loft)", optional: true, items: ["Treads and landings", "Railings", "Walls", "Ceiling", "Lighting"] },
  { key: "laundry", name: "Laundry", items: ["Washer", "Dryer and vent", "Floor", "Walls", "Laundry sink / taps"] },
  { key: "storage", name: "Storage locker", optional: true, items: ["Locker door and lock", "Floor", "Walls / mesh", "Lighting", "Contents removed"] },
  { key: "systems", name: "Systems and safety", items: ["Smoke alarm(s) tested", "CO alarm(s) tested", "Thermostat", "Heating", "Air conditioning", "Water heater (rental tank)", "Electrical panel", "Sprinkler heads (not covered or painted)", "Fire extinguisher"] },
  { key: "exterior", name: "Balcony / terrace", items: ["Balcony / terrace door", "Balcony surface and drain", "Railing and glass panels", "Exterior glass", "Exterior lighting"] },
  { key: "parking", name: "Parking", items: ["Parking space (number on the report)", "Space surface / oil stains", "Lighting", "Items left in the space"] },
  { key: "keys", name: "Keys and remotes", kind: "keys", items: ["Unit door key", "Deadbolt key", "Building entry fob", "Amenity fob", "Mailbox key", "Parking remote / fob", "Locker key"] },
  { key: "meters", name: "Meter readings", kind: "meters", items: ["Electricity (suite meter)", "Water (suite meter)", "Gas"] },
];

export const OPTIONAL_ROOMS = ROOM_DEFS.filter((r) => r.optional);

let seq = 0;
export const uid = (p = "") => `${p}${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** Appliances many units do not have: they start as N/A so "All Good" never records one that is not there. */
const MAYBE_ABSENT = new Set(["Fireplace", "Dishwasher", "Microwave"]);
export function makeItem(label: string, custom = false): Item {
  return { id: uid("i"), label, cond: !custom && MAYBE_ABSENT.has(label) ? "na" : "", issues: [], comment: "", photoIds: [], custom };
}

export function makeRoom(key: string, n?: number): Room {
  const def = ROOM_DEFS.find((r) => r.key === key)!;
  return {
    id: uid("r"),
    name: def.group && n ? `${def.name} ${n}` : def.name,
    kind: def.kind ?? "std",
    group: def.group ?? key,
    items: def.items.map((l) => makeItem(l)),
    notes: "",
    photoIds: [],
  };
}

/** Default layout: every non-optional room, 1 bedroom, 1 bathroom. */
export function defaultRooms(): Room[] {
  return ROOM_DEFS.filter((d) => !d.optional).map((d) => makeRoom(d.key, d.group === "bedroom" || d.group === "bathroom" ? 1 : undefined));
}

/** Insert a room keeping the template order; renumbers bedrooms/bathrooms. */
export function insertRoom(rooms: Room[], key: string): Room[] {
  const order = ROOM_DEFS.map((d) => d.key);
  const r = makeRoom(key, 1);
  const idx = order.indexOf(key);
  let at = rooms.length;
  for (let i = 0; i < rooms.length; i++) {
    const g = order.indexOf(rooms[i].group ?? "");
    if (g > idx) { at = i; break; }
  }
  const next = [...rooms.slice(0, at), r, ...rooms.slice(at)];
  return renumber(next);
}

export function renumber(rooms: Room[]): Room[] {
  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  rooms.forEach((r) => { if (r.group === "bedroom" || r.group === "bathroom") totals[r.group] = (totals[r.group] ?? 0) + 1; });
  return rooms.map((r) => {
    if (r.group !== "bedroom" && r.group !== "bathroom") return r;
    counts[r.group] = (counts[r.group] ?? 0) + 1;
    const base = r.group === "bedroom" ? "Bedroom" : "Bathroom";
    const custom = r.name.replace(/^(Bedroom|Bathroom)\s*\d*/, "").trim(); // keep "(primary)" etc.
    return { ...r, name: `${base} ${counts[r.group]}${custom ? " " + custom : ""}` };
  });
}

export function todayISO(): string {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}-${g("month")}-${g("day")}`;
}

export function makeReportId(type: InspectionType): string {
  const d = todayISO().replace(/-/g, "").slice(2);
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const r = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => alphabet[b % alphabet.length]).join("");
  return `${type === "in" ? "MI" : "MO"}-${d}-${r}`;
}

export const emptyDetails = (): Details => ({ address: "", unit: "", city: "", tenants: "", inspector: "", date: todayISO(), tenantPresent: true, forwardingAddress: "" });

export function newReport(type: InspectionType): Report {
  return {
    v: 1, id: makeReportId(type), type, status: "draft", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), completedAt: "",
    details: emptyDetails(), rooms: defaultRooms(), moveOut: { comparison: "", damages: "", charges: "" },
    tenantSigs: [], landlordSig: null, screen: "details",
  };
}

export const typeLabel = (t: InspectionType) => (t === "in" ? "Move-in" : "Move-out");

export const fmtDate = (iso: string) => {
  if (!iso) return "";
  const d = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(iso + "T12:00:00") : new Date(iso);
  return d.toLocaleDateString("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "long", day: "numeric" });
};
export const fmtDateTime = (iso: string) => {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-CA", { timeZone: "America/Toronto", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
};

export const addressLine = (d: Details) => [d.unit && `Suite ${d.unit}`, d.address, d.city].filter((x) => x && x.trim()).join(", ");

/** Fingerprint of everything a signature vouches for (details, rooms, move-out notes). Not
   cryptographic: it only has to notice that the report changed after someone signed. */
export function contentHash(r: Report): string {
  const s = JSON.stringify([r.type, r.details, r.rooms, r.moveOut]);
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(16)}${(h2 >>> 0).toString(16)}:${s.length}`;
}

/** Items that still need a mark on a room screen. */
export function unmarked(room: Room): number {
  if (room.kind === "std") return room.items.filter((i) => !i.cond).length;
  return 0;
}
