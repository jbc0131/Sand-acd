import { z } from "zod";
import { raw } from "@/lib/db";
import { touchSite } from "@/lib/model";
import { fail, ok, parseId } from "@/lib/http";

const Body = z.object({ safetyRelated: z.boolean() });

/** Marks an asset safety-related (always fully reviewed) or not. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]/assets/[assetId]">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const assetId = parseId(p.assetId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !assetId || !parsed.success) return fail("Invalid request.");
  const r = raw()
    .prepare(`UPDATE assets SET safety_related = ? WHERE id = ? AND site_id = ?`)
    .run(parsed.data.safetyRelated ? 1 : 0, assetId, siteId);
  if (!r.changes) return fail("Asset not found.", 404);
  touchSite(siteId);
  return ok({ ok: true });
}
