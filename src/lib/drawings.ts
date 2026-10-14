import "server-only";
import { raw, nowIso } from "./db";
import { buildReviewItems, reviewProgress, siteReviewMode } from "./review";
import type { DrawingDTO, DrawingStatus, DrawingType, OpenConnectorDTO } from "./types";

interface DrawingRow {
  id: number;
  source_id: number | null;
  file_name: string;
  page_image_path: string | null;
  drawing_number: string | null;
  revision: string | null;
  date_drawn: string | null;
  unit: string | null;
  system: string | null;
  title: string | null;
  author: string | null;
  site_label: string | null;
  drawing_type: DrawingType;
  status: DrawingStatus;
  partial_reason: string | null;
  resolved_pct: number | null;
  component_count: number;
  confidence_avg: number | null;
  ingest_ms: number | null;
  tokens_in: number | null;
  tokens_out: number | null;
  created_at: string;
}

export function listDrawings(siteId: number): DrawingDTO[] {
  const db = raw();
  const rows = db
    .prepare(`SELECT * FROM drawings WHERE site_id = ? ORDER BY COALESCE(drawing_number, file_name), id`)
    .all(siteId) as DrawingRow[];
  const mode = siteReviewMode(siteId);
  const connectors = db
    .prepare(
      `SELECT c.id, c.drawing_id, c.label, c.direction, c.target_drawing_number, c.target_tag, c.resolved, a.tag AS at_tag
       FROM off_page_connectors c LEFT JOIN assets a ON a.id = c.at_asset_id WHERE c.site_id = ? ORDER BY c.id`,
    )
    .all(siteId) as {
    id: number;
    drawing_id: number;
    label: string;
    direction: "from" | "to";
    target_drawing_number: string | null;
    target_tag: string | null;
    resolved: number;
    at_tag: string | null;
  }[];
  return rows.map((r) => {
    let progress: number | null = null;
    if (r.status === "parsed" || r.status === "partial") {
      const p = reviewProgress(buildReviewItems(siteId, r.id, mode));
      progress = p.required ? p.reviewed / p.required : null;
    }
    const conns: OpenConnectorDTO[] = connectors
      .filter((c) => c.drawing_id === r.id)
      .map((c) => ({
        id: c.id,
        label: c.label,
        direction: c.direction,
        targetDrawingNumber: c.target_drawing_number,
        targetTag: c.target_tag,
        atTag: c.at_tag,
        resolved: Boolean(c.resolved),
      }));
    return toDTO(r, progress, conns);
  });
}

function toDTO(r: DrawingRow, reviewProgress: number | null, openConnectors: OpenConnectorDTO[]): DrawingDTO {
  return {
    id: r.id,
    sourceId: r.source_id,
    fileName: r.file_name,
    hasImage: Boolean(r.page_image_path),
    drawingNumber: r.drawing_number,
    revision: r.revision,
    dateDrawn: r.date_drawn,
    unit: r.unit,
    system: r.system,
    title: r.title,
    author: r.author,
    siteLabel: r.site_label,
    drawingType: r.drawing_type,
    status: r.status,
    partialReason: r.partial_reason,
    resolvedPct: r.resolved_pct,
    componentCount: r.component_count,
    confidenceAvg: r.confidence_avg,
    ingestMs: r.ingest_ms,
    tokensIn: r.tokens_in,
    tokensOut: r.tokens_out,
    createdAt: r.created_at,
    reviewProgress,
    openConnectors,
  };
}

export function getDrawing(siteId: number, drawingId: number): DrawingDTO | null {
  return listDrawings(siteId).find((d) => d.id === drawingId) ?? null;
}

export function drawingImagePath(siteId: number, drawingId: number): string | null {
  const r = raw().prepare(`SELECT page_image_path FROM drawings WHERE id = ? AND site_id = ?`).get(drawingId, siteId) as
    | { page_image_path: string | null }
    | undefined;
  return r?.page_image_path ?? null;
}

export function insertDrawing(siteId: number, sourceId: number | null, fileName: string, status: DrawingStatus = "queued"): number {
  return Number(
    raw()
      .prepare(`INSERT INTO drawings (site_id, source_id, file_name, status, created_at) VALUES (?, ?, ?, ?, ?)`)
      .run(siteId, sourceId, fileName, status, nowIso()).lastInsertRowid,
  );
}

export function setDrawingStatus(drawingId: number, status: DrawingStatus, reason: string | null = null) {
  raw().prepare(`UPDATE drawings SET status = ?, partial_reason = COALESCE(?, partial_reason) WHERE id = ?`).run(status, reason, drawingId);
}

export function setDrawingImage(drawingId: number, imagePath: string) {
  raw().prepare(`UPDATE drawings SET page_image_path = ? WHERE id = ?`).run(imagePath, drawingId);
}
