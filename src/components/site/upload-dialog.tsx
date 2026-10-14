"use client";

import * as React from "react";
import { FileUp, LoaderCircle, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, pollJob } from "@/lib/client";
import { SOURCE_ACCEPT, type JobDTO, type UploadKind } from "@/lib/types";
import { cn } from "@/lib/utils";

const TITLES: Record<UploadKind, { title: string; desc: string }> = {
  pfd: { title: "Upload Process Flow Diagram", desc: "A process flow diagram, P&ID or electrical one-line. CDA reads it and builds the site model." },
  om: { title: "Upload O & M Manual", desc: "Text is extracted per page and indexed for Copilot. Run Enrichment to apply it to assets." },
  assetdb: { title: "Upload Asset Database", desc: "CSV export with a tag column (tag, asset_tag, asset_id, equipment or location)." },
  telemetry: { title: "Upload Telemetry", desc: "CSV with tag, optional signal, timestamp, value and optional unit columns." },
};

export function UploadDialog({
  kind,
  siteId,
  maxUploadMb,
  onOpenChange,
  onDone,
}: {
  kind: UploadKind | null;
  siteId: number;
  maxUploadMb: number;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [drag, setDrag] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const open = kind !== null;
  const accept = kind ? SOURCE_ACCEPT[kind] : SOURCE_ACCEPT.pfd;

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset form when the dialog opens
      setFile(null);
      setError(null);
      setBusy(false);
      setStep("");
    }
  }, [open, kind]);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
    setError(null);
    if (!accept.exts.includes(ext)) {
      setError(`Upload failed. Unsupported file type. Accepted: ${accept.label}.`);
      return;
    }
    if (f.size > maxUploadMb * 1024 * 1024) {
      setError(`Upload failed. File is larger than the ${maxUploadMb} MB limit.`);
      return;
    }
    setFile(f);
  };

  const submit = async () => {
    if (!file || !kind) return;
    setBusy(true);
    setError(null);
    setStep(kind === "pfd" ? "Uploading" : "Ingesting");
    try {
      const form = new FormData();
      form.set("kind", kind);
      form.set("file", file);
      const res = await api<{ job?: JobDTO; sourceId?: number }>(`/api/sites/${siteId}/sources`, { method: "POST", body: form });
      if (res.job) {
        const final = await pollJob<JobDTO>(res.job.id, (j) => setStep(j.step));
        if (final.status === "failed") throw new Error(final.error || "Processing failed.");
        toast.success(final.message || "Site model built.");
        final.warnings?.forEach((w) => toast.warning(w));
      } else {
        toast.success(`Data ingested: ${file.name}. Run Enrichment to apply it.`);
      }
      onDone();
      onOpenChange(false);
    } catch (e) {
      setError(`Upload failed. ${(e as Error).message}`);
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent showClose={!busy} onInteractOutside={(e) => busy && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>{kind ? TITLES[kind].title : ""}</DialogTitle>
          <DialogDescription>{kind ? TITLES[kind].desc : ""}</DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex flex-col items-center gap-3 py-8" role="status" aria-live="polite">
            <LoaderCircle className="size-8 animate-spin text-accent" />
            <div className="text-sm font-medium" data-testid="upload-step">
              {step}…
            </div>
            <div className="max-w-full truncate text-xs text-muted">{file?.name}</div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files?.[0]);
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors",
              drag ? "border-accent bg-accent-soft" : "border-border hover:border-accent",
            )}
          >
            <FileUp className="size-8 text-muted" />
            <span className="text-sm font-medium">Drag files here or click to upload</span>
            <span className="text-xs text-muted">
              Accepted: {accept.label} · up to {maxUploadMb} MB
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={accept.exts.join(",")}
          data-testid="upload-input"
          onChange={(e) => {
            pick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {file && !busy && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-page px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <span className="text-xs text-muted">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
            <button type="button" onClick={() => setFile(null)} className="rounded p-0.5 text-muted hover:text-text" aria-label="Remove file">
              <X className="size-4" />
            </button>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!file || busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : null}
            {error && file ? "Retry" : kind === "pfd" ? "Build site model" : "Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
