import { addMissing, AddMissingSchema } from "@/lib/review";
import { fail, handle, ok, parseId } from "@/lib/http";

/** Adds a component or connection the extraction missed (counted as a miss in recall). */
export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/review/missing">) {
  const siteId = parseId((await ctx.params).id);
  const parsed = AddMissingSchema.safeParse(await req.json().catch(() => null));
  if (!siteId || !parsed.success) return fail("Fill in the required fields.");
  try {
    addMissing(siteId, parsed.data);
    return ok({ ok: true }, 201);
  } catch (err) {
    return handle(err);
  }
}
