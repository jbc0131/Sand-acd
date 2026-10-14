import "server-only";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { callJson, MODEL_MAIN, UserFacingError } from "./ai";
import { raw, nowIso } from "./db";
import { recomputeAssets, relayout, setParam, touchSite, DESCRIPTION_KEY } from "./model";
import { ASSET_TYPES, normalizeTag, type AssetType } from "./types";
import type { JobContext } from "./jobs";

const DIAGRAM_PROMPT = `You are building a site model for an industrial facility from an engineering diagram (a process flow diagram, P&ID or electrical one-line). Read the attached drawing. Return ONLY JSON: {"nodes":[{"id":"N1","name":"plain asset name","tag":"equipment tag exactly as drawn, or empty","type":"<one of the asset types>","description":"one short sentence","params":{"key":"value"},"confidence":0.0}],"edges":[{"from":"N1","to":"N2","label":"stream or connection name"}]}. Rules: one node per piece of equipment or major process unit. Edges follow flow direction (process flow, or power from sources to loads). Put only values printed on the drawing into params, snake_case keys. Use confidence below 0.8 for anything unclear. Do not invent equipment or values.

Asset types: ${ASSET_TYPES.join(", ")}.`;

const scalar = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));

const NodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  tag: z.string().nullish().transform((v) => (v ?? "").trim()),
  type: z
    .string()
    .transform((t) => t.toLowerCase().trim())
    .transform((t): AssetType => ((ASSET_TYPES as readonly string[]).includes(t) ? (t as AssetType) : "other")),
  description: z.string().nullish().transform((v) => (v ?? "").trim()),
  params: z.record(z.string(), scalar.nullable()).nullish().transform((p) => {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p ?? {})) if (v != null && String(v).trim()) out[snake(k)] = String(v).trim();
    return out;
  }),
  confidence: z.coerce.number().min(0).max(1).catch(0.5),
});

const DiagramSchema = z.object({
  nodes: z.array(NodeSchema).min(1, "no equipment was found on the drawing"),
  edges: z
    .array(
      z.object({
        from: z.string(),
        to: z.string(),
        label: z.string().nullish().transform((v) => (v ?? "").trim()),
      }),
    )
    .default([]),
});

const VerifySchema = z.object({ nodes: z.array(NodeSchema.partial({ name: true, type: true }).required({ id: true })) });

type Diagram = z.infer<typeof DiagramSchema>;

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

export async function extractDiagram(filePath: string, ctx: JobContext): Promise<Diagram> {
  const block = await drawingBlock(filePath);
  ctx.step("Reading diagram");
  const result = await callJson({
    model: MODEL_MAIN,
    content: [block, { type: "text", text: DIAGRAM_PROMPT }],
    schema: DiagramSchema,
  });

  // Dedupe node ids and drop edges that point at unknown ids.
  const seen = new Set<string>();
  result.nodes = result.nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  result.edges = result.edges.filter((e) => seen.has(e.from) && seen.has(e.to) && e.from !== e.to);

  const unsure = result.nodes.filter((n) => n.confidence < 0.8);
  if (unsure.length > 0) {
    ctx.step(`Verifying ${unsure.length} unclear item${unsure.length === 1 ? "" : "s"}`);
    try {
      const fix = await callJson({
        model: MODEL_MAIN,
        content: [
          block,
          {
            type: "text",
            text: `You extracted these items from the attached drawing but marked them as unclear:\n${JSON.stringify(
              unsure,
              null,
              1,
            )}\n\nLook at the drawing again and correct only these items. Keep each id. Fix name, tag, type, description and params so they match exactly what is printed. Do not invent values. Return ONLY JSON: {"nodes":[{"id":"...","name":"...","tag":"...","type":"<one of: ${ASSET_TYPES.join(
              ", ",
            )}>","description":"...","params":{},"confidence":0.0}]}`,
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
          tag: f.tag ?? n.tag,
          type: f.type ?? n.type,
          description: f.description || n.description,
          params: f.params && Object.keys(f.params).length ? f.params : n.params,
          confidence: f.confidence ?? n.confidence,
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

/** Saves an extracted diagram into the site model (merging with any existing model by tag), lays it out and activates the site. */
export function saveDiagram(siteId: number, sourceId: number, d: Diagram): { assets: number; edges: number } {
  const db = raw();
  const existing = db.prepare(`SELECT id, tag, name FROM assets WHERE site_id = ?`).all(siteId) as {
    id: number;
    tag: string;
    name: string;
  }[];
  const byTag = new Map(existing.filter((a) => normalizeTag(a.tag)).map((a) => [normalizeTag(a.tag), a.id]));
  const byName = new Map(existing.map((a) => [a.name.toLowerCase(), a.id]));
  const idMap = new Map<string, number>();
  const insAsset = db.prepare(
    `INSERT INTO assets (site_id, ext_id, name, tag, type, description, params_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`,
  );
  const insEdge = db.prepare(`INSERT INTO edges (site_id, from_asset, to_asset, label) VALUES (?, ?, ?, ?)`);
  const edgeExists = db.prepare(`SELECT 1 FROM edges WHERE site_id = ? AND from_asset = ? AND to_asset = ?`);
  let edgeCount = 0;
  db.transaction(() => {
    for (const n of d.nodes) {
      const match = (n.tag && byTag.get(normalizeTag(n.tag))) || byName.get(n.name.toLowerCase());
      let id: number;
      if (match) {
        id = match;
      } else {
        id = Number(insAsset.run(siteId, n.id, n.name, n.tag, n.type, n.description).lastInsertRowid);
        if (n.tag) byTag.set(normalizeTag(n.tag), id);
        byName.set(n.name.toLowerCase(), id);
      }
      idMap.set(n.id, id);
      for (const [k, v] of Object.entries(n.params)) setParam(id, k, v, sourceId, null);
      if (n.description) setParam(id, DESCRIPTION_KEY, n.description, sourceId, null);
    }
    for (const e of d.edges) {
      const from = idMap.get(e.from);
      const to = idMap.get(e.to);
      if (!from || !to || from === to || edgeExists.get(siteId, from, to)) continue;
      insEdge.run(siteId, from, to, e.label);
      edgeCount++;
    }
    db.prepare(`UPDATE sites SET status = 'active', updated_at = ? WHERE id = ?`).run(nowIso(), siteId);
  })();
  recomputeAssets(siteId);
  relayout(siteId);
  touchSite(siteId);
  return { assets: new Set(idMap.values()).size, edges: edgeCount };
}
