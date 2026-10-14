import "server-only";
import { z } from "zod";
import { raw, nowIso } from "./db";
import { UserFacingError } from "./ai";
import { refreshDiscrepancies } from "./extract";
import { recomputeAssets, relayout, setParam, smeSourceId, touchSite, DESCRIPTION_KEY } from "./model";
import {
  ASSET_TYPES,
  FLAG_THRESHOLD,
  normalizeTag,
  type BBox,
  type ReviewItemDTO,
  type ReviewMode,
  type ReviewState,
  type ReviewTargetType,
} from "./types";

interface AppRow {
  id: number;
  asset_id: number;
  bbox: string | null;
  confidence: number | null;
  extracted_json: string;
  tag: string;
  name: string;
  type: string;
  description: string;
  safety_related: number;
}

interface EdgeRow {
  id: number;
  from_asset: number;
  to_asset: number;
  label: string;
  confidence: number | null;
  via: string;
}

interface ItemRow {
  target_type: ReviewTargetType;
  target_id: number;
  attr_key: string;
  state: ReviewState;
  before_json: string | null;
  after_json: string | null;
  comment: string | null;
  reviewer: string | null;
  flagged: number;
  reviewed_at: string;
}

const keyOf = (t: ReviewTargetType, id: number, attr = "") => `${t}:${id}:${attr}`;
const isFlagged = (c: number | null) => c != null && c < FLAG_THRESHOLD;

/** Every extracted component, attribute and connection for one drawing, with its review state. */
export function buildReviewItems(siteId: number, drawingId: number, mode: ReviewMode): ReviewItemDTO[] {
  const db = raw();
  const apps = db
    .prepare(
      `SELECT ap.id, ap.asset_id, ap.bbox, ap.confidence, ap.extracted_json, a.tag, a.name, a.type, a.description, a.safety_related
       FROM asset_appearances ap JOIN assets a ON a.id = ap.asset_id
       WHERE ap.drawing_id = ? AND a.site_id = ? ORDER BY ap.id`,
    )
    .all(drawingId, siteId) as AppRow[];
  const edges = db
    .prepare(`SELECT id, from_asset, to_asset, label, confidence, via FROM edges WHERE drawing_id = ? AND site_id = ? ORDER BY id`)
    .all(drawingId, siteId) as EdgeRow[];
  const reviews = new Map(
    (db.prepare(`SELECT * FROM review_items WHERE drawing_id = ?`).all(drawingId) as ItemRow[]).map((r) => [
      keyOf(r.target_type, r.target_id, r.attr_key),
      r,
    ]),
  );
  const assetInfo = new Map(
    (db.prepare(`SELECT id, tag, name, safety_related FROM assets WHERE site_id = ?`).all(siteId) as {
      id: number;
      tag: string;
      name: string;
      safety_related: number;
    }[]).map((a) => [a.id, a]),
  );
  const tagOf = (id: number) => assetInfo.get(id)?.tag || assetInfo.get(id)?.name || `#${id}`;
  const drawingSource =
    (db.prepare(`SELECT source_id FROM drawings WHERE id = ?`).get(drawingId) as { source_id: number | null } | undefined)?.source_id ?? -1;
  const smeSource = (db.prepare(`SELECT id FROM sources WHERE site_id = ? AND kind = 'sme'`).get(siteId) as { id: number } | undefined)?.id ?? -1;
  const ownValues = db.prepare(`SELECT key, value, source_id FROM asset_param_sources WHERE asset_id = ? AND source_id IN (?, ?)`);

  const items: ReviewItemDTO[] = [];
  const push = (
    base: Omit<ReviewItemDTO, "state" | "comment" | "reviewer" | "reviewedAt" | "before" | "after" | "required" | "live" | "key">,
  ) => {
    const key = keyOf(base.targetType, base.targetId, base.attrKey);
    const r = reviews.get(key);
    reviews.delete(key);
    items.push({
      ...base,
      key,
      live: true,
      required: mode === "full" || base.flagged || base.safetyRelated,
      state: r?.state ?? "unreviewed",
      comment: r?.comment ?? null,
      reviewer: r?.reviewer ?? null,
      reviewedAt: r?.reviewed_at ?? null,
      before: r?.before_json ? JSON.parse(r.before_json) : null,
      after: r?.after_json ? JSON.parse(r.after_json) : null,
    });
  };

  for (const ap of apps) {
    const bbox = ap.bbox ? (JSON.parse(ap.bbox) as BBox) : null;
    const flagged = isFlagged(ap.confidence);
    const safety = Boolean(ap.safety_related);
    const label = `${ap.tag || "(no tag)"} · ${ap.name}`;
    push({
      targetType: "component",
      targetId: ap.id,
      attrKey: "",
      drawingId,
      assetId: ap.asset_id,
      label,
      current: { tag: ap.tag, name: ap.name, type: ap.type, description: ap.description },
      bbox,
      confidence: ap.confidence,
      flagged,
      safetyRelated: safety,
    });
    const extracted = JSON.parse(ap.extracted_json || "{}") as { params?: Record<string, string> };
    const own = ownValues.all(ap.asset_id, drawingSource, smeSource) as { key: string; value: string; source_id: number }[];
    const valueOf = (k: string, read: string) =>
      own.find((o) => o.key === k && o.source_id === smeSource)?.value ?? own.find((o) => o.key === k)?.value ?? read;
    for (const [k, v] of Object.entries(extracted.params ?? {})) {
      push({
        targetType: "attribute",
        targetId: ap.id,
        attrKey: k,
        drawingId,
        assetId: ap.asset_id,
        label: `${ap.tag || ap.name} · ${k}`,
        current: { key: k, read: v, value: valueOf(k, v) },
        bbox,
        confidence: ap.confidence,
        flagged,
        safetyRelated: safety,
      });
    }
  }
  for (const e of edges) {
    const safety = Boolean(assetInfo.get(e.from_asset)?.safety_related || assetInfo.get(e.to_asset)?.safety_related);
    push({
      targetType: "connection",
      targetId: e.id,
      attrKey: "",
      drawingId,
      assetId: null,
      label: `${tagOf(e.from_asset)} → ${tagOf(e.to_asset)}`,
      current: { from: tagOf(e.from_asset), to: tagOf(e.to_asset), label: e.label },
      bbox: null,
      confidence: e.confidence,
      flagged: isFlagged(e.confidence),
      safetyRelated: safety,
    });
  }
  // Rejected items are gone from the graph, but their review records stay visible.
  for (const r of reviews.values()) {
    const before = r.before_json ? (JSON.parse(r.before_json) as Record<string, string>) : {};
    items.push({
      key: keyOf(r.target_type, r.target_id, r.attr_key),
      targetType: r.target_type,
      targetId: r.target_id,
      attrKey: r.attr_key,
      drawingId,
      assetId: null,
      label: before.__label ?? `${r.target_type} ${r.target_id}`,
      current: before,
      bbox: before.__bbox ? (JSON.parse(before.__bbox) as BBox) : null,
      confidence: null,
      flagged: Boolean(r.flagged),
      safetyRelated: false,
      required: mode === "full" || Boolean(r.flagged),
      live: false,
      state: r.state,
      comment: r.comment,
      reviewer: r.reviewer,
      reviewedAt: r.reviewed_at,
      before,
      after: r.after_json ? JSON.parse(r.after_json) : null,
    });
  }
  const typeOrder: Record<ReviewTargetType, number> = { component: 0, attribute: 1, connection: 2 };
  return items.sort(
    (a, b) =>
      Number(b.flagged) - Number(a.flagged) ||
      Number(b.live) - Number(a.live) ||
      typeOrder[a.targetType] - typeOrder[b.targetType] ||
      a.label.localeCompare(b.label),
  );
}

export function reviewProgress(items: ReviewItemDTO[]): { required: number; reviewed: number } {
  const req = items.filter((i) => i.required);
  return { required: req.length, reviewed: req.filter((i) => i.state !== "unreviewed").length };
}

export function siteReviewMode(siteId: number): ReviewMode {
  const r = raw().prepare(`SELECT review_mode FROM sites WHERE id = ?`).get(siteId) as { review_mode: ReviewMode } | undefined;
  return r?.review_mode ?? "full";
}

// ---------- Actions ----------

export const ReviewActionSchema = z.object({
  drawingId: z.number().int().positive(),
  targetType: z.enum(["component", "attribute", "connection"]),
  targetId: z.number().int().positive(),
  attrKey: z.string().default(""),
  action: z.enum(["accept", "correct", "reject", "ambiguous"]),
  after: z.record(z.string(), z.string()).optional(),
  comment: z.string().trim().max(2000).optional(),
  reviewer: z.string().trim().max(120).optional(),
});
export type ReviewAction = z.infer<typeof ReviewActionSchema>;

const STATE: Record<ReviewAction["action"], ReviewState> = {
  accept: "accepted",
  correct: "corrected",
  reject: "rejected",
  ambiguous: "ambiguous",
};

/** Records a review decision and writes corrections or rejections back to the asset model. */
export function applyReview(siteId: number, a: ReviewAction): void {
  const db = raw();
  const items = buildReviewItems(siteId, a.drawingId, siteReviewMode(siteId));
  const item = items.find((i) => i.key === keyOf(a.targetType, a.targetId, a.attrKey));
  if (!item) throw new UserFacingError("That item is no longer on this drawing.");
  if (!item.live) throw new UserFacingError("This item was rejected and removed from the model.");
  if (a.action === "ambiguous" && !a.comment) throw new UserFacingError("Add a comment explaining what needs adjudication.");
  const before: Record<string, string> = {
    ...item.current,
    __label: item.label,
    ...(item.bbox ? { __bbox: JSON.stringify(item.bbox) } : {}),
  };
  let after: Record<string, string> | null = null;
  const drawingSource = (db.prepare(`SELECT source_id FROM drawings WHERE id = ?`).get(a.drawingId) as { source_id: number | null })
    .source_id;

  db.transaction(() => {
    if (a.action === "correct") {
      if (!a.after) throw new UserFacingError("Nothing was changed.");
      after = correct(siteId, item, a.after);
    } else if (a.action === "reject") {
      reject(siteId, item, drawingSource);
    }
    db.prepare(
      `INSERT INTO review_items (site_id, target_type, target_id, attr_key, drawing_id, state, before_json, after_json, comment, reviewer, flagged, reviewed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(target_type, target_id, attr_key, drawing_id) DO UPDATE SET
         state = excluded.state, after_json = excluded.after_json, comment = excluded.comment,
         reviewer = excluded.reviewer, reviewed_at = excluded.reviewed_at`,
    ).run(
      siteId,
      a.targetType,
      a.targetId,
      a.attrKey,
      a.drawingId,
      STATE[a.action],
      JSON.stringify(before),
      after ? JSON.stringify(after) : null,
      a.comment || null,
      a.reviewer || null,
      item.flagged ? 1 : 0,
      nowIso(),
    );
  })();
  recomputeAssets(siteId);
  if (a.action === "reject") relayout(siteId);
  touchSite(siteId);
}

function correct(siteId: number, item: ReviewItemDTO, input: Record<string, string>): Record<string, string> {
  const db = raw();
  const after: Record<string, string> = {};
  if (item.targetType === "component" && item.assetId) {
    const name = input.name?.trim();
    const type = input.type?.trim();
    const desc = input.description?.trim();
    if (name && name !== item.current.name) {
      db.prepare(`UPDATE assets SET name = ? WHERE id = ?`).run(name, item.assetId);
      after.name = name;
    }
    if (type && type !== item.current.type) {
      if (!(ASSET_TYPES as readonly string[]).includes(type)) throw new UserFacingError("Unknown asset type.");
      db.prepare(`UPDATE assets SET type = ? WHERE id = ?`).run(type, item.assetId);
      after.type = type;
    }
    if (desc !== undefined && desc !== item.current.description) {
      setParam(item.assetId, DESCRIPTION_KEY, desc, smeSourceId(siteId), null);
      after.description = desc;
    }
  } else if (item.targetType === "attribute" && item.assetId) {
    const value = input.value?.trim();
    if (!value) throw new UserFacingError("Enter the corrected value.");
    if (value !== item.current.value) {
      setParam(item.assetId, item.attrKey, value, smeSourceId(siteId), null);
      after.value = value;
    }
  } else if (item.targetType === "connection") {
    const label = input.label?.trim() ?? "";
    if (label !== item.current.label) {
      db.prepare(`UPDATE edges SET label = ? WHERE id = ?`).run(label, item.targetId);
      after.label = label;
    }
  }
  if (Object.keys(after).length === 0) throw new UserFacingError("Nothing was changed. Use Accept if the item is right.");
  return after;
}

function reject(siteId: number, item: ReviewItemDTO, drawingSource: number | null) {
  const db = raw();
  if (item.targetType === "component" && item.assetId) {
    const assetId = item.assetId;
    db.prepare(`DELETE FROM edges WHERE drawing_id = ? AND (from_asset = ? OR to_asset = ?)`).run(item.drawingId, assetId, assetId);
    db.prepare(`DELETE FROM asset_appearances WHERE id = ?`).run(item.targetId);
    if (drawingSource) db.prepare(`DELETE FROM asset_param_sources WHERE asset_id = ? AND source_id = ?`).run(assetId, drawingSource);
    const left = (db.prepare(`SELECT COUNT(*) AS n FROM asset_appearances WHERE asset_id = ?`).get(assetId) as { n: number }).n;
    if (left === 0) db.prepare(`DELETE FROM assets WHERE id = ?`).run(assetId);
    else refreshDiscrepancies(siteId, [assetId]);
  } else if (item.targetType === "attribute" && item.assetId) {
    if (drawingSource)
      db.prepare(`DELETE FROM asset_param_sources WHERE asset_id = ? AND key = ? AND source_id = ?`).run(item.assetId, item.attrKey, drawingSource);
    refreshDiscrepancies(siteId, [item.assetId]);
  } else if (item.targetType === "connection") {
    db.prepare(`DELETE FROM edges WHERE id = ?`).run(item.targetId);
  }
}

// ---------- Add missing ----------

export const AddMissingSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("component"),
    drawingId: z.number().int().positive(),
    name: z.string().trim().min(1).max(200),
    tag: z.string().trim().max(80).default(""),
    type: z.enum(ASSET_TYPES),
    description: z.string().trim().max(500).default(""),
    reviewer: z.string().trim().max(120).optional(),
  }),
  z.object({
    kind: z.literal("connection"),
    drawingId: z.number().int().positive(),
    fromTag: z.string().trim().min(1),
    toTag: z.string().trim().min(1),
    label: z.string().trim().max(120).default(""),
    reviewer: z.string().trim().max(120).optional(),
  }),
]);
export type AddMissing = z.infer<typeof AddMissingSchema>;

/** Adds a component or connection the extraction missed. Each one counts as a miss in recall. */
export function addMissing(siteId: number, m: AddMissing): void {
  const db = raw();
  const drawing = db.prepare(`SELECT id, drawing_type FROM drawings WHERE id = ? AND site_id = ?`).get(m.drawingId, siteId) as
    | { id: number; drawing_type: string }
    | undefined;
  if (!drawing) throw new UserFacingError("Drawing not found.");
  const assets = db.prepare(`SELECT id, tag FROM assets WHERE site_id = ?`).all(siteId) as { id: number; tag: string }[];
  const byTag = (t: string) => assets.find((a) => normalizeTag(a.tag) && normalizeTag(a.tag) === normalizeTag(t))?.id;
  db.transaction(() => {
    let targetType: ReviewTargetType;
    let targetId: number;
    let snapshot: Record<string, string>;
    if (m.kind === "component") {
      let assetId = m.tag ? byTag(m.tag) : undefined;
      if (!assetId) {
        assetId = Number(
          db
            .prepare(`INSERT INTO assets (site_id, ext_id, name, tag, type, description, params_json) VALUES (?, ?, ?, ?, ?, ?, '{}')`)
            .run(siteId, `SME-${Date.now()}`, m.name, m.tag, m.type, m.description).lastInsertRowid,
        );
      }
      const exists = db.prepare(`SELECT 1 FROM asset_appearances WHERE asset_id = ? AND drawing_id = ?`).get(assetId, m.drawingId);
      if (exists) throw new UserFacingError("That component is already listed on this drawing.");
      targetId = Number(
        db
          .prepare(`INSERT INTO asset_appearances (asset_id, drawing_id, bbox, confidence, extracted_json) VALUES (?, ?, NULL, NULL, ?)`)
          .run(assetId, m.drawingId, JSON.stringify({ added_by: "sme", name: m.name, tag: m.tag, type: m.type, params: {} })).lastInsertRowid,
      );
      if (m.description) setParam(assetId, DESCRIPTION_KEY, m.description, smeSourceId(siteId), null);
      targetType = "component";
      snapshot = { tag: m.tag, name: m.name, type: m.type, description: m.description, __label: `${m.tag || "(no tag)"} · ${m.name}` };
    } else {
      const from = byTag(m.fromTag);
      const to = byTag(m.toTag);
      if (!from || !to) throw new UserFacingError("Both ends must be existing tags at this site.");
      if (from === to) throw new UserFacingError("A connection needs two different assets.");
      if (db.prepare(`SELECT 1 FROM edges WHERE site_id = ? AND from_asset = ? AND to_asset = ?`).get(siteId, from, to))
        throw new UserFacingError("That connection is already in the model.");
      targetId = Number(
        db
          .prepare(`INSERT INTO edges (site_id, from_asset, to_asset, label, drawing_id, kind, confidence, via) VALUES (?, ?, ?, ?, ?, ?, NULL, 'sme')`)
          .run(siteId, from, to, m.label, m.drawingId, drawing.drawing_type === "elementary" ? "control" : "power").lastInsertRowid,
      );
      targetType = "connection";
      snapshot = { from: m.fromTag, to: m.toTag, label: m.label, __label: `${m.fromTag} → ${m.toTag}` };
    }
    db.prepare(
      `INSERT INTO review_items (site_id, target_type, target_id, attr_key, drawing_id, state, before_json, after_json, comment, reviewer, flagged, reviewed_at)
       VALUES (?, ?, ?, '', ?, 'added_missing', NULL, ?, NULL, ?, 0, ?)`,
    ).run(siteId, targetType, targetId, m.drawingId, JSON.stringify(snapshot), m.reviewer || null, nowIso());
  })();
  recomputeAssets(siteId);
  relayout(siteId);
  touchSite(siteId);
}

// ---------- Sessions ----------

export function startSession(siteId: number, drawingId: number, reviewer: string | null): number {
  const db = raw();
  if (!db.prepare(`SELECT 1 FROM drawings WHERE id = ? AND site_id = ?`).get(drawingId, siteId)) throw new UserFacingError("Drawing not found.");
  return Number(
    db
      .prepare(`INSERT INTO review_sessions (site_id, drawing_id, reviewer, active_ms, flagged_ms, started_at) VALUES (?, ?, ?, 0, 0, ?)`)
      .run(siteId, drawingId, reviewer, nowIso()).lastInsertRowid,
  );
}

/** Stores the client's running totals. Totals never decrease and can't exceed wall-clock time since start. */
export function updateSession(siteId: number, sessionId: number, activeMs: number, flaggedMs: number, ended: boolean) {
  const db = raw();
  const s = db.prepare(`SELECT started_at, active_ms, flagged_ms FROM review_sessions WHERE id = ? AND site_id = ?`).get(sessionId, siteId) as
    | { started_at: string; active_ms: number; flagged_ms: number }
    | undefined;
  if (!s) throw new UserFacingError("Review session not found.");
  const wall = Date.now() - Date.parse(s.started_at) + 5000;
  const active = Math.min(wall, Math.max(s.active_ms, Math.round(activeMs)));
  const flagged = Math.min(active, Math.max(s.flagged_ms, Math.round(flaggedMs)));
  db.prepare(`UPDATE review_sessions SET active_ms = ?, flagged_ms = ?, ended_at = ? WHERE id = ?`).run(
    active,
    flagged,
    ended ? nowIso() : null,
    sessionId,
  );
}
