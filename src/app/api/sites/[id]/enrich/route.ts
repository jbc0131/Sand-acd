import { runEnrichment } from "@/lib/enrich";
import { runningJobFor, startJob } from "@/lib/jobs";
import { toUserMessage } from "@/lib/ai";
import { getSiteSummary } from "@/lib/model";
import { fail, ok, parseId } from "@/lib/http";

export async function POST(_req: Request, ctx: RouteContext<"/api/sites/[id]/enrich">) {
  const id = parseId((await ctx.params).id);
  if (!id || !getSiteSummary(id)) return fail("Site not found.", 404);
  const running = runningJobFor(id, "enrich");
  if (running) return ok(running, 202);
  const job = startJob(id, "enrich", "Preparing enrichment", (jc) => runEnrichment(id, jc), toUserMessage);
  return ok(job, 202);
}
