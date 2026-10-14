"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Building2, FlaskConical, MapPin, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusPill } from "@/components/status-pill";
import { useGlobalSearch } from "@/components/app-shell";
import { api, jsonInit } from "@/lib/client";
import type { SiteSummary } from "@/lib/types";

export function SitesHome() {
  const router = useRouter();
  const { query } = useGlobalSearch();
  const [sites, setSites] = React.useState<SiteSummary[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [addOpen, setAddOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    api<{ sites: SiteSummary[] }>("/api/sites")
      .then((d) => setSites(d.sites))
      .catch((e: Error) => setError(e.message));
  }, []);

  const addSample = async () => {
    setBusy(true);
    try {
      const { id } = await api<{ id: number }>("/api/sites/sample", { method: "POST" });
      toast.success("Sample site added (fictional data).");
      router.push(`/sites/${id}`);
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  const q = query.trim().toLowerCase();
  const visible = (sites ?? []).filter((s) => !q || `${s.name} ${s.location ?? ""}`.toLowerCase().includes(q));

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-semibold">Available Sites</h1>
          <p className="text-sm text-muted">Build a connected asset model from engineering diagrams, then enrich it.</p>
        </div>
        <Button variant="outline" onClick={addSample} disabled={busy}>
          <FlaskConical /> Add sample site
        </Button>
        <Button onClick={() => setAddOpen(true)}>
          <Plus /> Add site
        </Button>
      </div>

      {error && <div className="rounded-xl border border-danger/40 bg-danger-bg p-4 text-sm text-danger">{error}</div>}

      {sites === null && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-36 animate-pulse rounded-xl border border-border bg-panel" />
          ))}
        </div>
      )}

      {sites && sites.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border bg-panel px-6 py-14 text-center">
          <Building2 className="size-10 text-muted" />
          <h2 className="font-semibold">No sites yet</h2>
          <p className="max-w-md text-sm text-muted">
            Add a site and upload a process flow diagram or electrical one-line, or load the fictional sample site to see the full demo
            without an API key.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={addSample} disabled={busy}>
              <FlaskConical /> Add sample site
            </Button>
            <Button onClick={() => setAddOpen(true)}>
              <Plus /> Add site
            </Button>
          </div>
        </div>
      )}

      {sites && sites.length > 0 && visible.length === 0 && <p className="text-sm text-muted">No sites match “{query}”.</p>}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((s) => (
          <Link
            key={s.id}
            href={`/sites/${s.id}`}
            data-testid="site-card"
            className="group flex flex-col gap-3 rounded-xl border border-border bg-panel p-4 shadow-card transition hover:border-accent"
          >
            <div className="flex items-start gap-2">
              <h2 className="mr-auto line-clamp-2 font-semibold group-hover:text-accent">{s.name}</h2>
              <StatusPill status={s.status} />
            </div>
            <div className="flex gap-6 text-sm">
              <div>
                <div className="text-lg font-semibold">{s.assetCount}</div>
                <div className="text-xs text-muted">Assets</div>
              </div>
              <div>
                <div className="text-lg font-semibold">{s.enrichedCount}</div>
                <div className="text-xs text-muted">Enriched</div>
              </div>
            </div>
            <div className="mt-auto flex items-center gap-1.5 text-xs text-muted">
              <MapPin className="size-3.5" />
              {s.location ? s.location : <i>Unset</i>}
            </div>
          </Link>
        ))}
      </div>

      <AddSiteDialog open={addOpen} onOpenChange={setAddOpen} onCreated={(id) => router.push(`/sites/${id}`)} />
    </div>
  );
}

function AddSiteDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: number) => void }) {
  const [name, setName] = React.useState("");
  const [location, setLocation] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { id } = await api<{ id: number }>("/api/sites", jsonInit("POST", { name, location: location || null }));
      onCreated(id);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Add site</DialogTitle>
            <DialogDescription>Create an empty site, then upload a diagram to build its model.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-1.5 text-sm">
            Name
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Unit 1 Electrical" required autoFocus />
          </label>
          <label className="grid gap-1.5 text-sm">
            Location <span className="text-xs text-muted">(optional)</span>
            <Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City, state" />
          </label>
          {error && <p className="text-sm text-danger">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              Create site
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
