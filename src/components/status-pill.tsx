import { cn } from "@/lib/utils";
import type { SiteStatus } from "@/lib/types";

export function StatusPill({ status, className }: { status: SiteStatus; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        status === "active" ? "bg-accent-soft text-accent" : "bg-amber-bg text-amber-fg",
        className,
      )}
      data-testid="site-status"
    >
      {status === "active" ? "active" : "In Planning"}
    </span>
  );
}
