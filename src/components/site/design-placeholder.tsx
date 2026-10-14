import { PencilRuler } from "lucide-react";

export function DesignPlaceholder({ enriched, total }: { enriched: number; total: number }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="max-w-xl rounded-xl border border-border bg-panel p-6 shadow-card" data-testid="design-placeholder">
        <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <PencilRuler className="size-5" />
        </span>
        <h2 className="text-lg font-semibold">Design (not built yet)</h2>
        <p className="mt-2 text-sm text-muted">
          This is where design optioneering for uprates and plant modifications will go. The idea is to start from the enriched site
          model, propose alternative configurations, and compare them against the ratings, limits and procedures captured during
          enrichment.
        </p>
        <p className="mt-2 text-sm text-muted">
          Neither reference demo shows this tab, so nothing here is implemented. The enriched model it would build on is available today
          in the Overview, Enrich and Documentation tabs, and can be exported as JSON with full parameter provenance.
        </p>
        <p className="mt-4 text-xs text-muted">
          Current model: {enriched} of {total} assets enriched.
        </p>
      </div>
    </div>
  );
}
