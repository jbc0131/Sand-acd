import "server-only";
import { z } from "zod";
import { callJson, hasApiKey, MODEL_MAIN, NO_KEY_MESSAGE, UserFacingError, toUserMessage } from "./ai";
import { raw } from "./db";
import { recomputeAssets, setParam, touchSite, DESCRIPTION_KEY } from "./model";
import { LINK_TYPES, normalizeTag, type LinkType, type SourceKind } from "./types";
import type { JobContext } from "./jobs";

const EXCERPT_CHARS = 60_000;

const scalar = z.union([z.string(), z.number(), z.boolean()]).transform((v) => String(v));
const ManualResult = z.object({
  assets: z
    .array(
      z.object({
        id: z.coerce.string().optional(),
        tag: z.string().optional(),
        params: z.record(z.string(), scalar.nullable()).nullish(),
        description: z.string().nullish(),
        sections: z
          .array(
            z.object({
              section_no: z.coerce.number().int().positive(),
              link_type: z
                .string()
                .nullish()
                .transform((t): LinkType => (LINK_TYPES as string[]).includes(t ?? "") ? (t as LinkType) : "other"),
            }),
          )
          .nullish()
          .catch(null),
      }),
    )
    .default([]),
});
type ManualResult = z.infer<typeof ManualResult>;

interface SourceRow {
  id: number;
  kind: SourceKind;
  file_name: string;
  file_path: string;
  precomputed_json: string | null;
}

interface AssetRow {
  id: number;
  tag: string;
  name: string;
  type: string;
}

function snake(k: string) {
  return k
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/** Applies every ingested enrichment source to the site model. Returns a toast message. */
export async function runEnrichment(siteId: number, ctx: JobContext): Promise<string> {
  const db = raw();
  const assets = db.prepare(`SELECT id, tag, name, type FROM assets WHERE site_id = ?`).all(siteId) as AssetRow[];
  if (assets.length === 0) throw new UserFacingError("Build the site model from a diagram first.");
  const sources = db
    .prepare(
      `SELECT id, kind, file_name, file_path, precomputed_json FROM sources
       WHERE site_id = ? AND kind != 'pfd' AND status = 'ingested' ORDER BY created_at, id`,
    )
    .all(siteId) as SourceRow[];
  if (sources.length === 0) throw new UserFacingError("Nothing new to apply. Upload an asset database, manual or telemetry first.");

  const runId =
    (db.prepare(`SELECT COALESCE(MAX(last_run_id), 0) AS m FROM sites`).get() as { m: number }).m + 1 + Math.floor(Math.random() * 1000);
  db.prepare(`UPDATE sites SET last_run_id = ? WHERE id = ?`).run(runId, siteId);

  const byTag = new Map(assets.filter((a) => normalizeTag(a.tag)).map((a) => [normalizeTag(a.tag), a]));
  const markStatus = db.prepare(`UPDATE sources SET status = ?, summary = COALESCE(?, summary) WHERE id = ?`);
  let paramCount = 0;
  let links = 0;
  const touched = new Set<number>();
  let applied = 0;
  const warnings: string[] = [];
  const warn = (m: string) => {
    warnings.push(m);
    ctx.warn(m);
  };

  for (const src of sources) {
    if (src.kind === "assetdb" || src.kind === "telemetry") {
      ctx.step(`Applying ${src.file_name}`);
      const rows = db.prepare(`SELECT tag_norm, data_json FROM staged_rows WHERE source_id = ?`).all(src.id) as {
        tag_norm: string;
        data_json: string;
      }[];
      let matched = 0;
      db.transaction(() => {
        for (const r of rows) {
          const a = byTag.get(r.tag_norm);
          if (!a) continue;
          matched++;
          for (const [k, v] of Object.entries(JSON.parse(r.data_json) as Record<string, string>)) {
            setParam(a.id, k, v, src.id, runId);
            paramCount++;
            touched.add(a.id);
          }
        }
      })();
      markStatus.run("applied", null, src.id);
      applied++;
      if (matched < rows.length) warn(`${src.file_name}: ${rows.length - matched} row(s) did not match any asset tag.`);
      continue;
    }

    // O&M manual
    ctx.step(`Reading ${src.file_name}`);
    let result: ManualResult;
    if (src.precomputed_json) {
      result = ManualResult.parse(JSON.parse(src.precomputed_json));
    } else if (!hasApiKey()) {
      warn(`${src.file_name} was not applied. ${NO_KEY_MESSAGE}`);
      continue;
    } else {
      try {
        result = await enrichFromManual(src, assets, ctx);
      } catch (err) {
        warn(`${src.file_name}: ${toUserMessage(err)}`);
        markStatus.run("failed", null, src.id);
        continue;
      }
    }
    const idSet = new Map(assets.map((a) => [String(a.id), a]));
    const chunkBySection = new Map(
      (db.prepare(`SELECT id, section_no FROM kb_chunks WHERE source_id = ?`).all(src.id) as { id: number; section_no: number }[]).map((c) => [
        c.section_no,
        c.id,
      ]),
    );
    const linkStmt = db.prepare(
      `INSERT OR IGNORE INTO asset_doc_links (asset_id, chunk_id, link_type, created_by, status) VALUES (?, ?, ?, 'model', 'unreviewed')`,
    );
    db.transaction(() => {
      for (const entry of result.assets) {
        const a = (entry.id && idSet.get(entry.id)) || (entry.tag ? byTag.get(normalizeTag(entry.tag)) : undefined);
        if (!a) continue;
        for (const [k, v] of Object.entries(entry.params ?? {})) {
          if (v == null || !String(v).trim()) continue;
          const key = snake(k);
          if (!key || key === "tag") continue;
          setParam(a.id, key, String(v).trim(), src.id, runId);
          paramCount++;
          touched.add(a.id);
        }
        if (entry.description && entry.description.trim()) setParam(a.id, DESCRIPTION_KEY, entry.description.trim(), src.id, runId);
        for (const sec of entry.sections ?? []) {
          const chunk = chunkBySection.get(sec.section_no);
          if (chunk) links += linkStmt.run(a.id, chunk, sec.link_type).changes;
        }
      }
    })();
    markStatus.run("applied", null, src.id);
    applied++;
  }

  ctx.step("Updating enrichment status");
  recomputeAssets(siteId);
  touchSite(siteId);
  if (applied === 0) throw new UserFacingError(warnings.at(-1) ?? "No sources could be applied.");
  const linkNote = links ? `, ${links} document links` : "";
  return `Enrichment complete: ${paramCount} parameters on ${touched.size} assets from ${applied} source${applied === 1 ? "" : "s"}${linkNote}.`;
}

async function enrichFromManual(src: SourceRow, assets: AssetRow[], ctx: JobContext): Promise<ManualResult> {
  // The manual was chunked and indexed at upload; send those sections so the model can cite them by number.
  const chunks = raw()
    .prepare(`SELECT section_no, page, text FROM kb_chunks WHERE source_id = ? ORDER BY section_no`)
    .all(src.id) as { section_no: number; page: number; text: string }[];
  if (chunks.length === 0) throw new UserFacingError("This manual has no indexed text.");
  // Group sections into excerpts that fit comfortably in context.
  const excerpts: string[] = [];
  let cur = "";
  chunks.forEach((c) => {
    const block = `[Section ${c.section_no} | page ${c.page}]\n${c.text}\n\n`;
    if (cur && cur.length + block.length > EXCERPT_CHARS) {
      excerpts.push(cur);
      cur = "";
    }
    cur += block.length > EXCERPT_CHARS ? block.slice(0, EXCERPT_CHARS) : block;
  });
  if (cur.trim()) excerpts.push(cur);

  const assetJson = JSON.stringify(assets.map((a) => ({ id: String(a.id), tag: a.tag, name: a.name, type: a.type })));
  const merged = new Map<string, { params: Record<string, string>; description: string; sections: Map<number, LinkType> }>();
  for (let i = 0; i < excerpts.length; i++) {
    ctx.step(`Reading ${src.file_name} (part ${i + 1} of ${excerpts.length})`);
    const prompt = `You are enriching a site model from an O&M manual. Assets: ${assetJson}. From the manual excerpt below, extract operating and design parameters for these assets. Match by tag first, then by clear name. Return ONLY JSON: {"assets":[{"id":"...","params":{"snake_case_key":"value with units"},"description":"better one-sentence description if the manual gives one, else empty","sections":[{"section_no":12,"link_type":"operating"}]}]}. Include only values stated in the excerpt. In "sections", list the section numbers (from the [Section N] markers) that describe each asset, with link_type one of operating, maintenance, design_data or other. Only list sections that actually discuss the asset.\n\n<manual_excerpt>\n${excerpts[i]}\n</manual_excerpt>`;
    const r = await callJson({ model: MODEL_MAIN, content: [{ type: "text", text: prompt }], schema: ManualResult });
    for (const a of r.assets) {
      if (!a.id) continue;
      const m = merged.get(a.id) ?? { params: {}, description: "", sections: new Map<number, LinkType>() };
      for (const sec of a.sections ?? []) if (!m.sections.has(sec.section_no)) m.sections.set(sec.section_no, sec.link_type);
      for (const [k, v] of Object.entries(a.params ?? {})) if (v != null && String(v).trim()) m.params[k] = String(v);
      if (a.description && a.description.trim() && !m.description) m.description = a.description.trim();
      merged.set(a.id, m);
    }
  }
  return {
    assets: [...merged.entries()].map(([id, v]) => ({
      id,
      params: v.params,
      description: v.description,
      sections: [...v.sections.entries()].map(([section_no, link_type]) => ({ section_no, link_type })),
    })),
  };
}
