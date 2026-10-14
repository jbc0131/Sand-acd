import { StatusDot } from "./asset-node";
import { STATUS_LABELS } from "@/lib/types";

const ORDER = ["pending", "enriching", "partial", "enriched"] as const;

export function StatusLegend() {
  return (
    <div
      className="pointer-events-none absolute top-3 right-3 z-10 rounded-xl bg-dark-surface/95 px-3 py-2.5 text-dark-surface-fg shadow-float"
      data-testid="status-legend"
    >
      <div className="mb-1.5 text-[11px] font-semibold tracking-wide uppercase opacity-80">Enrichment Status</div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-1">
        {ORDER.map((s) => (
          <li key={s} className="flex items-center gap-2">
            <StatusDot status={s} />
            {STATUS_LABELS[s]}
          </li>
        ))}
      </ul>
    </div>
  );
}
