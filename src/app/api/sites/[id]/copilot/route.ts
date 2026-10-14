import { z } from "zod";
import { hasApiKey, NO_KEY_MESSAGE } from "@/lib/ai";
import { runCopilot, type CopilotEvent } from "@/lib/copilot";
import { getSiteSummary } from "@/lib/model";
import { fail, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

const Body = z.object({ message: z.string().trim().min(1).max(4000) });

/** Streams one Copilot answer as Server-Sent Events. */
export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/copilot">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getSiteSummary(id)) return fail("Site not found.", 404);
  if (!hasApiKey()) return fail(NO_KEY_MESSAGE, 503);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Type a question first.");

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (e: CopilotEvent) => {
        try {
          controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        } catch {
          // client went away
        }
      };
      try {
        await runCopilot(id, parsed.data.message, emit);
      } catch {
        emit({ type: "error", message: "Copilot hit an unexpected error. Try again." });
      } finally {
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
