import { z } from "zod";
import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";

const Body = z.object({ feedback: z.enum(["up", "down"]).nullable() });

/** Thumbs up/down on an assistant answer. */
export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]/chat/[messageId]">) {
  const p = await ctx.params;
  const id = parseId(p.id);
  const messageId = parseId(p.messageId);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!id || !messageId || !parsed.success) return fail("Invalid feedback.");
  const r = raw()
    .prepare(`UPDATE chat_messages SET feedback = ? WHERE id = ? AND site_id = ? AND role = 'assistant'`)
    .run(parsed.data.feedback, messageId, id);
  return r.changes ? ok({ ok: true }) : fail("Message not found.", 404);
}
