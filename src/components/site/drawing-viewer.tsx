"use client";

import * as React from "react";
import { LoaderCircle, Unplug } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AssetIcon } from "@/components/asset-icon";
import { api } from "@/lib/client";
import { DRAWING_TYPE_LABELS, FLAG_THRESHOLD, type AssetType, type BBox, type DrawingDTO } from "@/lib/types";
import { cn } from "@/lib/utils";
import { PanZoomImage } from "./pan-zoom-image";
import { DrawingStatusPill } from "./drawing-status";

interface ViewerData {
  drawing: DrawingDTO;
  components: {
    appearanceId: number;
    assetId: number;
    tag: string;
    name: string;
    type: AssetType;
    confidence: number | null;
    bbox: BBox | null;
  }[];
}

export interface ViewerTarget {
  drawingId: number;
  assetId?: number | null;
}

/** Drawing viewer: page image with zoom and pan, the asset's bbox highlighted, and a title-block summary. */
export function DrawingViewer({
  siteId,
  target,
  onClose,
  onSelectAsset,
}: {
  siteId: number;
  target: ViewerTarget | null;
  onClose: () => void;
  onSelectAsset?: (assetId: number) => void;
}) {
  const [data, setData] = React.useState<ViewerData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [activeAsset, setActiveAsset] = React.useState<number | null>(null);
  const [focusNonce, setFocusNonce] = React.useState(0);

  React.useEffect(() => {
    if (!target) return;
    let live = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset when a new drawing opens
    setData(null);
    setError(null);
    setActiveAsset(target.assetId ?? null);
    api<ViewerData>(`/api/sites/${siteId}/drawings/${target.drawingId}`)
      .then((d) => live && setData(d))
      .catch((e: Error) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [siteId, target]);

  const d = data?.drawing;
  const active = data?.components.find((c) => c.assetId === activeAsset) ?? null;
  const title = d ? `${d.drawingNumber ?? d.fileName}${d.revision ? ` rev ${d.revision}` : ""}` : "Drawing";

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-3 rounded-none p-3 sm:h-[90dvh] sm:max-h-[90dvh] sm:w-[calc(100%-2rem)] sm:max-w-6xl sm:rounded-xl sm:p-4"
        data-testid="drawing-viewer"
      >
        <div className="pr-8">
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {title}
            {d && <DrawingStatusPill status={d.status} />}
            {active && (
              <span className="rounded-full bg-amber-bg px-2 py-0.5 font-mono text-xs text-amber-fg" data-testid="viewer-active-asset">
                {active.tag || active.name}
              </span>
            )}
          </DialogTitle>
          <DialogDescription>{d?.title ?? "Loading drawing…"}</DialogDescription>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        {!data && !error && (
          <div className="flex flex-1 items-center justify-center">
            <LoaderCircle className="size-6 animate-spin text-muted" />
          </div>
        )}
        {data && d && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row">
            <PanZoomImage
              src={d.hasImage ? `/api/sites/${siteId}/drawings/${d.id}/image` : null}
              alt={`${title} page 1`}
              className="min-h-[45dvh] flex-1 md:min-h-0"
              boxes={data.components
                .filter((c) => c.bbox)
                .map((c) => ({ key: String(c.assetId), bbox: c.bbox!, label: `${c.tag} · ${c.name}`, active: c.assetId === activeAsset }))}
              focus={active?.bbox ?? null}
              focusKey={`${d.id}:${activeAsset}:${focusNonce}`}
              onBoxClick={(k) => {
                setActiveAsset(Number(k));
                setFocusNonce((n) => n + 1);
              }}
            />
            <aside className="flex max-h-[40dvh] w-full shrink-0 flex-col gap-3 overflow-y-auto text-sm md:max-h-none md:w-72">
              <section className="rounded-lg border border-border p-3" data-testid="title-block">
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Title block</h3>
                <dl className="grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-xs">
                  {(
                    [
                      ["Drawing", d.drawingNumber],
                      ["Revision", d.revision],
                      ["Title", d.title],
                      ["System", d.system],
                      ["Unit", d.unit],
                      ["Site", d.siteLabel],
                      ["Date", d.dateDrawn],
                      ["Drawn by", d.author],
                      ["Type", DRAWING_TYPE_LABELS[d.drawingType]],
                    ] as [string, string | null][]
                  ).map(([k, v]) => (
                    <React.Fragment key={k}>
                      <dt className="text-muted">{k}</dt>
                      <dd className={cn("min-w-0 break-words", !v && "text-muted italic")}>{v || "not read"}</dd>
                    </React.Fragment>
                  ))}
                </dl>
                {d.status === "partial" && (
                  <p className="mt-2 rounded bg-amber-bg px-2 py-1 text-xs text-amber-fg">
                    Partial read: {d.partialReason} ({d.resolvedPct ?? "?"}% resolved)
                  </p>
                )}
              </section>
              <section className="rounded-lg border border-border p-3">
                <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
                  Components ({data.components.length})
                </h3>
                <ul className="space-y-0.5">
                  {data.components.map((c) => (
                    <li key={c.appearanceId}>
                      <button
                        type="button"
                        onClick={() => {
                          setActiveAsset(c.assetId);
                          setFocusNonce((n) => n + 1);
                        }}
                        onDoubleClick={() => onSelectAsset?.(c.assetId)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs hover:bg-muted-bg",
                          c.assetId === activeAsset && "bg-amber-bg",
                        )}
                      >
                        <AssetIcon type={c.type} size="sm" />
                        <span className="font-mono">{c.tag || "—"}</span>
                        <span className="truncate text-muted">{c.name}</span>
                        {c.confidence != null && c.confidence < FLAG_THRESHOLD && (
                          <span className="ml-auto rounded bg-amber-bg px-1 text-[10px] text-amber-fg">{Math.round(c.confidence * 100)}%</span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
              {d.openConnectors.length > 0 && (
                <section className="rounded-lg border border-border p-3">
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Off-page connectors</h3>
                  <ul className="space-y-1 text-xs">
                    {d.openConnectors.map((c) => (
                      <li key={c.id} className="flex items-start gap-1.5">
                        <Unplug className={cn("mt-0.5 size-3.5 shrink-0", c.resolved ? "text-accent" : "text-amber")} />
                        <span>
                          <span className="font-mono">{c.label}</span>
                          <span className="block text-muted">{c.resolved ? "resolved into a connection" : "open: target drawing not in the model"}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </aside>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
