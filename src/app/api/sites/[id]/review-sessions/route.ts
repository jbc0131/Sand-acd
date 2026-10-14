import { z } from "zod";
import { startSession } from "@/lib/review";
import { fail, handle, ok, parseId } from "@/lib/http";

const Body = z.object({ drawingId: z.number().int().positive(), reviewer: z.string().trim().max(120).nullish() });

export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/review-sessions">) {
  const siteId = parseId((await ctx.params).id);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!siteId || !parsed.success) return fail("Invalid review session.");
  try {
    return ok({ id: startSession(siteId, parsed.data.drawingId, parsed.data.reviewer || null) }, 201);
  } catch (err) {
    return handle(err);
  }
}
