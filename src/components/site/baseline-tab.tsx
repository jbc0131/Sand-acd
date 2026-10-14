"use client";

import * as React from "react";
import { Check, Dices, Download, Info, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Tooltip as TooltipPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, jsonInit } from "@/lib/client";
import type { Baseline, GroupBaseline } from "@/lib/baseline-types";
import { DRAWING_TYPE_LABELS, type DrawingType } from "@/lib/types";
import { cn } from "@/lib/utils";

const pct = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v: number | null, d = 1) => (v == null ? "—" : v.toLocaleString(undefined, { maximumFractionDigits: d, minimumFractionDigits: d }));
const secs = (ms: number | null) => (ms == null ? "—" : `${(ms / 1000).toFixed(1)} s`);

function Formula({ text }: { text: string }) {
  return (
    <TooltipPrimitive.Root delayDuration={100}>
      <TooltipPrimitive.Trigger asChild>
        <button type="button" className="text-muted hover:text-text" aria-label={`Formula: ${text}`}>
          <Info className="size-3.5" />
        </button>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          sideOffset={4}
          className="z-50 max-w-xs rounded-lg bg-dark-surface px-2.5 py-1.5 font-mono text-[11px] text-dark-surface-fg shadow-float"
        >
          {text}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

function Card({ title, formula, children, testId }: { title: string; formula: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="rounded-xl border border-border bg-panel p-4 shadow-card" data-testid={testId}>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Formula text={formula} />
      </div>
      {children}
    </section>
  );
}

function VsTarget({ value, target }: { value: number | null; target: number }) {
  if (value == null) return <span className="text-lg font-semibold text-muted">—</span>;
  const ok = value >= target;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className={cn("text-lg font-semibold tabular-nums", ok ? "text-accent" : "text-amber-fg")}>{pct(value)}</span>
      <span className="text-[11px] text-muted">target {pct(target)}</span>
    </span>
  );
}

function AccuracyCard({ g, target, formulas }: { g: GroupBaseline; target: number; formulas: Baseline["formulas"] }) {
  return (
    <Card title="Accuracy" formula={`${formulas.precision}\n${formulas.recall}`} testId={`accuracy-${g.key}`}>
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] tracking-wider text-muted uppercase">
          <tr>
            <th className="py-1 font-semibold" />
            <th className="py-1 font-semibold">Precision</th>
            <th className="py-1 font-semibold">Recall</th>
            <th className="py-1 text-right font-semibold">A / C / R / M</th>
          </tr>
        </thead>
        <tbody>
          {(["component", "attribute", "connection"] as const).map((t) => {
            const a = g.accuracy[t];
            return (
              <tr key={t} className="border-t border-border" data-testid={`accuracy-${g.key}-${t}`}>
                <td className="py-1.5 capitalize">{t}s</td>
                <td className="py-1.5" data-testid="precision">
                  <VsTarget value={a.precision} target={target} />
                </td>
                <td className="py-1.5" data-testid="recall">
                  <VsTarget value={a.recall} target={target} />
                </td>
                <td className="py-1.5 text-right font-mono text-xs text-muted">
                  {a.accepted}/{a.corrected}/{a.rejected}/{a.addedMissing}
                  {a.ambiguous ? ` · ${a.ambiguous}?` : ""}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted">A accepted · C corrected · R rejected · M added missing · ? ambiguous (excluded)</p>
    </Card>
  );
}

function GroupCards({ g, b }: { g: GroupBaseline; b: Baseline }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" data-testid={`baseline-group-${g.key}`}>
      <AccuracyCard g={g} target={b.target} formulas={b.formulas} />
      <Card title="Ingestion time per drawing" formula={b.formulas.ingest}>
        <div className="flex gap-6">
          <Stat label="Mean" value={secs(g.ingest.meanMs)} />
          <Stat label="p90" value={secs(g.ingest.p90Ms)} />
          <Stat label="Drawings" value={String(g.ingest.n)} />
        </div>
      </Card>
      <Card title="SME minutes per drawing" formula={`${b.formulas.smeFull}\n${b.formulas.smeFlagged}`} testId={`sme-${g.key}`}>
        <div className="flex gap-6">
          <Stat label="Full verification" value={g.sme.meanFullMinutes == null ? "—" : `${num(g.sme.meanFullMinutes, 2)} min`} testId="sme-full" />
          <Stat label="Flagged items" value={g.sme.meanFlaggedMinutes == null ? "—" : `${num(g.sme.meanFlaggedMinutes, 2)} min`} testId="sme-flagged" />
          <Stat label="Reviewed" value={String(g.sme.reviewedDrawings)} />
        </div>
      </Card>
      <Card title="Confidence-flag effectiveness" formula={b.formulas.flagEffectiveness}>
        <div className="flex gap-6">
          <Stat label="Flagged changed" value={pct(g.flags.flaggedShare)} hint={`${g.flags.flaggedChanged} of ${g.flags.flaggedReviewed}`} />
          <Stat label="Unflagged changed" value={pct(g.flags.unflaggedShare)} hint={`${g.flags.unflaggedChanged} of ${g.flags.unflaggedReviewed}`} />
        </div>
        <p className="mt-1 text-[11px] text-muted">Flags work when flagged items are changed far more often than unflagged ones.</p>
      </Card>
      <Card title="Discrepancies found" formula={b.formulas.discrepancies}>
        <div className="flex gap-6">
          <Stat label="Open" value={String(g.discrepancies.open)} />
          <Stat label="Resolved" value={String(g.discrepancies.resolved)} />
        </div>
      </Card>
      <Card title="Cost per drawing" formula={b.rates ? b.formulas.cost : `${b.formulas.cost} (rates not configured)`}>
        <div className="flex gap-6">
          <Stat label="Tokens in" value={num(g.cost.meanTokensIn, 0)} />
          <Stat label="Tokens out" value={num(g.cost.meanTokensOut, 0)} />
          {b.rates && <Stat label="Cost" value={g.cost.meanCost == null ? "—" : `$${g.cost.meanCost.toFixed(3)}`} />}
        </div>
        {!b.rates && (
          <p className="mt-1 text-[11px] text-muted">
            Rates aren&apos;t configured. Set CDA_PRICE_IN_PER_MTOK and CDA_PRICE_OUT_PER_MTOK to show cost.
          </p>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId?: string }) {
  return (
    <div>
      <div className="text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </div>
      <div className="text-[11px] text-muted">{label}</div>
      {hint && <div className="text-[11px] text-muted">{hint}</div>}
    </div>
  );
}

export function BaselineTab({ siteId, refreshKey }: { siteId: number; refreshKey: number }) {
  const [b, setB] = React.useState<Baseline | null>(null);
  const [group, setGroup] = React.useState("overall");
  const [n, setN] = React.useState("30");
  const [open, setOpen] = React.useState<number | null>(null);
  const [busy, setBusy] = React.useState(false);

  const load = React.useCallback(async () => {
    try {
      setB(await api<Baseline>(`/api/sites/${siteId}/baseline`));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [siteId]);

  React.useEffect(() => {
    let live = true;
    api<Baseline>(`/api/sites/${siteId}/baseline`)
      .then((d) => live && setB(d))
      .catch((e: Error) => toast.error(e.message));
    return () => {
      live = false;
    };
  }, [siteId, refreshKey]);

  const draw = async () => {
    setBusy(true);
    try {
      const r = await api<{ n: number }>(`/api/sites/${siteId}/link-sample`, jsonInit("POST", { n: Number(n) || 30 }));
      toast.success(`Drew ${r.n} random links for review.`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const mark = async (linkId: number, assetTag: string, status: "correct" | "incorrect") => {
    // Optimistic update, then reload the percentages.
    setB((prev) =>
      prev ? { ...prev, linkTest: { ...prev.linkTest, items: prev.linkTest.items.map((i) => (i.id === linkId ? { ...i, status } : i)) } } : prev,
    );
    try {
      const link = b?.linkTest.items.find((i) => i.id === linkId);
      if (!link) return;
      await api(`/api/sites/${siteId}/link-test/${linkId}`, jsonInit("PATCH", { status }));
      await load();
    } catch (e) {
      toast.error(`${assetTag}: ${(e as Error).message}`);
    }
  };

  if (!b) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoaderCircle className="size-6 animate-spin text-muted" />
      </div>
    );
  }
  const g = group === "overall" ? b.overall : (b.byType.find((t) => t.key === group) ?? b.overall);
  const lt = b.linkTest;

  return (
    <TooltipPrimitive.Provider>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6" data-testid="baseline-tab">
        <div className="mx-auto max-w-7xl space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="mr-auto">
              <h2 className="font-semibold">Value Baseline</h2>
              <p className="text-sm text-muted">Computed live from SME review data. Hover the ⓘ on any card for its formula.</p>
            </div>
            <Button variant="outline" asChild>
              <a href={`/api/sites/${siteId}/baseline?format=csv`} download data-testid="baseline-csv">
                <Download /> Export CSV
              </a>
            </Button>
            <Button variant="outline" asChild>
              <a href={`/api/sites/${siteId}/baseline?format=json`} download data-testid="baseline-json">
                <Download /> Export JSON
              </a>
            </Button>
          </div>

          <div className="flex flex-wrap gap-1 rounded-full border border-border bg-page p-1 text-sm" role="tablist" aria-label="Drawing type">
            {[b.overall, ...b.byType].map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={group === t.key}
                onClick={() => setGroup(t.key)}
                className={cn("rounded-full px-3 py-1", group === t.key ? "bg-accent text-accent-fg" : "text-muted hover:text-text")}
                data-testid={`baseline-type-${t.key}`}
              >
                {t.label} <span className="text-xs opacity-80">({t.drawings})</span>
              </button>
            ))}
          </div>

          <GroupCards g={g} b={b} />

          <Card title="Document-link test" formula={b.formulas.linkTest} testId="link-test">
            <div className="flex flex-wrap items-end gap-4">
              <div>
                <VsTarget value={lt.pct} target={b.target} />
                <div className="text-[11px] text-muted" data-testid="link-test-count">
                  {lt.correct} correct of {lt.marked} marked · sample {lt.sampleSize} of {lt.totalLinks} links
                </div>
              </div>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-muted">
                Sample size
                <Input value={n} onChange={(e) => setN(e.target.value.replace(/\D/g, ""))} className="h-8 w-16" aria-label="Link sample size" />
              </label>
              <Button variant="outline" onClick={draw} disabled={busy}>
                <Dices /> Draw link sample
              </Button>
            </div>
            {lt.items.length > 0 && (
              <ul className="mt-3 divide-y divide-border rounded-lg border border-border" data-testid="link-sample">
                {lt.items.map((i) => (
                  <li key={i.id} className="px-3 py-2 text-sm" data-testid="link-sample-item" data-status={i.status}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{i.assetTag}</span>
                      <span className="text-muted">→</span>
                      <button type="button" className="text-left underline decoration-dotted" onClick={() => setOpen(open === i.id ? null : i.id)}>
                        {i.file} §{i.sectionNo} (p. {i.page})
                      </button>
                      <span className="rounded-full bg-chip-bg px-1.5 text-[10px] text-chip-fg">{i.linkType.replace("_", " ")}</span>
                      <span className="ml-auto flex gap-1">
                        <Button
                          size="sm"
                          variant={i.status === "correct" ? "default" : "outline"}
                          onClick={() => mark(i.id, i.assetTag, "correct")}
                          aria-label={`Mark ${i.assetTag} §${i.sectionNo} correct`}
                        >
                          <Check /> Correct
                        </Button>
                        <Button
                          size="sm"
                          variant={i.status === "incorrect" ? "destructive" : "outline"}
                          onClick={() => mark(i.id, i.assetTag, "incorrect")}
                          aria-label={`Mark ${i.assetTag} §${i.sectionNo} incorrect`}
                        >
                          <X /> Incorrect
                        </Button>
                      </span>
                    </div>
                    {open === i.id && <p className="mt-1.5 rounded bg-page p-2 text-xs whitespace-pre-wrap text-muted">{i.text}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <section className="rounded-xl border border-border bg-panel shadow-card">
            <h3 className="border-b border-border px-4 py-2.5 text-sm font-semibold">Per drawing</h3>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-left text-[11px] tracking-wider text-muted uppercase">
                  <tr>
                    {["Drawing", "Type", "Status", "Ingest", "SME min", "Flagged min", "Tokens in", "Tokens out", "Cost"].map((h) => (
                      <th key={h} className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {b.perDrawing.map((d) => (
                    <tr key={d.id}>
                      <td className="px-3 py-1.5 font-mono text-xs">
                        {d.drawingNumber ?? `#${d.id}`}
                        {d.revision ? ` rev ${d.revision}` : ""}
                      </td>
                      <td className="px-3 py-1.5 text-xs">{DRAWING_TYPE_LABELS[d.type as DrawingType] ?? d.type}</td>
                      <td className="px-3 py-1.5 text-xs">{d.status}</td>
                      <td className="px-3 py-1.5 tabular-nums">{secs(d.ingestMs)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{num(d.activeMinutes, 2)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{num(d.flaggedMinutes, 2)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{num(d.tokensIn, 0)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{num(d.tokensOut, 0)}</td>
                      <td className="px-3 py-1.5 tabular-nums">{d.cost == null ? (b.rates ? "—" : "rates not set") : `$${d.cost.toFixed(3)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </TooltipPrimitive.Provider>
  );
}
