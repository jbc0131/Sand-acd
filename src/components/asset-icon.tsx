import * as React from "react";
import {
  Box,
  Cable,
  CircleSlash2,
  Cog,
  Cylinder,
  Droplets,
  FlaskConical,
  Gauge,
  Network,
  PanelsTopLeft,
  Server,
  TestTubeDiagonal,
  ToggleRight,
  UtilityPole,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AssetType } from "@/lib/types";
import { cn } from "@/lib/utils";

// Lucide icons: the fallback when a type has no electrical symbol (and for process equipment).
const ICONS: Record<AssetType, LucideIcon> = {
  source: UtilityPole,
  treatment: FlaskConical,
  chemical: TestTubeDiagonal,
  storage: Cylinder,
  pump: Droplets,
  motor: Cog,
  valve: CircleSlash2,
  instrument: Gauge,
  generator: Zap,
  transformer: Cable,
  breaker: ToggleRight,
  bus: Network,
  mcc: Server,
  panel: PanelsTopLeft,
  relay: ToggleRight,
  ct: Gauge,
  pt: Cable,
  fuse: Box,
  disconnect: ToggleRight,
  other: Box,
};

// Icons are colored by group: process, rotating, control, electrical.
const GROUP_COLOR: Record<AssetType, string> = {
  source: "#2a7bd1",
  treatment: "#2a7bd1",
  chemical: "#2a7bd1",
  storage: "#2a7bd1",
  pump: "#0f9d8a",
  motor: "#0f9d8a",
  valve: "#7c5cd6",
  instrument: "#7c5cd6",
  relay: "#7c5cd6",
  generator: "#d98a0b",
  transformer: "#d98a0b",
  breaker: "#d98a0b",
  bus: "#d98a0b",
  mcc: "#d98a0b",
  panel: "#d98a0b",
  ct: "#d98a0b",
  pt: "#d98a0b",
  fuse: "#d98a0b",
  disconnect: "#d98a0b",
  other: "#6b7280",
};

/**
 * Simplified ANSI/IEEE 315 style symbols, drawn on a 24x24 grid with currentColor.
 * They are recognisable stand-ins for node icons, not a drafting-standard symbol library.
 */
const SYMBOLS: Partial<Record<AssetType, React.ReactNode>> = {
  // Circuit breaker: square in the line.
  breaker: (
    <>
      <path d="M12 2v5M12 17v5" />
      <rect x="7" y="7" width="10" height="10" />
    </>
  ),
  // Two-winding transformer: two overlapping circles.
  transformer: (
    <>
      <path d="M12 1v3M12 20v3" />
      <circle cx="12" cy="9" r="5" />
      <circle cx="12" cy="15" r="5" />
    </>
  ),
  // Motor: circle with M.
  motor: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 15.5v-7l3.5 4.5 3.5-4.5v7" />
    </>
  ),
  // Generator: circle with G.
  generator: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M15 9.2a3.6 3.6 0 1 0 .6 4.3H12.5" />
    </>
  ),
  // Bus: heavy horizontal bar with taps.
  bus: (
    <>
      <path d="M3 11h18v2H3z" fill="currentColor" />
      <path d="M7 13v6M12 13v6M17 13v6M12 5v6" />
    </>
  ),
  // Relay: coil (circle) with designation tick.
  relay: (
    <>
      <path d="M12 2v5M12 17v5" />
      <circle cx="12" cy="12" r="5" />
      <path d="M10 12h4" />
    </>
  ),
  // Current transformer: circle around the conductor.
  ct: (
    <>
      <path d="M12 2v20" />
      <circle cx="12" cy="12" r="5" />
    </>
  ),
  // Potential transformer: two small circles to ground.
  pt: (
    <>
      <path d="M12 2v4" />
      <circle cx="12" cy="9.5" r="3.5" />
      <circle cx="12" cy="14.5" r="3.5" />
      <path d="M12 18v2M9 20h6M10.5 22h3" />
    </>
  ),
  // Fuse: rectangle with conductor through it.
  fuse: (
    <>
      <path d="M12 2v20" />
      <rect x="9" y="7" width="6" height="10" />
    </>
  ),
  // Disconnect switch: open blade.
  disconnect: (
    <>
      <path d="M12 2v6M12 18v4" />
      <circle cx="12" cy="18" r="1.3" fill="currentColor" />
      <path d="M12 18L6 9" />
    </>
  ),
  // Valve: bowtie.
  valve: (
    <>
      <path d="M2 12h3M19 12h3" />
      <path d="M5 7v10l7-5zM19 7v10l-7-5z" />
    </>
  ),
};

export function hasSymbol(type: AssetType): boolean {
  return type in SYMBOLS;
}

export function AssetIcon({ type, className, size = "md" }: { type: AssetType; className?: string; size?: "sm" | "md" }) {
  const color = GROUP_COLOR[type] ?? GROUP_COLOR.other;
  const symbol = SYMBOLS[type];
  const Icon = ICONS[type] ?? Box;
  const px = size === "md" ? "size-5" : "size-3.5";
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", size === "md" ? "size-9" : "size-6", className)}
      style={{ background: `${color}1f`, color }}
      aria-hidden
      data-symbol={symbol ? type : undefined}
    >
      {symbol ? (
        <svg viewBox="0 0 24 24" className={px} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
          {symbol}
        </svg>
      ) : (
        <Icon className={px} />
      )}
    </span>
  );
}
