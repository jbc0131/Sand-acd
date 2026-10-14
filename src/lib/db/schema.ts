import { sqliteTable, integer, text, real, primaryKey, index, uniqueIndex } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  status: text("status", { enum: ["in_planning", "active"] }).notNull().default("in_planning"),
  /** id of the most recent enrichment run, used to outline fresh chips */
  lastRunId: integer("last_run_id"),
  /** 'full' (default) or 'exception' (flagged and safety-related items only) */
  reviewMode: text("review_mode", { enum: ["full", "exception"] }).notNull().default("full"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const sources = sqliteTable("sources", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["pfd", "om", "assetdb", "telemetry"] }).notNull(),
  fileName: text("file_name").notNull(),
  filePath: text("file_path").notNull(),
  status: text("status", { enum: ["ingested", "applied", "failed"] }).notNull(),
  summary: text("summary"),
  /** Optional pre-computed manual extraction (used by the fictional sample site so it works without an API key). */
  precomputedJson: text("precomputed_json"),
  createdAt: text("created_at").notNull(),
});

export const assets = sqliteTable(
  "assets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    extId: text("ext_id").notNull(),
    name: text("name").notNull(),
    tag: text("tag").notNull().default(""),
    type: text("type").notNull(),
    description: text("description").notNull().default(""),
    paramsJson: text("params_json").notNull().default("{}"),
    enrichmentStatus: text("enrichment_status", { enum: ["pending", "partial", "enriched"] })
      .notNull()
      .default("pending"),
    x: real("x").notNull().default(0),
    y: real("y").notNull().default(0),
    safetyRelated: integer("safety_related", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [index("assets_site_idx").on(t.siteId)],
);

export const assetParamSources = sqliteTable(
  "asset_param_sources",
  {
    assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    runId: integer("run_id"),
  },
  (t) => [primaryKey({ columns: [t.assetId, t.key, t.sourceId] })],
);

export const edges = sqliteTable("edges", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  fromAsset: integer("from_asset").notNull().references(() => assets.id, { onDelete: "cascade" }),
  toAsset: integer("to_asset").notNull().references(() => assets.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  /** drawing the connection was read from (null for SME-added or legacy edges) */
  drawingId: integer("drawing_id").references(() => drawings.id, { onDelete: "set null" }),
  /** 'power' edges carry energy; 'control' edges (elementaries) are excluded from tracing */
  kind: text("kind", { enum: ["power", "control"] }).notNull().default("power"),
  confidence: real("confidence"),
  /** 'drawing', 'connector' (resolved off-page connector) or 'sme' */
  via: text("via").notNull().default("drawing"),
});

export const kbChunks = sqliteTable(
  "kb_chunks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
    page: integer("page").notNull(),
    sectionNo: integer("section_no").notNull(),
    text: text("text").notNull(),
  },
  (t) => [index("kb_site_idx").on(t.siteId)],
);

export const stagedRows = sqliteTable("staged_rows", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
  tagNorm: text("tag_norm").notNull(),
  dataJson: text("data_json").notNull(),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  toolsJson: text("tools_json"),
  highlightJson: text("highlight_json"),
  sourcesJson: text("sources_json"),
  feedback: text("feedback"),
  drawingsJson: text("drawings_json"),
  createdAt: text("created_at").notNull(),
});

export const drawings = sqliteTable("drawings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  sourceId: integer("source_id").references(() => sources.id, { onDelete: "set null" }),
  fileName: text("file_name").notNull(),
  pageImagePath: text("page_image_path"),
  drawingNumber: text("drawing_number"),
  revision: text("revision"),
  dateDrawn: text("date_drawn"),
  unit: text("unit"),
  system: text("system"),
  title: text("title"),
  author: text("author"),
  siteLabel: text("site_label"),
  drawingType: text("drawing_type", {
    enum: ["single_line", "elementary", "pid", "pfd", "isometric", "switchgear_notes", "other"],
  })
    .notNull()
    .default("other"),
  status: text("status", { enum: ["queued", "processing", "parsed", "partial", "failed"] }).notNull().default("queued"),
  partialReason: text("partial_reason"),
  resolvedPct: real("resolved_pct"),
  componentCount: integer("component_count").notNull().default(0),
  confidenceAvg: real("confidence_avg"),
  ingestMs: integer("ingest_ms"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  createdAt: text("created_at").notNull(),
});

export const assetAppearances = sqliteTable("asset_appearances", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
  drawingId: integer("drawing_id").notNull().references(() => drawings.id, { onDelete: "cascade" }),
  /** JSON [x0, y0, x1, y1], normalized 0..1 page coordinates, origin top-left */
  bbox: text("bbox"),
  confidence: real("confidence"),
  extractedJson: text("extracted_json").notNull().default("{}"),
});

export const offPageConnectors = sqliteTable("off_page_connectors", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  drawingId: integer("drawing_id").notNull().references(() => drawings.id, { onDelete: "cascade" }),
  label: text("label").notNull().default(""),
  direction: text("direction", { enum: ["from", "to"] }).notNull().default("from"),
  targetDrawingNumber: text("target_drawing_number"),
  targetTag: text("target_tag"),
  atAssetId: integer("at_asset_id").references(() => assets.id, { onDelete: "cascade" }),
  resolvedEdgeId: integer("resolved_edge_id").references(() => edges.id, { onDelete: "set null" }),
  resolved: integer("resolved", { mode: "boolean" }).notNull().default(false),
});

export const discrepancies = sqliteTable(
  "discrepancies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** JSON [{ value, drawingIds: number[] }] */
    valuesJson: text("values_json").notNull(),
    status: text("status", { enum: ["open", "resolved"] }).notNull().default("open"),
    resolution: text("resolution"),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (t) => [uniqueIndex("discrepancies_asset_key").on(t.assetId, t.key)],
);

export const reviewItems = sqliteTable(
  "review_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
    targetType: text("target_type", { enum: ["component", "attribute", "connection"] }).notNull(),
    /** appearance id for components and attributes, edge id for connections */
    targetId: integer("target_id").notNull(),
    /** parameter key for attributes, '' otherwise */
    attrKey: text("attr_key").notNull().default(""),
    drawingId: integer("drawing_id").notNull().references(() => drawings.id, { onDelete: "cascade" }),
    state: text("state", { enum: ["unreviewed", "accepted", "corrected", "rejected", "ambiguous", "added_missing"] }).notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json"),
    comment: text("comment"),
    reviewer: text("reviewer"),
    flagged: integer("flagged", { mode: "boolean" }).notNull().default(false),
    reviewedAt: text("reviewed_at").notNull(),
  },
  (t) => [uniqueIndex("review_items_target").on(t.targetType, t.targetId, t.attrKey, t.drawingId)],
);

export const reviewSessions = sqliteTable("review_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  siteId: integer("site_id").notNull().references(() => sites.id, { onDelete: "cascade" }),
  drawingId: integer("drawing_id").notNull().references(() => drawings.id, { onDelete: "cascade" }),
  reviewer: text("reviewer"),
  activeMs: integer("active_ms").notNull().default(0),
  flaggedMs: integer("flagged_ms").notNull().default(0),
  startedAt: text("started_at").notNull(),
  endedAt: text("ended_at"),
});

export const assetDocLinks = sqliteTable(
  "asset_doc_links",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    assetId: integer("asset_id").notNull().references(() => assets.id, { onDelete: "cascade" }),
    chunkId: integer("chunk_id").notNull().references(() => kbChunks.id, { onDelete: "cascade" }),
    linkType: text("link_type", { enum: ["operating", "maintenance", "design_data", "other"] }).notNull().default("other"),
    createdBy: text("created_by", { enum: ["model", "sme"] }).notNull().default("model"),
    status: text("status", { enum: ["unreviewed", "correct", "incorrect"] }).notNull().default("unreviewed"),
    /** 1 when the link is in the current SME link-test sample */
    inSample: integer("in_sample", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [uniqueIndex("asset_doc_links_pair").on(t.assetId, t.chunkId)],
);
