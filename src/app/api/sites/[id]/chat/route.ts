import { raw } from "@/lib/db";
import { fail, ok, parseId } from "@/lib/http";
import type { ChatMessageDTO } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/chat">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  const rows = raw().prepare(`SELECT * FROM chat_messages WHERE site_id = ? ORDER BY id`).all(id) as {
    id: number;
    role: "user" | "assistant";
    content: string;
    tools_json: string | null;
    highlight_json: string | null;
    sources_json: string | null;
    feedback: "up" | "down" | null;
    created_at: string;
  }[];
  const messages: ChatMessageDTO[] = rows.map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    tools: r.tools_json ? JSON.parse(r.tools_json) : [],
    highlight: r.highlight_json ? JSON.parse(r.highlight_json) : [],
    sources: r.sources_json ? JSON.parse(r.sources_json) : [],
    feedback: r.feedback,
    createdAt: r.created_at,
  }));
  return ok({ messages });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sites/[id]/chat">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  raw().prepare(`DELETE FROM chat_messages WHERE site_id = ?`).run(id);
  return ok({ ok: true });
}
