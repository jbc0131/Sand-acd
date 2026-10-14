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
