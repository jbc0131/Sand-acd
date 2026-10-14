import { unlinkSource } from "@/lib/model";
import { fail, handle, ok, parseId } from "@/lib/http";

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sites/[id]/sources/[sourceId]">) {
  const p = await ctx.params;
  const id = parseId(p.id);
  const sourceId = parseId(p.sourceId);
  if (!id || !sourceId) return fail("Source not found.", 404);
  try {
    return ok(unlinkSource(id, sourceId));
  } catch (err) {
    return handle(err);
  }
}
