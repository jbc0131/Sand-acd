import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { callJson, MODEL_MAIN, UserFacingError, type TokenUsage } from "./ai";
import { raw, nowIso } from "./db";
import { recomputeAssets, relayout, removeUpload, setParam, touchSite, DESCRIPTION_KEY } from "./model";
import { ASSET_TYPES, DRAWING_TYPES, normalizeTag, type AssetType, type DrawingType } from "./types";
import type { JobContext } from "./jobs";

const DIAGRAM_PROMPT = `You are building a site model for an industrial facility from an engineering diagram (a process flow diagram, P&ID or electrical one-line). Read the attached drawing. Return ONLY JSON: {"nodes":[{"id":"N1","name":"plain asset name","tag":"equipment tag exactly as drawn, or empty","type":"<one of the asset types>","description":"one short sentence","params":{"key":"value"},"confidence":0.0}],"edges":[{"from":"N1","to":"N2","label":"stream or connection name"}]}. Rules: one node per piece of equipment or major process unit. Edges follow flow direction (process flow, or power from sources to loads). Put only values printed on the drawing into params, snake_case keys. Use confidence below 0.8 for anything unclear. Do not invent equipment or values.

Asset types: ${ASSET_TYPES.join(", ")}.

Also return these fields in the same JSON object:
- "drawing_type": one of ${DRAWING_TYPES.join(", ")}.
- "title_block": {"drawing_number","revision","date","unit","site","author","system","title"} copied exactly from the title block; use "" for anything not printed or not legible.
- For every node, "bbox": [x0, y0, x1, y1] giving the node's symbol and label on the page as fractions 0..1 of page width and height, origin top-left.
- For every edge, "confidence" 0..1.
- "off_page_connectors": [{"label":"text on the flag","direction":"from" or "to","target_drawing_number":"","target_tag":"","at_node_id":"node the connector attaches to"}] for every off-page or continuation flag.
- "status": "parsed" when the whole sheet was read, or "partial" when any region cannot be read. For partial, add "partial_reason" (what could not be read, e.g. "legend block illegible") and "resolved_pct" (0-100, the share of the sheet you could read). Never guess at unreadable content; leave it out and say so in partial_reason.`;

const scalar = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));
const str = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((v) => (v == null ? "" : String(v).trim()));

const BBoxSchema = z
  .array(z.coerce.number())
  .length(4)
  .transform((b) => {
    const c = b.map((v) => Math.min(1, Math.max(0, v)));
    return [Math.min(c[0], c[2]), Math.min(c[1], c[3]), Math.max(c[0], c[2]), Math.max(c[1], c[3])] as [number, number, number, number];
  })
  .nullish()
  .catch(null);

const NodeSchema = z.object({
  id: z.coerce.string().min(1),
  name: z.string().min(1),
  tag: str,
  type: z
    .string()
    .transform((t) => t.toLowerCase().trim())
    .transform((t): AssetType => ((ASSET_TYPES as readonly string[]).includes(t) ? (t as AssetType) : "other")),
  description: str,
  params: z
    .record(z.string(), scalar.nullable())
    .nullish()
    .transform((p) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(p ?? {})) if (v != null && String(v).trim()) out[snake(k)] = String(v).trim();
      return out;
    }),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
  bbox: BBoxSchema,
});

const DiagramSchema = z.object({
  nodes: z.array(NodeSchema).min(1, "no equipment was found on the drawing"),
  edges: z
    .array(
      z.object({
        from: z.coerce.string(),
        to: z.coerce.string(),
        label: str,
        confidence: z.coerce.number().min(0).max(1).nullish().catch(null),
      }),
    )
    .default([]),
  drawing_type: z
    .string()
    .nullish()
    .transform((t): DrawingType => {
      const v = (t ?? "").toLowerCase().trim().replace(/[\s-]+/g, "_");
      return (DRAWING_TYPES as readonly string[]).includes(v) ? (v as DrawingType) : "other";
    }),
  title_block: z
    .object({
      drawing_number: str,
      revision: str,
      date: str,
      unit: str,
      site: str,
      author: str,
      system: str,
      title: str,
    })
    .partial()
    .nullish()
    .transform((t) => t ?? {}),
  off_page_connectors: z
    .array(
      z.object({
        label: str,
        direction: z
          .string()
          .nullish()
          .transform((d) => (d === "to" ? ("to" as const) : d === "from" ? ("from" as const) : null)),
        target_drawing_number: str,
        target_tag: str,
        at_node_id: str,
      }),
    )
    .nullish()
    .transform((c) => c ?? []),
  status: z
    .string()
    .nullish()
    .transform((s) => (s === "partial" ? ("partial" as const) : ("parsed" as const))),
  partial_reason: str,
  resolved_pct: z.coerce.number().min(0).max(100).nullish().catch(null),
});

const VerifySchema = z.object({ nodes: z.array(NodeSchema.partial({ name: true, type: true }).required({ id: true })) });

export type Diagram = z.infer<typeof DiagramSchema>;

function snake(k: string) {
  return k
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Builds the content block for the drawing: PDF as a document block (first page only if large), images as image blocks. */
async function drawingBlock(filePath: string): Promise<Anthropic.Beta.Messages.BetaContentBlockParam> {
  const ext = path.extname(filePath).toLowerCase();
  const buf = fs.readFileSync(filePath);
  if (ext === ".pdf") {
    let data = buf;
    let doc: PDFDocument;
    try {
      doc = await PDFDocument.load(buf, { ignoreEncryption: true });
    } catch {
      throw new UserFacingError("Could not open this PDF. It may be damaged.");
    }
    if (doc.getPageCount() > 3 || buf.length > 8 * 1024 * 1024) {
      const first = await PDFDocument.create();
      const [p] = await first.copyPages(doc, [0]);
      first.addPage(p);
      data = Buffer.from(await first.save());
    }
    return {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: data.toString("base64") },
    };
  }
  if (buf.length > 5 * 1024 * 1024) {
    throw new UserFacingError("Images must be under 5 MB for diagram extraction. Export a smaller PNG or use a PDF.");
  }
  const media_type = ext === ".png" ? "image/png" : "image/jpeg";
  return { type: "image", source: { type: "base64", media_type, data: buf.toString("base64") } };
}

export async function extractDiagram(filePath: string, ctx: JobContext, usage: TokenUsage): Promise<Diagram> {
  const block = await drawingBlock(filePath);
  ctx.step("Reading diagram");
  const result = await callJson({
    model: MODEL_MAIN,
    content: [block, { type: "text", text: DIAGRAM_PROMPT }],
    schema: DiagramSchema,
    usage,
  });

  // Dedupe node ids and drop edges or connectors that point at unknown ids.
  const seen = new Set<string>();
  result.nodes = result.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  result.edges = result.edges.filter((e) => seen.has(e.from) && seen.has(e.to) && e.from !== e.to);
  result.off_page_connectors = result.off_page_connectors.filter((c) => !c.at_node_id || seen.has(c.at_node_id));

  const unsure = result.nodes.filter((n) => n.confidence < 0.8);
  if (unsure.length > 0) {
    ctx.step(`Verifying ${unsure.length} unclear item${unsure.length === 1 ? "" : "s"}`);
    try {
      const fix = await callJson({
        model: MODEL_MAIN,
        usage,
        content: [
          block,
          {
            type: "text",
            text: `You extracted these items from the attached drawing but marked them as unclear:\n${JSON.stringify(
              unsure,
              null,
              1,
            )}\n\nLook at the drawing again and correct only these items. Keep each id. Fix name, tag, type, description, params and bbox so they match exactly what is printed. Do not invent values; if something is still unreadable, keep a low confidence. Return ONLY JSON: {"nodes":[{"id":"...","name":"...","tag":"...","type":"<one of: ${ASSET_TYPES.join(
              ", ",
            )}>","description":"...","params":{},"bbox":[0,0,0,0],"confidence":0.0}]}`,
          },
        ],
        schema: VerifySchema,
      });
      const byId = new Map(fix.nodes.map((n) => [n.id, n]));
      result.nodes = result.nodes.map((n) => {
        const f = byId.get(n.id);
        if (!f) return n;
        return {
          ...n,
          name: f.name || n.name,
          tag: f.tag || n.tag,
          type: f.type ?? n.type,
          description: f.description || n.description,
          params: f.params && Object.keys(f.params).length ? f.params : n.params,
          confidence: f.confidence ?? n.confidence,
          bbox: f.bbox ?? n.bbox,
        };
      });
    } catch (err) {
      // The first pass is still usable; keep it and say so.
      ctx.warn("Verification pass failed; unclear items were kept as first read.");
      if (!(err instanceof UserFacingError)) console.error("[verify]", err);
    }
  }
  return result;
}

export interface IngestStats {
  ingestMs: number;
  tokensIn: number;
  tokensOut: number;
}

/**
 * Saves one drawing's extraction into the site model:
 * - assets are keyed by normalized tag within the site (untagged assets are never merged),
 * - every node becomes an appearance with its bbox and confidence,
 * - parameter disagreements between drawings become discrepancies,
 * - off-page connectors resolve into edges when their target drawing and tag are known,
 * - a drawing with the same drawing number replaces the earlier one's appearances.
 */
export function saveDrawing(
  siteId: number,
  drawingId: number,
  sourceId: number,
  d: Diagram,
  stats: IngestStats,
): { assets: number; edges: number; replaced: number } {
  const db = raw();
  const tb = d.title_block;
  const drawingNumber = tb.drawing_number?.trim() || null;
  let replaced = 0;
  const touchedAssets = new Set<number>();

  db.transaction(() => {
    // 1. A new revision (or a re-upload) of the same drawing number replaces the old drawing's content.
    if (drawingNumber) {
      const old = (
        db
          .prepare(`SELECT id, drawing_number FROM drawings WHERE site_id = ? AND id != ? AND status IN ('parsed', 'partial')`)
          .all(siteId, drawingId) as { id: number; drawing_number: string | null }[]
      ).filter((o) => normalizeTag(o.drawing_number ?? "") === normalizeTag(drawingNumber));
      for (const o of old) {
        removeDrawingContent(siteId, o.id).forEach((a) => touchedAssets.add(a));
        replaced++;
      }
    }

    // 2. Assets and appearances.
    const siteAssets = db.prepare(`SELECT id, tag FROM assets WHERE site_id = ?`).all(siteId) as { id: number; tag: string }[];
    const byTag = new Map<string, number>();
    for (const a of siteAssets) if (normalizeTag(a.tag)) byTag.set(normalizeTag(a.tag), a.id);
    const insAsset = db.prepare(
      `INSERT INTO assets (site_id, ext_id, name, tag, type, description, params_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`,
    );
    const insApp = db.prepare(
      `INSERT INTO asset_appearances (asset_id, drawing_id, bbox, confidence, extracted_json) VALUES (?, ?, ?, ?, ?)`,
    );
    const idMap = new Map<string, number>();
    for (const n of d.nodes) {
      const key = normalizeTag(n.tag);
      let id = key ? byTag.get(key) : undefined;
      if (!id) {
        id = Number(insAsset.run(siteId, `D${drawingId}-${n.id}`, n.name, n.tag, n.type, n.description).lastInsertRowid);
        if (key) byTag.set(key, id);
      }
      idMap.set(n.id, id);
      touchedAssets.add(id);
      insApp.run(id, drawingId, n.bbox ? JSON.stringify(n.bbox) : null, n.confidence, JSON.stringify(n));
      for (const [k, v] of Object.entries(n.params)) setParam(id, k, v, sourceId, null);
      if (n.description) setParam(id, DESCRIPTION_KEY, n.description, sourceId, null);
    }

    // 3. Connections drawn on this sheet. Elementaries carry control wiring, not power paths.
    const kind = d.drawing_type === "elementary" ? "control" : "power";
    const insEdge = db.prepare(
      `INSERT INTO edges (site_id, from_asset, to_asset, label, drawing_id, kind, confidence, via) VALUES (?, ?, ?, ?, ?, ?, ?, 'drawing')`,
    );
    const edgeExists = db.prepare(`SELECT 1 FROM edges WHERE site_id = ? AND from_asset = ? AND to_asset = ?`);
    for (const e of d.edges) {
      const from = idMap.get(e.from);
      const to = idMap.get(e.to);
      if (!from || !to || from === to || edgeExists.get(siteId, from, to)) continue;
      insEdge.run(siteId, from, to, e.label, drawingId, kind, e.confidence ?? null);
    }

    // 4. Off-page connectors.
    const insConn = db.prepare(
      `INSERT INTO off_page_connectors (site_id, drawing_id, label, direction, target_drawing_number, target_tag, at_asset_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const c of d.off_page_connectors) {
      const direction = c.direction ?? (/^\s*to\b/i.test(c.label) ? "to" : "from");
      insConn.run(siteId, drawingId, c.label, direction, c.target_drawing_number || null, c.target_tag || null, idMap.get(c.at_node_id) ?? null);
    }

    // 5. Drawing register row.
    const confs = d.nodes.map((n) => n.confidence);
    db.prepare(
      `UPDATE drawings SET drawing_number = ?, revision = ?, date_drawn = ?, unit = ?, system = ?, title = ?, author = ?, site_label = ?,
         drawing_type = ?, status = ?, partial_reason = ?, resolved_pct = ?, component_count = ?, confidence_avg = ?,
         ingest_ms = ?, tokens_in = ?, tokens_out = ?
       WHERE id = ?`,
    ).run(
      drawingNumber,
      tb.revision || null,
      tb.date || null,
      tb.unit || null,
      tb.system || null,
      tb.title || null,
      tb.author || null,
      tb.site || null,
      d.drawing_type,
      d.status,
      d.status === "partial" ? d.partial_reason || "Part of the sheet could not be read." : null,
      d.status === "partial" ? (d.resolved_pct ?? null) : 100,
      d.nodes.length,
      confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
      stats.ingestMs,
      stats.tokensIn,
      stats.tokensOut,
      drawingId,
    );

    // Earlier failed attempts of the same file are superseded by this successful read.
    const fileName = (db.prepare(`SELECT file_name FROM drawings WHERE id = ?`).get(drawingId) as { file_name: string }).file_name;
    const failed = db
      .prepare(`SELECT d.id, s.file_path FROM drawings d LEFT JOIN sources s ON s.id = d.source_id WHERE d.site_id = ? AND d.status = 'failed' AND d.file_name = ?`)
      .all(siteId, fileName) as { id: number; file_path: string | null }[];
    for (const f of failed) {
      db.prepare(`DELETE FROM sources WHERE id = (SELECT source_id FROM drawings WHERE id = ?)`).run(f.id);
      db.prepare(`DELETE FROM drawings WHERE id = ?`).run(f.id);
      if (f.file_path) removeUpload(f.file_path);
    }

    db.prepare(`UPDATE sources SET status = 'applied' WHERE id = ?`).run(sourceId);
    db.prepare(`UPDATE sites SET status = 'active', updated_at = ? WHERE id = ?`).run(nowIso(), siteId);
    resolveConnectors(siteId);
    refreshDiscrepancies(siteId, [...touchedAssets]);
    deleteOrphans(siteId, [...touchedAssets]);
  })();

  recomputeAssets(siteId);
  relayout(siteId);
  touchSite(siteId);
  const edgeCount = (db.prepare(`SELECT COUNT(*) AS n FROM edges WHERE drawing_id = ?`).get(drawingId) as { n: number }).n;
  return { assets: new Set(d.nodes.map((n) => n.id)).size, edges: edgeCount, replaced };
}

/**
 * Removes everything one drawing contributed (appearances, its edges and connectors, its parameter
 * provenance) and deletes the drawing row and its source. Returns the assets it touched.
 */
export function removeDrawingContent(siteId: number, drawingId: number): number[] {
  const db = raw();
  const row = db.prepare(`SELECT source_id FROM drawings WHERE id = ? AND site_id = ?`).get(drawingId, siteId) as
    | { source_id: number | null }
    | undefined;
  if (!row) return [];
  const assets = (db.prepare(`SELECT DISTINCT asset_id FROM asset_appearances WHERE drawing_id = ?`).all(drawingId) as { asset_id: number }[]).map(
    (r) => r.asset_id,
  );
  db.prepare(`DELETE FROM edges WHERE drawing_id = ?`).run(drawingId);
  if (row.source_id) {
    const src = db.prepare(`SELECT file_path FROM sources WHERE id = ?`).get(row.source_id) as { file_path: string } | undefined;
    db.prepare(`DELETE FROM sources WHERE id = ?`).run(row.source_id);
    if (src) removeUpload(src.file_path);
  }
  const img = db.prepare(`SELECT page_image_path FROM drawings WHERE id = ?`).get(drawingId) as { page_image_path: string | null };
  db.prepare(`DELETE FROM drawings WHERE id = ?`).run(drawingId);
  if (img.page_image_path) removeUpload(img.page_image_path);
  return assets;
}

/** Deletes assets that came from drawings but no longer appear on any drawing. */
function deleteOrphans(siteId: number, assetIds: number[]) {
  const db = raw();
  const del = db.prepare(
    `DELETE FROM assets WHERE id = ? AND site_id = ? AND NOT EXISTS (SELECT 1 FROM asset_appearances WHERE asset_id = ?)`,
  );
  for (const id of assetIds) del.run(id, siteId, id);
}

/** Turns off-page connectors into edges once their target drawing and tag are in the model. */
export function resolveConnectors(siteId: number) {
  const db = raw();
  const open = db
    .prepare(
      `SELECT c.id, c.drawing_id, c.direction, c.target_drawing_number, c.target_tag, c.at_asset_id, d.drawing_type
       FROM off_page_connectors c JOIN drawings d ON d.id = c.drawing_id
       WHERE c.site_id = ? AND c.resolved = 0 AND c.at_asset_id IS NOT NULL`,
    )
    .all(siteId) as {
    id: number;
    drawing_id: number;
    direction: "from" | "to";
    target_drawing_number: string | null;
    target_tag: string | null;
    at_asset_id: number;
    drawing_type: string;
  }[];
  if (open.length === 0) return;
  const drawings = db
    .prepare(`SELECT id, drawing_number FROM drawings WHERE site_id = ? AND status IN ('parsed', 'partial')`)
    .all(siteId) as { id: number; drawing_number: string | null }[];
  const onDrawing = db.prepare(
    `SELECT a.id, a.tag FROM asset_appearances ap JOIN assets a ON a.id = ap.asset_id WHERE ap.drawing_id = ?`,
  );
  const findEdge = db.prepare(`SELECT id FROM edges WHERE site_id = ? AND from_asset = ? AND to_asset = ?`);
  const insEdge = db.prepare(
    `INSERT INTO edges (site_id, from_asset, to_asset, label, drawing_id, kind, confidence, via) VALUES (?, ?, ?, ?, ?, ?, NULL, 'connector')`,
  );
  const mark = db.prepare(`UPDATE off_page_connectors SET resolved = 1, resolved_edge_id = ? WHERE id = ?`);
  for (const c of open) {
    if (!c.target_drawing_number || !c.target_tag) continue;
    const target = drawings.find((d) => normalizeTag(d.drawing_number ?? "") === normalizeTag(c.target_drawing_number!));
    if (!target) continue;
    const asset = (onDrawing.all(target.id) as { id: number; tag: string }[]).find(
      (a) => normalizeTag(a.tag) === normalizeTag(c.target_tag!),
    );
    if (!asset || asset.id === c.at_asset_id) continue;
    const [from, to] = c.direction === "to" ? [c.at_asset_id, asset.id] : [asset.id, c.at_asset_id];
    const existing = (findEdge.get(siteId, from, to) as { id: number } | undefined)?.id;
    const edgeId =
      existing ??
      Number(
        insEdge.run(siteId, from, to, `Off-page ${c.target_drawing_number}`, c.drawing_id, c.drawing_type === "elementary" ? "control" : "power")
          .lastInsertRowid,
      );
    mark.run(edgeId, c.id);
  }
}

function normValue(v: string) {
  return v.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compares the values each drawing gives for each parameter of the given assets.
 * Two or more different values open a discrepancy; agreement removes an open one.
 */
export function refreshDiscrepancies(siteId: number, assetIds: number[]) {
  const db = raw();
  const rows = db.prepare(
    `SELECT aps.key, aps.value, d.id AS drawing_id
     FROM asset_param_sources aps JOIN drawings d ON d.source_id = aps.source_id
     WHERE aps.asset_id = ? AND aps.key != ? AND d.status IN ('parsed', 'partial')`,
  );
  const existing = db.prepare(`SELECT id, values_json, status FROM discrepancies WHERE asset_id = ? AND key = ?`);
  const ins = db.prepare(`INSERT INTO discrepancies (site_id, asset_id, key, values_json, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)`);
  const upd = db.prepare(`UPDATE discrepancies SET values_json = ?, status = 'open', resolution = NULL, resolved_at = NULL WHERE id = ?`);
  const del = db.prepare(`DELETE FROM discrepancies WHERE id = ?`);
  const all = db.prepare(`SELECT id, key FROM discrepancies WHERE asset_id = ?`);
  for (const assetId of assetIds) {
    const byKey = new Map<string, Map<string, { value: string; drawingIds: number[] }>>();
    for (const r of rows.all(assetId, DESCRIPTION_KEY) as { key: string; value: string; drawing_id: number }[]) {
      const m = byKey.get(r.key) ?? new Map();
      const v = m.get(normValue(r.value)) ?? { value: r.value, drawingIds: [] };
      v.drawingIds.push(r.drawing_id);
      m.set(normValue(r.value), v);
      byKey.set(r.key, m);
    }
    const conflicting = new Set<string>();
    for (const [key, m] of byKey) {
      if (m.size < 2) continue;
      conflicting.add(key);
      const values = JSON.stringify([...m.values()].sort((a, b) => a.value.localeCompare(b.value)));
      const ex = existing.get(assetId, key) as { id: number; values_json: string; status: string } | undefined;
      if (!ex) ins.run(siteId, assetId, key, values, nowIso());
      else if (ex.values_json !== values) upd.run(values, ex.id);
    }
    for (const d of all.all(assetId) as { id: number; key: string }[]) if (!conflicting.has(d.key)) del.run(d.id);
  }
}
