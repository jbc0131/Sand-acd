import { PencilRuler } from "lucide-react";

export function DesignPlaceholder({ enriched, total }: { enriched: number; total: number }) {
  return (
    <div className="flex flex-1 items-center justify-center overflow-y-auto p-4">
      <div className="max-w-xl rounded-xl border border-border bg-panel p-6 shadow-card" data-testid="design-placeholder">
        <span className="mb-3 flex size-10 items-center justify-center rounded-lg bg-accent-soft text-accent">
          <PencilRuler className="size-5" />
        </span>
        <h2 className="text-lg font-semibold">Accelerating Capital Delivery</h2>
        <p className="mt-1 text-xs font-medium tracking-wide text-amber-fg uppercase">Later enabled use case · not built</p>
        <p className="mt-3 text-sm text-muted">
          This is a later enabled use case built on the site model. Once the drawing knowledge graph has been reviewed and its value
          baseline measured, the same model can support design optioneering for uprates and plant modifications: proposing alternative
          configurations and checking them against the ratings, limits, procedures and connections captured from the drawings.
        </p>
        <p className="mt-2 text-sm text-muted">
          Nothing on this tab is implemented. Phase 1 delivers the drawing register, SME review, the value baseline, document links and
          tracing that this would build on. The reviewed model can be exported as JSON with full parameter provenance from Documentation.
        </p>
        <p className="mt-4 text-xs text-muted">
          Current model: {enriched} of {total} assets enriched.
        </p>
      </div>
    </div>
  );
}
