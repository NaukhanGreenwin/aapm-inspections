export type InspectionType = "in" | "out";
export type Condition = "good" | "fair" | "poor" | "na" | "";
export type RoomKind = "std" | "keys" | "meters";

export interface Item {
  id: string;
  label: string;
  cond: Condition;
  issues: string[];
  comment: string;
  photoIds: string[];
  /** keys: number issued (move-in) or returned (move-out); meters: reading */
  count?: string;
  reading?: string;
  /** move-out only, optional estimate for the office */
  cost?: string;
  custom?: boolean;
}

export interface Room {
  id: string;
  name: string;
  kind: RoomKind;
  /** "bedroom" | "bathroom" etc. used for numbering and add/remove */
  group?: string;
  items: Item[];
  notes: string;
  photoIds: string[];
}

export interface Signature {
  name: string;
  dataUrl: string; // PNG
  at: string; // ISO
  /** contentHash() of the report when this person signed; a later change voids the signature */
  hash?: string;
}

export interface TenantSignature extends Signature {
  agree: "agree" | "disagree" | "declined" | "";
  reason: string;
}

export interface Details {
  address: string;
  unit: string;
  city: string;
  tenants: string;
  inspector: string;
  date: string; // yyyy-mm-dd
  tenantPresent: boolean;
  forwardingAddress: string; // move-out
}

export interface MoveOutNotes {
  comparison: string;
  damages: string;
  charges: string;
}

/** Send (preview: always the ITRS demo inbox, fixed on the relay). */
export interface SendState {
  /** first press of "Email report" (ISO): from then on the report is locked and queued */
  queuedAt?: string;
  /** last attempt (ISO) and its honest outcome, shown on the waiting banner */
  triedAt?: string;
  lastError?: string;
}

export interface Report {
  v: 1;
  id: string; // MI-261012-AB12 / MO-...
  type: InspectionType;
  /** draft = being filled in; queued = signed, locked, waiting until the email is confirmed sent */
  status: "draft" | "queued" | "complete";
  createdAt: string;
  /** last edit (ISO), drives the 12 h "resume or discard" and 24 h auto-clear of unsigned drafts */
  updatedAt?: string;
  completedAt: string;
  details: Details;
  rooms: Room[];
  moveOut: MoveOutNotes;
  tenantSigs: TenantSignature[];
  landlordSig: Signature | null;
  /** Send step: the only way a finished report leaves the app */
  send?: SendState;
  /** UI position so a refresh returns to the same screen */
  screen: string;
}

export interface PhotoRecord {
  id: string;
  reportId: string;
  /** JPEG bytes, max 1600px. ArrayBuffer, not Blob: Safari cannot store Blobs in IndexedDB in some modes. */
  data?: ArrayBuffer;
  thumbData?: ArrayBuffer; // 320px
  /** pre-v4 records stored Blobs; still read */
  blob?: Blob;
  thumb?: Blob;
  w: number;
  h: number;
  takenAt: string;
}
