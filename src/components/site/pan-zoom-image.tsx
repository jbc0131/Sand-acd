"use client";

import * as React from "react";
import { ImageOff, Maximize, Minus, Plus } from "lucide-react";
import type { BBox } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface Box {
  key: string;
  bbox: BBox;
  label?: string;
  active?: boolean;
}

interface View {
  s: number;
  x: number;
  y: number;
}

/**
 * A drawing page with zoom (wheel, buttons, pinch) and pan (drag). Boxes are drawn in normalized
 * page coordinates; `focus` zooms to and centers a box whenever `focusKey` changes.
 */
export function PanZoomImage({
  src,
  boxes = [],
  focus,
  focusKey,
  onBoxClick,
  className,
  alt,
}: {
  src: string | null;
  boxes?: Box[];
  focus?: BBox | null;
  focusKey?: string | number;
  onBoxClick?: (key: string) => void;
  className?: string;
  alt: string;
}) {
  const wrap = React.useRef<HTMLDivElement>(null);
  const [view, setView] = React.useState<View>({ s: 1, x: 0, y: 0 });
  const [aspect, setAspect] = React.useState<number | null>(null);
  const [failed, setFailed] = React.useState(false);
  const [cw, setCw] = React.useState(0);
  const pointers = React.useRef(new Map<number, { x: number; y: number }>());
  const pinch = React.useRef<{ dist: number; view: View; cx: number; cy: number } | null>(null);
  const drag = React.useRef<{ x: number; y: number; view: View } | null>(null);

  const size = () => {
    const el = wrap.current;
    return { w: el?.clientWidth ?? 1, h: el?.clientHeight ?? 1 };
  };

  // Fit the page inside the container.
  const fit = React.useCallback(() => {
    if (!aspect) return;
    const { w, h } = size();
    const s = Math.min(1, h / (w * aspect));
    setView({ s, x: (w - w * s) / 2, y: (h - w * aspect * s) / 2 });
  }, [aspect]);

  function zoomCenter(factor: number) {
    const { w, h } = size();
    zoomAt(factor, w / 2, h / 2);
  }

  const zoomAt = (factor: number, px: number, py: number) =>
    setView((v) => {
      const s = Math.min(8, Math.max(0.2, v.s * factor));
      const k = s / v.s;
      return { s, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });

  React.useEffect(() => {
    if (!aspect) return;
    if (focus) {
      const { w, h } = size();
      const pageH = w * aspect;
      const bw = Math.max(0.02, focus[2] - focus[0]);
      const bh = Math.max(0.02, focus[3] - focus[1]);
      const s = Math.min(2.5, Math.max(1, Math.min(0.35 / bw, (0.35 * h) / (bh * pageH))));
      const cx = ((focus[0] + focus[2]) / 2) * w * s;
      const cy = ((focus[1] + focus[3]) / 2) * pageH * s;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- view follows the focus prop
      setView({ s, x: w / 2 - cx, y: h / 2 - cy });
    } else fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refocus only when the focus target changes
  }, [aspect, focusKey]);

  // Track the container width; the page image is laid out at that width before scaling.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Non-passive wheel listener so the page doesn't scroll while zooming.
  React.useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const local = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-box]")) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), view, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      drag.current = null;
    } else drag.current = { ...local(e), view };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, local(e));
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const p = pinch.current;
      const s = Math.min(8, Math.max(0.2, p.view.s * (Math.hypot(a.x - b.x, a.y - b.y) / p.dist)));
      const k = s / p.view.s;
      setView({ s, x: p.cx - (p.cx - p.view.x) * k, y: p.cy - (p.cy - p.view.y) * k });
    } else if (drag.current) {
      const pt = local(e);
      const d = drag.current;
      setView({ ...d.view, x: d.view.x + pt.x - d.x, y: d.view.y + pt.y - d.y });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0) drag.current = null;
  };

  return (
    <div
      ref={wrap}
      className={cn("relative touch-none overflow-hidden rounded-lg border border-border bg-[#f8f8f6] select-none", className)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      data-testid="drawing-image"
    >
      {!src || failed ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted">
          <ImageOff className="size-6" />
          No page image for this drawing.
        </div>
      ) : (
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, width: cw || "100%" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- authenticated API image, sized by the pan/zoom transform */}
          <img
            src={src}
            alt={alt}
            draggable={false}
            className="block w-full"
            onLoad={(e) => setAspect(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
            onError={() => setFailed(true)}
          />
          {aspect &&
            boxes.map((b) => (
              <button
                key={b.key}
                type="button"
                data-box
                data-active={b.active ? "true" : undefined}
                title={b.label}
                onClick={() => onBoxClick?.(b.key)}
                className={cn(
                  "absolute rounded-sm border-2 transition-colors",
                  b.active ? "border-amber bg-amber/20 shadow-[0_0_0_3px_rgb(217_138_11/0.35)]" : "border-chip-fg/40 hover:border-chip-fg",
                  !onBoxClick && "pointer-events-none",
                )}
                style={{
                  left: `${b.bbox[0] * 100}%`,
                  top: `${b.bbox[1] * 100}%`,
                  width: `${(b.bbox[2] - b.bbox[0]) * 100}%`,
                  height: `${(b.bbox[3] - b.bbox[1]) * 100}%`,
                }}
              />
            ))}
        </div>
      )}
      <div className="absolute bottom-2 left-2 flex overflow-hidden rounded-lg border border-border bg-panel shadow-card">
        <button type="button" onClick={() => zoomCenter(1.3)} className="p-1.5 text-text hover:bg-muted-bg" aria-label="Zoom in" title="Zoom in">
          <Plus className="size-4" />
        </button>
        <button type="button" onClick={() => zoomCenter(1 / 1.3)} className="p-1.5 text-text hover:bg-muted-bg" aria-label="Zoom out" title="Zoom out">
          <Minus className="size-4" />
        </button>
        <button type="button" onClick={fit} className="p-1.5 text-text hover:bg-muted-bg" aria-label="Fit page" title="Fit page">
          <Maximize className="size-4" />
        </button>
      </div>
    </div>
  );
}
