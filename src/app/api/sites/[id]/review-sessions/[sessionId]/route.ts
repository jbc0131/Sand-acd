import { z } from "zod";
import { updateSession } from "@/lib/review";
import { fail, handle, ok, parseId } from "@/lib/http";

const Body = z.object({
  activeMs: z.number().min(0),
  flaggedMs: z.number().min(0),
  ended: z.boolean().default(false),
});

/** Running totals from the browser; also accepted via navigator.sendBeacon (POST). */
async function update(req: Request, ctx: RouteContext<"/api/sites/[id]/review-sessions/[sessionId]">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const sessionId = parseId(p.sessionId);
  const text = await req.text().catch(() => "");
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    // fall through to validation error
  }
  const parsed = Body.safeParse(json);
  if (!siteId || !sessionId || !parsed.success) return fail("Invalid session update.");
  try {
    updateSession(siteId, sessionId, parsed.data.activeMs, parsed.data.flaggedMs, parsed.data.ended);
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}

export const PATCH = update;
export const POST = update;
