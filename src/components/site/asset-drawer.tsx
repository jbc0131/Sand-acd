"use client";

import { ArrowLeft, ArrowRight, Bot, X } from "lucide-react";
import { AssetIcon } from "@/components/asset-icon";
import { Button } from "@/components/ui/button";
import { StatusDot } from "./asset-node";
import { STATUS_LABELS, typeLabel, type AssetDTO, type SiteModel } from "@/lib/types";

const KIND_LABEL = { pfd: "Diagram", om: "O&M manual", assetdb: "Asset database", telemetry: "Telemetry" } as const;

export function AssetDrawer({
  asset,
  model,
  onClose,
  onSelect,
  onAsk,
}: {
  asset: AssetDTO;
  model: SiteModel;
  onClose: () => void;
  onSelect: (id: number) => void;
  onAsk: (asset: AssetDTO) => void;
}) {
  const byId = new Map(model.assets.map((a) => [a.id, a]));
  const incoming = model.edges.filter((e) => e.to === asset.id);
  const outgoing = model.edges.filter((e) => e.from === asset.id);
  const srcOf = new Map<string, string[]>();
  for (const p of asset.provenance) srcOf.set(p.key, [...(srcOf.get(p.key) ?? []), p.fileName]);
  const fileSet = new Map<number, { name: string; kind: keyof typeof KIND_LABEL; count: number }>();
  for (const p of asset.provenance) {
    const f = fileSet.get(p.sourceId) ?? { name: p.fileName, kind: p.sourceKind, count: 0 };
    f.count++;
    fileSet.set(p.sourceId, f);
  }
  const params = Object.entries(asset.params);

  return (
    <aside
      className="absolute inset-y-0 right-0 z-30 flex w-full flex-col border-l border-border bg-panel shadow-float sm:w-[380px]"
      data-testid="asset-drawer"
      aria-label={`${asset.name} details`}
    >
      <div className="flex items-start gap-3 border-b border-border p-4">
        <AssetIcon type={asset.type} />
        <div className="min-w-0 flex-1">
          <h2 className="leading-snug font-semibold">
            {asset.name} {asset.tag && <span className="font-normal text-muted">({asset.tag})</span>}
          </h2>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted">
            <StatusDot status={asset.enrichmentStatus} /> {STATUS_LABELS[asset.enrichmentStatus]}
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
        <Section title="Parameters">
          {params.length === 0 && asset.tag === "" && <p className="text-muted italic">No parameters yet.</p>}
          <dl className="divide-y divide-border rounded-lg border border-border">
            {asset.tag && (
              <Row k="tag" v={asset.tag} />
            )}
            {params.map(([k, v]) => (
              <Row key={k} k={k} v={v} hint={srcOf.get(k)?.join(", ")} />
            ))}
          </dl>
        </Section>
        <Section title="Connections">
          {incoming.length + outgoing.length === 0 && <p className="text-muted italic">No connections.</p>}
          <ul className="space-y-1">
            {incoming.map((e) => {
              const a = byId.get(e.from);
              return a ? (
                <li key={`i${e.id}`}>
                  <button type="button" onClick={() => onSelect(a.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted-bg">
                    <ArrowLeft className="size-3.5 text-muted" />
                    <span className="text-xs text-muted">from</span>
                    <span className="font-mono text-xs">{a.tag || a.name}</span>
                    {e.label && <span className="ml-auto text-xs text-muted">{e.label}</span>}
                  </button>
                </li>
              ) : null;
            })}
            {outgoing.map((e) => {
              const a = byId.get(e.to);
              return a ? (
                <li key={`o${e.id}`}>
                  <button type="button" onClick={() => onSelect(a.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted-bg">
                    <ArrowRight className="size-3.5 text-muted" />
                    <span className="text-xs text-muted">to</span>
                    <span className="font-mono text-xs">{a.tag || a.name}</span>
                    {e.label && <span className="ml-auto text-xs text-muted">{e.label}</span>}
                  </button>
                </li>
              ) : null;
            })}
          </ul>
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
