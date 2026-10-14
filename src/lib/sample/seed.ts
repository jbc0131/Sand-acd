import fs from "node:fs";
import path from "node:path";
import { raw, UPLOAD_DIR } from "../db";
import { chunkPages, indexChunks, insertSource, stageAssetDb, stageTelemetry } from "../ingest";
import { createSite, recomputeAssets, relayout } from "../model";
import { saveDrawing, type Diagram } from "../extract";
import { insertDrawing, setDrawingImage } from "../drawings";
import { renderFirstPagePng } from "../render";
import { normalizeTag } from "../types";
import {
  ASSET_REGISTER_CSV,
  ASSET_REGISTER_FILE,
  HISTORIAN_CSV,
  HISTORIAN_FILE,
  MANUAL_EXTRACTION,
  MANUAL_FILE_NAME,
  MANUAL_PAGES,
  MANUAL_TITLE,
  SAFETY_RELATED_TAGS,
  SAMPLE_DOC_LINKS,
  SAMPLE_LOCATION,
  SAMPLE_SITE_NAME,
} from "./data";
import { SAMPLE_SHEETS, sheetAsset, sheetBBox, sheetImageName, type SampleSheet } from "./drawings";

const SAMPLE_DIR = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "sample-data");

/** The extraction result the model would return for one sample sheet. */
export function sheetDiagram(sheet: SampleSheet): Diagram {
  return {
    drawing_type: sheet.drawingType,
    title_block: { ...sheet.titleBlock },
    status: sheet.status,
    partial_reason: sheet.partialReason ?? "",
    resolved_pct: sheet.resolvedPct,
    nodes: sheet.nodes.map((n) => {
      const a = sheetAsset(n.tag);
      return {
        id: n.tag,
        name: n.name ?? a.name,
        tag: n.tag,
        type: a.type,
        description: a.description,
        params: { ...(n.params ?? {}) },
        confidence: n.confidence,
        bbox: sheetBBox(n),
      };
    }),
    edges: sheet.edges.map((e) => ({ from: e.from, to: e.to, label: e.label, confidence: e.confidence })),
    off_page_connectors: sheet.connectors.map((c) => ({
      label: c.label,
      direction: c.direction,
      target_drawing_number: c.targetDrawingNumber,
      target_tag: c.targetTag,
      at_node_id: c.atTag,
    })),
  };
}

/**
 * Creates the fictional sample site with no API key:
 * - three drawings, saved through the same merge path as live uploads (applied),
 * - the O&M manual indexed for the Copilot, with component-to-section links,
 * - the manual extraction, asset register and historian export ingested but not yet applied.
 * No review records are seeded.
 */
export async function seedSampleSite(): Promise<number> {
  const siteId = createSite(SAMPLE_SITE_NAME, SAMPLE_LOCATION);
  const dir = path.join(UPLOAD_DIR, String(siteId));
  fs.mkdirSync(dir, { recursive: true });
  const write = (name: string, body: string | Buffer) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const db = raw();

  // 1. Drawings, in sheet order so off-page connectors resolve as each sheet lands.
  for (const sheet of SAMPLE_SHEETS) {
    const pdf = fs.readFileSync(path.join(SAMPLE_DIR, sheet.fileName));
    const pdfPath = write(sheet.fileName, pdf);
    const sourceId = insertSource(siteId, "pfd", sheet.fileName, pdfPath, "ingested", null);
    const drawingId = insertDrawing(siteId, sourceId, sheet.fileName, "processing");
    const pngSrc = path.join(SAMPLE_DIR, sheetImageName(sheet));
    const png = fs.existsSync(pngSrc) ? fs.readFileSync(pngSrc) : await renderFirstPagePng(new Uint8Array(pdf));
    setDrawingImage(drawingId, write(sheetImageName(sheet), png));
    const r = saveDrawing(siteId, drawingId, sourceId, sheetDiagram(sheet), {
      ingestMs: sheet.ingestMs,
      tokensIn: sheet.tokensIn,
      tokensOut: sheet.tokensOut,
    });
    const t = sheet.titleBlock;
    db.prepare(`UPDATE sources SET summary = ? WHERE id = ?`).run(
      `${t.drawing_number} rev ${t.revision}: ${t.title} (fictional, pre-extracted). ${r.assets} components, ${r.edges} connections${
        sheet.status === "partial" ? `; partial read (${sheet.partialReason}, ${sheet.resolvedPct}% resolved)` : ""
      }.`,
      sourceId,
    );
  }

  const assets = db.prepare(`SELECT id, tag FROM assets WHERE site_id = ?`).all(siteId) as { id: number; tag: string }[];
  const idOf = (tag: string) => assets.find((a) => normalizeTag(a.tag) === normalizeTag(tag))?.id;

  db.transaction(() => {
    // 2. Safety-related equipment always gets full review.
    const safety = db.prepare(`UPDATE assets SET safety_related = 1 WHERE id = ?`);
    for (const tag of SAFETY_RELATED_TAGS) {
      const id = idOf(tag);
      if (id) safety.run(id);
    }

    // 3. O&M manual: indexed now, applied to assets when enrichment runs. Section links seeded now.
    const manualPath = write(MANUAL_FILE_NAME, MANUAL_PAGES.join("\n\f\n"));
    const chunks = chunkPages(MANUAL_PAGES);
    const omId = insertSource(
      siteId,
      "om",
      MANUAL_FILE_NAME,
      manualPath,
      "ingested",
      `${MANUAL_TITLE}. ${MANUAL_PAGES.length} pages, ${chunks.length} indexed sections covering equipment data, normal lineup, loss of offsite power, restoring offsite power, EDG surveillance, breaker racking, RHR pump start, MOV stroke test and preventive maintenance.`,
      JSON.stringify(MANUAL_EXTRACTION),
    );
    indexChunks(siteId, omId, chunks);
    const chunkOnPage = db.prepare(`SELECT id FROM kb_chunks WHERE source_id = ? AND page = ? ORDER BY section_no LIMIT 1`);
    const link = db.prepare(
      `INSERT OR IGNORE INTO asset_doc_links (asset_id, chunk_id, link_type, created_by, status) VALUES (?, ?, ?, 'model', 'unreviewed')`,
    );
    for (const l of SAMPLE_DOC_LINKS) {
      const chunk = chunkOnPage.get(omId, l.page) as { id: number } | undefined;
      if (!chunk) continue;
      for (const tag of l.tags) {
        const id = idOf(tag);
        if (id) link.run(id, chunk.id, l.linkType);
      }
    }

    // 4. Asset register CSV and historian export: staged, not applied.
    const regPath = write(ASSET_REGISTER_FILE, ASSET_REGISTER_CSV);
    const regId = insertSource(siteId, "assetdb", ASSET_REGISTER_FILE, regPath, "ingested", null);
    const reg = stageAssetDb(regId, ASSET_REGISTER_CSV);
    db.prepare(`UPDATE sources SET summary = ? WHERE id = ?`).run(
      `Fictional asset register. ${reg.rows} rows for ${reg.tags} tags; columns: ${reg.columns.join(", ")}.`,
      regId,
    );
    const histPath = write(HISTORIAN_FILE, HISTORIAN_CSV);
    const histId = insertSource(siteId, "telemetry", HISTORIAN_FILE, histPath, "ingested", null);
    const hist = stageTelemetry(histId, HISTORIAN_CSV);
    db.prepare(`UPDATE sources SET summary = ? WHERE id = ?`).run(
      `Fictional historian export. ${hist.rows} readings; latest value kept for ${hist.signals} signals on ${hist.tags} tags.`,
      histId,
    );
  })();

  recomputeAssets(siteId);
  relayout(siteId);
  return siteId;
}
