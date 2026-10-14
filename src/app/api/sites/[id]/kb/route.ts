import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Knowledge-base sections for the site (used to add document links and open section text). */
export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/kb">) {
  const siteId = parseId((await ctx.params).id);
  if (!siteId) return fail("Site not found.", 404);
  const sections = raw()
    .prepare(
      `SELECT c.id, c.section_no AS sectionNo, c.page, c.text, s.file_name AS file
       FROM kb_chunks c JOIN sources s ON s.id = c.source_id WHERE c.site_id = ? ORDER BY c.section_no`,
    )
    .all(siteId);
  return ok({ sections });
}
