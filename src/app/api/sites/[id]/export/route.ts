import Papa from "papaparse";
import { getSiteModel } from "@/lib/model";
import { fail, parseId } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Asset register export. ?format=csv|json. JSON includes edges and parameter provenance. */
export async function GET(req: Request, ctx: RouteContext<"/api/sites/[id]/export">) {
  const id = parseId((await ctx.params).id);
  const model = id ? getSiteModel(id) : null;
  if (!model) return fail("Site not found.", 404);
  const format = new URL(req.url).searchParams.get("format") === "json" ? "json" : "csv";
  const slug = model.site.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "site";
  const tagOf = new Map(model.assets.map((a) => [a.id, a.tag || a.name]));

  if (format === "json") {
    const body = {
      site: { id: model.site.id, name: model.site.name, location: model.site.location, status: model.site.status },
      exportedAt: new Date().toISOString(),
      assets: model.assets.map((a) => ({
        tag: a.tag,
        name: a.name,
        type: a.type,
        description: a.description,
        enrichmentStatus: a.enrichmentStatus,
        params: a.params,
        provenance: a.provenance.map((p) => ({ key: p.key, value: p.value, source: p.fileName, sourceKind: p.sourceKind })),
      })),
      edges: model.edges.map((e) => ({ from: tagOf.get(e.from), to: tagOf.get(e.to), label: e.label })),
      sources: model.sources.map((s) => ({ kind: s.kind, fileName: s.fileName, status: s.status, summary: s.summary })),
    };
    return new Response(JSON.stringify(body, null, 2), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${slug}-assets.json"` },
    });
  }
  const rows = model.assets.map((a) => ({
    tag: a.tag,
    name: a.name,
    type: a.type,
    enrichment_status: a.enrichmentStatus,
    description: a.description,
    parameters: Object.entries(a.params)
      .map(([k, v]) => `${k}=${v}`)
      .join("; "),
    feeds: model.edges
      .filter((e) => e.from === a.id)
      .map((e) => tagOf.get(e.to))
      .join("; "),
  }));
  return new Response(Papa.unparse(rows), {
    headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${slug}-assets.csv"` },
  });
}
