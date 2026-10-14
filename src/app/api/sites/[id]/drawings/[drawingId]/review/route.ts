import { getDrawing } from "@/lib/drawings";
import { buildReviewItems, reviewProgress, siteReviewMode } from "@/lib/review";
import { fail, ok, parseId } from "@/lib/http";
import type { ReviewListDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Every extracted component, attribute and connection on one drawing, with review state. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/drawings/[drawingId]/review">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const drawingId = parseId(p.drawingId);
  const drawing = siteId && drawingId ? getDrawing(siteId, drawingId) : null;
  if (!siteId || !drawingId || !drawing) return fail("Drawing not found.", 404);
  const mode = siteReviewMode(siteId);
  const items = buildReviewItems(siteId, drawingId, mode);
  const body: ReviewListDTO = { drawing, mode, items, ...reviewProgress(items) };
  return ok(body);
}
