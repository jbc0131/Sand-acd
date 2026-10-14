// Tracing and energization over the site graph. Pure functions with no server imports,
// shared by the browser (asset drawer, lineup bar) and the Copilot tools.
// DECISION SUPPORT ONLY: this is a connectivity model, not a protection or switching study.

import { normalizeTag, type AssetType } from "./types";

export const DECISION_SUPPORT = "Decision support only";

export interface ElecAsset {
  id: number;
  tag: string;
  name: string;
  type: AssetType;
  params: Record<string, string>;
}

export interface ElecEdge {
  id: number;
  from: number;
  to: number;
  kind: "power" | "control";
}

export interface TraceResult {
  startId: number;
  direction: "upstream" | "downstream";
  paths: number[][];
  nodeIds: number[];
  edgeIds: number[];
  truncated: boolean;
}

const MAX_PATHS = 200;

/** Every path from the start asset along power connections, up to maxDepth hops. */
export function trace(
  assets: ElecAsset[],
  edges: ElecEdge[],
  startId: number,
  direction: "upstream" | "downstream",
  maxDepth = 15,
): TraceResult {
  const power = edges.filter((e) => e.kind === "power");
  const next = new Map<number, { node: number; edge: number }[]>();
  for (const e of power) {
    const [a, b] = direction === "downstream" ? [e.from, e.to] : [e.to, e.from];
    next.set(a, [...(next.get(a) ?? []), { node: b, edge: e.id }]);
  }
  const paths: number[][] = [];
  const nodeIds = new Set<number>([startId]);
  const edgeIds = new Set<number>();
  let truncated = false;
  const walk = (path: number[], depth: number) => {
    if (paths.length >= MAX_PATHS) {
      truncated = true;
      return;
    }
    const here = path[path.length - 1];
    const outs = (next.get(here) ?? []).filter((o) => !path.includes(o.node));
    if (outs.length === 0 || depth >= maxDepth) {
      if (depth >= maxDepth && outs.length > 0) truncated = true;
      if (path.length > 1) paths.push(path);
      return;
    }
    for (const o of outs) {
      nodeIds.add(o.node);
      edgeIds.add(o.edge);
      walk([...path, o.node], depth + 1);
    }
  };
  if (assets.some((a) => a.id === startId)) walk([startId], 0);
  return { startId, direction, paths, nodeIds: [...nodeIds], edgeIds: [...edgeIds], truncated };
}

/** A breaker conducts when it's closed: open if the what-if opened it, or if its normal_state reads open. */
export function conducts(a: ElecAsset, opened: Set<number>): boolean {
  if (a.type !== "breaker" && a.type !== "disconnect" && a.type !== "fuse") return true;
  if (opened.has(a.id)) return false;
  const state = (a.params.normal_state ?? a.params.state ?? "").toLowerCase();
  return !/open/.test(state);
}

const isSource = (a: ElecAsset) => a.type === "source" || a.type === "generator";

/**
 * Assets reachable from any source along power connections. Generators feed only through breakers
 * (their output breaker). An open breaker is reached on its line side but does not pass power on.
 */
export function energized(assets: ElecAsset[], edges: ElecEdge[], opened: Set<number>): Set<number> {
  const byId = new Map(assets.map((a) => [a.id, a]));
  const out = new Map<number, number[]>();
  for (const e of edges) if (e.kind === "power") out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const live = new Set<number>();
  const queue = assets.filter(isSource).map((a) => a.id);
  queue.forEach((id) => live.add(id));
  while (queue.length) {
    const id = queue.shift()!;
    const a = byId.get(id);
    if (!a || !conducts(a, opened)) continue;
    for (const to of out.get(id) ?? []) {
      const b = byId.get(to);
      if (!b || live.has(to)) continue;
      if (a.type === "generator" && b.type !== "breaker") continue;
      live.add(to);
      queue.push(to);
    }
  }
  return live;
}

export interface WhatIfResult {
  opened: { id: number; tag: string }[];
  /** assets in the power path that have no supply under the what-if lineup */
  deenergized: { id: number; tag: string; name: string; type: AssetType; normallyEnergized: boolean }[];
  /** how many of those were energized in the normal lineup */
  newlyDeenergized: number;
  byType: Record<string, number>;
  label: typeof DECISION_SUPPORT;
}

/** Opens the given breakers and reports what loses supply from all sources. */
export function whatIfOpen(assets: ElecAsset[], edges: ElecEdge[], openIds: number[]): WhatIfResult {
  const inPowerPath = new Set<number>();
  for (const e of edges) {
    if (e.kind !== "power") continue;
    inPowerPath.add(e.from);
    inPowerPath.add(e.to);
  }
  const opened = new Set(openIds);
  const normal = energized(assets, edges, new Set());
  const now = energized(assets, edges, opened);
  const deenergized = assets
    .filter((a) => inPowerPath.has(a.id) && !now.has(a.id) && !isSource(a))
    .map((a) => ({ id: a.id, tag: a.tag, name: a.name, type: a.type, normallyEnergized: normal.has(a.id) }));
  const byType: Record<string, number> = {};
  for (const d of deenergized) byType[d.type] = (byType[d.type] ?? 0) + 1;
  return {
    opened: assets.filter((a) => opened.has(a.id)).map((a) => ({ id: a.id, tag: a.tag })),
    deenergized,
    newlyDeenergized: deenergized.filter((d) => d.normallyEnergized).length,
    byType,
    label: DECISION_SUPPORT,
  };
}

export function findByTag(assets: ElecAsset[], tagOrName: string): ElecAsset | undefined {
  const t = normalizeTag(tagOrName);
  return (
    assets.find((a) => normalizeTag(a.tag) === t && t !== "") ??
    assets.find((a) => a.name.toLowerCase() === tagOrName.toLowerCase().trim())
  );
}
