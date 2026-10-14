"use client";

import * as React from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { AssetIcon } from "@/components/asset-icon";
import { STATUS_COLORS, STATUS_LABELS, type AssetDTO, type EnrichmentStatus } from "@/lib/types";
import { cn } from "@/lib/utils";

export type AssetNodeData = {
  asset: AssetDTO;
  mode: "overview" | "enrich";
  status: EnrichmentStatus | "enriching";
  highlighted: boolean;
  dimmed: boolean;
  traced: boolean;
  deenergized: boolean;
  opened: boolean;
};

export type AssetFlowNode = Node<AssetNodeData, "asset">;

export function StatusDot({ status, className }: { status: EnrichmentStatus | "enriching"; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", status === "enriching" && "cda-pulse", className)}
      style={{ background: STATUS_COLORS[status] }}
      title={STATUS_LABELS[status]}
      aria-label={STATUS_LABELS[status]}
      data-status={status}
    />
  );
}

function AssetNodeImpl({ data, selected }: NodeProps<AssetFlowNode>) {
  const { asset, mode, status, highlighted, dimmed, traced, deenergized, opened } = data;
  const freshKeys = new Set(asset.provenance.filter((p) => p.fresh).map((p) => p.key));
  const paramEntries = Object.entries(asset.params).filter(([k]) => k !== "tag");
  // Fresh chips first so the latest run is visible.
  paramEntries.sort((a, b) => Number(freshKeys.has(b[0])) - Number(freshKeys.has(a[0])));
  const chips: { key: string; value: string; fresh: boolean }[] =
    mode === "overview"
      ? asset.tag
        ? [{ key: "tag", value: asset.tag, fresh: false }]
        : []
      : paramEntries.slice(0, 6).map(([k, v]) => ({ key: k, value: v, fresh: freshKeys.has(k) }));

  return (
    <div
      className={cn(
        "relative w-[250px] rounded-xl border bg-card p-3 shadow-card transition-[opacity,border-color]",
        selected ? "border-accent" : "border-border",
        highlighted && "cda-highlight",
        traced && "cda-traced",
        deenergized && "cda-deenergized",
        dimmed && "cda-dimmed",
      )}
      data-testid="asset-node"
      data-tag={asset.tag}
      data-status={status}
      data-traced={traced ? "true" : undefined}
      data-deenergized={deenergized ? "true" : undefined}
    >
      {(deenergized || opened) && (
        <span
          className={cn(
            "absolute -top-2.5 left-3 rounded-full px-1.5 text-[10px] font-semibold text-white",
            opened ? "bg-[#7c5cd6]" : "bg-danger",
          )}
        >
          {opened ? "OPEN (what-if)" : "De-energized"}
        </span>
      )}
      <Handle type="target" position={Position.Left} className="cda-handle" />
      <StatusDot status={status} className="absolute top-3 right-3" />
      <div className="flex items-start gap-2.5 pr-4">
        <AssetIcon type={asset.type} />
        <div className="min-w-0">
          <div className="text-[13px] leading-snug font-semibold">
            {asset.name}
            {asset.tag && <span className="font-normal text-muted"> ({asset.tag})</span>}
          </div>
          {asset.description && <div className="truncate text-xs text-muted italic">{asset.description}</div>}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {chips.map((c) => (
            <span
              key={c.key}
              className={cn(
                "max-w-full truncate rounded-md bg-chip-bg px-1.5 py-0.5 font-mono text-[10.5px] text-chip-fg",
                c.fresh && "ring-1 ring-accent",
              )}
              title={`${c.key}: ${c.value}`}
            >
              {c.key}: {c.value}
            </span>
          ))}
          {mode === "enrich" && paramEntries.length > 6 && (
            <span className="rounded-md px-1 py-0.5 text-[10.5px] text-muted">+{paramEntries.length - 6}</span>
          )}
        </div>
      )}
      <Handle type="source" position={Position.Right} className="cda-handle" />
    </div>
  );
}

export const AssetNode = React.memo(AssetNodeImpl);
