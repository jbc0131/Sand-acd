"use client";

import * as React from "react";
import { Check, FileUp, LoaderCircle, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, pollJob } from "@/lib/client";
import { SOURCE_ACCEPT, type JobDTO } from "@/lib/types";
import { cn } from "@/lib/utils";

const CONCURRENCY = 2;

type ItemStatus = "queued" | "uploading" | "processing" | "done" | "failed";

interface QueueItem {
  id: number;
  file: File;
  status: ItemStatus;
  step: string;
  error?: string;
  message?: string;
}

let nextId = 1;

/**
 * Diagram upload: accepts several drawings and processes them two at a time, with progress per file.
 * Each drawing adds to the site model; it never replaces it (except a new revision of the same drawing number).
 */
export function DrawingUploadDialog({
  open,
  siteId,
  maxUploadMb,
  onOpenChange,
  onProgress,
}: {
  open: boolean;
  siteId: number;
  maxUploadMb: number;
  onOpenChange: (open: boolean) => void;
  /** called whenever a drawing finishes, so the model and register refresh as the queue runs */
  onProgress: () => void;
}) {
  const [items, setItems] = React.useState<QueueItem[]>([]);
  const [started, setStarted] = React.useState(false);
  const [drag, setDrag] = React.useState(false);
  const [rejected, setRejected] = React.useState<string[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const running = React.useRef(0);
  const itemsRef = React.useRef<QueueItem[]>([]);
  const accept = SOURCE_ACCEPT.pfd;

  React.useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  React.useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- start fresh each time the dialog opens
      setItems([]);
      setStarted(false);
      setRejected([]);
    }
  }, [open]);

  const patch = (id: number, p: Partial<QueueItem>) => setItems((all) => all.map((i) => (i.id === id ? { ...i, ...p } : i)));

  const add = (files: FileList | File[] | null | undefined) => {
    if (!files) return;
    const bad: string[] = [];
    const ok: QueueItem[] = [];
    for (const f of Array.from(files)) {
      const ext = f.name.slice(f.name.lastIndexOf(".")).toLowerCase();
      if (!accept.exts.includes(ext)) bad.push(`${f.name}: unsupported type`);
      else if (f.size > maxUploadMb * 1024 * 1024) bad.push(`${f.name}: over ${maxUploadMb} MB`);
      else ok.push({ id: nextId++, file: f, status: "queued", step: "Queued" });
    }
    setRejected(bad);
    setItems((all) => [...all, ...ok]);
  };

  const processOne = React.useCallback(
    async (item: QueueItem) => {
      running.current++;
      patch(item.id, { status: "uploading", step: "Uploading", error: undefined });
      try {
        const form = new FormData();
        form.set("kind", "pfd");
        form.set("file", item.file);
        const res = await api<{ job: JobDTO }>(`/api/sites/${siteId}/sources`, { method: "POST", body: form });
        patch(item.id, { status: "processing", step: res.job.step });
        const final = await pollJob<JobDTO>(res.job.id, (j) => patch(item.id, { step: j.step }));
        if (final.status === "failed") throw new Error(final.error || "Processing failed.");
        patch(item.id, { status: "done", step: "Done", message: final.message });
        final.warnings?.forEach((w) => toast.warning(`${item.file.name}: ${w}`));
      } catch (e) {
        patch(item.id, { status: "failed", step: "Failed", error: (e as Error).message });
      } finally {
        running.current--;
        onProgress();
      }
    },
    [siteId, onProgress],
  );

  // Pump the queue: keep up to CONCURRENCY drawings in flight.
  React.useEffect(() => {
    if (!started) return;
    const free = CONCURRENCY - running.current;
    const next = items.filter((i) => i.status === "queued").slice(0, Math.max(0, free));
    next.forEach((i) => {
      patch(i.id, { status: "uploading", step: "Uploading" });
      void processOne(i);
    });
  }, [items, started, processOne]);

  const busy = items.some((i) => i.status === "uploading" || i.status === "processing" || (started && i.status === "queued"));
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const finished = started && !busy && items.length > 0;

  React.useEffect(() => {
    if (finished && done > 0) toast.success(`${done} drawing${done === 1 ? "" : "s"} added to the site model${failed ? `, ${failed} failed` : ""}.`);
    // only when the queue drains
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent showClose={!busy} onInteractOutside={(e) => busy && e.preventDefault()} className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Upload Process Flow Diagram</DialogTitle>
          <DialogDescription>
            Process flow diagrams, P&IDs or electrical one-lines. Add several at once: they are read two at a time and each one adds to the site
            model.
          </DialogDescription>
        </DialogHeader>

        {!started && (
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
              add(e.dataTransfer.files);
            }}
            className={cn(
              "flex flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
              drag ? "border-accent bg-accent-soft" : "border-border hover:border-accent",
            )}
          >
            <FileUp className="size-8 text-muted" />
            <span className="text-sm font-medium">Drag files here or click to upload</span>
            <span className="text-xs text-muted">
              Accepted: {accept.label} · up to {maxUploadMb} MB each · multiple files
            </span>
          </button>
        )}
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          accept={accept.exts.join(",")}
          data-testid="upload-input"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = "";
          }}
        />

        {rejected.length > 0 && (
          <div className="rounded-lg border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger" role="alert">
            Upload failed. {rejected.join("; ")}.
          </div>
        )}

        {items.length > 0 && (
          <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-lg border border-border" data-testid="upload-queue">
            {items.map((i) => (
              <li key={i.id} className="flex items-start gap-2 px-3 py-2 text-sm" data-status={i.status}>
                <span className="mt-0.5">
                  {i.status === "done" ? (
                    <Check className="size-4 text-accent" />
                  ) : i.status === "failed" ? (
                    <X className="size-4 text-danger" />
                  ) : i.status === "queued" ? (
                    <span className="block size-4 rounded-full border-2 border-border" />
                  ) : (
                    <LoaderCircle className="size-4 animate-spin text-accent" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{i.file.name}</span>
                  <span className={cn("block text-xs", i.status === "failed" ? "text-danger" : "text-muted")} data-testid="upload-step">
                    {i.status === "failed" ? `Upload failed. ${i.error}` : (i.message ?? `${i.step}${i.status === "done" ? "" : "…"}`)}
                  </span>
                </span>
                {i.status === "failed" && (
                  <Button size="sm" variant="outline" onClick={() => patch(i.id, { status: "queued", step: "Queued", error: undefined })}>
                    <RotateCcw /> Retry
                  </Button>
                )}
                {!started && (
                  <button
                    type="button"
                    onClick={() => setItems((all) => all.filter((x) => x.id !== i.id))}
                    className="rounded p-0.5 text-muted hover:text-text"
                    aria-label={`Remove ${i.file.name}`}
                  >
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          {finished ? (
            <Button onClick={() => onOpenChange(false)}>Done</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={() => setStarted(true)} disabled={items.length === 0 || started}>
                {busy ? <LoaderCircle className="animate-spin" /> : null}
                {items.length > 1 ? `Process ${items.length} drawings` : "Build site model"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
