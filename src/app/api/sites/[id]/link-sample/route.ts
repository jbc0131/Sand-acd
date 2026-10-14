import { z } from "zod";
import { drawLinkSample } from "@/lib/baseline";
import { fail, ok, parseId } from "@/lib/http";

const Body = z.object({ n: z.number().int().min(1).max(500).default(30) });

/** Draws a fresh random sample of component-to-section links for the SME link test. */
export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/link-sample">) {
  const siteId = parseId((await ctx.params).id);
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!siteId || !parsed.success) return fail("Sample size must be between 1 and 500.");
  const n = drawLinkSample(siteId, parsed.data.n);
  if (n === 0) return fail("There are no document links to sample yet.");
  return ok({ n });
}
