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
  "relay",
  "ct",
  "pt",
  "fuse",
  "disconnect",
  "other",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

/** Kinds a user can upload. */
export const SOURCE_KINDS = ["pfd", "om", "assetdb", "telemetry"] as const;
export type UploadKind = (typeof SOURCE_KINDS)[number];
/** 'sme' is the per-site source that holds SME corrections from review. */
export type SourceKind = UploadKind | "sme";
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
  kind: UploadKind;
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
  safetyRelated: boolean;
  appearances: AppearanceDTO[];
  discrepancies: DiscrepancyDTO[];
  docLinks: DocLinkDTO[];
}

export interface EdgeDTO {
  id: number;
  from: number;
  to: number;
  label: string;
  kind: "power" | "control";
  drawingId: number | null;
  confidence: number | null;
  via: string;
}

export const DRAWING_TYPES = ["single_line", "elementary", "pid", "pfd", "isometric", "switchgear_notes", "other"] as const;
export type DrawingType = (typeof DRAWING_TYPES)[number];
export const DRAWING_TYPE_LABELS: Record<DrawingType, string> = {
  single_line: "Single line",
  elementary: "Elementary",
  pid: "P&ID",
  pfd: "PFD",
  isometric: "Isometric",
  switchgear_notes: "Switchgear notes",
  other: "Other",
};
export type DrawingStatus = "queued" | "processing" | "parsed" | "partial" | "failed";

/** [x0, y0, x1, y1] in normalized 0..1 page coordinates, origin top-left. */
export type BBox = [number, number, number, number];

export interface DrawingDTO {
  id: number;
  sourceId: number | null;
  fileName: string;
  hasImage: boolean;
  drawingNumber: string | null;
  revision: string | null;
  dateDrawn: string | null;
  unit: string | null;
  system: string | null;
  title: string | null;
  author: string | null;
  siteLabel: string | null;
  drawingType: DrawingType;
  status: DrawingStatus;
  partialReason: string | null;
  resolvedPct: number | null;
  componentCount: number;
  confidenceAvg: number | null;
  ingestMs: number | null;
  tokensIn: number | null;
  tokensOut: number | null;
  createdAt: string;
  /** reviewed required items / required items, 0..1 (null when nothing to review) */
  reviewProgress: number | null;
  openConnectors: OpenConnectorDTO[];
}

export interface OpenConnectorDTO {
  id: number;
  label: string;
  direction: "from" | "to";
  targetDrawingNumber: string | null;
  targetTag: string | null;
  atTag: string | null;
  resolved: boolean;
}

export interface AppearanceDTO {
  id: number;
  drawingId: number;
  drawingNumber: string | null;
  revision: string | null;
  bbox: BBox | null;
  confidence: number | null;
}

export interface DiscrepancyDTO {
  id: number;
  key: string;
  values: { value: string; drawingIds: number[]; drawingNumbers: string[] }[];
  status: "open" | "resolved";
  resolution: string | null;
}

export type LinkType = "operating" | "maintenance" | "design_data" | "other";
export const LINK_TYPES: LinkType[] = ["operating", "maintenance", "design_data", "other"];

export interface DocLinkDTO {
  id: number;
  chunkId: number;
  sectionNo: number;
  page: number;
  file: string;
  linkType: LinkType;
  createdBy: "model" | "sme";
  status: "unreviewed" | "correct" | "incorrect";
}

export interface SiteModel {
  site: SiteSummary;
  assets: AssetDTO[];
  edges: EdgeDTO[];
  sources: SourceDTO[];
  hasApiKey: boolean;
  maxUploadMb: number;
  drawings: DrawingDTO[];
  reviewMode: ReviewMode;
}

export type ReviewMode = "full" | "exception";

export interface JobDTO {
  id: string;
  kind: "diagram" | "enrich";
  status: "running" | "done" | "failed";
  step: string;
  error?: string;
  message?: string;
  warnings?: string[];
}

export interface ChatDrawingRef {
  drawingId: number;
  drawingNumber: string;
  revision: string | null;
  assetId: number;
  tag: string;
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
  drawings: ChatDrawingRef[];
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

export const SOURCE_ACCEPT: Record<UploadKind, { exts: string[]; label: string }> = {
  pfd: { exts: [".pdf", ".png", ".jpg", ".jpeg"], label: "PDF, PNG, JPG" },
  om: { exts: [".pdf", ".txt"], label: "PDF, TXT" },
  assetdb: { exts: [".csv"], label: "CSV" },
  telemetry: { exts: [".csv"], label: "CSV" },
};

export function typeLabel(t: AssetType): string {
  if (t === "mcc" || t === "ct" || t === "pt") return t.toUpperCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Review targets and states. */
export type ReviewTargetType = "component" | "attribute" | "connection";
export type ReviewState = "unreviewed" | "accepted" | "corrected" | "rejected" | "ambiguous" | "added_missing";
export const FLAG_THRESHOLD = 0.8;

export interface ReviewItemDTO {
  /** `${targetType}:${targetId}:${attrKey}` */
  key: string;
  targetType: ReviewTargetType;
  targetId: number;
  attrKey: string;
  drawingId: number;
  assetId: number | null;
  /** headline, e.g. "52-1A04 · Core Spray Feeder" */
  label: string;
  /** current values shown and edited in the review panel */
  current: Record<string, string>;
  bbox: BBox | null;
  confidence: number | null;
  flagged: boolean;
  safetyRelated: boolean;
  /** false when the review mode does not require this item */
  required: boolean;
  /** false when the item was rejected and is no longer in the graph */
  live: boolean;
  state: ReviewState;
  comment: string | null;
  reviewer: string | null;
  reviewedAt: string | null;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
}

export interface ReviewListDTO {
  drawing: DrawingDTO;
  mode: ReviewMode;
  items: ReviewItemDTO[];
  required: number;
  reviewed: number;
}
