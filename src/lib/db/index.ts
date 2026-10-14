import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

export const DATA_DIR = path.resolve(/*turbopackIgnore: true*/ process.env.CDA_DATA_DIR || "./data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = path.join(DATA_DIR, "cda.db");

// Tables are created idempotently at startup so `npm run dev` works on a fresh clone
// without a separate migration step. drizzle.config.ts is provided for drizzle-kit users.
const DDL = `
CREATE TABLE IF NOT EXISTS sites (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'in_planning',
  last_run_id INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  precomputed_json TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  ext_id TEXT NOT NULL,
  name TEXT NOT NULL,
  tag TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  params_json TEXT NOT NULL DEFAULT '{}',
  enrichment_status TEXT NOT NULL DEFAULT 'pending',
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS assets_site_idx ON assets(site_id);
CREATE TABLE IF NOT EXISTS asset_param_sources (
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_id INTEGER,
  PRIMARY KEY (asset_id, key, source_id)
);
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  from_asset INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  to_asset INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kb_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  page INTEGER NOT NULL,
  section_no INTEGER NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS kb_site_idx ON kb_chunks(site_id);
CREATE VIRTUAL TABLE IF NOT EXISTS kb_fts USING fts5(text, chunk_id UNINDEXED, site_id UNINDEXED, tokenize='porter unicode61');
CREATE TRIGGER IF NOT EXISTS kb_chunks_ad AFTER DELETE ON kb_chunks BEGIN
  DELETE FROM kb_fts WHERE chunk_id = old.id;
END;
CREATE TABLE IF NOT EXISTS staged_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  tag_norm TEXT NOT NULL,
  data_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drawings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  page_image_path TEXT,
  drawing_number TEXT,
  revision TEXT,
  date_drawn TEXT,
  unit TEXT,
  system TEXT,
  title TEXT,
  author TEXT,
  site_label TEXT,
  drawing_type TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL DEFAULT 'queued',
  partial_reason TEXT,
  resolved_pct REAL,
  component_count INTEGER NOT NULL DEFAULT 0,
  confidence_avg REAL,
  ingest_ms INTEGER,
  tokens_in INTEGER,
  tokens_out INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drawings_site_idx ON drawings(site_id);
CREATE TABLE IF NOT EXISTS asset_appearances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  bbox TEXT,
  confidence REAL,
  extracted_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS appearances_asset_idx ON asset_appearances(asset_id);
CREATE INDEX IF NOT EXISTS appearances_drawing_idx ON asset_appearances(drawing_id);
CREATE TABLE IF NOT EXISTS off_page_connectors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'from',
  target_drawing_number TEXT,
  target_tag TEXT,
  at_asset_id INTEGER REFERENCES assets(id) ON DELETE CASCADE,
  resolved_edge_id INTEGER REFERENCES edges(id) ON DELETE SET NULL,
  resolved INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS discrepancies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  values_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  resolution TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (asset_id, key)
);
CREATE TABLE IF NOT EXISTS review_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  attr_key TEXT NOT NULL DEFAULT '',
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  state TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  comment TEXT,
  reviewer TEXT,
  flagged INTEGER NOT NULL DEFAULT 0,
  reviewed_at TEXT NOT NULL,
  UNIQUE (target_type, target_id, attr_key, drawing_id)
);
CREATE TABLE IF NOT EXISTS review_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  drawing_id INTEGER NOT NULL REFERENCES drawings(id) ON DELETE CASCADE,
  reviewer TEXT,
  active_ms INTEGER NOT NULL DEFAULT 0,
  flagged_ms INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  ended_at TEXT
);
CREATE TABLE IF NOT EXISTS asset_doc_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  chunk_id INTEGER NOT NULL REFERENCES kb_chunks(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL DEFAULT 'other',
  created_by TEXT NOT NULL DEFAULT 'model',
  status TEXT NOT NULL DEFAULT 'unreviewed',
  in_sample INTEGER NOT NULL DEFAULT 0,
  UNIQUE (asset_id, chunk_id)
);
CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tools_json TEXT,
  highlight_json TEXT,
  sources_json TEXT,
  feedback TEXT,
  created_at TEXT NOT NULL
);
`;

/** Adds columns introduced after the first release, so existing local databases keep working. */
function migrate(sqlite: Database.Database) {
  const add = (table: string, column: string, def: string) => {
    const cols = sqlite.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    if (!cols.some((c) => c.name === column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  };
  add("sites", "review_mode", "TEXT NOT NULL DEFAULT 'full'");
  add("assets", "safety_related", "INTEGER NOT NULL DEFAULT 0");
  add("edges", "drawing_id", "INTEGER REFERENCES drawings(id) ON DELETE SET NULL");
  add("edges", "kind", "TEXT NOT NULL DEFAULT 'power'");
  add("edges", "confidence", "REAL");
  add("edges", "via", "TEXT NOT NULL DEFAULT 'drawing'");
  add("chat_messages", "drawings_json", "TEXT");
}

type DB = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

const g = globalThis as unknown as { __cdaDb?: DB };

export function getDb(): DB {
  if (g.__cdaDb) return g.__cdaDb;
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(DDL);
  migrate(sqlite);
  g.__cdaDb = drizzle(sqlite, { schema }) as DB;
  return g.__cdaDb;
}

export function raw(): Database.Database {
  return getDb().$client;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export { schema };
