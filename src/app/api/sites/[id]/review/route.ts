import { applyReview, ReviewActionSchema } from "@/lib/review";
import { fail, handle, ok, parseId } from "@/lib/http";

/** Accept, correct, reject or mark ambiguous one extracted item. */
export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/review">) {
  const siteId = parseId((await ctx.params).id);
  const parsed = ReviewActionSchema.safeParse(await req.json().catch(() => null));
  if (!siteId || !parsed.success) return fail("Invalid review action.");
  try {
    applyReview(siteId, parsed.data);
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
