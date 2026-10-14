"use client";

import * as React from "react";
import { Activity, ArrowRight, BookOpen, Database, Eye, LoaderCircle, Sparkles, Unlink, Upload, Workflow, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { SiteModel, SourceDTO, SourceKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const CARDS: { kind: SourceKind; title: string; desc: string; icon: LucideIcon }[] = [
  { kind: "assetdb", title: "Asset Database", desc: "Connect a database to enrich insights", icon: Database },
  { kind: "om", title: "O & M Manuals", desc: "Upload operational and maintenance manuals", icon: BookOpen },
  { kind: "pfd", title: "Process Flow Diagrams", desc: "Upload PFDs to support site planning", icon: Workflow },
  { kind: "telemetry", title: "Telemetry", desc: "Upload historical telemetry data", icon: Activity },
];

export function EnrichPanel({
  model,
  enriching,
  enrichStep,
  onUpload,
  onUnlink,
  onRun,
  onContinue,
}: {
  model: SiteModel;
  enriching: boolean;
  enrichStep: string;
  onUpload: (kind: SourceKind) => void;
  onUnlink: (kind: SourceKind) => Promise<void>;
  onRun: () => void;
  onContinue: () => void;
}) {
  const [details, setDetails] = React.useState<SourceKind | null>(null);
  const [confirm, setConfirm] = React.useState<SourceKind | null>(null);
  const hasModel = model.assets.length > 0;
  const pendingCount = model.sources.filter((s) => s.kind !== "pfd" && s.status === "ingested").length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <h2 className="font-semibold">Enrich Site</h2>
        <p className="text-sm text-muted">Upload documentation to enrich site</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {!hasModel && (
          <p className="rounded-lg bg-amber-bg px-3 py-2 text-xs text-amber-fg">
            Build the site model from a process flow diagram or electrical one-line first. The other sources unlock once it is done.
          </p>
        )}
        {CARDS.map((c) => {
          const list = model.sources.filter((s) => s.kind === c.kind);
          const ingested = list.length > 0;
          const connected = list.some((s) => s.status === "applied");
          const disabled = c.kind !== "pfd" && !hasModel;
          return (
            <div
              key={c.kind}
              className={cn("rounded-xl border border-border bg-card p-3.5 shadow-card", disabled && "opacity-55")}
              data-testid={`source-card-${c.kind}`}
            >
              <div className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <c.icon className="size-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold">{c.title}</div>
                  <div className="text-xs text-muted">{c.desc}</div>
                </div>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <Chip on={ingested}>{ingested ? "Data Ingested" : "No Data"}</Chip>
                <Chip on={connected}>{connected ? "Connected" : "Disconnected"}</Chip>
              </div>
              <div className="mt-3 flex gap-2">
                {ingested ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => setDetails(c.kind)}>
                      <Eye /> View Details
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-danger"
                      disabled={enriching}
                      onClick={() => (c.kind === "pfd" ? setConfirm(c.kind) : onUnlink(c.kind))}
                    >
                      <Unlink /> Unlink
                    </Button>
                  </>
                ) : (
                  <Button size="sm" variant="outline" disabled={disabled || enriching} onClick={() => onUpload(c.kind)}>
                    <Upload /> Upload
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="space-y-2 border-t border-border p-4">
        {enriching && (
          <div className="flex items-center gap-2 text-xs text-muted" role="status">
            <LoaderCircle className="size-3.5 animate-spin" /> {enrichStep || "Enriching"}…
          </div>
        )}
        <Button variant="amber" className="w-full" onClick={onRun} disabled={!hasModel || enriching || pendingCount === 0}>
          {enriching ? <LoaderCircle className="animate-spin" /> : <Sparkles />}
          Run Enrichment
          {pendingCount > 0 && !enriching && <span className="rounded-full bg-white/25 px-1.5 text-xs">{pendingCount}</span>}
        </Button>
        <Button variant="secondary" className="w-full" onClick={onContinue}>
          Continue to Design <ArrowRight />
        </Button>
      </div>

      <DetailsDialog
        kind={details}
        sources={model.sources.filter((s) => s.kind === details)}
        onClose={() => setDetails(null)}
        onUploadMore={(k) => {
          setDetails(null);
          onUpload(k);
        }}
        canUpload={!enriching}
      />

      <AlertDialog open={confirm !== null} onOpenChange={(o) => !o && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogTitle>Unlink the diagram?</AlertDialogTitle>
          <AlertDialogDescription>
            This wipes the site model: every asset, connection and enriched parameter is removed. Ingested manuals and CSVs stay and can be
            re-applied after a new diagram is processed.
          </AlertDialogDescription>
          <div className="flex justify-end gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                await onUnlink("pfd");
                setConfirm(null);
              }}
            >
              Unlink and wipe model
            </AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", on ? "bg-accent-soft text-accent" : "bg-muted-bg text-muted")}
    >
      {children}
    </span>
  );
}

const KIND_TITLES: Record<SourceKind, string> = {
  pfd: "Process Flow Diagrams",
  om: "O & M Manuals",
  assetdb: "Asset Database",
  telemetry: "Telemetry",
};

function DetailsDialog({
  kind,
  sources,
  onClose,
  onUploadMore,
  canUpload,
}: {
  kind: SourceKind | null;
  sources: SourceDTO[];
  onClose: () => void;
  onUploadMore: (k: SourceKind) => void;
  canUpload: boolean;
}) {
  return (
    <Dialog open={kind !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{kind ? KIND_TITLES[kind] : ""}</DialogTitle>
          <DialogDescription>Files ingested for this source.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{s.fileName}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-medium",
                    s.status === "applied" ? "bg-accent-soft text-accent" : s.status === "failed" ? "bg-danger-bg text-danger" : "bg-amber-bg text-amber-fg",
                  )}
                >
                  {s.status === "applied" ? "Applied" : s.status === "failed" ? "Failed" : "Ingested, not applied"}
                </span>
              </div>
              {s.summary && <p className="mt-1 text-xs text-muted">{s.summary}</p>}
              <p className="mt-1 text-[11px] text-muted">Added {new Date(s.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ul>
        <DialogFooter>
          {kind && (
            <Button variant="outline" onClick={() => onUploadMore(kind)} disabled={!canUpload}>
              <Upload /> Upload another file
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
