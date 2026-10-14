import dagre from "dagre";

export const NODE_W = 250;
export const NODE_H = 96;

/** Left-to-right dagre layout. Returns top-left positions keyed by node id. */
export function layoutLR(
  nodes: { id: string | number; height?: number }[],
  edges: { from: string | number; to: string | number }[],
): Map<string, { x: number; y: number }> {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(String(n.id), { width: NODE_W, height: n.height ?? NODE_H });
  for (const e of edges) {
    if (g.hasNode(String(e.from)) && g.hasNode(String(e.to))) g.setEdge(String(e.from), String(e.to));
  }
  dagre.layout(g);
  const out = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(String(n.id));
    out.set(String(n.id), { x: Math.round(p.x - NODE_W / 2), y: Math.round(p.y - (n.height ?? NODE_H) / 2) });
  }
  return out;
}
