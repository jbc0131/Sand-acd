import { z } from "zod";
import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";

const Body = z.object({ status: z.enum(["unreviewed", "correct", "incorrect"]) });

/** SME verdict on one sampled component-to-section link. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]/link-test/[linkId]">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const linkId = parseId(p.linkId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !linkId || !parsed.success) return fail("Invalid request.");
  const r = raw()
    .prepare(`UPDATE asset_doc_links SET status = ? WHERE id = ? AND asset_id IN (SELECT id FROM assets WHERE site_id = ?)`)
    .run(parsed.data.status, linkId, siteId);
  return r.changes ? ok({ ok: true }) : fail("Link not found.", 404);
}
