import Papa from "papaparse";
import { baselineCsvRows, computeBaseline } from "@/lib/baseline";
import { getSiteSummary } from "@/lib/model";
import { fail, ok, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

/** The value baseline. ?format=csv or ?format=json downloads it; no format returns JSON for the UI. */
export async function GET(req: Request, ctx: RouteContext<"/api/sites/[id]/baseline">) {
  const siteId = parseId((await ctx.params).id);
  const site = siteId ? getSiteSummary(siteId) : null;
  if (!siteId || !site) return fail("Site not found.", 404);
  const b = computeBaseline(siteId);
  const format = new URL(req.url).searchParams.get("format");
  const slug = site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  if (format === "csv") {
    return new Response(Papa.unparse(baselineCsvRows(b)), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-baseline.csv"` },
    });
  }
  if (format === "json") {
    return new Response(JSON.stringify({ site: { id: site.id, name: site.name }, generatedAt: new Date().toISOString(), ...b }, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${slug}-baseline.json"` },
    });
  }
  return ok(b);
}
