// Client-safe baseline types (the computation lives in baseline.ts, server only).
import type { DrawingType, ReviewTargetType } from "./types";

export interface Accuracy {
  accepted: number;
  corrected: number;
  rejected: number;
  addedMissing: number;
  ambiguous: number;
  precision: number | null;
  recall: number | null;
}

export interface GroupBaseline {
  key: string;
  label: string;
  drawings: number;
  accuracy: Record<ReviewTargetType, Accuracy>;
  ingest: { meanMs: number | null; p90Ms: number | null; n: number };
  sme: { reviewedDrawings: number; meanFullMinutes: number | null; meanFlaggedMinutes: number | null };
  flags: {
    flaggedReviewed: number;
    flaggedChanged: number;
    flaggedShare: number | null;
    unflaggedReviewed: number;
    unflaggedChanged: number;
    unflaggedShare: number | null;
  };
  discrepancies: { open: number; resolved: number };
  cost: { meanTokensIn: number | null; meanTokensOut: number | null; meanCost: number | null; n: number };
}

export interface LinkSampleItem {
  id: number;
  assetTag: string;
  assetName: string;
  sectionNo: number;
  page: number;
  file: string;
  linkType: string;
  createdBy: string;
  status: "unreviewed" | "correct" | "incorrect";
  text: string;
}

export interface Baseline {
  target: number;
  formulas: Record<"precision" | "recall" | "ingest" | "smeFull" | "smeFlagged" | "flagEffectiveness" | "discrepancies" | "cost" | "linkTest", string>;
  rates: { inPerMTok: number; outPerMTok: number } | null;
  overall: GroupBaseline;
  byType: GroupBaseline[];
  perDrawing: {
    id: number;
    drawingNumber: string | null;
    revision: string | null;
    type: DrawingType;
    status: string;
    ingestMs: number | null;
    activeMinutes: number;
    flaggedMinutes: number;
    tokensIn: number | null;
    tokensOut: number | null;
    cost: number | null;
  }[];
  linkTest: {
    sampleSize: number;
    marked: number;
    correct: number;
    pct: number | null;
    totalLinks: number;
    items: LinkSampleItem[];
  };
}

