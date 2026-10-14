import fs from "node:fs";
import path from "node:path";
import { raw, nowIso, UPLOAD_DIR } from "../db";
import { chunkPages, indexChunks, insertSource, stageAssetDb, stageTelemetry } from "../ingest";
import { createSite, recomputeAssets, relayout, setParam, DESCRIPTION_KEY } from "../model";
import {
  ASSET_REGISTER_CSV,
  ASSET_REGISTER_FILE,
  HISTORIAN_CSV,
  HISTORIAN_FILE,
  MANUAL_EXTRACTION,
  MANUAL_FILE_NAME,
  MANUAL_PAGES,
  MANUAL_TITLE,
  SAMPLE_ASSETS,
  SAMPLE_EDGES,
  SAMPLE_LOCATION,
  SAMPLE_SITE_NAME,
} from "./data";

const DIAGRAM_FILE = "SAMPLE_Bus1A_one_line.json";

/**
 * Creates the fictional sample site: the diagram-derived model is applied,
 * while the manual, asset register and historian export are ingested but not yet applied.
 * Needs no API key.
 */
export function seedSampleSite(): number {
  const siteId = createSite(SAMPLE_SITE_NAME, SAMPLE_LOCATION);
  const dir = path.join(UPLOAD_DIR, String(siteId));
  fs.mkdirSync(dir, { recursive: true });
  const write = (name: string, body: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, body);
    return p;
  };
  const db = raw();

  db.transaction(() => {
    // 1. The one-line diagram (pre-extracted, so no model call is needed).
    const diagramPath = write(DIAGRAM_FILE, JSON.stringify({ note: "Fictional sample one-line", assets: SAMPLE_ASSETS, edges: SAMPLE_EDGES }, null, 2));
    const pfdId = insertSource(
      siteId,
      "pfd",
      DIAGRAM_FILE,
      diagramPath,
      "applied",
      `Fictional Bus 1A electrical one-line (pre-extracted sample). ${SAMPLE_ASSETS.length} assets, ${SAMPLE_EDGES.length} connections.`,
    );
    const ins = db.prepare(`INSERT INTO assets (site_id, ext_id, name, tag, type, description, params_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`);
    const ids = new Map<string, number>();
    SAMPLE_ASSETS.forEach((a, i) => {
      const id = Number(ins.run(siteId, `N${i + 1}`, a.name, a.tag, a.type, a.description).lastInsertRowid);
      ids.set(a.tag, id);
      setParam(id, DESCRIPTION_KEY, a.description, pfdId, null);
      for (const [k, v] of Object.entries(a.params ?? {})) setParam(id, k, v, pfdId, null);
    });
    const insE = db.prepare(`INSERT INTO edges (site_id, from_asset, to_asset, label) VALUES (?, ?, ?, ?)`);
    for (const [f, t, label] of SAMPLE_EDGES) insE.run(siteId, ids.get(f)!, ids.get(t)!, label);
    db.prepare(`UPDATE sites SET status = 'active', updated_at = ? WHERE id = ?`).run(nowIso(), siteId);

    // 2. O&M manual: indexed into the knowledge base now, applied to assets when enrichment runs.
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

    // 3. Asset register CSV and historian export: staged, not applied.
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
