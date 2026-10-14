import "server-only";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import Papa from "papaparse";
import { raw, nowIso, UPLOAD_DIR } from "./db";
import { UserFacingError } from "./ai";
import { normalizeTag, SOURCE_ACCEPT, type SourceKind, type UploadKind } from "./types";

export const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 50);

/** Validates type and size, then writes the upload to ./data/uploads/{siteId}/. */
export async function saveUpload(siteId: number, kind: UploadKind, file: File): Promise<{ filePath: string; fileName: string }> {
  const fileName = path.basename(file.name || "upload").slice(0, 200);
  const ext = path.extname(fileName).toLowerCase();
  const accept = SOURCE_ACCEPT[kind];
  if (!accept.exts.includes(ext)) {
    throw new UserFacingError(`Unsupported file type "${ext || "none"}". Accepted: ${accept.label}.`);
  }
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new UserFacingError(`File is larger than the ${MAX_UPLOAD_MB} MB limit.`);
  }
  if (file.size === 0) throw new UserFacingError("The file is empty.");
  const dir = path.join(UPLOAD_DIR, String(siteId));
  fs.mkdirSync(dir, { recursive: true });
  const safe = fileName.replace(/[^\w.\- ]+/g, "_");
  const filePath = path.join(dir, `${crypto.randomUUID().slice(0, 8)}-${safe}`);
  fs.writeFileSync(filePath, Buffer.from(await file.arrayBuffer()));
  return { filePath, fileName };
}

export function insertSource(
  siteId: number,
  kind: SourceKind,
  fileName: string,
  filePath: string,
  status: "ingested" | "applied" | "failed",
  summary: string | null,
  precomputedJson: string | null = null,
): number {
  const info = raw()
    .prepare(
      `INSERT INTO sources (site_id, kind, file_name, file_path, status, summary, precomputed_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(siteId, kind, fileName, filePath, status, summary, precomputedJson, nowIso());
  return Number(info.lastInsertRowid);
}

// ---------- PDF ----------

/** Extracts text per page with pdfjs-dist. Returns one string per page (1-indexed by position). */
export async function pdfPages(data: Uint8Array): Promise<string[]> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data, useSystemFonts: true });
  const doc = await task.promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) {
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }
    }
    pages.push(text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim());
  }
  await task.destroy();
  return pages;
}

/** Reads a manual (PDF or TXT) into pages. TXT pages split on form feeds. */
export async function readManualPages(filePath: string): Promise<string[]> {
  const buf = fs.readFileSync(filePath);
  if (filePath.toLowerCase().endsWith(".txt")) {
    return buf
      .toString("utf8")
      .split("\f")
      .map((p) => p.trim());
  }
  let pages: string[];
  try {
    pages = await pdfPages(new Uint8Array(buf));
  } catch {
    throw new UserFacingError("Could not read this PDF. It may be encrypted or damaged.");
  }
  const chars = pages.join("").replace(/\s/g, "").length;
  if (chars < Math.max(50, pages.length * 20)) {
    throw new UserFacingError("This PDF looks scanned. Run OCR first.");
  }
  return pages;
}

// ---------- Chunking ----------

const TARGET = 1200;

/** Splits page text into ~1,200 character chunks along sentence boundaries. Never crosses pages. */
export function chunkPages(pages: string[]): { page: number; text: string }[] {
  const out: { page: number; text: string }[] = [];
  pages.forEach((pageText, idx) => {
    const sentences = pageText.match(/[^.!?\n]+(?:[.!?]+["')\]]?|\n|$)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
    let cur = "";
    for (const s of sentences) {
      if (cur && cur.length + s.length + 1 > TARGET) {
        out.push({ page: idx + 1, text: cur.trim() });
        cur = "";
      }
      if (s.length > TARGET * 1.5) {
        // Very long run-on text: hard-split on whitespace.
        for (let i = 0; i < s.length; i += TARGET) out.push({ page: idx + 1, text: s.slice(i, i + TARGET).trim() });
        continue;
      }
      cur += (cur ? " " : "") + s;
    }
    if (cur.trim()) out.push({ page: idx + 1, text: cur.trim() });
  });
  return out.filter((c) => c.text.length > 0);
}

/** Inserts chunks for a source, numbering sections sequentially per site, and indexes them in FTS5. */
export function indexChunks(siteId: number, sourceId: number, chunks: { page: number; text: string }[]): number {
  const db = raw();
  const max = (db.prepare(`SELECT COALESCE(MAX(section_no), 0) AS m FROM kb_chunks WHERE site_id = ?`).get(siteId) as {
    m: number;
  }).m;
  const ins = db.prepare(`INSERT INTO kb_chunks (site_id, source_id, page, section_no, text) VALUES (?, ?, ?, ?, ?)`);
  const fts = db.prepare(`INSERT INTO kb_fts (text, chunk_id, site_id) VALUES (?, ?, ?)`);
  db.transaction(() => {
    chunks.forEach((c, i) => {
      const info = ins.run(siteId, sourceId, c.page, max + i + 1, c.text);
      fts.run(c.text, Number(info.lastInsertRowid), siteId);
    });
  })();
  return chunks.length;
}

export interface KbHit {
  chunkId: number;
  sectionNo: number;
  file: string;
  page: number;
  text: string;
}

const STOP = new Set(
  "the a an of to and or for in on at is are be what which how do does with this that from by as it its can i me my we".split(" "),
);

/** Full-text search over a site's knowledge base, ranked with bm25(). */
export function searchKb(siteId: number, query: string, k = 5): KbHit[] {
  const terms = (query.toLowerCase().match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
    .flatMap((t) => (t.includes("-") ? [t] : [t]))
    .filter((t) => !STOP.has(t))
    .slice(0, 16);
  if (terms.length === 0) return [];
  const match = terms.map((t) => `"${t.replace(/"/g, "")}"`).join(" OR ");
  const rows = raw()
    .prepare(
      `SELECT c.id AS chunkId, c.section_no AS sectionNo, s.file_name AS file, c.page AS page, c.text AS text
       FROM kb_fts f JOIN kb_chunks c ON c.id = f.chunk_id JOIN sources s ON s.id = c.source_id
       WHERE kb_fts MATCH ? AND f.site_id = ?
       ORDER BY bm25(kb_fts) LIMIT ?`,
    )
    .all(match, siteId, Math.min(Math.max(k, 1), 10)) as KbHit[];
  return rows;
}

// ---------- CSV ----------

const TAG_HEADERS = ["tag", "asset_tag", "asset_id", "equipment", "location"];

function normHeader(h: string) {
  return h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const res = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normHeader,
  });
  const headers = (res.meta.fields ?? []).filter(Boolean);
  if (headers.length === 0) throw new UserFacingError("The CSV has no header row.");
  return { headers, rows: res.data };
}

function findTagColumn(headers: string[]): string {
  for (const h of TAG_HEADERS) if (headers.includes(h)) return h;
  throw new UserFacingError(`No tag column found. Expected a header named one of: ${TAG_HEADERS.join(", ")}.`);
}

/** Asset register: every non-tag column becomes a parameter. Rows are staged until enrichment runs. */
export function stageAssetDb(sourceId: number, text: string): { rows: number; tags: number; columns: string[] } {
  const { headers, rows } = parseCsv(text);
  const tagCol = findTagColumn(headers);
  const cols = headers.filter((h) => h !== tagCol);
  const db = raw();
  const ins = db.prepare(`INSERT INTO staged_rows (source_id, tag_norm, data_json) VALUES (?, ?, ?)`);
  const tags = new Set<string>();
  let n = 0;
  db.transaction(() => {
    for (const r of rows) {
      const tagNorm = normalizeTag(r[tagCol] ?? "");
      if (!tagNorm) continue;
      const data: Record<string, string> = {};
      for (const c of cols) {
        const v = (r[c] ?? "").toString().trim();
        if (v) data[c] = v;
      }
      ins.run(sourceId, tagNorm, JSON.stringify(data));
      tags.add(tagNorm);
      n++;
    }
  })();
  if (n === 0) throw new UserFacingError("The CSV has no rows with a tag value.");
  return { rows: n, tags: tags.size, columns: cols };
}

/** Telemetry: keeps the latest value per tag and signal; each becomes parameter live_{signal}. */
export function stageTelemetry(sourceId: number, text: string): { rows: number; tags: number; signals: number } {
  const { headers, rows } = parseCsv(text);
  const tagCol = findTagColumn(headers);
  const sigCol = ["signal", "parameter", "point", "measurement"].find((h) => headers.includes(h));
  const tsCol = ["timestamp", "time", "ts", "datetime", "date"].find((h) => headers.includes(h));
  const valCol = ["value", "val", "reading"].find((h) => headers.includes(h));
  const unitCol = ["unit", "units", "uom"].find((h) => headers.includes(h));
  if (!valCol) throw new UserFacingError("No value column found. Expected a header named value.");
  if (!tsCol) throw new UserFacingError("No timestamp column found. Expected a header named timestamp.");
  const latest = new Map<string, { tagNorm: string; signal: string; ts: number; value: string; unit: string }>();
  let n = 0;
  for (const r of rows) {
    const tagNorm = normalizeTag(r[tagCol] ?? "");
    const value = (r[valCol] ?? "").toString().trim();
    if (!tagNorm || !value) continue;
    n++;
    const signal = normHeader(sigCol ? r[sigCol] || "value" : "value") || "value";
    const tsRaw = (r[tsCol] ?? "").toString().trim();
    const ts = Date.parse(tsRaw);
    const key = `${tagNorm}|${signal}`;
    const prev = latest.get(key);
    const t = Number.isNaN(ts) ? n : ts;
    if (!prev || t >= prev.ts) latest.set(key, { tagNorm, signal, ts: t, value, unit: unitCol ? (r[unitCol] ?? "").trim() : "" });
  }
  if (latest.size === 0) throw new UserFacingError("The CSV has no rows with both a tag and a value.");
  const byTag = new Map<string, Record<string, string>>();
  for (const v of latest.values()) {
    const d = byTag.get(v.tagNorm) ?? {};
    d[`live_${v.signal}`] = v.unit ? `${v.value} ${v.unit}` : v.value;
    byTag.set(v.tagNorm, d);
  }
  const db = raw();
  const ins = db.prepare(`INSERT INTO staged_rows (source_id, tag_norm, data_json) VALUES (?, ?, ?)`);
  db.transaction(() => {
    for (const [tag, data] of byTag) ins.run(sourceId, tag, JSON.stringify(data));
  })();
  return { rows: n, tags: byTag.size, signals: latest.size };
}
