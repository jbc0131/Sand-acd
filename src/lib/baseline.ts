import "server-only";
import { raw } from "./db";
import { DRAWING_TYPE_LABELS, type DrawingType, type ReviewTargetType } from "./types";
import type { Accuracy, Baseline, GroupBaseline, LinkSampleItem } from "./baseline-types";

export type { Accuracy, Baseline, GroupBaseline, LinkSampleItem };

// Value baseline. Every figure is computed from review data at request time; nothing is stored.

export const TARGET = 0.9;

export const FORMULAS = {
  precision: "precision = accepted / (accepted + corrected + rejected)",
  recall: "recall = (accepted + corrected) / (accepted + corrected + added_missing)",
  ingest: "mean and p90 (nearest rank) of drawing ingest time, parsed and partial drawings",
  smeFull: "mean over reviewed drawings of total active review minutes per drawing (visible tab, idle > 2 min excluded)",
  smeFlagged: "mean over reviewed drawings of active minutes spent with a flagged item selected",
  flagEffectiveness:
    "share changed = (corrected + rejected) / (accepted + corrected + rejected), for flagged items vs unflagged items",
  discrepancies: "count of parameter discrepancies between drawings, by status",
  cost: "cost per drawing = (tokens_in × CDA_PRICE_IN_PER_MTOK + tokens_out × CDA_PRICE_OUT_PER_MTOK) / 1,000,000, averaged over drawings",
  linkTest: "% correct = links marked correct / links marked, within the current random sample",
} as const;

export function priceRates(): { inPerMTok: number; outPerMTok: number } | null {
  const i = process.env.CDA_PRICE_IN_PER_MTOK;
  const o = process.env.CDA_PRICE_OUT_PER_MTOK;
  if (!i || !o || !i.trim() || !o.trim()) return null;
  const inPerMTok = Number(i);
  const outPerMTok = Number(o);
  if (!Number.isFinite(inPerMTok) || !Number.isFinite(outPerMTok)) return null;
  return { inPerMTok, outPerMTok };
}

const ratio = (n: number, d: number) => (d > 0 ? n / d : null);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
function p90(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
}

export function computeBaseline(siteId: number): Baseline {
  const db = raw();
  const rates = priceRates();
  const drawings = db
    .prepare(`SELECT id, drawing_number, revision, drawing_type, status, ingest_ms, tokens_in, tokens_out FROM drawings WHERE site_id = ? ORDER BY drawing_number, id`)
    .all(siteId) as {
    id: number;
    drawing_number: string | null;
    revision: string | null;
    drawing_type: DrawingType;
    status: string;
    ingest_ms: number | null;
    tokens_in: number | null;
    tokens_out: number | null;
  }[];
  const items = db
    .prepare(`SELECT drawing_id, target_type, state, flagged FROM review_items WHERE site_id = ?`)
    .all(siteId) as { drawing_id: number; target_type: ReviewTargetType; state: string; flagged: number }[];
  const sessions = db
    .prepare(`SELECT drawing_id, SUM(active_ms) AS active, SUM(flagged_ms) AS flagged FROM review_sessions WHERE site_id = ? GROUP BY drawing_id`)
    .all(siteId) as { drawing_id: number; active: number; flagged: number }[];
  const discs = db.prepare(`SELECT values_json, status FROM discrepancies WHERE site_id = ?`).all(siteId) as {
    values_json: string;
    status: "open" | "resolved";
  }[];
  const sessionBy = new Map(sessions.map((s) => [s.drawing_id, s]));
  const costOf = (tin: number | null, tout: number | null) =>
    rates && tin != null && tout != null ? (tin * rates.inPerMTok + tout * rates.outPerMTok) / 1_000_000 : null;

  const group = (key: string, label: string, ds: typeof drawings): GroupBaseline => {
    const ids = new Set(ds.map((d) => d.id));
    const its = items.filter((i) => ids.has(i.drawing_id));
    const accuracy = {} as Record<ReviewTargetType, Accuracy>;
    for (const t of ["component", "attribute", "connection"] as ReviewTargetType[]) {
      const c = (s: string) => its.filter((i) => i.target_type === t && i.state === s).length;
      const a = c("accepted");
      const co = c("corrected");
      const r = c("rejected");
      const m = c("added_missing");
      accuracy[t] = {
        accepted: a,
        corrected: co,
        rejected: r,
        addedMissing: m,
        ambiguous: c("ambiguous"),
        precision: ratio(a, a + co + r),
        recall: ratio(a + co, a + co + m),
      };
    }
    const ingested = ds.filter((d) => (d.status === "parsed" || d.status === "partial") && d.ingest_ms != null);
    const ingestMs = ingested.map((d) => d.ingest_ms!);
    const reviewed = ds.map((d) => sessionBy.get(d.id)).filter((s): s is NonNullable<typeof s> => Boolean(s && s.active > 0));
    const decided = its.filter((i) => ["accepted", "corrected", "rejected"].includes(i.state));
    const changed = (xs: typeof decided) => xs.filter((i) => i.state !== "accepted").length;
    const fl = decided.filter((i) => i.flagged);
    const un = decided.filter((i) => !i.flagged);
    let open = 0;
    let resolved = 0;
    for (const d of discs) {
      const involved = (JSON.parse(d.values_json) as { drawingIds: number[] }[]).some((v) => v.drawingIds.some((id) => ids.has(id)));
      if (!involved) continue;
      if (d.status === "open") open++;
      else resolved++;
    }
    const withTokens = ingested.filter((d) => d.tokens_in != null && d.tokens_out != null);
    return {
      key,
      label,
      drawings: ds.length,
      accuracy,
      ingest: { meanMs: mean(ingestMs), p90Ms: p90(ingestMs), n: ingestMs.length },
      sme: {
        reviewedDrawings: reviewed.length,
        meanFullMinutes: mean(reviewed.map((s) => s.active / 60000)),
        meanFlaggedMinutes: mean(reviewed.map((s) => s.flagged / 60000)),
      },
      flags: {
        flaggedReviewed: fl.length,
        flaggedChanged: changed(fl),
        flaggedShare: ratio(changed(fl), fl.length),
        unflaggedReviewed: un.length,
        unflaggedChanged: changed(un),
        unflaggedShare: ratio(changed(un), un.length),
      },
      discrepancies: { open, resolved },
      cost: {
        meanTokensIn: mean(withTokens.map((d) => d.tokens_in!)),
        meanTokensOut: mean(withTokens.map((d) => d.tokens_out!)),
        meanCost: rates ? mean(withTokens.map((d) => costOf(d.tokens_in, d.tokens_out)!)) : null,
        n: withTokens.length,
      },
    };
  };

  const types = [...new Set(drawings.map((d) => d.drawing_type))].sort();
  const links = linkTest(siteId);
  return {
    target: TARGET,
    formulas: FORMULAS,
    rates,
    overall: group("overall", "All drawings", drawings),
    byType: types.map((t) => group(t, DRAWING_TYPE_LABELS[t] ?? t, drawings.filter((d) => d.drawing_type === t))),
    perDrawing: drawings.map((d) => {
      const s = sessionBy.get(d.id);
      return {
        id: d.id,
        drawingNumber: d.drawing_number,
        revision: d.revision,
        type: d.drawing_type,
        status: d.status,
        ingestMs: d.ingest_ms,
        activeMinutes: (s?.active ?? 0) / 60000,
        flaggedMinutes: (s?.flagged ?? 0) / 60000,
        tokensIn: d.tokens_in,
        tokensOut: d.tokens_out,
        cost: costOf(d.tokens_in, d.tokens_out),
      };
    }),
    linkTest: links,
  };
}

function linkTest(siteId: number): Baseline["linkTest"] {
  const db = raw();
  const rows = db
    .prepare(
      `SELECT l.id, l.link_type, l.created_by, l.status, l.in_sample, a.tag, a.name, c.section_no, c.page, c.text, s.file_name
       FROM asset_doc_links l JOIN assets a ON a.id = l.asset_id JOIN kb_chunks c ON c.id = l.chunk_id JOIN sources s ON s.id = c.source_id
       WHERE a.site_id = ? ORDER BY a.tag, c.section_no`,
    )
    .all(siteId) as {
    id: number;
    link_type: string;
    created_by: string;
    status: LinkSampleItem["status"];
    in_sample: number;
    tag: string;
    name: string;
    section_no: number;
    page: number;
    text: string;
    file_name: string;
  }[];
  const sample = rows.filter((r) => r.in_sample);
  const marked = sample.filter((r) => r.status !== "unreviewed");
  const correct = marked.filter((r) => r.status === "correct").length;
  return {
    sampleSize: sample.length,
    marked: marked.length,
    correct,
    pct: ratio(correct, marked.length),
    totalLinks: rows.length,
    items: sample.map((r) => ({
      id: r.id,
      assetTag: r.tag,
      assetName: r.name,
      sectionNo: r.section_no,
      page: r.page,
      file: r.file_name,
      linkType: r.link_type,
      createdBy: r.created_by,
      status: r.status,
      text: r.text,
    })),
  };
}

/** Picks n random links for the SME link test, replacing any previous sample. */
export function drawLinkSample(siteId: number, n: number): number {
  const db = raw();
  const ids = (
    db
      .prepare(`SELECT l.id FROM asset_doc_links l JOIN assets a ON a.id = l.asset_id WHERE a.site_id = ?`)
      .all(siteId) as { id: number }[]
  ).map((r) => r.id);
  // Fisher-Yates shuffle, then take n.
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const pick = new Set(ids.slice(0, Math.max(1, Math.min(n, ids.length))));
  db.transaction(() => {
    db.prepare(`UPDATE asset_doc_links SET in_sample = 0 WHERE asset_id IN (SELECT id FROM assets WHERE site_id = ?)`).run(siteId);
    const mark = db.prepare(`UPDATE asset_doc_links SET in_sample = 1, status = 'unreviewed' WHERE id = ?`);
    for (const id of pick) mark.run(id);
  })();
  return pick.size;
}

/** Flattens the baseline into CSV rows: group, metric, value, numerator, denominator, formula. */
export function baselineCsvRows(b: Baseline): Record<string, string | number | null>[] {
  const rows: Record<string, string | number | null>[] = [];
  const add = (group: string, metric: string, value: number | null, num: number | null, den: number | null, formula: string) =>
    rows.push({ group, metric, value: value == null ? "" : Math.round(value * 10000) / 10000, numerator: num, denominator: den, formula });
  for (const g of [b.overall, ...b.byType]) {
    for (const t of ["component", "attribute", "connection"] as ReviewTargetType[]) {
      const a = g.accuracy[t];
      add(g.label, `${t}_precision`, a.precision, a.accepted, a.accepted + a.corrected + a.rejected, FORMULAS.precision);
      add(g.label, `${t}_recall`, a.recall, a.accepted + a.corrected, a.accepted + a.corrected + a.addedMissing, FORMULAS.recall);
    }
    add(g.label, "ingest_mean_ms", g.ingest.meanMs, null, g.ingest.n, FORMULAS.ingest);
    add(g.label, "ingest_p90_ms", g.ingest.p90Ms, null, g.ingest.n, FORMULAS.ingest);
    add(g.label, "sme_full_minutes_per_drawing", g.sme.meanFullMinutes, null, g.sme.reviewedDrawings, FORMULAS.smeFull);
    add(g.label, "sme_flagged_minutes_per_drawing", g.sme.meanFlaggedMinutes, null, g.sme.reviewedDrawings, FORMULAS.smeFlagged);
    add(g.label, "flagged_share_changed", g.flags.flaggedShare, g.flags.flaggedChanged, g.flags.flaggedReviewed, FORMULAS.flagEffectiveness);
    add(g.label, "unflagged_share_changed", g.flags.unflaggedShare, g.flags.unflaggedChanged, g.flags.unflaggedReviewed, FORMULAS.flagEffectiveness);
    add(g.label, "discrepancies_open", g.discrepancies.open, null, null, FORMULAS.discrepancies);
    add(g.label, "discrepancies_resolved", g.discrepancies.resolved, null, null, FORMULAS.discrepancies);
    add(g.label, "mean_tokens_in", g.cost.meanTokensIn, null, g.cost.n, FORMULAS.cost);
    add(g.label, "mean_tokens_out", g.cost.meanTokensOut, null, g.cost.n, FORMULAS.cost);
    add(g.label, "mean_cost_per_drawing", g.cost.meanCost, null, g.cost.n, b.rates ? FORMULAS.cost : "rates not configured");
  }
  add("All drawings", "doc_link_pct_correct", b.linkTest.pct, b.linkTest.correct, b.linkTest.marked, FORMULAS.linkTest);
  return rows;
}
