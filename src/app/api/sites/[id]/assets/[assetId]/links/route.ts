import { z } from "zod";
import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";
import { LINK_TYPES } from "@/lib/types";

const Body = z.object({ chunkId: z.number().int().positive(), linkType: z.enum(LINK_TYPES as [string, ...string[]]) });

/** SME adds a component-to-section link. SME links count as reviewed correct. */
export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/assets/[assetId]/links">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const assetId = parseId(p.assetId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !assetId || !parsed.success) return fail("Choose a section and a link type.");
  const db = raw();
  const asset = db.prepare(`SELECT 1 FROM assets WHERE id = ? AND site_id = ?`).get(assetId, siteId);
  const chunk = db.prepare(`SELECT 1 FROM kb_chunks WHERE id = ? AND site_id = ?`).get(parsed.data.chunkId, siteId);
  if (!asset || !chunk) return fail("Asset or section not found.", 404);
  const r = db
    .prepare(
      `INSERT INTO asset_doc_links (asset_id, chunk_id, link_type, created_by, status) VALUES (?, ?, ?, 'sme', 'correct')
       ON CONFLICT(asset_id, chunk_id) DO UPDATE SET link_type = excluded.link_type`,
    )
    .run(assetId, parsed.data.chunkId, parsed.data.linkType);
  return ok({ id: Number(r.lastInsertRowid) }, 201);
}
