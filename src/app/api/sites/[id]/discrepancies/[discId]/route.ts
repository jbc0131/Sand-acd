import { z } from "zod";
import { raw, nowIso } from "@/lib/db";
import { recomputeAssets, setParam, smeSourceId, touchSite } from "@/lib/model";
import { fail, ok, parseId } from "@/lib/http";

const Body = z.object({
  resolution: z.string().trim().min(1).max(1000),
  /** optional value to adopt as the asset's parameter (written as an SME correction) */
  value: z.string().trim().max(200).optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]/discrepancies/[discId]">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const discId = parseId(p.discId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !discId || !parsed.success) return fail("Describe how the discrepancy was resolved.");
  const db = raw();
  const d = db.prepare(`SELECT asset_id, key FROM discrepancies WHERE id = ? AND site_id = ?`).get(discId, siteId) as
    | { asset_id: number; key: string }
    | undefined;
  if (!d) return fail("Discrepancy not found.", 404);
  db.transaction(() => {
    if (parsed.data.value) setParam(d.asset_id, d.key, parsed.data.value, smeSourceId(siteId), null);
    db.prepare(`UPDATE discrepancies SET status = 'resolved', resolution = ?, resolved_at = ? WHERE id = ?`).run(
      parsed.data.resolution,
      nowIso(),
      discId,
    );
  })();
  recomputeAssets(siteId);
  touchSite(siteId);
  return ok({ ok: true });
}
