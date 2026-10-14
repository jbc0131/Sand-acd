import fs from "node:fs";
import { raw } from "@/lib/db";
import { callText, hasApiKey, NO_KEY_MESSAGE, toUserMessage, UserFacingError } from "@/lib/ai";
import { extractDiagram, saveDiagram } from "@/lib/extract";
import { chunkPages, indexChunks, insertSource, readManualPages, saveUpload, stageAssetDb, stageTelemetry } from "@/lib/ingest";
import { runningJobFor, startJob } from "@/lib/jobs";
import { getSiteSummary, listSources, removeUpload } from "@/lib/model";
import { fail, handle, ok, parseId } from "@/lib/http";
import { SOURCE_KINDS, type SourceKind } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: RouteContext<"/api/sites/[id]/sources">) {
  const id = parseId((await ctx.params).id);
  if (!id) return fail("Site not found.", 404);
  return ok({ sources: listSources(id) });
}

export async function POST(req: Request, ctx: RouteContext<"/api/sites/[id]/sources">) {
  const siteId = parseId((await ctx.params).id);
  if (!siteId || !getSiteSummary(siteId)) return fail("Site not found.", 404);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("Upload failed. The request was not a valid file upload.");
  }
  const kind = String(form.get("kind") ?? "") as SourceKind;
  const file = form.get("file");
  if (!SOURCE_KINDS.includes(kind)) return fail("Unknown source type.");
  if (!(file instanceof File)) return fail("Choose a file to upload.");

  const assetCount = (raw().prepare(`SELECT COUNT(*) AS n FROM assets WHERE site_id = ?`).get(siteId) as { n: number }).n;
  if (kind !== "pfd" && assetCount === 0) return fail("Upload a process flow diagram or electrical one-line first.");

  let saved: { filePath: string; fileName: string };
  try {
    saved = await saveUpload(siteId, kind, file);
  } catch (err) {
    return handle(err);
  }

  if (kind === "pfd") {
    if (!hasApiKey()) {
      removeUpload(saved.filePath);
      return fail(NO_KEY_MESSAGE);
    }
    if (runningJobFor(siteId, "diagram")) {
      removeUpload(saved.filePath);
      return fail("A diagram is already being processed for this site.");
    }
    const sourceId = insertSource(siteId, "pfd", saved.fileName, saved.filePath, "ingested", "Processing…");
    const job = startJob(
      siteId,
      "diagram",
      "Reading diagram",
      async (jc) => {
        const d = await extractDiagram(saved.filePath, jc);
        jc.step("Building site model");
        const r = saveDiagram(siteId, sourceId, d);
        raw()
          .prepare(`UPDATE sources SET status = 'applied', summary = ? WHERE id = ?`)
          .run(`${r.assets} assets and ${r.edges} connections extracted from ${saved.fileName}.`, sourceId);
        return `Site model built: ${r.assets} assets, ${r.edges} connections.`;
      },
      (err) => {
        // Failed diagrams leave nothing behind, so the user can simply retry.
        raw().prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
        removeUpload(saved.filePath);
        return toUserMessage(err);
      },
    );
    return ok({ job }, 202);
  }

  try {
    if (kind === "om") {
      const pages = await readManualPages(saved.filePath);
      const chunks = chunkPages(pages);
      if (chunks.length === 0) throw new UserFacingError("No readable text was found in this file.");
      const summary = `${pages.length} page${pages.length === 1 ? "" : "s"}, ${chunks.length} indexed sections. ${firstLine(pages)}`;
      const sourceId = insertSource(siteId, "om", saved.fileName, saved.filePath, "ingested", summary);
      indexChunks(siteId, sourceId, chunks);
      if (hasApiKey()) void summarize(sourceId, pages, summary);
      return ok({ sourceId }, 201);
    }
    const text = fs.readFileSync(saved.filePath, "utf8");
    const sourceId = insertSource(siteId, kind, saved.fileName, saved.filePath, "ingested", null);
    try {
      const summary =
        kind === "assetdb"
          ? (() => {
              const r = stageAssetDb(sourceId, text);
              return `${r.rows} rows for ${r.tags} tags; columns: ${r.columns.join(", ")}.`;
            })()
          : (() => {
              const r = stageTelemetry(sourceId, text);
              return `${r.rows} readings; latest value kept for ${r.signals} signals on ${r.tags} tags.`;
            })();
      raw().prepare(`UPDATE sources SET summary = ? WHERE id = ?`).run(summary, sourceId);
    } catch (err) {
      raw().prepare(`DELETE FROM sources WHERE id = ?`).run(sourceId);
      throw err;
    }
    return ok({ sourceId }, 201);
  } catch (err) {
    removeUpload(saved.filePath);
    return handle(err);
  }
}

function firstLine(pages: string[]): string {
  const l = pages.join("\n").split("\n").map((s) => s.trim()).find((s) => s.length > 8) ?? "";
  return l.length > 160 ? `${l.slice(0, 157)}…` : l;
}

/** Background one-paragraph summary on the fast model; keeps the heuristic summary on failure. */
async function summarize(sourceId: number, pages: string[], fallback: string) {
  try {
    const text = pages.join("\n\n").slice(0, 24000);
    const s = await callText(
      `Summarize this O&M manual excerpt in two sentences for an asset engineer: what equipment it covers and which procedures it contains. Plain text only.\n\n${text}`,
      600,
    );
    if (s) raw().prepare(`UPDATE sources SET summary = ? WHERE id = ?`).run(`${fallback.split(".")[0]}. ${s}`, sourceId);
  } catch {
    // keep heuristic summary
  }
}
