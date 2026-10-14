"use client";

import * as React from "react";
import { Bot, ChevronDown, ChevronUp, LoaderCircle, Send, ThumbsDown, ThumbsUp } from "lucide-react";
import { api, jsonInit } from "@/lib/client";
import type { ChatMessageDTO, ChatSource, SiteModel } from "@/lib/types";
import { cn } from "@/lib/utils";

interface LiveMessage extends ChatMessageDTO {
  streaming?: boolean;
  error?: string;
}

export interface CopilotHandle {
  ask: (question: string) => void;
}

export const Copilot = React.forwardRef<
  CopilotHandle,
  {
    model: SiteModel;
    onHighlight: (tags: string[]) => void;
    onFocusTag: (tag: string) => void;
    onOpenDrawing: (drawingId: number, assetId: number) => void;
  }
>(function Copilot({ model, onHighlight, onFocusTag, onOpenDrawing }, ref) {
  const siteId = model.site.id;
  const [open, setOpen] = React.useState(true);
  const [messages, setMessages] = React.useState<LiveMessage[]>([]);
  const [input, setInput] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    // Collapsed by default on narrow screens.
    if (window.innerWidth < 760) setOpen(false);
  }, []);

  React.useEffect(() => {
    api<{ messages: ChatMessageDTO[] }>(`/api/sites/${siteId}/chat`)
      .then((d) => setMessages(d.messages))
      .catch(() => {});
  }, [siteId]);

  React.useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  const suggestions = React.useMemo(() => buildSuggestions(model), [model]);

  const send = React.useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      setOpen(true);
      setInput("");
      setBusy(true);
      const now = new Date().toISOString();
      const userMsg: LiveMessage = { id: -Date.now(), role: "user", content: q, tools: [], highlight: [], sources: [], drawings: [], feedback: null, createdAt: now };
      const botId = -Date.now() - 1;
      const bot: LiveMessage = { id: botId, role: "assistant", content: "", tools: [], highlight: [], sources: [], drawings: [], feedback: null, createdAt: now, streaming: true };
      setMessages((m) => [...m, userMsg, bot]);
      const patch = (fn: (m: LiveMessage) => LiveMessage) => setMessages((all) => all.map((m) => (m.id === botId ? fn(m) : m)));

      try {
        const res = await fetch(`/api/sites/${siteId}/copilot`, jsonInit("POST", { message: q }));
        if (!res.ok || !res.body) {
          const d = await res.json().catch(() => null);
          throw new Error(d?.error || "Copilot is unavailable.");
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let finalId: number | null = null;
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const data = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!data) continue;
            const ev = JSON.parse(data.slice(6));
            if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.text }));
            else if (ev.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, { name: ev.name, count: ev.count }] }));
            else if (ev.type === "highlight") {
              patch((m) => ({ ...m, highlight: ev.tags }));
              onHighlight(ev.tags);
            } else if (ev.type === "error") patch((m) => ({ ...m, error: ev.message }));
            else if (ev.type === "done") {
              finalId = ev.id;
              patch((m) => ({ ...m, id: ev.id, content: ev.content, sources: ev.sources, drawings: ev.drawings ?? [], highlight: ev.highlight, streaming: false }));
            }
          }
        }
        if (finalId === null) patch((m) => ({ ...m, streaming: false }));
      } catch (e) {
        patch((m) => ({ ...m, streaming: false, error: (e as Error).message }));
      } finally {
        setBusy(false);
      }
    },
    [busy, siteId, onHighlight],
  );

  React.useImperativeHandle(ref, () => ({ ask: (q: string) => void send(q) }), [send]);

  const feedback = async (id: number, value: "up" | "down") => {
    const current = messages.find((m) => m.id === id)?.feedback;
    const next = current === value ? null : value;
    setMessages((all) => all.map((m) => (m.id === id ? { ...m, feedback: next } : m)));
    await api(`/api/sites/${siteId}/chat/${id}`, jsonInit("PATCH", { feedback: next })).catch(() => {});
  };

  return (
    <section
      className={cn(
        "absolute right-3 bottom-3 z-20 flex flex-col overflow-hidden rounded-xl border border-border bg-panel shadow-float",
        open ? "max-h-[min(560px,calc(100%-1.5rem))] w-[calc(100%-1.5rem)] sm:w-[390px]" : "w-[230px] sm:w-[390px]",
      )}
      data-testid="copilot"
      aria-label="SiteAId Copilot"
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-3 border-b border-border px-3.5 py-2.5 text-left"
        aria-expanded={open}
      >
        <span className="flex size-8 items-center justify-center rounded-full bg-accent text-accent-fg">
          <Bot className="size-4" />
        </span>
        <span className="flex-1 leading-tight">
          <span className="block text-sm font-semibold">SiteAId Copilot</span>
          <span className="block text-xs text-muted">Get help from Copilot</span>
        </span>
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronUp className="size-4 text-muted" />}
      </button>

      {open && (
        <>
          <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3.5">
            <BotBubble>
              Ask questions about the current view and get insights into site performance, assets, and operational data.
            </BotBubble>
            {!model.hasApiKey && (
              <p className="rounded-lg bg-amber-bg px-3 py-2 text-xs text-amber-fg" data-testid="copilot-no-key">
                Copilot needs ANTHROPIC_API_KEY set on the server. The knowledge base is indexed and ready; add the key and restart to ask
                questions.
              </p>
            )}
            {messages.length === 0 && model.hasApiKey && suggestions.length > 0 && (
              <div className="flex flex-col items-start gap-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="rounded-lg bg-dark-surface px-3 py-2 text-left text-xs text-dark-surface-fg hover:brightness-125"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <UserMessage key={m.id} m={m} />
              ) : (
                <AssistantMessage
                  key={m.id}
                  m={m}
                  onFocusTag={onFocusTag}
                  onRemoveHighlight={() => onHighlight([])}
                  onOpenDrawing={onOpenDrawing}
                  onReapplyHighlight={() => onHighlight(m.highlight)}
                  onFeedback={feedback}
                />
              ),
            )}
          </div>
          <form
            className="flex items-center gap-2 border-t border-border p-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Copilot anything"
              disabled={!model.hasApiKey}
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-page px-3 text-sm outline-none placeholder:text-muted focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-60"
              aria-label="Ask Copilot anything"
            />
            <button
              type="submit"
              disabled={!input.trim() || busy || !model.hasApiKey}
              className="flex size-9 items-center justify-center rounded-lg bg-accent text-accent-fg disabled:opacity-40"
              aria-label="Send"
            >
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
            </button>
          </form>
        </>
      )}
    </section>
  );
});

function buildSuggestions(model: SiteModel): string[] {
  const out: string[] = [];
  const rotating = model.assets.find((a) => (a.type === "pump" || a.type === "motor") && a.tag);
  if (rotating) out.push(`What is the start procedure for ${rotating.tag}?`);
  if (model.assets.some((a) => a.enrichmentStatus === "pending")) out.push("Which assets are still pending enrichment?");
  const gen = model.assets.find((a) => a.type === "generator" && a.tag);
  if (gen) out.push(`What happens on loss of offsite power for ${gen.tag}?`);
  else {
    const bus = model.assets.find((a) => a.type === "bus" && a.tag);
    if (bus) out.push(`What loads are fed from ${bus.tag}?`);
  }
  if (out.length < 3 && model.assets.length) out.push("Summarize the site model and its main connections.");
  return out.slice(0, 3);
}

function time(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function BotBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
        <Bot className="size-3.5" />
      </span>
      <div className="rounded-xl rounded-tl-sm bg-muted-bg px-3 py-2 text-sm">{children}</div>
    </div>
  );
}

function UserMessage({ m }: { m: LiveMessage }) {
  return (
    <div className="flex flex-row-reverse gap-2.5">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-chip-bg text-[10px] font-semibold text-chip-fg">You</span>
      <div className="min-w-0 max-w-[85%]">
        <div className="mb-0.5 text-right text-[11px] text-muted">
          You · {time(m.createdAt)}
        </div>
        <div className="rounded-xl rounded-tr-sm bg-accent px-3 py-2 text-sm whitespace-pre-wrap text-accent-fg">{m.content}</div>
      </div>
    </div>
  );
}

function AssistantMessage({
  m,
  onFocusTag,
  onRemoveHighlight,
  onOpenDrawing,
  onReapplyHighlight,
  onFeedback,
}: {
  m: LiveMessage;
  onFocusTag: (tag: string) => void;
  onRemoveHighlight: () => void;
  onOpenDrawing: (drawingId: number, assetId: number) => void;
  onReapplyHighlight: () => void;
  onFeedback: (id: number, v: "up" | "down") => void;
}) {
  const [openSource, setOpenSource] = React.useState<number | null>(null);
  const [hlRemoved, setHlRemoved] = React.useState(false);
  const src = m.sources.find((s) => s.n === openSource);
  return (
    <div className="flex gap-2.5" data-testid="copilot-answer">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
        <Bot className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[11px] text-muted">SiteAId Copilot · {time(m.createdAt)}</div>
        {m.tools.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1">
            {m.tools.map((t, i) => (
              <span key={i} className="rounded border border-border bg-page px-1.5 py-0.5 font-mono text-[10.5px] text-muted">
                🔧 {t.name}
                {t.count !== undefined && t.name !== "highlight_asset" ? ` · ${t.count}` : ""}
              </span>
            ))}
          </div>
        )}
        <div className="rounded-xl rounded-tl-sm bg-muted-bg px-3 py-2 text-sm">
          {m.content ? (
            <RichText text={m.content} onTag={onFocusTag} />
          ) : m.streaming ? (
            <span className="inline-flex items-center gap-2 text-muted">
              <LoaderCircle className="size-3.5 animate-spin" /> Thinking…
            </span>
          ) : null}
          {m.error && <p className="mt-1 text-xs text-danger">{m.error}</p>}
        </div>
        {m.highlight.length > 0 && (
          <button
            type="button"
            className="mt-1 text-xs text-amber-fg underline underline-offset-2"
            onClick={() => {
              if (hlRemoved) onReapplyHighlight();
              else onRemoveHighlight();
              setHlRemoved(!hlRemoved);
            }}
          >
            {hlRemoved ? "Show highlight" : "Remove highlight"}
          </button>
        )}
        {(m.sources.length > 0 || m.drawings.length > 0) && (
          <div className="mt-1.5">
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[11px] text-muted">Sources</span>
              {m.drawings.map((d) => (
                <button
                  key={`${d.drawingId}:${d.assetId}`}
                  type="button"
                  onClick={() => onOpenDrawing(d.drawingId, d.assetId)}
                  className="rounded border border-chip-fg/30 bg-chip-bg px-1.5 py-0.5 font-mono text-[10.5px] text-chip-fg hover:border-chip-fg"
                  title={`Open ${d.drawingNumber}${d.revision ? ` rev ${d.revision}` : ""} at ${d.tag}`}
                  data-testid="drawing-source-chip"
                >
                  DWG {d.drawingNumber}
                  {m.drawings.filter((x) => x.drawingId === d.drawingId).length > 1 ? ` · ${d.tag}` : ""}
                </button>
              ))}
              {m.sources.map((s) => (
                <button
                  key={s.n}
                  type="button"
                  onClick={() => setOpenSource(openSource === s.n ? null : s.n)}
                  className={cn(
                    "size-5 rounded border text-[10.5px] font-medium",
                    openSource === s.n ? "border-accent bg-accent text-accent-fg" : "border-border bg-panel text-muted hover:text-text",
                  )}
                  title={`${s.file}, page ${s.page}, section ${s.sectionNo}`}
                  aria-label={`Source ${s.n}`}
                >
                  {s.n}
                </button>
              ))}
            </div>
            {src && <SourceCard s={src} />}
          </div>
        )}
        {!m.streaming && m.id > 0 && (
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              onClick={() => onFeedback(m.id, "up")}
              className={cn("rounded p-1 text-muted hover:text-text", m.feedback === "up" && "text-accent")}
              aria-label="Helpful"
              aria-pressed={m.feedback === "up"}
            >
              <ThumbsUp className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onFeedback(m.id, "down")}
              className={cn("rounded p-1 text-muted hover:text-text", m.feedback === "down" && "text-danger")}
              aria-label="Not helpful"
              aria-pressed={m.feedback === "down"}
            >
              <ThumbsDown className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SourceCard({ s }: { s: ChatSource }) {
  return (
    <div className="mt-1.5 rounded-lg border border-border bg-page p-2.5 text-xs">
      <div className="mb-1 font-medium">
        {s.file} · page {s.page} · section {s.sectionNo}
      </div>
      <p className="whitespace-pre-wrap text-muted">{s.text}</p>
    </div>
  );
}

/** Minimal renderer: paragraphs, numbered/bulleted lists, **bold**, and [[TAG]] links. */
function RichText({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  const lines = text.split("\n");
  const blocks: React.ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(
      <Tag key={blocks.length} className={cn("my-1 space-y-0.5 pl-5", list.ordered ? "list-decimal" : "list-disc")}>
        {list.items.map((it, i) => (
          <li key={i}>
            <Inline text={it} onTag={onTag} />
          </li>
        ))}
      </Tag>,
    );
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    if (ol || ul) {
      const ordered = Boolean(ol);
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ol ?? ul)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(
      <p key={blocks.length} className={cn("my-1", heading && "font-semibold", /^sources?:/i.test(line) && "text-xs text-muted")}>
        <Inline text={heading ? heading[1] : line} onTag={onTag} />
      </p>,
    );
  }
  flush();
  return <div className="[&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{blocks}</div>;
}

function Inline({ text, onTag }: { text: string; onTag: (tag: string) => void }) {
  const parts = text.split(/(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const tag = p.match(/^\[\[([^\]]+)\]\]$/);
        if (tag)
          return (
            <button
              key={i}
              type="button"
              onClick={() => onTag(tag[1])}
              className="font-medium text-amber underline decoration-dotted underline-offset-2 hover:brightness-110"
              data-testid="tag-link"
            >
              {tag[1]}
            </button>
          );
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i}>{bold[1]}</strong>;
        return <React.Fragment key={i}>{p}</React.Fragment>;
      })}
    </>
  );
}

