// Shared types used by both server and client code. No server imports here.

export const ASSET_TYPES = [
  "source",
  "treatment",
  "chemical",
  "storage",
  "pump",
  "motor",
  "valve",
  "instrument",
  "generator",
  "transformer",
  "breaker",
  "bus",
  "mcc",
  "panel",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const SOURCE_KINDS = ["pfd", "om", "assetdb", "telemetry"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
export const ENRICHMENT_KINDS: SourceKind[] = ["om", "assetdb", "telemetry"];

export type SiteStatus = "in_planning" | "active";
export type SourceStatus = "ingested" | "applied" | "failed";
export type EnrichmentStatus = "pending" | "partial" | "enriched";

export interface SiteSummary {
  id: number;
  name: string;
  location: string | null;
  status: SiteStatus;
  assetCount: number;
  enrichedCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface SourceDTO {
  id: number;
  kind: SourceKind;
  fileName: string;
  status: SourceStatus;
  summary: string | null;
  createdAt: string;
}

export interface ParamDTO {
  key: string;
  value: string;
  sourceId: number;
  sourceKind: SourceKind;
  fileName: string;
  /** true when this value was written by the most recent enrichment run */
  fresh: boolean;
}

export interface AssetDTO {
  id: number;
  extId: string;
  name: string;
  tag: string;
  type: AssetType;
  description: string;
  params: Record<string, string>;
  provenance: ParamDTO[];
  enrichmentStatus: EnrichmentStatus;
  x: number;
  y: number;
}

export interface EdgeDTO {
  id: number;
  from: number;
  to: number;
  label: string;
}

export interface SiteModel {
  site: SiteSummary;
  assets: AssetDTO[];
  edges: EdgeDTO[];
  sources: SourceDTO[];
  hasApiKey: boolean;
  maxUploadMb: number;
}

export interface JobDTO {
  id: string;
  kind: "diagram" | "enrich";
  status: "running" | "done" | "failed";
  step: string;
  error?: string;
  message?: string;
  warnings?: string[];
}

export interface ChatSource {
  n: number;
  chunkId: number;
  sectionNo: number;
  file: string;
  page: number;
  text: string;
}

export interface ChatMessageDTO {
  id: number;
  role: "user" | "assistant";
  content: string;
  tools: { name: string; count?: number }[];
  highlight: string[];
  sources: ChatSource[];
  feedback: "up" | "down" | null;
  createdAt: string;
}

/** Uppercase, alphanumerics only. Used to match tags across files. */
export function normalizeTag(tag: string): string {
  return (tag ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const STATUS_COLORS: Record<EnrichmentStatus | "enriching", string> = {
  pending: "#6b7280",
  enriching: "#c27c2c",
  partial: "#f2c94c",
  enriched: "#3fb37f",
};

export const STATUS_LABELS: Record<EnrichmentStatus | "enriching", string> = {
  pending: "Pending",
  enriching: "Enriching",
  partial: "Partial",
  enriched: "Enriched",
};

export const SOURCE_ACCEPT: Record<SourceKind, { exts: string[]; label: string }> = {
  pfd: { exts: [".pdf", ".png", ".jpg", ".jpeg"], label: "PDF, PNG, JPG" },
  om: { exts: [".pdf", ".txt"], label: "PDF, TXT" },
  assetdb: { exts: [".csv"], label: "CSV" },
  telemetry: { exts: [".csv"], label: "CSV" },
};

export function typeLabel(t: AssetType): string {
  return t === "mcc" ? "MCC" : t.charAt(0).toUpperCase() + t.slice(1);
}
