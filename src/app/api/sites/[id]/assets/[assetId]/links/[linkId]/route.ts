import { z } from "zod";
import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";

async function ids(ctx: RouteContext<"/api/sites/[id]/assets/[assetId]/links/[linkId]">) {
  const p = await ctx.params;
  return { siteId: parseId(p.id), assetId: parseId(p.assetId), linkId: parseId(p.linkId) };
}

const owned = `id = ? AND asset_id = ? AND asset_id IN (SELECT id FROM assets WHERE site_id = ?)`;

/** SME removes a link. */
export async function DELETE(_req: Request, ctx: RouteContext<"/api/sites/[id]/assets/[assetId]/links/[linkId]">) {
  const { siteId, assetId, linkId } = await ids(ctx);
  if (!siteId || !assetId || !linkId) return fail("Link not found.", 404);
  const r = raw().prepare(`DELETE FROM asset_doc_links WHERE ${owned}`).run(linkId, assetId, siteId);
  return r.changes ? ok({ ok: true }) : fail("Link not found.", 404);
}

const Body = z.object({ status: z.enum(["unreviewed", "correct", "incorrect"]) });

/** SME marks a link correct or incorrect (used by the link test). */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]/assets/[assetId]/links/[linkId]">) {
  const { siteId, assetId, linkId } = await ids(ctx);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !assetId || !linkId || !parsed.success) return fail("Invalid request.");
  const r = raw().prepare(`UPDATE asset_doc_links SET status = ? WHERE ${owned}`).run(parsed.data.status, linkId, assetId, siteId);
  return r.changes ? ok({ ok: true }) : fail("Link not found.", 404);
}
