"use client";

import * as React from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
} from "@xyflow/react";
import { AssetNode, type AssetFlowNode } from "./asset-node";
import type { AssetDTO, EdgeDTO, EnrichmentStatus } from "@/lib/types";
import { normalizeTag } from "@/lib/types";
import { layoutLR } from "@/lib/layout";

/** Conservative card height in enrich mode, where up to 6 parameter chips wrap onto extra rows. */
function enrichHeight(a: AssetDTO) {
  const chips = Math.min(Object.keys(a.params).filter((k) => k !== "tag").length, 6);
  return 78 + chips * 21;
}

const nodeTypes = { asset: AssetNode };

export interface CanvasProps {
  assets: AssetDTO[];
  edges: EdgeDTO[];
  mode: "overview" | "enrich";
  enrichingIds: Set<number>;
  highlightTags: string[];
  focus: { tags: string[]; nonce: number } | null;
  search: string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  trace?: { nodeIds: Set<number>; edgeIds: Set<number>; nonce: number } | null;
  deenergized?: Set<number>;
  opened?: Set<number>;
}

function matches(a: AssetDTO, q: string) {
  return `${a.name} ${a.tag} ${a.type} ${a.description}`.toLowerCase().includes(q);
}

const EMPTY = new Set<number>();

function CanvasInner({
  assets,
  edges,
  mode,
  enrichingIds,
  highlightTags,
  focus,
  search,
  selectedId,
  onSelect,
  trace,
  deenergized = EMPTY,
  opened = EMPTY,
}: CanvasProps) {
  const rf = useReactFlow();
  const hl = React.useMemo(() => new Set(highlightTags.map(normalizeTag)), [highlightTags]);
  const q = search.trim().toLowerCase();

  // Overview uses the stored layout; Enrich re-runs dagre with taller cards so chips never overlap.
  const enrichPos = React.useMemo(
    () => (mode === "enrich" ? layoutLR(assets.map((a) => ({ id: a.id, height: enrichHeight(a) })), edges) : null),
    [mode, assets, edges],
  );

  const derived = React.useMemo<AssetFlowNode[]>(
    () =>
      assets.map((a) => ({
        id: String(a.id),
        type: "asset",
        position: enrichPos?.get(String(a.id)) ?? { x: a.x, y: a.y },
        selected: a.id === selectedId,
        data: {
          asset: a,
          mode,
          status: (enrichingIds.has(a.id) ? "enriching" : a.enrichmentStatus) as EnrichmentStatus | "enriching",
          highlighted: Boolean(a.tag) && hl.has(normalizeTag(a.tag)),
          dimmed: q.length > 0 && !matches(a, q),
          traced: Boolean(trace?.nodeIds.has(a.id)),
          deenergized: deenergized.has(a.id),
          opened: opened.has(a.id),
        },
      })),
    [assets, mode, enrichingIds, hl, q, selectedId, enrichPos, trace, deenergized, opened],
  );

  // Keep user-dragged positions while data (status, chips, highlight) changes; reset them when the layout changes.
  const [nodes, setNodes, onNodesChange] = useNodesState<AssetFlowNode>(derived);
  const layoutKey = `${mode}|${assets.map((a) => `${a.id}:${mode === "enrich" ? enrichHeight(a) : `${a.x},${a.y}`}`).join(",")}`;
  const lastLayout = React.useRef(layoutKey);
  React.useEffect(() => {
    const relayout = lastLayout.current !== layoutKey;
    lastLayout.current = layoutKey;
    setNodes((prev) => {
      if (relayout) return derived;
      const pos = new Map(prev.map((n) => [n.id, n.position]));
      return derived.map((n) => ({ ...n, position: pos.get(n.id) ?? n.position }));
    });
  }, [derived, setNodes, layoutKey]);

  // Re-fit when the set of assets or the layout changes.
  const assetKey = layoutKey;
  React.useEffect(() => {
    const t = setTimeout(() => rf.fitView({ padding: 0.15, duration: 300 }), 50);
    return () => clearTimeout(t);
  }, [assetKey, rf]);

  React.useEffect(() => {
    if (!focus || focus.tags.length === 0) return;
    const want = new Set(focus.tags.map(normalizeTag));
    const ids = assets.filter((a) => a.tag && want.has(normalizeTag(a.tag))).map((a) => ({ id: String(a.id) }));
    if (ids.length) rf.fitView({ nodes: ids, duration: 500, padding: 0.6, maxZoom: 1.1 });
  }, [focus, assets, rf]);

  // Pan to a new trace.
  React.useEffect(() => {
    if (!trace || trace.nodeIds.size === 0) return;
    rf.fitView({ nodes: [...trace.nodeIds].map((id) => ({ id: String(id) })), duration: 500, padding: 0.25 });
  }, [trace, rf]);

  const flowEdges = React.useMemo<Edge[]>(
    () =>
      edges.map((e) => {
        const traced = Boolean(trace?.edgeIds.has(e.id));
        const dead = deenergized.has(e.to) && !traced;
        const color = traced ? "#2a5bb8" : dead ? "#c93b3b" : e.kind === "control" ? "#7c5cd6" : "#14a85a";
        return {
          id: String(e.id),
          source: String(e.from),
          target: String(e.to),
          type: "smoothstep",
          animated: e.kind !== "control" && !dead,
          label: e.label || undefined,
          labelBgPadding: [6, 3] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "#ffffff", stroke: "#dbe2ea" },
          style: {
            stroke: traced || dead || e.kind === "control" ? color : "var(--accent)",
            strokeWidth: traced ? 3 : 1.6,
            ...(e.kind === "control" ? { strokeDasharray: "2 4" } : {}),
          },
          markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
          className: traced ? "cda-traced-edge" : undefined,
        };
      }),
    [edges, trace, deenergized],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={flowEdges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, n) => onSelect(Number(n.id))}
      onPaneClick={() => onSelect(null)}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.15}
      maxZoom={2}
      nodesConnectable={false}
      zoomOnPinch
      panOnDrag
    >
      <Background variant={BackgroundVariant.Dots} gap={18} size={1.4} color="var(--canvas-dot)" />
      <Controls position="bottom-left" showInteractive={false} />
    </ReactFlow>
  );
}

export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
