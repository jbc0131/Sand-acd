"use client";

import { Download } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { Button } from "@/components/ui/button";
import { StatusDot } from "./asset-node";
import { STATUS_LABELS, typeLabel, type SiteModel } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Documentation({
  model,
  search,
  onSelect,
}: {
  model: SiteModel;
  search: string;
  onSelect: (id: number) => void;
}) {
  const tagOf = new Map(model.assets.map((a) => [a.id, a.tag || a.name]));
  const q = search.trim().toLowerCase();
  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="font-semibold">Asset Register</h2>
            <p className="text-sm text-muted">
              {model.assets.length} assets · {model.edges.length} connections · {model.sources.length} source files
            </p>
          </div>
          <Button variant="outline" asChild>
            <a href={`/api/sites/${model.site.id}/export?format=csv`} download data-testid="export-csv">
              <Download /> Export CSV
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href={`/api/sites/${model.site.id}/export?format=json`} download data-testid="export-json">
              <Download /> Export JSON
            </a>
          </Button>
        </div>
        {model.assets.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-panel p-10 text-center text-sm text-muted">
            No site model yet. Upload a process flow diagram or electrical one-line first.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-card">
            <table className="w-full min-w-[820px] text-sm" data-testid="asset-table">
              <thead className="border-b border-border bg-page text-left text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  <th className="px-3 py-2.5 font-semibold">Asset</th>
                  <th className="px-3 py-2.5 font-semibold">Tag</th>
                  <th className="px-3 py-2.5 font-semibold">Status</th>
                  <th className="px-3 py-2.5 font-semibold">Type</th>
                  <th className="px-3 py-2.5 font-semibold">Parameters</th>
                  <th className="px-3 py-2.5 font-semibold">Feeds</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {model.assets.map((a) => {
                  const params = Object.entries(a.params);
                  const dim = q && !`${a.name} ${a.tag} ${a.type} ${a.description}`.toLowerCase().includes(q);
                  return (
                    <tr
                      key={a.id}
                      onClick={() => onSelect(a.id)}
                      className={cn("cursor-pointer hover:bg-muted-bg", dim && "opacity-30")}
                      data-testid="asset-row"
                    >
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <AssetIcon type={a.type} size="sm" />
                          <span className="font-medium">{a.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{a.tag}</td>
                      <td className="px-3 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs" data-testid="row-status" data-status={a.enrichmentStatus}>
                          <StatusDot status={a.enrichmentStatus} /> {STATUS_LABELS[a.enrichmentStatus]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="rounded-full bg-amber-bg px-2 py-0.5 text-xs text-amber-fg">{typeLabel(a.type)}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-1">
                          {params.slice(0, 3).map(([k, v]) => (
                            <span key={k} className="max-w-[180px] truncate rounded bg-chip-bg px-1.5 py-0.5 font-mono text-[10.5px] text-chip-fg">
                              {k}: {v}
                            </span>
                          ))}
                          {params.length > 3 && <span className="text-xs text-muted">+{params.length - 3}</span>}
                          {params.length === 0 && <span className="text-xs text-muted">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-muted">
                        {model.edges
                          .filter((e) => e.from === a.id)
                          .map((e) => tagOf.get(e.to))
                          .join(", ") || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
