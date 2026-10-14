import { sqliteTable, integer, text, real, primaryKey, index } from "drizzle-orm/sqlite-core";

export const sites = sqliteTable("sites", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  status: text("status", { enum: ["in_planning", "active"] }).notNull().default("in_planning"),
  /** id of the most recent enrichment run, used to outline fresh chips */
  lastRunId: integer("last_run_id"),
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
  createdAt: text("created_at").notNull(),
});
