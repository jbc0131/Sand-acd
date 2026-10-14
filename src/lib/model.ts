import "server-only";
import fs from "node:fs";
import path from "node:path";
import { raw, nowIso, UPLOAD_DIR } from "./db";
import { hasApiKey } from "./ai";
import { layoutLR } from "./layout";
import {
  ENRICHMENT_KINDS,
  type AssetDTO,
  type AssetType,
  type EdgeDTO,
  type EnrichmentStatus,
  type ParamDTO,
  type SiteModel,
  type SiteSummary,
  type SourceDTO,
  type SourceKind,
} from "./types";

// Provenance keys that are not shown as parameters.
export const DESCRIPTION_KEY = "_description";

interface SiteRow {
  id: number;
  name: string;
  location: string | null;
  status: "in_planning" | "active";
  last_run_id: number | null;
  created_at: string;
  updated_at: string;
}

export function listSites(): SiteSummary[] {
  const rows = raw()
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id) AS asset_count,
        (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id AND a.enrichment_status = 'enriched') AS enriched_count
       FROM sites s ORDER BY s.created_at DESC, s.id DESC`,
    )
    .all() as (SiteRow & { asset_count: number; enriched_count: number })[];
  return rows.map(toSummary);
}

function toSummary(r: SiteRow & { asset_count: number; enriched_count: number }): SiteSummary {
  return {
    id: r.id,
    name: r.name,
    location: r.location,
    status: r.status,
    assetCount: r.asset_count,
    enrichedCount: r.enriched_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function getSiteSummary(siteId: number): SiteSummary | null {
  const r = raw()
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id) AS asset_count,
        (SELECT COUNT(*) FROM assets a WHERE a.site_id = s.id AND a.enrichment_status = 'enriched') AS enriched_count
       FROM sites s WHERE s.id = ?`,
    )
    .get(siteId) as (SiteRow & { asset_count: number; enriched_count: number }) | undefined;
  return r ? toSummary(r) : null;
}

export function createSite(name: string, location: string | null): number {
  const now = nowIso();
  const info = raw()
    .prepare(`INSERT INTO sites (name, location, status, created_at, updated_at) VALUES (?, ?, 'in_planning', ?, ?)`)
    .run(name, location, now, now);
  return Number(info.lastInsertRowid);
}

export function touchSite(siteId: number) {
  raw().prepare(`UPDATE sites SET updated_at = ? WHERE id = ?`).run(nowIso(), siteId);
}

export function listSources(siteId: number): SourceDTO[] {
  const rows = raw()
    .prepare(`SELECT * FROM sources WHERE site_id = ? ORDER BY created_at, id`)
    .all(siteId) as {
    id: number;
    kind: SourceKind;
    file_name: string;
    status: SourceDTO["status"];
    summary: string | null;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    fileName: r.file_name,
    status: r.status,
    summary: r.summary,
    createdAt: r.created_at,
  }));
}

export function getSiteModel(siteId: number): SiteModel | null {
  const site = getSiteSummary(siteId);
  if (!site) return null;
  const db = raw();
  const lastRun = (db.prepare(`SELECT last_run_id FROM sites WHERE id = ?`).get(siteId) as { last_run_id: number | null })
    .last_run_id;
  const assetRows = db.prepare(`SELECT * FROM assets WHERE site_id = ? ORDER BY id`).all(siteId) as {
    id: number;
    ext_id: string;
    name: string;
    tag: string;
    type: string;
    description: string;
    params_json: string;
    enrichment_status: EnrichmentStatus;
    x: number;
    y: number;
  }[];
  const prov = db
    .prepare(
      `SELECT aps.asset_id, aps.key, aps.value, aps.source_id, aps.run_id, s.kind, s.file_name
       FROM asset_param_sources aps JOIN sources s ON s.id = aps.source_id
       JOIN assets a ON a.id = aps.asset_id
       WHERE a.site_id = ? ORDER BY s.created_at, s.id`,
    )
    .all(siteId) as {
    asset_id: number;
    key: string;
    value: string;
    source_id: number;
    run_id: number | null;
    kind: SourceKind;
    file_name: string;
  }[];
  const provByAsset = new Map<number, ParamDTO[]>();
  for (const p of prov) {
    if (p.key === DESCRIPTION_KEY) continue;
    const list = provByAsset.get(p.asset_id) ?? [];
    list.push({
      key: p.key,
      value: p.value,
      sourceId: p.source_id,
      sourceKind: p.kind,
      fileName: p.file_name,
      fresh: lastRun != null && p.run_id === lastRun,
    });
    provByAsset.set(p.asset_id, list);
  }
  const assets: AssetDTO[] = assetRows.map((a) => ({
    id: a.id,
    extId: a.ext_id,
    name: a.name,
    tag: a.tag,
    type: a.type as AssetType,
    description: a.description,
    params: JSON.parse(a.params_json || "{}"),
    provenance: provByAsset.get(a.id) ?? [],
    enrichmentStatus: a.enrichment_status,
    x: a.x,
    y: a.y,
  }));
  const edges: EdgeDTO[] = (
    db.prepare(`SELECT id, from_asset, to_asset, label FROM edges WHERE site_id = ? ORDER BY id`).all(siteId) as {
      id: number;
      from_asset: number;
      to_asset: number;
      label: string;
    }[]
  ).map((e) => ({ id: e.id, from: e.from_asset, to: e.to_asset, label: e.label }));
  return { site, assets, edges, sources: listSources(siteId), hasApiKey: hasApiKey(), maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 50) };
}

/**
 * Rebuilds params_json, description and enrichment_status for every asset of a site
 * from asset_param_sources. Later sources win when two sources set the same key.
 */
export function recomputeAssets(siteId: number) {
  const db = raw();
  const assets = db.prepare(`SELECT id FROM assets WHERE site_id = ?`).all(siteId) as { id: number }[];
  const provStmt = db.prepare(
    `SELECT aps.key, aps.value, s.kind FROM asset_param_sources aps JOIN sources s ON s.id = aps.source_id
     WHERE aps.asset_id = ? ORDER BY s.created_at, s.id`,
  );
  const upd = db.prepare(`UPDATE assets SET params_json = ?, description = ?, enrichment_status = ? WHERE id = ?`);
  const origDesc = db.prepare(`SELECT description FROM assets WHERE id = ?`);
  const tx = db.transaction(() => {
    for (const a of assets) {
      const rows = provStmt.all(a.id) as { key: string; value: string; kind: SourceKind }[];
      const params: Record<string, string> = {};
      let description: string | null = null;
      const kinds = new Set<SourceKind>();
      for (const r of rows) {
        if (ENRICHMENT_KINDS.includes(r.kind)) kinds.add(r.kind);
        if (r.key === DESCRIPTION_KEY) {
          if (r.value.trim()) description = r.value;
          continue;
        }
        params[r.key] = r.value;
      }
      const nonTagCount = Object.keys(params).filter((k) => k !== "tag").length;
      let status: EnrichmentStatus = "pending";
      if (kinds.size > 0) status = kinds.size >= 2 || nonTagCount >= 6 ? "enriched" : "partial";
      const desc = description ?? (origDesc.get(a.id) as { description: string }).description;
      upd.run(JSON.stringify(params), desc, status, a.id);
    }
  });
  tx();
}

/** Writes one provenance row (upsert) for a parameter. */
export function setParam(assetId: number, key: string, value: string, sourceId: number, runId: number | null) {
  raw()
    .prepare(
      `INSERT INTO asset_param_sources (asset_id, key, value, source_id, run_id) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(asset_id, key, source_id) DO UPDATE SET value = excluded.value, run_id = excluded.run_id`,
    )
    .run(assetId, key, value, sourceId, runId);
}

/** Runs the dagre layout for a site and stores positions. */
export function relayout(siteId: number) {
  const db = raw();
  const nodes = db.prepare(`SELECT id FROM assets WHERE site_id = ?`).all(siteId) as { id: number }[];
  const edges = db.prepare(`SELECT from_asset AS "from", to_asset AS "to" FROM edges WHERE site_id = ?`).all(siteId) as {
    from: number;
    to: number;
  }[];
  const pos = layoutLR(nodes, edges);
  const upd = db.prepare(`UPDATE assets SET x = ?, y = ? WHERE id = ?`);
  db.transaction(() => {
    for (const n of nodes) {
      const p = pos.get(String(n.id))!;
      upd.run(p.x, p.y, n.id);
    }
  })();
}

/** Removes a source and everything it contributed. Removing a diagram wipes the site model. */
export function unlinkSource(siteId: number, sourceId: number): { wipedModel: boolean } {
  const db = raw();
  const src = db.prepare(`SELECT kind FROM sources WHERE id = ? AND site_id = ?`).get(sourceId, siteId) as
    | { kind: SourceKind }
    | undefined;
  if (!src) return { wipedModel: false };
  let wiped = false;
  const files = (
    src.kind === "pfd"
      ? db.prepare(`SELECT file_path FROM sources WHERE site_id = ? AND kind = 'pfd'`).all(siteId)
      : db.prepare(`SELECT file_path FROM sources WHERE id = ?`).all(sourceId)
  ) as { file_path: string }[];
  db.transaction(() => {
    if (src.kind === "pfd") {
      db.prepare(`DELETE FROM edges WHERE site_id = ?`).run(siteId);
      db.prepare(`DELETE FROM assets WHERE site_id = ?`).run(siteId);
      // Every other diagram is part of the same model, so remove them too.
      db.prepare(`DELETE FROM sources WHERE site_id = ? AND kind = 'pfd'`).run(siteId);
      // Enrichment sources stay ingested so they can be re-applied to a new model.
      db.prepare(`UPDATE sources SET status = 'ingested' WHERE site_id = ? AND status = 'applied'`).run(siteId);
      db.prepare(`UPDATE sites SET status = 'in_planning' WHERE id = ?`).run(siteId);
      wiped = true;
    } else {
      db.prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
    }
  })();
  for (const f of files) removeUpload(f.file_path);
  recomputeAssets(siteId);
  touchSite(siteId);
  return { wipedModel: wiped };
}

export function removeUpload(filePath: string) {
  try {
    if (filePath && path.resolve(filePath).startsWith(UPLOAD_DIR)) fs.rmSync(filePath, { force: true });
  } catch {
    // best effort
  }
}
