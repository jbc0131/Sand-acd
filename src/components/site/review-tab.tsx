"use client";

import * as React from "react";
import { Check, Flag, HelpCircle, LoaderCircle, Pencil, Plus, ShieldAlert, Timer, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, jsonInit } from "@/lib/client";
import {
  ASSET_TYPES,
  DRAWING_TYPE_LABELS,
  typeLabel,
  type DrawingDTO,
  type ReviewItemDTO,
  type ReviewListDTO,
  type ReviewMode,
  type ReviewState,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { PanZoomImage } from "./pan-zoom-image";
import { DrawingStatusPill } from "./drawing-status";

const REVIEWER_KEY = "siteaid-reviewer";
const IDLE_MS = 2 * 60 * 1000;
const FLUSH_MS = 15_000;

const STATE_STYLE: Record<ReviewState, string> = {
  unreviewed: "bg-muted-bg text-muted",
  accepted: "bg-accent-soft text-accent",
  corrected: "bg-chip-bg text-chip-fg",
  rejected: "bg-danger-bg text-danger",
  ambiguous: "bg-amber-bg text-amber-fg",
  added_missing: "bg-chip-bg text-chip-fg",
};
const STATE_LABEL: Record<ReviewState, string> = {
  unreviewed: "Unreviewed",
  accepted: "Accepted",
  corrected: "Corrected",
  rejected: "Rejected",
  ambiguous: "Ambiguous",
  added_missing: "Added (miss)",
};

function useReviewer(): [string, (v: string) => void] {
  const [name, setName] = React.useState("");
  React.useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read the saved name once, after mount
      setName(localStorage.getItem(REVIEWER_KEY) ?? "");
    } catch {
      // storage unavailable
    }
  }, []);
  const save = (v: string) => {
    setName(v);
    try {
      localStorage.setItem(REVIEWER_KEY, v);
    } catch {
      // storage unavailable
    }
  };
  return [name, save];
}

/**
 * Active review time for one drawing: counts only while the tab is visible and the reviewer has
 * interacted in the last 2 minutes. Time with a flagged item selected is also counted separately.
 */
function useReviewTimer(siteId: number, drawingId: number | null, reviewer: string, flaggedSelected: boolean) {
  const [display, setDisplay] = React.useState({ active: 0, flagged: 0 });
  const state = React.useRef({ sessionId: null as number | null, active: 0, flagged: 0, lastTick: 0, lastActivity: 0 });
  const flaggedRef = React.useRef(flaggedSelected);
  React.useEffect(() => {
    flaggedRef.current = flaggedSelected;
  }, [flaggedSelected]);

  const send = React.useCallback(
    async (ended: boolean) => {
      const s = state.current;
      if (!s.sessionId) return;
      const body = JSON.stringify({ activeMs: s.active, flaggedMs: s.flagged, ended });
      await fetch(`/api/sites/${siteId}/review-sessions/${s.sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {});
    },
    [siteId],
  );

  React.useEffect(() => {
    if (!drawingId) return;
    const s = state.current;
    s.sessionId = null;
    s.active = 0;
    s.flagged = 0;
    s.lastTick = Date.now();
    s.lastActivity = Date.now();
    let cancelled = false;
    api<{ id: number }>(`/api/sites/${siteId}/review-sessions`, jsonInit("POST", { drawingId, reviewer: reviewer || null }))
      .then((r) => {
        if (!cancelled) s.sessionId = r.id;
      })
      .catch(() => {});
    const activity = () => {
      s.lastActivity = Date.now();
    };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    const tick = setInterval(() => {
      const now = Date.now();
      const dt = Math.min(now - s.lastTick, 5000);
      s.lastTick = now;
      if (document.visibilityState === "visible" && now - s.lastActivity < IDLE_MS) {
        s.active += dt;
        if (flaggedRef.current) s.flagged += dt;
        setDisplay({ active: s.active, flagged: s.flagged });
      }
    }, 1000);
    const flush = setInterval(() => void send(false), FLUSH_MS);
    const onHide = () => void send(false);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      cancelled = true;
      clearInterval(tick);
      clearInterval(flush);
      events.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener("visibilitychange", onHide);
      void send(true);
    };
    // reviewer is captured when the session starts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, drawingId, send]);

  return { ...display, flush: () => send(false) };
}

const fmt = (ms: number) => `${Math.floor(ms / 60000)}m ${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}s`;

export function ReviewTab({
  siteId,
  drawings,
  reviewMode,
  initialDrawingId,
  onChanged,
}: {
  siteId: number;
  drawings: DrawingDTO[];
  reviewMode: ReviewMode;
  initialDrawingId: number | null;
  onChanged: () => void;
}) {
  const reviewable = drawings.filter((d) => d.status === "parsed" || d.status === "partial");
  const [drawingId, setDrawingId] = React.useState<number | null>(initialDrawingId ?? reviewable[0]?.id ?? null);
  const [list, setList] = React.useState<ReviewListDTO | null>(null);
  const [reloadKey, setReloadKey] = React.useState(0);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [showAll, setShowAll] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [addOpen, setAddOpen] = React.useState(false);
  const [reviewer, setReviewer] = useReviewer();
  const [focusNonce, setFocusNonce] = React.useState(0);

  const load = React.useCallback(
    async (id: number) => {
      try {
        setList(await api<ReviewListDTO>(`/api/sites/${siteId}/drawings/${id}/review`));
      } catch (e) {
        toast.error((e as Error).message);
      }
    },
    [siteId],
  );

  React.useEffect(() => {
    if (!drawingId) return;
    let live = true;
    api<ReviewListDTO>(`/api/sites/${siteId}/drawings/${drawingId}/review`)
      .then((d) => live && setList(d))
      .catch((e: Error) => toast.error(e.message));
    return () => {
      live = false;
    };
  }, [siteId, drawingId, reviewMode, reloadKey]);
  const loading = Boolean(drawingId && list?.drawing.id !== drawingId);

  const items = list?.items ?? [];
  const sel = items.find((i) => i.key === selected) ?? null;
  const timer = useReviewTimer(siteId, drawingId, reviewer, Boolean(sel?.flagged));
  const visible = items.filter((i) => showAll || i.required || !i.live);
  const hidden = items.length - visible.length;

  const act = async (item: ReviewItemDTO, action: "accept" | "correct" | "reject" | "ambiguous", after?: Record<string, string>, comment?: string) => {
    setBusy(true);
    try {
      await api(
        `/api/sites/${siteId}/review`,
        jsonInit("POST", {
          drawingId: item.drawingId,
          targetType: item.targetType,
          targetId: item.targetId,
          attrKey: item.attrKey,
          action,
          after,
          comment,
          reviewer: reviewer || undefined,
        }),
      );
      await timer.flush();
      await load(item.drawingId);
      onChanged();
      // Move on to the next unreviewed required item.
      const idx = visible.findIndex((i) => i.key === item.key);
      const next = visible.slice(idx + 1).find((i) => i.state === "unreviewed" && i.live);
      if (next && action !== "reject") {
        setSelected(next.key);
        setFocusNonce((n) => n + 1);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (mode: ReviewMode) => {
    try {
      await api(`/api/sites/${siteId}`, jsonInit("PATCH", { reviewMode: mode }));
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (reviewable.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
        No parsed drawings to review yet. Upload drawings first.
      </div>
    );
  }

  const drawing = list?.drawing ?? reviewable.find((d) => d.id === drawingId) ?? null;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-panel px-3 py-2 sm:px-5">
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Drawing
          <select
            value={drawingId ?? ""}
            onChange={(e) => {
              setDrawingId(Number(e.target.value));
              setSelected(null);
            }}
            className="h-8 max-w-[260px] rounded-lg border border-border bg-panel px-2 text-sm text-text"
            aria-label="Drawing to review"
            data-testid="review-drawing-select"
          >
            {reviewable.map((d) => (
              <option key={d.id} value={d.id}>
                {d.drawingNumber ?? d.fileName}
                {d.revision ? ` rev ${d.revision}` : ""} · {DRAWING_TYPE_LABELS[d.drawingType]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          Reviewer
          <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Your name" className="h-8 w-36" aria-label="Reviewer name" />
        </label>
        <div className="flex items-center gap-1 rounded-full border border-border bg-page p-0.5 text-xs" role="radiogroup" aria-label="Review mode">
          {(
            [
              ["full", "Full verification"],
              ["exception", "Exception-based"],
            ] as [ReviewMode, string][]
          ).map(([m, l]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={reviewMode === m}
              onClick={() => setMode(m)}
              className={cn("rounded-full px-2.5 py-1", reviewMode === m ? "bg-accent text-accent-fg" : "text-muted hover:text-text")}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 text-xs text-muted">
          {list && (
            <span data-testid="review-progress">
              {list.reviewed}/{list.required} required reviewed
            </span>
          )}
          <span className="flex items-center gap-1 tabular-nums" title="Active review time on this drawing (this session). Idle over 2 minutes or a hidden tab is not counted.">
            <Timer className="size-3.5" /> {fmt(timer.active)} · flagged {fmt(timer.flagged)}
          </span>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-[40dvh] flex-1 flex-col gap-2 p-3 lg:min-h-0">
          {drawing && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-semibold">{drawing.title ?? drawing.fileName}</span>
              <DrawingStatusPill status={drawing.status} />
              {drawing.status === "partial" && (
                <span className="text-amber-fg">
                  {drawing.partialReason} · {drawing.resolvedPct}% resolved
                </span>
              )}
            </div>
          )}
          <PanZoomImage
            src={drawing?.hasImage ? `/api/sites/${siteId}/drawings/${drawing.id}/image` : null}
            alt={drawing ? `${drawing.drawingNumber ?? drawing.fileName} page 1` : "Drawing"}
            className="min-h-[36dvh] flex-1"
            boxes={items
              .filter((i) => i.targetType === "component" && i.bbox && i.live)
              .map((i) => ({ key: i.key, bbox: i.bbox!, label: i.label, active: sel?.assetId != null && i.assetId === sel.assetId }))}
            focus={sel?.bbox ?? null}
            focusKey={`${drawingId}:${sel?.key ?? ""}:${focusNonce}`}
            onBoxClick={(k) => {
              setSelected(k);
              setFocusNonce((n) => n + 1);
            }}
          />
        </div>

        <div className="flex min-h-0 w-full flex-col border-t border-border bg-panel lg:w-[440px] lg:border-t-0 lg:border-l">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-sm font-semibold">Extracted items</span>
            <span className="text-xs text-muted">{items.length}</span>
            {loading && <LoaderCircle className="size-3.5 animate-spin text-muted" />}
            <Button size="sm" variant="outline" className="ml-auto" onClick={() => setAddOpen(true)}>
              <Plus /> Add missing
            </Button>
          </div>
          {reviewMode === "exception" && (
            <div className="flex items-center gap-2 border-b border-border bg-amber-bg/50 px-3 py-1.5 text-xs text-amber-fg">
              Exception-based: flagged and safety-related items only.
              {hidden > 0 && (
                <button type="button" className="ml-auto underline" onClick={() => setShowAll((v) => !v)}>
                  {showAll ? "Hide" : "Show"} {hidden} not required
                </button>
              )}
              {showAll && hidden === 0 && (
                <button type="button" className="ml-auto underline" onClick={() => setShowAll(false)}>
                  Hide not required
                </button>
              )}
            </div>
          )}
          <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto" data-testid="review-list">
            {visible.map((item) => (
              <ReviewRow
                key={item.key}
                item={item}
                selected={item.key === selected}
                busy={busy}
                onSelect={() => {
                  setSelected(item.key === selected ? null : item.key);
                  setFocusNonce((n) => n + 1);
                }}
                onAct={(a, after, comment) => act(item, a, after, comment)}
              />
            ))}
          </ul>
        </div>
      </div>

      {drawingId && (
        <AddMissingDialog
          open={addOpen}
          onOpenChange={setAddOpen}
          siteId={siteId}
          drawingId={drawingId}
          reviewer={reviewer}
          onAdded={async () => {
            await timer.flush();
            setReloadKey((k) => k + 1);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ReviewRow({
  item,
  selected,
  busy,
  onSelect,
  onAct,
}: {
  item: ReviewItemDTO;
  selected: boolean;
  busy: boolean;
  onSelect: () => void;
  onAct: (a: "accept" | "correct" | "reject" | "ambiguous", after?: Record<string, string>, comment?: string) => void;
}) {
  const [mode, setMode] = React.useState<"none" | "edit" | "ambiguous">("none");
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [comment, setComment] = React.useState("");
  const value =
    item.targetType === "attribute"
      ? item.current.value
      : item.targetType === "connection"
        ? item.current.label || "(no label)"
        : item.current.type
          ? typeLabel(item.current.type as (typeof ASSET_TYPES)[number])
          : "";

  return (
    <li
      className={cn("px-3 py-2", selected && "bg-muted-bg/70", !item.live && "opacity-60")}
      data-testid="review-item"
      data-key={item.key}
      data-type={item.targetType}
      data-state={item.state}
      data-flagged={item.flagged ? "true" : "false"}
    >
      <button type="button" onClick={onSelect} className="flex w-full items-start gap-2 text-left" aria-expanded={selected}>
        <span className="mt-0.5 w-4 shrink-0">
          {item.flagged && <Flag className="size-3.5 fill-amber text-amber" aria-label="Flagged: confidence below 0.8" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="rounded bg-muted-bg px-1 text-[10px] tracking-wide text-muted uppercase">{item.targetType}</span>
            <span className="truncate text-sm font-medium">{item.label}</span>
            {item.safetyRelated && <ShieldAlert className="size-3.5 text-danger" aria-label="Safety-related: always fully reviewed" />}
          </span>
          {value && <span className="block truncate font-mono text-xs text-muted">{value}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-medium", STATE_STYLE[item.state])}>{STATE_LABEL[item.state]}</span>
          {item.confidence != null && (
            <span className={cn("text-[10px] tabular-nums", item.flagged ? "text-amber-fg" : "text-muted")}>{Math.round(item.confidence * 100)}%</span>
          )}
        </span>
      </button>

      {selected && (
        <div className="mt-2 space-y-2 pl-6">
          {item.after && (
            <p className="text-xs text-muted">
              Changed: {Object.entries(item.after).filter(([k]) => !k.startsWith("__")).map(([k, v]) => `${k} → ${v}`).join(", ")}
            </p>
          )}
          {item.comment && <p className="text-xs text-amber-fg">Comment: {item.comment}</p>}
          {item.reviewedAt && (
            <p className="text-[11px] text-muted">
              {STATE_LABEL[item.state]} {item.reviewer ? `by ${item.reviewer} ` : ""}at {new Date(item.reviewedAt).toLocaleString()}
            </p>
          )}
          {item.live && item.state !== "added_missing" && mode === "none" && (
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" disabled={busy} onClick={() => onAct("accept")}>
                <Check /> Accept
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setDraft(
                    item.targetType === "component"
                      ? { name: item.current.name, type: item.current.type, description: item.current.description }
                      : item.targetType === "attribute"
                        ? { value: item.current.value }
                        : { label: item.current.label },
                  );
                  setMode("edit");
                }}
              >
                <Pencil /> Edit
              </Button>
              <Button size="sm" variant="outline" className="text-danger" disabled={busy} onClick={() => onAct("reject")}>
                <X /> Reject
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMode("ambiguous")}>
                <HelpCircle /> Mark ambiguous
              </Button>
            </div>
          )}
          {mode === "edit" && (
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onAct("correct", draft);
                setMode("none");
              }}
            >
              {Object.keys(draft).map((k) =>
                k === "type" ? (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted">type</span>
                    <select
                      value={draft[k]}
                      onChange={(e) => setDraft({ ...draft, [k]: e.target.value })}
                      className="h-8 flex-1 rounded-lg border border-border bg-panel px-2 text-sm"
                    >
                      {ASSET_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {typeLabel(t)}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label key={k} className="flex items-center gap-2 text-xs">
                    <span className="w-20 text-muted">{k}</span>
                    <Input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} className="h-8 flex-1" aria-label={`Corrected ${k}`} />
                  </label>
                ),
              )}
              {item.targetType === "attribute" && <p className="text-[11px] text-muted">Read from the drawing: {item.current.read}</p>}
              <div className="flex gap-1.5">
                <Button size="sm" type="submit" disabled={busy}>
                  Save correction
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setMode("none")}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
          {mode === "ambiguous" && (
            <form
              className="space-y-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                onAct("ambiguous", undefined, comment);
                setMode("none");
              }}
            >
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What needs adjudication?"
                className="min-h-16 w-full rounded-lg border border-border bg-panel p-2 text-sm"
                required
                aria-label="Ambiguity comment"
              />
              <div className="flex gap-1.5">
                <Button size="sm" type="submit" disabled={busy || !comment.trim()}>
                  Mark ambiguous
                </Button>
                <Button size="sm" variant="ghost" type="button" onClick={() => setMode("none")}>
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </li>
  );
}

function AddMissingDialog({
  open,
  onOpenChange,
  siteId,
  drawingId,
  reviewer,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  siteId: number;
  drawingId: number;
  reviewer: string;
  onAdded: () => Promise<void>;
}) {
  const [kind, setKind] = React.useState<"component" | "connection">("component");
  const [f, setF] = React.useState({ name: "", tag: "", type: "other", description: "", fromTag: "", toTag: "", label: "" });
  const [busy, setBusy] = React.useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body =
        kind === "component"
          ? { kind, drawingId, name: f.name, tag: f.tag, type: f.type, description: f.description, reviewer: reviewer || undefined }
          : { kind, drawingId, fromTag: f.fromTag, toTag: f.toTag, label: f.label, reviewer: reviewer || undefined };
      await api(`/api/sites/${siteId}/review/missing`, jsonInit("POST", body));
      toast.success(`Missing ${kind} added. It counts as a miss in recall.`);
      setF({ name: "", tag: "", type: "other", description: "", fromTag: "", toTag: "", label: "" });
      onOpenChange(false);
      await onAdded();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const field = (k: keyof typeof f, label: string, required = false) => (
    <label className="grid gap-1 text-sm">
      {label}
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={required} />
    </label>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-3">
          <DialogHeader>
            <DialogTitle>Add missing item</DialogTitle>
            <DialogDescription>Something on the drawing the extraction missed. Added items count as misses in recall.</DialogDescription>
          </DialogHeader>
          <div className="flex gap-1 rounded-full border border-border bg-page p-0.5 text-sm" role="radiogroup">
            {(["component", "connection"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="radio"
                aria-checked={kind === k}
                onClick={() => setKind(k)}
                className={cn("flex-1 rounded-full px-3 py-1 capitalize", kind === k ? "bg-accent text-accent-fg" : "text-muted")}
              >
                {k}
              </button>
            ))}
          </div>
          {kind === "component" ? (
            <>
              {field("name", "Name", true)}
              {field("tag", "Tag (as drawn)")}
              <label className="grid gap-1 text-sm">
                Type
                <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className="h-9 rounded-lg border border-border bg-panel px-2">
                  {ASSET_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {typeLabel(t)}
                    </option>
                  ))}
                </select>
              </label>
              {field("description", "Description")}
            </>
          ) : (
            <>
              {field("fromTag", "From tag", true)}
              {field("toTag", "To tag", true)}
              {field("label", "Label")}
            </>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
