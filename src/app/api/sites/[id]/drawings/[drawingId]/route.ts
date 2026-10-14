import { raw } from "@/lib/db";
import { getDrawing } from "@/lib/drawings";
import { fail, ok, parseId } from "@/lib/http";
import type { BBox } from "@/lib/types";

export const dynamic = "force-dynamic";

/** One drawing with every component that appears on it (for the drawing viewer). */
export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/drawings/[drawingId]">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const drawingId = parseId(p.drawingId);
  if (!siteId || !drawingId) return fail("Drawing not found.", 404);
  const drawing = getDrawing(siteId, drawingId);
  if (!drawing) return fail("Drawing not found.", 404);
  const rows = raw()
    .prepare(
      `SELECT ap.id, ap.asset_id, ap.bbox, ap.confidence, a.tag, a.name, a.type
       FROM asset_appearances ap JOIN assets a ON a.id = ap.asset_id WHERE ap.drawing_id = ? ORDER BY a.tag`,
    )
    .all(drawingId) as { id: number; asset_id: number; bbox: string | null; confidence: number | null; tag: string; name: string; type: string }[];
  return ok({
    drawing,
    components: rows.map((r) => ({
      appearanceId: r.id,
      assetId: r.asset_id,
      tag: r.tag,
      name: r.name,
      type: r.type,
      confidence: r.confidence,
      bbox: r.bbox ? (JSON.parse(r.bbox) as BBox) : null,
    })),
  });
}
