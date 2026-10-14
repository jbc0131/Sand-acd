import fs from "node:fs";
import path from "node:path";
import { raw, UPLOAD_DIR } from "@/lib/db";
import { callText, hasApiKey, NO_KEY_MESSAGE, toUserMessage, UserFacingError } from "@/lib/ai";
import { extractDiagram, saveDrawing } from "@/lib/extract";
import { insertDrawing, setDrawingImage, setDrawingStatus } from "@/lib/drawings";
import { renderFirstPagePng } from "@/lib/render";
import type { JobContext } from "@/lib/jobs";
import { chunkPages, indexChunks, insertSource, readManualPages, saveUpload, stageAssetDb, stageTelemetry } from "@/lib/ingest";
import { startJob } from "@/lib/jobs";
import { getSiteSummary, listSources, removeUpload } from "@/lib/model";
import { fail, handle, ok, parseId } from "@/lib/http";
import { SOURCE_KINDS, type UploadKind } from "@/lib/types";

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
  const kind = String(form.get("kind") ?? "") as UploadKind;
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
    const sourceId = insertSource(siteId, "pfd", saved.fileName, saved.filePath, "ingested", "Processing…");
    const drawingId = insertDrawing(siteId, sourceId, saved.fileName, "queued");
    const job = startJob(
      siteId,
      "diagram",
      "Reading diagram",
      async (jc) => {
        const started = Date.now();
        setDrawingStatus(drawingId, "processing");
        jc.step("Rendering page image");
        await storePageImage(siteId, drawingId, saved.filePath, jc);
        const usage = { input: 0, output: 0 };
        const d = await extractDiagram(saved.filePath, jc, usage);
        jc.step("Building site model");
        const r = saveDrawing(siteId, drawingId, sourceId, d, {
          ingestMs: Date.now() - started,
          tokensIn: usage.input,
          tokensOut: usage.output,
        });
        const num = d.title_block.drawing_number || saved.fileName;
        raw()
          .prepare(`UPDATE sources SET summary = ? WHERE id = ?`)
          .run(
            `${num}${d.title_block.revision ? ` rev ${d.title_block.revision}` : ""}: ${r.assets} components and ${r.edges} connections${
              d.status === "partial" ? `; partial read (${d.partial_reason || "part of the sheet unreadable"})` : ""
            }${r.replaced ? `; replaced ${r.replaced} earlier revision` : ""}.`,
            sourceId,
          );
        return `${num}: ${r.assets} components, ${r.edges} connections${d.status === "partial" ? " (partial read)" : ""}.`;
      },
      (err) => {
        // The drawing stays in the register as failed, with the reason, so the read can be retried.
        const reason = toUserMessage(err);
        setDrawingStatus(drawingId, "failed", reason);
        raw().prepare(`UPDATE sources SET status = 'failed', summary = ? WHERE id = ?`).run(`Failed: ${reason}`, sourceId);
        return reason;
      },
    );
    return ok({ job, drawingId }, 202);
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

/** Stores a PNG of page 1 for the drawing viewer. Images are used as-is. A render failure is not fatal. */
async function storePageImage(siteId: number, drawingId: number, filePath: string, jc: JobContext) {
  if (!filePath.toLowerCase().endsWith(".pdf")) {
    setDrawingImage(drawingId, filePath);
    return;
  }
  try {
    const png = await renderFirstPagePng(new Uint8Array(fs.readFileSync(filePath)));
    const out = path.join(UPLOAD_DIR, String(siteId), `drawing-${drawingId}.png`);
    fs.writeFileSync(out, png);
    setDrawingImage(drawingId, out);
  } catch (err) {
    console.error("[render]", err);
    jc.warn("The page image could not be rendered, so the drawing viewer will show no image for this sheet.");
  }
}
