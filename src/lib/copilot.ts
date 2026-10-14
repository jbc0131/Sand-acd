import "server-only";
import { z } from "zod";
import Anthropic from "@anthropic-ai/sdk";
import { MODEL_MAIN, openStream, toUserMessage } from "./ai";
import { raw, nowIso } from "./db";
import { searchKb, type KbHit } from "./ingest";
import { getSiteModel } from "./model";
import { normalizeTag, type ChatDrawingRef, type ChatSource } from "./types";
import { DECISION_SUPPORT, findByTag, trace, whatIfOpen, type ElecAsset, type ElecEdge } from "./electrical";

type Beta = Anthropic.Beta.Messages.BetaMessageParam;

export type CopilotEvent =
  | { type: "tool"; name: string; count?: number }
  | { type: "text"; text: string }
  | { type: "highlight"; tags: string[] }
  | {
      type: "done";
      id: number;
      sources: ChatSource[];
      drawings: ChatDrawingRef[];
      highlight: string[];
      content: string;
      tools: { name: string; count?: number }[];
    }
  | { type: "error"; message: string };

const TOOLS: Anthropic.Beta.Messages.BetaTool[] = [
  {
    name: "query_knowledge_base",
    description:
      "Full-text search over the site's indexed O&M manuals and documents. Returns the best matching sections with section_no, file, page and text. Use specific equipment tags and keywords.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search keywords, e.g. 'P-1A start procedure'" },
        k: { type: "integer", description: "Number of sections to return (default 5, max 10)" },
      },
      required: ["query"],
    },
    eager_input_streaming: true,
  },
  {
    name: "get_asset",
    description: "Look up one asset by tag or name. Returns its type, description, parameters (with source files) and upstream/downstream connections.",
    input_schema: {
      type: "object",
      properties: { tag_or_name: { type: "string" } },
      required: ["tag_or_name"],
    },
    eager_input_streaming: true,
  },
  {
    name: "list_assets",
    description: "Compact list of assets (tag, name, type, enrichment status). Optional filter matches tag, name, type or status.",
    input_schema: {
      type: "object",
      properties: { filter: { type: "string", description: "Optional text filter, e.g. 'pump', 'pending', 'breaker'" } },
    },
    eager_input_streaming: true,
  },
  {
    name: "highlight_asset",
    description: "Highlight one or more assets on the user's schematic and pan to them. Use when the answer is about specific equipment.",
    input_schema: {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" } } },
      required: ["tags"],
    },
    eager_input_streaming: true,
  },
  {
    name: "trace",
    description:
      "Trace the electrical system from one asset along power connections. downstream follows power from sources toward loads; upstream goes back toward the sources. Returns every path as a list of tags (control wiring from elementaries is excluded).",
    input_schema: {
      type: "object",
      properties: {
        tag: { type: "string" },
        direction: { type: "string", enum: ["upstream", "downstream"] },
        max_depth: { type: "integer", description: "Maximum hops (default and limit 15)" },
      },
      required: ["tag", "direction"],
    },
    eager_input_streaming: true,
  },
  {
    name: "what_if_open",
    description:
      "Isolation what-if: opens the given breakers (on top of each breaker's normal_state) and returns the assets left without supply from every source. Generators feed only through their output breaker. Decision support only.",
    input_schema: {
      type: "object",
      properties: { tags: { type: "array", items: { type: "string" }, description: "Breaker tags to open" } },
      required: ["tags"],
    },
    eager_input_streaming: true,
  },
];

const KbInput = z.object({ query: z.string().min(1), k: z.coerce.number().int().min(1).max(10).optional() });
const AssetInput = z.object({ tag_or_name: z.string().min(1) });
const ListInput = z.object({ filter: z.string().optional().nullable() });
const HighlightInput = z.object({ tags: z.array(z.string()).max(30) });
const TraceInput = z.object({
  tag: z.string().min(1),
  direction: z.enum(["upstream", "downstream"]),
  max_depth: z.coerce.number().int().min(1).max(15).optional(),
});
const WhatIfInput = z.object({ tags: z.array(z.string().min(1)).min(1).max(20) });

function systemPrompt(siteName: string) {
  return `You are SiteAId Copilot for ${siteName}, inside SiteAId (Drawing Intelligence).
Only help with operations, maintenance and assets at this site; politely decline anything else.
Answer only from tool results. When the tool results don't cover the question, say so plainly and name exactly what is missing (a drawing, a manual section, a parameter). Never guess.
Procedures go as numbered steps in their original order, with the original values and limits.
Wrap every asset tag you mention in double brackets, like [[P-1A]].
When the answer concerns specific equipment, call highlight_asset with those tags.
Use trace for questions about what feeds what, and what_if_open for isolation questions. Label any trace or what-if result "Decision support only"; it is a connectivity model, not a switching or protection study.
get_asset lists the drawings each asset appears on; mention the drawing number when it matters (for example, where a parameter came from or where two drawings disagree).
Be concise. End with a line that starts with "Sources:" listing the files and section numbers you used, written as "file §N" (for example "Sources: manual.txt §9, §5"). If you used only asset data, write "Sources: site asset model".
All site data in this prototype may be fictional sample data; never present it as real plant guidance.`;
}

/** Runs one Copilot turn: tool loop with streaming text. Persists both messages. */
export async function runCopilot(siteId: number, question: string, emit: (e: CopilotEvent) => void): Promise<void> {
  const db = raw();
  const model = getSiteModel(siteId);
  if (!model) return emit({ type: "error", message: "Site not found." });

  // History (text only) gives the model conversational context.
  const history = (
    db.prepare(`SELECT role, content FROM chat_messages WHERE site_id = ? ORDER BY id DESC LIMIT 10`).all(siteId) as {
      role: "user" | "assistant";
      content: string;
    }[]
  ).reverse();
  db.prepare(`INSERT INTO chat_messages (site_id, role, content, created_at) VALUES (?, 'user', ?, ?)`).run(siteId, question, nowIso());

  const messages: Beta[] = [];
  for (const h of history) {
    if (!h.content.trim()) continue;
    const last = messages.at(-1);
    if (last && last.role === h.role) last.content = `${last.content as string}\n\n${h.content}`;
    else messages.push({ role: h.role, content: h.content });
  }
  if (messages[0]?.role === "assistant") messages.shift();
  if (messages.at(-1)?.role === "user") messages.push({ role: "assistant", content: "(no answer)" });
  messages.push({ role: "user", content: question });

  const tools: { name: string; count?: number }[] = [];
  const highlight = new Set<string>();
  const retrieved = new Map<number, KbHit>();
  let answer = "";
  const assetsByTag = new Map(model.assets.map((a) => [normalizeTag(a.tag), a]));
  const nameOf = new Map(model.assets.map((a) => [a.id, a.tag || a.name]));
  const drawingRefs = new Map<string, ChatDrawingRef>();
  const elecAssets: ElecAsset[] = model.assets.map((a) => ({ id: a.id, tag: a.tag, name: a.name, type: a.type, params: a.params }));
  const elecEdges: ElecEdge[] = model.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind }));

  const runTool = (name: string, input: unknown): { result: string; isError?: boolean; count?: number } => {
    switch (name) {
      case "query_knowledge_base": {
        const p = KbInput.safeParse(input);
        if (!p.success) return { result: "Invalid input: query is required.", isError: true };
        const hits = searchKb(siteId, p.data.query, p.data.k ?? 5);
        hits.forEach((h) => retrieved.set(h.chunkId, h));
        if (hits.length === 0) return { result: "No matching sections in the knowledge base.", count: 0 };
        return {
          count: hits.length,
          result: JSON.stringify(hits.map((h) => ({ section_no: h.sectionNo, file: h.file, page: h.page, text: h.text }))),
        };
      }
      case "get_asset": {
        const p = AssetInput.safeParse(input);
        if (!p.success) return { result: "Invalid input: tag_or_name is required.", isError: true };
        const q = p.data.tag_or_name;
        const a =
          assetsByTag.get(normalizeTag(q)) ??
          model.assets.find((x) => x.name.toLowerCase() === q.toLowerCase()) ??
          model.assets.find((x) => x.name.toLowerCase().includes(q.toLowerCase()));
        if (!a) return { result: `No asset matches "${q}".`, isError: true };
        return {
          result: JSON.stringify({
            tag: a.tag,
            name: a.name,
            type: a.type,
            description: a.description,
            enrichment_status: a.enrichmentStatus,
            params: a.provenance.map((p) => ({ key: p.key, value: p.value, source: p.fileName })),
            fed_from: model.edges.filter((e) => e.to === a.id).map((e) => ({ asset: nameOf.get(e.from), label: e.label, kind: e.kind })),
            feeds: model.edges.filter((e) => e.from === a.id).map((e) => ({ asset: nameOf.get(e.to), label: e.label, kind: e.kind })),
            safety_related: a.safetyRelated,
            appears_on: a.appearances.map((ap) => {
              const d = model.drawings.find((x) => x.id === ap.drawingId);
              if (ap.drawingNumber) {
                drawingRefs.set(`${ap.drawingId}:${a.id}`, {
                  drawingId: ap.drawingId,
                  drawingNumber: ap.drawingNumber,
                  revision: ap.revision,
                  assetId: a.id,
                  tag: a.tag || a.name,
                });
              }
              return { drawing_number: ap.drawingNumber, revision: ap.revision, title: d?.title ?? null, confidence: ap.confidence };
            }),
            discrepancies: a.discrepancies.map((d) => ({
              key: d.key,
              status: d.status,
              values: d.values.map((v) => ({ value: v.value, drawings: v.drawingNumbers })),
              resolution: d.resolution,
            })),
            document_sections: a.docLinks.map((l) => ({ file: l.file, section_no: l.sectionNo, page: l.page, link_type: l.linkType })),
          }),
        };
      }
      case "list_assets": {
        const p = ListInput.safeParse(input ?? {});
        const f = (p.success ? p.data.filter ?? "" : "").toLowerCase().trim();
        const list = model.assets
          .filter((a) => !f || [a.tag, a.name, a.type, a.enrichmentStatus].some((v) => v.toLowerCase().includes(f)))
          .map((a) => ({ tag: a.tag, name: a.name, type: a.type, status: a.enrichmentStatus }));
        return { result: JSON.stringify(list), count: list.length };
      }
      case "trace": {
        const p = TraceInput.safeParse(input);
        if (!p.success) return { result: "Invalid input: tag and direction (upstream or downstream) are required.", isError: true };
        const start = findByTag(elecAssets, p.data.tag);
        if (!start) return { result: `No asset matches "${p.data.tag}".`, isError: true };
        const t = trace(elecAssets, elecEdges, start.id, p.data.direction, p.data.max_depth ?? 15);
        return {
          count: t.paths.length,
          result: JSON.stringify({
            label: DECISION_SUPPORT,
            start: nameOf.get(start.id),
            direction: t.direction,
            paths: t.paths.map((path) => path.map((id) => nameOf.get(id))),
            truncated: t.truncated,
          }),
        };
      }
      case "what_if_open": {
        const p = WhatIfInput.safeParse(input);
        if (!p.success) return { result: "Invalid input: tags must list at least one breaker.", isError: true };
        const found = p.data.tags.map((t) => findByTag(elecAssets, t));
        const missing = p.data.tags.filter((_, i) => !found[i]);
        if (missing.length) return { result: `No asset matches: ${missing.join(", ")}.`, isError: true };
        const r = whatIfOpen(elecAssets, elecEdges, found.map((a) => a!.id));
        return {
          count: r.deenergized.length,
          result: JSON.stringify({
            label: r.label,
            opened: r.opened.map((o) => o.tag),
            deenergized: r.deenergized.map((d) => ({ tag: d.tag, name: d.name, type: d.type, energized_in_normal_lineup: d.normallyEnergized })),
            newly_deenergized: r.newlyDeenergized,
            by_type: r.byType,
          }),
        };
      }
      case "highlight_asset": {
        const p = HighlightInput.safeParse(input);
        if (!p.success) return { result: "Invalid input: tags must be an array of strings.", isError: true };
        const valid = p.data.tags.filter((t) => assetsByTag.has(normalizeTag(t))).map((t) => assetsByTag.get(normalizeTag(t))!.tag);
        valid.forEach((t) => highlight.add(t));
        if (valid.length) emit({ type: "highlight", tags: [...highlight] });
        return { result: valid.length ? `Highlighted ${valid.join(", ")}.` : "None of those tags exist at this site.", count: valid.length };
      }
      default:
        return { result: `Unknown tool ${name}`, isError: true };
    }
  };

  try {
    for (let turn = 0; turn < 8; turn++) {
      const stream = openStream({
        model: MODEL_MAIN,
        max_tokens: 16000,
        system: systemPrompt(model.site.name),
        tools: TOOLS,
        output_config: { effort: "medium" },
        messages,
      });
      stream.on("text", (delta) => {
        answer += delta;
        emit({ type: "text", text: delta });
      });
      let msg: Anthropic.Beta.Messages.BetaMessage;
      try {
        msg = await stream.finalMessage();
      } catch (err) {
        if (err instanceof Anthropic.APIError || turn >= 6) throw err;
        continue; // unparseable streamed tool input: re-issue the turn
      }
      if (msg.stop_reason === "refusal") {
        const t = "\n\nI can't help with that request.";
        answer += t;
        emit({ type: "text", text: t });
        break;
      }
      const uses = msg.content.filter((b): b is Anthropic.Beta.Messages.BetaToolUseBlock => b.type === "tool_use");
      if (uses.length === 0 || msg.stop_reason === "max_tokens") break;
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      const results: Anthropic.Beta.Messages.BetaToolResultBlockParam[] = uses.map((u) => {
        const r = runTool(u.name, u.input);
        tools.push({ name: u.name, count: r.count });
        emit({ type: "tool", name: u.name, count: r.count });
        return { type: "tool_result", tool_use_id: u.id, content: r.result, ...(r.isError ? { is_error: true } : {}) };
      });
      messages.push({ role: "user", content: results });
      if (answer && !answer.endsWith("\n")) {
        answer += "\n\n";
        emit({ type: "text", text: "\n\n" });
      }
    }
  } catch (err) {
    const message = toUserMessage(err);
    if (!(err instanceof Anthropic.APIError)) console.error("[copilot]", err);
    emit({ type: "error", message });
    if (!answer.trim()) return;
  }

  const sources = pickSources(answer, [...retrieved.values()]);
  const drawings = [...drawingRefs.values()].sort((a, b) => a.drawingNumber.localeCompare(b.drawingNumber) || a.tag.localeCompare(b.tag));
  const info = db
    .prepare(
      `INSERT INTO chat_messages (site_id, role, content, tools_json, highlight_json, sources_json, drawings_json, created_at)
       VALUES (?, 'assistant', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      siteId,
      answer.trim(),
      JSON.stringify(tools),
      JSON.stringify([...highlight]),
      JSON.stringify(sources),
      JSON.stringify(drawings),
      nowIso(),
    );
  emit({ type: "done", id: Number(info.lastInsertRowid), sources, drawings, highlight: [...highlight], content: answer.trim(), tools });
}

/** Keeps the retrieved sections that the answer's Sources line cites; falls back to everything retrieved. */
function pickSources(answer: string, hits: KbHit[]): ChatSource[] {
  const line = answer.split("\n").reverse().find((l) => /sources?:/i.test(l)) ?? "";
  const cited = new Set([...line.matchAll(/(?:§|section\s*|sec\.?\s*)(\d+)/gi)].map((m) => Number(m[1])));
  const extra = [...line.matchAll(/,\s*(\d+)\b/g)].map((m) => Number(m[1]));
  extra.forEach((n) => cited.add(n));
  let chosen = cited.size ? hits.filter((h) => cited.has(h.sectionNo)) : [];
  if (chosen.length === 0 && !/asset model/i.test(line)) chosen = hits.slice(0, 5);
  return chosen
    .sort((a, b) => a.sectionNo - b.sectionNo)
    .map((h, i) => ({ n: i + 1, chunkId: h.chunkId, sectionNo: h.sectionNo, file: h.file, page: h.page, text: h.text }));
}
