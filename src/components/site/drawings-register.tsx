"use client";

import * as React from "react";
import { FileStack, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DRAWING_TYPE_LABELS, type DrawingDTO, type DrawingStatus, type DrawingType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { DrawingStatusPill } from "./drawing-status";

function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-lg border border-border bg-panel px-2 text-sm text-text"
        aria-label={`Filter by ${label.toLowerCase()}`}
      >
        <option value="">All</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

/** Drawing register: every ingested drawing, including partial and failed reads. */
export function DrawingsRegister({
  drawings,
  search,
  onOpen,
  onUpload,
}: {
  drawings: DrawingDTO[];
  search: string;
  onOpen: (d: DrawingDTO) => void;
  onUpload: () => void;
}) {
  const [type, setType] = React.useState("");
  const [status, setStatus] = React.useState("");
  const [system, setSystem] = React.useState("");
  const q = search.trim().toLowerCase();
  const types = [...new Set(drawings.map((d) => d.drawingType))].sort() as DrawingType[];
  const statuses = [...new Set(drawings.map((d) => d.status))].sort() as DrawingStatus[];
  const systems = [...new Set(drawings.map((d) => d.system).filter((s): s is string => Boolean(s)))].sort();
  const rows = drawings.filter(
    (d) =>
      (!type || d.drawingType === type) &&
      (!status || d.status === status) &&
      (!system || d.system === system) &&
      (!q || `${d.drawingNumber} ${d.title} ${d.system} ${d.fileName}`.toLowerCase().includes(q)),
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="mr-auto">
            <h2 className="font-semibold">Drawing Register</h2>
            <p className="text-sm text-muted">
              {drawings.length} drawing{drawings.length === 1 ? "" : "s"} ·{" "}
              {drawings.reduce((n, d) => n + d.componentCount, 0)} component reads ·{" "}
              {drawings.filter((d) => d.status === "partial").length} partial · {drawings.filter((d) => d.status === "failed").length} failed
            </p>
          </div>
          <Button variant="outline" onClick={onUpload}>
            <Upload /> Upload drawings
          </Button>
        </div>
        <div className="mb-3 flex flex-wrap gap-3">
          <Select label="Type" value={type} onChange={setType} options={types.map((t) => ({ value: t, label: DRAWING_TYPE_LABELS[t] }))} />
          <Select label="Status" value={status} onChange={setStatus} options={statuses.map((s) => ({ value: s, label: s }))} />
          <Select label="System" value={system} onChange={setSystem} options={systems.map((s) => ({ value: s, label: s }))} />
        </div>
        {drawings.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-panel p-10 text-center text-sm text-muted">
            <FileStack className="size-8" />
            No drawings yet. Upload process flow diagrams, P&IDs or electrical one-lines to build the register.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-panel shadow-card">
            <table className="w-full min-w-[1000px] text-sm" data-testid="drawing-table">
              <thead className="border-b border-border bg-page text-left text-[11px] tracking-wider text-muted uppercase">
                <tr>
                  {["Drawing", "Rev", "Title", "System", "Type", "Date drawn", "Components", "Avg conf.", "Status", "Review", "Ingest"].map((h) => (
                    <th key={h} className="px-3 py-2.5 font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => onOpen(d)}
                    className="cursor-pointer align-top hover:bg-muted-bg"
                    data-testid="drawing-row"
                    data-drawing={d.drawingNumber ?? d.fileName}
                  >
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{d.drawingNumber ?? <span className="text-muted">{d.fileName}</span>}</td>
                    <td className="px-3 py-2 font-mono text-xs">{d.revision ?? "—"}</td>
                    <td className="px-3 py-2">{d.title ?? <span className="text-muted italic">not read</span>}</td>
                    <td className="px-3 py-2 text-xs">{d.system ?? "—"}</td>
                    <td className="px-3 py-2">
                      <span className="rounded-full bg-chip-bg px-2 py-0.5 text-xs whitespace-nowrap text-chip-fg">{DRAWING_TYPE_LABELS[d.drawingType]}</span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">{d.dateDrawn ?? "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{d.componentCount}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{pct(d.confidenceAvg)}</td>
                    <td className="px-3 py-2">
                      <DrawingStatusPill status={d.status} />
                      {(d.status === "partial" || d.status === "failed") && (
                        <p className={cn("mt-1 max-w-[220px] text-xs", d.status === "failed" ? "text-danger" : "text-amber-fg")} data-testid="partial-reason">
                          {d.partialReason}
                          {d.status === "partial" && d.resolvedPct != null && ` · ${Math.round(d.resolvedPct)}% resolved`}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {d.reviewProgress == null ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="flex items-center gap-2" title={`${pct(d.reviewProgress)} of required items reviewed`}>
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted-bg">
                            <div className="h-full bg-accent" style={{ width: `${d.reviewProgress * 100}%` }} />
                          </div>
                          <span className="text-xs tabular-nums">{pct(d.reviewProgress)}</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs whitespace-nowrap tabular-nums">{secs(d.ingestMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
