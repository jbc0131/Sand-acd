import type { DrawingStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

const STYLE: Record<DrawingStatus, string> = {
  queued: "bg-muted-bg text-muted",
  processing: "bg-chip-bg text-chip-fg",
  parsed: "bg-accent-soft text-accent",
  partial: "bg-amber-bg text-amber-fg",
  failed: "bg-danger-bg text-danger",
};

const LABEL: Record<DrawingStatus, string> = {
  queued: "Queued",
  processing: "Processing",
  parsed: "Parsed",
  partial: "Partial",
  failed: "Failed",
};

export function DrawingStatusPill({ status, className }: { status: DrawingStatus; className?: string }) {
  return (
    <span className={cn("inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium", STYLE[status], className)} data-status={status}>
      {LABEL[status]}
    </span>
  );
}
