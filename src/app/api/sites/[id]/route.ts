import { z } from "zod";
import { raw, nowIso } from "@/lib/db";
import { getSiteModel, removeUpload } from "@/lib/model";
import { fail, handle, ok, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  try {
    const model = getSiteModel(id);
    return model ? ok(model) : fail("Site not found.", 404);
  } catch (err) {
    return handle(err);
  }
}

const Patch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(120).nullable().optional(),
});

export async function PATCH(req: Request, ctx: RouteContext<"/api/sites/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail("Name cannot be empty.");
  try {
    const db = raw();
    if (parsed.data.name !== undefined) db.prepare(`UPDATE sites SET name = ? WHERE id = ?`).run(parsed.data.name, id);
    if (parsed.data.location !== undefined)
      db.prepare(`UPDATE sites SET location = ? WHERE id = ?`).run(parsed.data.location || null, id);
    db.prepare(`UPDATE sites SET updated_at = ? WHERE id = ?`).run(nowIso(), id);
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/sites/[id]">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  try {
    const db = raw();
    const files = db.prepare(`SELECT file_path FROM sources WHERE site_id = ?`).all(id) as { file_path: string }[];
    db.prepare(`DELETE FROM sites WHERE id = ?`).run(id);
    files.forEach((f) => removeUpload(f.file_path));
    return ok({ ok: true });
  } catch (err) {
    return handle(err);
  }
}
