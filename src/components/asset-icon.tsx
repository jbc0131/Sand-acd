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
  generator: "#d98a0b",
  transformer: "#d98a0b",
  breaker: "#d98a0b",
  bus: "#d98a0b",
  mcc: "#d98a0b",
  panel: "#d98a0b",
  other: "#6b7280",
};

export function AssetIcon({ type, className, size = "md" }: { type: AssetType; className?: string; size?: "sm" | "md" }) {
  const Icon = ICONS[type] ?? Box;
  const color = GROUP_COLOR[type] ?? GROUP_COLOR.other;
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-lg", size === "md" ? "size-9" : "size-6", className)}
      style={{ background: `${color}1f`, color }}
      aria-hidden
    >
      <Icon className={size === "md" ? "size-5" : "size-3.5"} />
    </span>
  );
}
