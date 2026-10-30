"use client";

import { useEffect, useRef, useState } from "react";
import { photoUrl } from "@/lib/store";
import { IconCamera, IconClose } from "./icons";

/** Thumbnail from IndexedDB by photo id. */
export function Thumb({ id, alt, onOpen }: { id: string; alt: string; onOpen?: (id: string) => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { let on = true; photoUrl(id).then((u) => on && setSrc(u)); return () => { on = false; }; }, [id]);
  const img = src
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={src} alt={alt} />
    : <span className="ph-missing" aria-label={alt} />;
  return onOpen ? <button type="button" className="ph-open" onClick={() => onOpen(id)} aria-label={`View ${alt}`}>{img}</button> : img;
}

interface Props {
  ids: string[];
  label: string;
  onAdd: (files: File[]) => Promise<void>;
  onRemove: (id: string) => void;
  onOpen: (id: string, remove?: () => void) => void;
  compact?: boolean;
  /** One row: small thumbs + a square camera button (room checklist rows). */
  inline?: boolean;
  buttonLabel?: string;
}

/** One button: the phone offers Take Photo / Photo Library itself. */
export default function PhotoStrip({ ids, label, onAdd, onRemove, onOpen, compact, inline, buttonLabel }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(0);
  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    if (!files.length) return;
    setBusy(files.length);
    try { await onAdd(files); } finally { setBusy(0); if (ref.current) ref.current.value = ""; }
  };
  const input = <input ref={ref} type="file" accept="image/*" multiple hidden onChange={(e) => void pick(e.target.files)} />;
  if (inline) {
    return (
      <div className="photos-inline">
        {ids.map((id, i) => (
          <span key={id} className="ph ph-xs">
            <Thumb id={id} alt={`${label}, photo ${i + 1}`} onOpen={(pid) => onOpen(pid, () => onRemove(pid))} />
          </span>
        ))}
        {busy > 0 && <span className="ph ph-xs ph-busy" aria-live="polite">…</span>}
        <button type="button" className={`cam-btn${buttonLabel ? " cam-btn-wide" : ""}`} onClick={() => ref.current?.click()} disabled={busy > 0} aria-label={buttonLabel ?? `Add a photo of ${label}`}>
          <IconCamera size={20} />{buttonLabel && <span>{buttonLabel}{ids.length ? ` (${ids.length})` : ""}</span>}
        </button>
        {input}
      </div>
    );
  }
  return (
    <div className={`photos${compact ? " photos-compact" : ""}`}>
      {(ids.length > 0 || busy > 0) && (
        <ul className="ph-list">
          {ids.map((id, i) => (
            <li key={id} className="ph">
              <Thumb id={id} alt={`${label}, photo ${i + 1}`} onOpen={onOpen} />
              <button type="button" className="ph-remove" onClick={() => onRemove(id)} aria-label={`Remove ${label} photo ${i + 1}`}><IconClose size={14} /></button>
            </li>
          ))}
          {Array.from({ length: busy }).map((_, i) => <li key={`b${i}`} className="ph ph-busy" aria-live="polite">Saving</li>)}
        </ul>
      )}
      <button type="button" className={`btn btn-quiet ${compact ? "btn-sm" : "btn-block"}`} onClick={() => ref.current?.click()} disabled={busy > 0}>
        <IconCamera size={20} /><span>{ids.length ? "Add another photo" : "Add photo"}</span>
      </button>
      {input}
    </div>
  );
}
