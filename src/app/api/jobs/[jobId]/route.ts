import { getJob } from "@/lib/jobs";
import { fail, ok } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/jobs/[jobId]">) {
  const job = getJob((await ctx.params).jobId);
  return job ? ok(job) : fail("Job not found. The server may have restarted; try again.", 404);
}
