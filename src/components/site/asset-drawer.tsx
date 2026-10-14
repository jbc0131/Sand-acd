"use client";

import * as React from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Bot,
  FileText,
  GitBranch,
  Plus,
  Power,
  ShieldAlert,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AssetIcon } from "@/components/asset-icon";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusDot } from "./asset-node";
import { api, jsonInit } from "@/lib/client";
import { LINK_TYPES, STATUS_LABELS, typeLabel, type AssetDTO, type LinkType, type SiteModel, type SourceKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<SourceKind, string> = {
  pfd: "Drawing",
  om: "O&M manual",
  assetdb: "Asset database",
  telemetry: "Telemetry",
  sme: "SME review",
};

interface KbSection {
  id: number;
  sectionNo: number;
  page: number;
  text: string;
  file: string;
}

// Sections are fetched once per site and shared between drawers.
const kbCache = new Map<number, Promise<KbSection[]>>();
function useKb(siteId: number, enabled: boolean) {
  const [sections, setSections] = React.useState<KbSection[] | null>(null);
  React.useEffect(() => {
    if (!enabled) return;
    let p = kbCache.get(siteId);
    if (!p) {
      p = api<{ sections: KbSection[] }>(`/api/sites/${siteId}/kb`).then((r) => r.sections);
      kbCache.set(siteId, p);
      p.catch(() => kbCache.delete(siteId));
    }
    let live = true;
    p.then((s) => live && setSections(s)).catch(() => {});
    return () => {
      live = false;
    };
  }, [siteId, enabled]);
  return sections;
}

export function AssetDrawer({
  asset,
  model,
  whatIfOpen,
  onClose,
  onSelect,
  onAsk,
  onOpenDrawing,
  onTrace,
  onToggleWhatIf,
  onChanged,
}: {
  asset: AssetDTO;
  model: SiteModel;
  whatIfOpen: Set<number>;
  onClose: () => void;
  onSelect: (id: number) => void;
  onAsk: (asset: AssetDTO) => void;
  onOpenDrawing: (drawingId: number, assetId: number) => void;
  onTrace: (assetId: number, direction: "upstream" | "downstream") => void;
  onToggleWhatIf: (assetId: number) => void;
  onChanged: () => Promise<unknown>;
}) {
  const siteId = model.site.id;
  const byId = new Map(model.assets.map((a) => [a.id, a]));
  const incoming = model.edges.filter((e) => e.to === asset.id);
  const outgoing = model.edges.filter((e) => e.from === asset.id);
  const srcOf = new Map<string, string[]>();
  for (const p of asset.provenance) srcOf.set(p.key, [...(srcOf.get(p.key) ?? []), p.fileName]);
  const fileSet = new Map<number, { name: string; kind: SourceKind; count: number }>();
  for (const p of asset.provenance) {
    const f = fileSet.get(p.sourceId) ?? { name: p.fileName, kind: p.sourceKind, count: 0 };
    f.count++;
    fileSet.set(p.sourceId, f);
  }
  const params = Object.entries(asset.params);
  const kb = useKb(siteId, true);
  const [openLink, setOpenLink] = React.useState<number | null>(null);
  const [adding, setAdding] = React.useState(false);
  const [newLink, setNewLink] = React.useState<{ chunkId: string; linkType: LinkType }>({ chunkId: "", linkType: "operating" });
  const isBreaker = asset.type === "breaker";
  const opened = whatIfOpen.has(asset.id);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await onChanged();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-panel shadow-float sm:w-[400px]"
      data-testid="asset-drawer"
      aria-label={`${asset.name} details`}
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <AssetIcon type={asset.type} />
        <div className="min-w-0 flex-1">
          <h2 className="leading-snug font-semibold">
            {asset.name} {asset.tag && <span className="font-normal text-muted">({asset.tag})</span>}
          </h2>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <StatusDot status={asset.enrichmentStatus} /> {STATUS_LABELS[asset.enrichmentStatus]}
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={asset.safetyRelated}
              onClick={() => run(() => api(`/api/sites/${siteId}/assets/${asset.id}`, jsonInit("PATCH", { safetyRelated: !asset.safetyRelated })))}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2 py-0.5",
                asset.safetyRelated ? "border-danger/40 bg-danger-bg text-danger" : "border-border text-muted hover:text-text",
              )}
              data-testid="safety-toggle"
              title="Safety-related items always get full review, whatever the review mode"
            >
              <ShieldAlert className="size-3" /> {asset.safetyRelated ? "Safety-related" : "Not safety-related"}
            </button>
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close details">
          <X />
        </Button>
      </div>
      <div className="flex-1 space-y-5 overflow-y-auto p-4 text-sm">
        <Section title="Description">
          <p className={asset.description ? "" : "text-muted italic"}>{asset.description || "No description yet."}</p>
        </Section>
        <Section title="Asset Type">
          <span className="inline-flex rounded-full bg-amber-bg px-2.5 py-0.5 text-xs font-medium text-amber-fg">{typeLabel(asset.type)}</span>
        </Section>

        <Section title="Appears on">
          {asset.appearances.length === 0 ? (
            <p className="text-muted italic">Not linked to a drawing.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5" data-testid="appears-on">
              {asset.appearances.map((ap) => (
                <button
                  key={ap.id}
                  type="button"
                  onClick={() => onOpenDrawing(ap.drawingId, asset.id)}
                  className="flex items-center gap-1 rounded-md border border-border bg-chip-bg px-2 py-1 font-mono text-xs text-chip-fg hover:border-chip-fg"
                  data-testid="appears-on-chip"
                  title="Open the drawing at this asset"
                >
                  <FileText className="size-3" />
                  {ap.drawingNumber ?? `Drawing ${ap.drawingId}`}
                  {ap.revision ? ` rev ${ap.revision}` : ""}
                </button>
              ))}
            </div>
          )}
        </Section>

        {asset.discrepancies.length > 0 && (
          <Section title="Discrepancies">
            <ul className="space-y-2" data-testid="discrepancies">
              {asset.discrepancies.map((d) => (
                <Discrepancy key={d.id} d={d} onResolve={(resolution, value) =>
                  run(() => api(`/api/sites/${siteId}/discrepancies/${d.id}`, jsonInit("PATCH", { resolution, value })), "Discrepancy resolved.")
                } />
              ))}
            </ul>
          </Section>
        )}

        <Section title="Parameters">
          {params.length === 0 && asset.tag === "" && <p className="text-muted italic">No parameters yet.</p>}
          <dl className="divide-y divide-border rounded-lg border border-border">
            {asset.tag && <Row k="tag" v={asset.tag} />}
            {params.map(([k, v]) => (
              <Row key={k} k={k} v={v} hint={srcOf.get(k)?.join(", ")} />
            ))}
          </dl>
        </Section>

        <Section title="Connections">
          {incoming.length + outgoing.length === 0 && <p className="text-muted italic">No connections.</p>}
          <ul className="space-y-1">
            {[...incoming.map((e) => ({ e, other: e.from, dir: "from" as const })), ...outgoing.map((e) => ({ e, other: e.to, dir: "to" as const }))].map(
              ({ e, other, dir }) => {
                const a = byId.get(other);
                if (!a) return null;
                return (
                  <li key={`${dir}${e.id}`}>
                    <button
                      type="button"
                      onClick={() => onSelect(a.id)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted-bg"
                    >
                      {dir === "from" ? <ArrowLeft className="size-3.5 text-muted" /> : <ArrowRight className="size-3.5 text-muted" />}
                      <span className="text-xs text-muted">{dir}</span>
                      <span className="font-mono text-xs">{a.tag || a.name}</span>
                      {e.kind === "control" && <span className="rounded bg-muted-bg px-1 text-[10px] text-muted">control</span>}
                      {e.label && <span className="ml-auto text-xs text-muted">{e.label}</span>}
                    </button>
                  </li>
                );
              },
            )}
          </ul>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onTrace(asset.id, "upstream")} data-testid="trace-upstream">
              <GitBranch className="rotate-180" /> Trace upstream
            </Button>
            <Button size="sm" variant="outline" onClick={() => onTrace(asset.id, "downstream")} data-testid="trace-downstream">
              <GitBranch /> Trace downstream
            </Button>
            {isBreaker && (
              <Button
                size="sm"
                variant={opened ? "destructive" : "outline"}
                onClick={() => onToggleWhatIf(asset.id)}
                data-testid="what-if-open"
              >
                <Power /> {opened ? "Close again in what-if" : "What if opened"}
              </Button>
            )}
          </div>
          <p className="mt-1 text-[11px] text-muted">Tracing and what-if are decision support only.</p>
        </Section>

        <Section title="Document sections">
          {asset.docLinks.length === 0 && <p className="text-muted italic">No linked sections yet.</p>}
          <ul className="space-y-1" data-testid="doc-links">
            {asset.docLinks.map((l) => {
              const text = kb?.find((s) => s.id === l.chunkId)?.text;
              return (
                <li key={l.id} className="rounded-md border border-border">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-xs" onClick={() => setOpenLink(openLink === l.id ? null : l.id)}>
                      <span className="font-medium">§{l.sectionNo}</span> <span className="text-muted">{l.file}, p. {l.page}</span>
                    </button>
                    <span className="rounded-full bg-chip-bg px-1.5 text-[10px] text-chip-fg">{l.linkType.replace("_", " ")}</span>
                    {l.createdBy === "sme" && <span className="text-[10px] text-muted">SME</span>}
                    <button
                      type="button"
                      onClick={() => run(() => api(`/api/sites/${siteId}/assets/${asset.id}/links/${l.id}`, { method: "DELETE" }), "Link removed.")}
                      className="text-muted hover:text-danger"
                      aria-label={`Remove link to section ${l.sectionNo}`}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                  {openLink === l.id && (
                    <p className="border-t border-border bg-page p-2 text-xs whitespace-pre-wrap text-muted">{text ?? "Loading…"}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {kb && kb.length > 0 && (
            <>
              {adding ? (
                <form
                  className="mt-2 space-y-1.5"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newLink.chunkId) return;
                    void run(
                      () =>
                        api(`/api/sites/${siteId}/assets/${asset.id}/links`, jsonInit("POST", { chunkId: Number(newLink.chunkId), linkType: newLink.linkType })),
                      "Link added.",
                    );
                    setAdding(false);
                  }}
                >
                  <select
                    value={newLink.chunkId}
                    onChange={(e) => setNewLink({ ...newLink, chunkId: e.target.value })}
                    className="h-8 w-full rounded-lg border border-border bg-panel px-2 text-xs"
                    aria-label="Section to link"
                    required
                  >
                    <option value="">Choose a section…</option>
                    {kb.map((s) => (
                      <option key={s.id} value={s.id}>
                        §{s.sectionNo} p.{s.page} · {s.text.replace(/^.*?Page \d+\.\s*/s, "").slice(0, 70)}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-1.5">
                    <select
                      value={newLink.linkType}
                      onChange={(e) => setNewLink({ ...newLink, linkType: e.target.value as LinkType })}
                      className="h-8 flex-1 rounded-lg border border-border bg-panel px-2 text-xs"
                      aria-label="Link type"
                    >
                      {LINK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t.replace("_", " ")}
                        </option>
                      ))}
                    </select>
                    <Button size="sm" type="submit">
                      Add
                    </Button>
                    <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <Button size="sm" variant="ghost" className="mt-1" onClick={() => setAdding(true)}>
                  <Plus /> Add link
                </Button>
              )}
            </>
          )}
        </Section>

        <Section title="Sources">
          {fileSet.size === 0 && <p className="text-muted italic">No source files yet.</p>}
          <ul className="space-y-1.5">
            {[...fileSet.values()].map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-xs">
                <span className="rounded bg-muted-bg px-1.5 py-0.5 text-muted">{KIND_LABEL[f.kind]}</span>
                <span className="truncate">{f.name}</span>
                <span className="ml-auto text-muted">{f.count}</span>
              </li>
            ))}
          </ul>
        </Section>
      </div>
      <div className="border-t border-border p-4">
        <Button className="w-full" onClick={() => onAsk(asset)}>
          <Bot /> Ask Copilot about this asset
        </Button>
      </div>
    </aside>
  );
}

function Discrepancy({
  d,
  onResolve,
}: {
  d: AssetDTO["discrepancies"][number];
  onResolve: (resolution: string, value?: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(d.values[0]?.value ?? "");
  const [note, setNote] = React.useState("");
  return (
    <li
      className={cn("rounded-lg border p-2.5", d.status === "open" ? "border-amber/50 bg-amber-bg/60" : "border-border")}
      data-testid="discrepancy"
      data-status={d.status}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <AlertTriangle className={cn("size-3.5", d.status === "open" ? "text-amber" : "text-muted")} />
        {d.key}
        <span className="ml-auto rounded-full bg-panel px-1.5 text-[10px] text-muted">{d.status}</span>
      </div>
      <ul className="mt-1 space-y-0.5 text-xs">
        {d.values.map((v) => (
          <li key={v.value} className="flex gap-2">
            <span className="font-mono">{v.value}</span>
            <span className="text-muted">on {v.drawingNumbers.join(", ")}</span>
          </li>
        ))}
      </ul>
      {d.resolution && <p className="mt-1 text-xs text-muted">Resolution: {d.resolution}</p>}
      {d.status === "open" &&
        (open ? (
          <form
            className="mt-2 space-y-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              onResolve(note || `Adopted ${value}`, value || undefined);
              setOpen(false);
            }}
          >
            <select value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-full rounded-lg border border-border bg-panel px-2 text-xs" aria-label="Value to adopt">
              {d.values.map((v) => (
                <option key={v.value} value={v.value}>
                  Adopt {v.value} ({v.drawingNumbers.join(", ")})
                </option>
              ))}
              <option value="">Keep both; note only</option>
            </select>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Resolution note (e.g. nameplate checked)" className="h-8 text-xs" />
            <div className="flex gap-1.5">
              <Button size="sm" type="submit">
                Resolve
              </Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <Button size="sm" variant="outline" className="mt-2" onClick={() => setOpen(true)}>
            Resolve
          </Button>
        ))}
    </li>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

function Row({ k, v, hint }: { k: string; v: string; hint?: string }) {
  return (
    <div className="flex gap-3 px-3 py-1.5" title={hint ? `Source: ${hint}` : undefined}>
      <dt className="w-2/5 shrink-0 truncate text-muted">{k}</dt>
      <dd className="min-w-0 font-mono text-xs break-words">{v}</dd>
    </div>
  );
}
