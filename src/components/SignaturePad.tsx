"use client";

import { useEffect, useRef } from "react";

/** Finger/stylus signature. Stores a PNG data URL on every stroke end so a refresh keeps it. */
export default function SignaturePad({ value, onChange, label }: { value: string; onChange: (dataUrl: string) => void; label: string }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const latest = useRef(value);
  latest.current = value;

  // size the bitmap to the element and repaint the saved value; again on rotate/resize so strokes stay under the finger
  useEffect(() => {
    const c = canvas.current!;
    let w = 0, h = 0;
    const fit = () => {
      const value = latest.current;
      const r = c.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      const ctx = c.getContext("2d")!;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = 2.2; ctx.strokeStyle = "#14172e";
      w = r.width; h = r.height;
      if (value) { const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, r.width, r.height); img.src = value; }
    };
    fit();
    const refit = () => {
      if (drawing.current) return;
      const r = c.getBoundingClientRect();
      if (Math.round(r.width) !== Math.round(w) || Math.round(r.height) !== Math.round(h)) fit();
    };
    window.addEventListener("resize", refit);
    window.addEventListener("orientationchange", refit);
    return () => { window.removeEventListener("resize", refit); window.removeEventListener("orientationchange", refit); };
  }, []);

  const pos = (e: React.PointerEvent) => { const r = canvas.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    drawing.current = true; last.current = pos(e);
    const ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath(); ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2); ctx.fillStyle = "#14172e"; ctx.fill();
    dirty.current = true;
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const p = pos(e), ctx = canvas.current!.getContext("2d")!;
    ctx.beginPath(); ctx.moveTo(last.current!.x, last.current!.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    last.current = p;
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) onChange(canvas.current!.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvas.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    dirty.current = false; onChange("");
  };

  return (
    <div className="sig">
      <div className="sig-frame">
        <canvas ref={canvas} className="sig-canvas" aria-label={`${label} signature pad. Sign with your finger.`} role="img"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
        {!value && <span className="sig-hint" aria-hidden="true">Sign here</span>}
        <span className="sig-line" aria-hidden="true" />
      </div>
      <div className="sig-foot">
        <span>{value ? "Signed" : "Use a finger to sign"}</span>
        <button type="button" className="link link-edit" onClick={clear} disabled={!value}>Clear</button>
      </div>
    </div>
  );
}
