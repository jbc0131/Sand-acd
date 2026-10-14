"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, LoaderCircle, MapPin, PanelLeftOpen, Pencil, Power, RotateCcw, Upload, Waypoints, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { StatusPill } from "@/components/status-pill";
import { useGlobalSearch } from "@/components/app-shell";
import { api, jsonInit, pollJob } from "@/lib/client";
import { DECISION_SUPPORT, trace as runTrace, whatIfOpen, type ElecAsset, type ElecEdge } from "@/lib/electrical";
import { typeLabel, type AssetDTO, type JobDTO, type SiteModel, type UploadKind } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Canvas } from "./canvas";
import { StatusLegend } from "./legend";
import { AssetDrawer } from "./asset-drawer";
import { UploadDialog } from "./upload-dialog";
import { DrawingUploadDialog } from "./drawing-upload-dialog";
import { EnrichPanel } from "./enrich-panel";
import { Copilot, type CopilotHandle } from "./copilot";
import { Documentation } from "./documentation";
import { DesignPlaceholder } from "./design-placeholder";
import { DrawingsRegister } from "./drawings-register";
import { DrawingViewer, type ViewerTarget } from "./drawing-viewer";
import { ReviewTab } from "./review-tab";
import { BaselineTab } from "./baseline-tab";

type Tab = "overview" | "drawings" | "enrich" | "review" | "baseline" | "documentation" | "acd";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "drawings", label: "Drawings" },
  { id: "enrich", label: "Enrich" },
  { id: "review", label: "Review" },
  { id: "baseline", label: "Baseline" },
  { id: "documentation", label: "Documentation" },
  { id: "acd", label: "Accelerating Capital Delivery" },
];

interface TraceState {
  assetId: number;
  tag: string;
  direction: "upstream" | "downstream";
  nodeIds: Set<number>;
  edgeIds: Set<number>;
  paths: number;
  truncated: boolean;
  nonce: number;
}

export function SiteWorkspace({ siteId }: { siteId: number }) {
  const { query } = useGlobalSearch();
  const [model, setModel] = React.useState<SiteModel | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [tab, setTab] = React.useState<Tab>("overview");
  const [selectedId, setSelectedId] = React.useState<number | null>(null);
  const [uploadKind, setUploadKind] = React.useState<UploadKind | null>(null);
  const [highlightTags, setHighlightTags] = React.useState<string[]>([]);
  const [focus, setFocus] = React.useState<{ tags: string[]; nonce: number } | null>(null);
  const [enrichingIds, setEnrichingIds] = React.useState<Set<number>>(new Set());
  const [enriching, setEnriching] = React.useState(false);
  const [enrichStep, setEnrichStep] = React.useState("");
  const [panelOpen, setPanelOpen] = React.useState(false);
  const [viewer, setViewer] = React.useState<ViewerTarget | null>(null);
  const [traceState, setTraceState] = React.useState<TraceState | null>(null);
  const [whatIf, setWhatIf] = React.useState<Set<number>>(new Set());
  const [showDead, setShowDead] = React.useState(false);
  const [dataVersion, setDataVersion] = React.useState(0);
  const copilotRef = React.useRef<CopilotHandle>(null);

  const reload = React.useCallback(async () => {
    try {
      const m = await api<SiteModel>(`/api/sites/${siteId}`);
      setModel(m);
      setDataVersion((v) => v + 1);
      return m;
    } catch (e) {
      setLoadError((e as Error).message);
      return null;
    }
  }, [siteId]);

  React.useEffect(() => {
    api<SiteModel>(`/api/sites/${siteId}`)
      .then(setModel)
      .catch((e: Error) => setLoadError(e.message));
  }, [siteId]);

  const onHighlight = React.useCallback((tags: string[]) => {
    setHighlightTags(tags);
    if (tags.length) setFocus({ tags, nonce: Date.now() });
  }, []);

  const onFocusTag = React.useCallback((tag: string) => {
    setHighlightTags((prev) => (prev.includes(tag) ? prev : [...prev, tag]));
    setFocus({ tags: [tag], nonce: Date.now() });
    setTab((t) => (t === "overview" || t === "enrich" ? t : "overview"));
  }, []);

  const openDrawing = React.useCallback((drawingId: number, assetId?: number | null) => setViewer({ drawingId, assetId: assetId ?? null }), []);

  const elec = React.useMemo(() => {
    if (!model) return null;
    const assets: ElecAsset[] = model.assets.map((a) => ({ id: a.id, tag: a.tag, name: a.name, type: a.type, params: a.params }));
    const edges: ElecEdge[] = model.edges.map((e) => ({ id: e.id, from: e.from, to: e.to, kind: e.kind }));
    return { assets, edges };
  }, [model]);

  const whatIfResult = React.useMemo(
    () => (elec && whatIf.size ? whatIfOpen(elec.assets, elec.edges, [...whatIf]) : null),
    [elec, whatIf],
  );
  const deenergized = React.useMemo(() => new Set(whatIfResult?.deenergized.map((d) => d.id) ?? []), [whatIfResult]);
  const traceProp = React.useMemo(
    () => (traceState ? { nodeIds: traceState.nodeIds, edgeIds: traceState.edgeIds, nonce: traceState.nonce } : null),
    [traceState],
  );

  if (loadError) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-danger/40 bg-danger-bg p-4 text-sm text-danger">{loadError}</div>
        <Link href="/" className="mt-3 inline-block text-sm text-accent">
          Back to Available Sites
        </Link>
      </div>
    );
  }
  if (!model || !elec) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted">
        <LoaderCircle className="size-6 animate-spin" />
      </div>
    );
  }

  const hasModel = model.assets.length > 0;
  const selected = model.assets.find((a) => a.id === selectedId) ?? null;
  const tagOf = (id: number) => model.assets.find((a) => a.id === id)?.tag ?? `#${id}`;

  const startTrace = (assetId: number, direction: "upstream" | "downstream") => {
    const t = runTrace(elec.assets, elec.edges, assetId, direction, 15);
    setTraceState({
      assetId,
      tag: tagOf(assetId),
      direction,
      nodeIds: new Set(t.nodeIds),
      edgeIds: new Set(t.edgeIds),
      paths: t.paths.length,
      truncated: t.truncated,
      nonce: Date.now(),
    });
    if (tab !== "overview" && tab !== "enrich") setTab("overview");
    setSelectedId(null);
  };

  const toggleWhatIf = (assetId: number) => {
    setWhatIf((prev) => {
      const next = new Set(prev);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
    if (tab !== "overview" && tab !== "enrich") setTab("overview");
    setShowDead(true);
  };

  const runEnrichment = async () => {
    setEnriching(true);
    setEnrichStep("Starting");
    setEnrichingIds(new Set(model.assets.map((a) => a.id)));
    setPanelOpen(false);
    try {
      const job = await api<JobDTO>(`/api/sites/${siteId}/enrich`, { method: "POST" });
      const final = await pollJob<JobDTO>(job.id, (j) => setEnrichStep(j.step));
      const fresh = await reload();
      if (final.status === "failed") toast.error(final.error || "Enrichment failed.");
      else toast.success(final.message || "Enrichment complete.");
      final.warnings?.forEach((w) => toast.warning(w));
      // Settle node status dots one by one, left to right.
      const order = [...(fresh?.assets ?? model.assets)].sort((a, b) => a.x - b.x || a.y - b.y).map((a) => a.id);
      for (const id of order) {
        await new Promise((r) => setTimeout(r, 90));
        setEnrichingIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setEnrichingIds(new Set());
      setEnriching(false);
      setEnrichStep("");
    }
  };

  const unlink = async (kind: UploadKind) => {
    const list = model.sources.filter((s) => s.kind === kind);
    try {
      for (const s of kind === "pfd" ? list.slice(0, 1) : list) {
        await api(`/api/sites/${siteId}/sources/${s.id}`, { method: "DELETE" });
      }
      toast.success(kind === "pfd" ? "Diagrams unlinked. The site model and drawing register were cleared." : "Source unlinked and its parameters removed.");
      if (kind === "pfd") {
        setSelectedId(null);
        setHighlightTags([]);
        setTraceState(null);
        setWhatIf(new Set());
      }
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const askAbout = (a: AssetDTO) => {
    setSelectedId(null);
    if (tab !== "overview" && tab !== "enrich") setTab("overview");
    // Copilot mounts with the canvas tabs; wait a tick after switching.
    setTimeout(
      () =>
        copilotRef.current?.ask(
          `Tell me about ${a.tag || a.name}${a.tag ? ` (${a.name})` : ""}: its key ratings, what it is connected to, which drawings it appears on, and any procedures that involve it.`,
        ),
      50,
    );
  };

  const canvasTab = tab === "overview" || tab === "enrich";
  const enrichPanel = (
    <EnrichPanel
      model={model}
      enriching={enriching}
      enrichStep={enrichStep}
      onUpload={(k) => {
        setPanelOpen(false);
        setUploadKind(k);
      }}
      onUnlink={unlink}
      onRun={runEnrichment}
      onContinue={() => {
        setPanelOpen(false);
        setTab("acd");
      }}
    />
  );

  const lineupBar = (whatIfResult || traceState) && (
    <div className="absolute top-3 left-3 z-10 flex max-w-[calc(100%-1.5rem)] flex-col gap-2 sm:max-w-[min(560px,calc(100%-14rem))]">
      {whatIfResult && (
        <div className="rounded-xl border border-danger/40 bg-panel p-2.5 text-xs shadow-float" data-testid="lineup-bar">
          <div className="flex flex-wrap items-center gap-2">
            <Power className="size-4 text-danger" />
            <span className="font-semibold">What-if lineup active</span>
            <span className="text-muted">Opened:</span>
            {whatIfResult.opened.map((o) => (
              <span key={o.id} className="rounded bg-[#7c5cd6]/15 px-1.5 font-mono text-[#7c5cd6]">
                {o.tag}
              </span>
            ))}
            <span className="ml-auto rounded-full bg-muted-bg px-2 py-0.5 text-[10px] text-muted">{DECISION_SUPPORT}</span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <button type="button" className="text-danger underline underline-offset-2" onClick={() => setShowDead((v) => !v)} data-testid="deenergized-count">
              {whatIfResult.deenergized.length} de-energized ({whatIfResult.newlyDeenergized} newly)
            </button>
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setWhatIf(new Set())} data-testid="reset-lineup">
              <RotateCcw /> Reset to normal lineup
            </Button>
          </div>
          {showDead && (
            <div className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-border">
              <div className="flex flex-wrap gap-1.5 border-b border-border bg-page px-2 py-1 text-[10px] text-muted">
                {Object.entries(whatIfResult.byType).map(([t, n]) => (
                  <span key={t}>
                    {typeLabel(t as AssetDTO["type"])}: {n}
                  </span>
                ))}
              </div>
              <ul className="divide-y divide-border" data-testid="deenergized-list">
                {whatIfResult.deenergized.map((d) => (
                  <li key={d.id}>
                    <button type="button" onClick={() => setSelectedId(d.id)} className="flex w-full items-center gap-2 px-2 py-1 text-left hover:bg-muted-bg">
                      <span className="font-mono">{d.tag}</span>
                      <span className="truncate text-muted">{d.name}</span>
                      {!d.normallyEnergized && <span className="ml-auto text-[10px] text-muted">already off in normal lineup</span>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {traceState && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-chip-fg/40 bg-panel p-2.5 text-xs shadow-float" data-testid="trace-bar">
          <Waypoints className="size-4 text-chip-fg" />
          <span className="font-semibold">
            Trace {traceState.direction} from {traceState.tag}
          </span>
          <span className="text-muted">
            {traceState.nodeIds.size - 1} assets · {traceState.paths} path{traceState.paths === 1 ? "" : "s"}
            {traceState.truncated ? " (depth limit reached)" : ""}
          </span>
          <span className="rounded-full bg-muted-bg px-2 py-0.5 text-[10px] text-muted">{DECISION_SUPPORT}</span>
          <button type="button" className="ml-auto rounded p-0.5 text-muted hover:text-text" onClick={() => setTraceState(null)} aria-label="Clear trace">
            <X className="size-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Title row */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel px-3 py-2.5 sm:px-5">
        <div className="w-full min-w-0 lg:w-auto lg:flex-1">
          <nav className="flex items-center gap-1 text-xs text-muted" aria-label="Breadcrumb">
            <Link href="/" className="hover:text-text">
              Available Sites
            </Link>
            <ChevronRight className="size-3" />
            <span className="truncate text-text">{model.site.name}</span>
          </nav>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <InlineEdit
              value={model.site.name}
              className="text-lg font-semibold"
              label="Site name"
              onSave={async (v) => {
                if (!v.trim()) return;
                await api(`/api/sites/${siteId}`, jsonInit("PATCH", { name: v }));
                await reload();
              }}
            />
            <StatusPill status={model.site.status} />
            <span className="flex items-center gap-1 text-sm text-muted">
              <MapPin className="size-3.5" />
              <InlineEdit
                value={model.site.location ?? ""}
                placeholder="Unset"
                label="Location"
                onSave={async (v) => {
                  await api(`/api/sites/${siteId}`, jsonInit("PATCH", { location: v.trim() || null }));
                  await reload();
                }}
              />
            </span>
          </div>
        </div>
        <div className="flex max-w-full overflow-x-auto rounded-full border border-border bg-page p-1" role="tablist" aria-label="Site views">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors",
                tab === t.id ? "bg-accent text-accent-fg" : "text-muted hover:text-text",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="relative flex min-h-0 flex-1">
        {tab === "enrich" && <aside className="hidden w-[330px] shrink-0 border-r border-border bg-panel md:block">{enrichPanel}</aside>}

        {canvasTab && (
          <div className="relative min-w-0 flex-1" data-testid="canvas-area">
            {hasModel ? (
              <>
                <Canvas
                  assets={model.assets}
                  edges={model.edges}
                  mode={tab === "enrich" ? "enrich" : "overview"}
                  enrichingIds={enrichingIds}
                  highlightTags={highlightTags}
                  focus={focus}
                  search={query}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  trace={traceProp}
                  deenergized={deenergized}
                  opened={whatIf}
                />
                <StatusLegend />
                {lineupBar}
              </>
            ) : (
              <div className="flex h-full items-center justify-center bg-[radial-gradient(var(--canvas-dot)_1px,transparent_1px)] [background-size:18px_18px] p-4">
                <div className="max-w-sm rounded-xl border border-border bg-panel p-6 text-center shadow-card" data-testid="empty-model">
                  <p className="text-sm">No site model yet. Upload a process flow diagram or electrical one-line first.</p>
                  {!model.hasApiKey && (
                    <p className="mt-2 text-xs text-amber-fg">
                      Diagram extraction needs ANTHROPIC_API_KEY on the server. The fictional sample site works without it.
                    </p>
                  )}
                  <Button className="mt-4" onClick={() => setUploadKind("pfd")}>
                    <Upload /> Upload
                  </Button>
                </div>
              </div>
            )}
            {tab === "enrich" && (
              <Button variant="outline" className="absolute bottom-24 left-3 z-10 shadow-card md:hidden" onClick={() => setPanelOpen(true)}>
                <PanelLeftOpen /> Enrich Site
              </Button>
            )}
            <Copilot ref={copilotRef} model={model} onHighlight={onHighlight} onFocusTag={onFocusTag} onOpenDrawing={openDrawing} />
          </div>
        )}

        {tab === "drawings" && (
          <DrawingsRegister drawings={model.drawings} search={query} onOpen={(d) => openDrawing(d.id)} onUpload={() => setUploadKind("pfd")} />
        )}
        {tab === "review" && (
          <ReviewTab siteId={siteId} drawings={model.drawings} reviewMode={model.reviewMode} initialDrawingId={null} onChanged={() => void reload()} />
        )}
        {tab === "baseline" && <BaselineTab siteId={siteId} refreshKey={dataVersion} />}
        {tab === "documentation" && <Documentation model={model} search={query} onSelect={setSelectedId} />}
        {tab === "acd" && (
          <DesignPlaceholder enriched={model.assets.filter((a) => a.enrichmentStatus === "enriched").length} total={model.assets.length} />
        )}

        {selected && (canvasTab || tab === "documentation" || tab === "drawings") && (
          <AssetDrawer
            asset={selected}
            model={model}
            whatIfOpen={whatIf}
            onClose={() => setSelectedId(null)}
            onSelect={setSelectedId}
            onAsk={askAbout}
            onOpenDrawing={openDrawing}
            onTrace={startTrace}
            onToggleWhatIf={toggleWhatIf}
            onChanged={reload}
          />
        )}
      </div>

      <Sheet open={panelOpen && tab === "enrich"} onOpenChange={setPanelOpen}>
        <SheetContent side="left" className="w-[92vw] max-w-[360px] sm:max-w-[360px]" aria-describedby={undefined}>
          <SheetTitle className="sr-only">Enrich Site</SheetTitle>
          {enrichPanel}
        </SheetContent>
      </Sheet>

      <UploadDialog
        kind={uploadKind && uploadKind !== "pfd" ? uploadKind : null}
        siteId={siteId}
        maxUploadMb={model.maxUploadMb}
        onOpenChange={(o) => !o && setUploadKind(null)}
        onDone={() => void reload()}
      />
      <DrawingUploadDialog
        open={uploadKind === "pfd"}
        siteId={siteId}
        maxUploadMb={model.maxUploadMb}
        onOpenChange={(o) => !o && setUploadKind(null)}
        onProgress={() => void reload()}
      />
      <DrawingViewer
        siteId={siteId}
        target={viewer}
        onClose={() => setViewer(null)}
        onSelectAsset={(id) => {
          setViewer(null);
          setSelectedId(id);
        }}
      />
    </div>
  );
}

function InlineEdit({
  value,
  onSave,
  className,
  placeholder,
  label,
}: {
  value: string;
  onSave: (v: string) => Promise<void>;
  className?: string;
  placeholder?: string;
  label: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const commit = async () => {
    setEditing(false);
    if (draft.trim() === value.trim()) return;
    try {
      await onSave(draft);
    } catch (e) {
      toast.error((e as Error).message);
      setDraft(value);
    }
  };
  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        aria-label={label}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") void commit();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        className={cn("min-w-0 rounded-md border border-accent bg-panel px-1.5 outline-none", className)}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      className={cn("group inline-flex min-w-0 items-center gap-1.5 rounded-md text-left hover:bg-muted-bg", className)}
      aria-label={`Edit ${label.toLowerCase()}`}
    >
      <span className="truncate">{value || <i className="text-muted">{placeholder}</i>}</span>
      <Pencil className="size-3 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
    </button>
  );
}
