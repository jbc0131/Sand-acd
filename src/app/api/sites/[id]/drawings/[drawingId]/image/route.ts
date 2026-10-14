import fs from "node:fs";
import path from "node:path";
import { drawingImagePath } from "@/lib/drawings";
import { UPLOAD_DIR } from "@/lib/db";
import { fail, parseId } from "@/lib/http";

const TYPES: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

/** Page 1 image of a drawing, rendered at ingest. */
export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/drawings/[drawingId]/image">) {
  const p = await ctx.params;
  const siteId = parseId(p.id);
  const drawingId = parseId(p.drawingId);
  const file = siteId && drawingId ? drawingImagePath(siteId, drawingId) : null;
  if (!file || !path.resolve(file).startsWith(UPLOAD_DIR) || !fs.existsSync(file)) return fail("No page image for this drawing.", 404);
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) return fail("No page image for this drawing.", 404);
  return new Response(new Uint8Array(fs.readFileSync(file)), {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600" },
  });
}
