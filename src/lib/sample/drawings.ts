// FICTIONAL SAMPLE DRAWINGS. Three invented sheets for the Bus 1A demo site. Nothing here
// describes a real plant. The same definitions drive the generated PDFs (npm run sample:files)
// and the seeded extraction results, so bounding boxes always line up with the page images.

import { SAMPLE_ASSETS } from "./data";
import type { AssetType, DrawingType } from "../types";

/** 17 x 11 in landscape, PDF points. Positions below use a top-left origin. */
export const PAGE_W = 1224;
export const PAGE_H = 792;
export const BOX_W = 124;
export const BOX_H = 54;

export interface SheetNode {
  tag: string;
  x: number;
  y: number;
  params?: Record<string, string>;
  confidence: number;
  /** printed name, defaults to the sample asset's name */
  name?: string;
}

export interface SheetEdge {
  from: string;
  to: string;
  label: string;
  confidence: number;
}

export interface SheetConnector {
  label: string;
  direction: "from" | "to";
  targetDrawingNumber: string;
  targetTag: string;
  atTag: string;
  /** where the connector flag is drawn */
  x: number;
  y: number;
}

export interface SampleSheet {
  fileName: string;
  drawingType: DrawingType;
  titleBlock: {
    drawing_number: string;
    revision: string;
    date: string;
    unit: string;
    site: string;
    author: string;
    system: string;
    title: string;
  };
  status: "parsed" | "partial";
  partialReason?: string;
  resolvedPct: number;
  ingestMs: number;
  tokensIn: number;
  tokensOut: number;
  nodes: SheetNode[];
  edges: SheetEdge[];
  connectors: SheetConnector[];
  /** free text printed on the sheet (notes, schedules) */
  notes: string[];
  /** a hatched, unreadable block (drives the partial read on E-003) */
  illegible?: { x: number; y: number; w: number; h: number; label: string };
  /** edges on elementaries are control wiring, not power paths */
  edgeKind: "power" | "control";
}

const SITE = "SAMPLE SITE (FICTIONAL)";

export const SAMPLE_SHEETS: SampleSheet[] = [
  {
    fileName: "SAMPLE-E-001_revA_Bus1A_one_line.pdf",
    drawingType: "single_line",
    titleBlock: {
      drawing_number: "SAMPLE-E-001",
      revision: "A",
      date: "2026-03-02",
      unit: "Unit 1",
      site: SITE,
      author: "J. Example",
      system: "4.16 kV Class 1E Distribution",
      title: "4.16 kV Bus 1A One-Line Diagram",
    },
    status: "parsed",
    resolvedPct: 100,
    ingestMs: 38_400,
    tokensIn: 41_200,
    tokensOut: 3_850,
    edgeKind: "power",
    nodes: [
      { tag: "SWYD-230", x: 50, y: 150, params: { voltage: "230 kV" }, confidence: 0.78 },
      { tag: "SAT-1A", x: 210, y: 150, params: { voltage_ratio: "230/4.16 kV", rating: "30 MVA" }, confidence: 0.95 },
      { tag: "52-1A01", x: 370, y: 150, params: { normal_state: "closed", continuous_rating: "1200 A" }, confidence: 0.96 },
      { tag: "EDG-1A", x: 210, y: 330, params: { rating: "2850 kW" }, confidence: 0.93 },
      { tag: "52-1A02", x: 370, y: 330, params: { normal_state: "open", continuous_rating: "1200 A" }, confidence: 0.94 },
      { tag: "BUS-1A", x: 530, y: 240, params: { voltage: "4.16 kV" }, confidence: 0.97 },
      { tag: "52-1A03", x: 690, y: 110, params: { normal_state: "open" }, confidence: 0.9 },
      { tag: "P-1A", x: 850, y: 110, params: { motor_rating: "1250 HP" }, confidence: 0.92 },
      { tag: "52-1A04", x: 690, y: 240, params: { normal_state: "open" }, confidence: 0.72 },
      { tag: "P-1C", x: 850, y: 240, params: { motor_rating: "800 HP" }, confidence: 0.91 },
      { tag: "52-1A05", x: 690, y: 400, params: { normal_state: "closed" }, confidence: 0.89 },
      { tag: "T-1A5", x: 850, y: 400, params: { voltage_ratio: "4160/480 V", rating: "1500 kVA" }, confidence: 0.9 },
      { tag: "MCC-1A1", x: 1010, y: 400, params: { voltage: "480 V" }, confidence: 0.93 },
      { tag: "MOV-E11-F004A", x: 900, y: 540, params: {}, confidence: 0.86 },
      { tag: "FN-1A", x: 1050, y: 540, params: { motor_rating: "15 HP" }, confidence: 0.88 },
    ],
    edges: [
      { from: "SWYD-230", to: "SAT-1A", label: "230 kV", confidence: 0.95 },
      { from: "SAT-1A", to: "52-1A01", label: "4.16 kV", confidence: 0.95 },
      { from: "52-1A01", to: "BUS-1A", label: "", confidence: 0.95 },
      { from: "EDG-1A", to: "52-1A02", label: "4.16 kV", confidence: 0.94 },
      { from: "52-1A02", to: "BUS-1A", label: "Standby", confidence: 0.93 },
      { from: "BUS-1A", to: "52-1A03", label: "", confidence: 0.95 },
      { from: "52-1A03", to: "P-1A", label: "Feeder", confidence: 0.94 },
      { from: "BUS-1A", to: "52-1A04", label: "", confidence: 0.9 },
      { from: "52-1A04", to: "P-1C", label: "Feeder", confidence: 0.9 },
      { from: "BUS-1A", to: "52-1A05", label: "", confidence: 0.93 },
      { from: "52-1A05", to: "T-1A5", label: "4.16 kV", confidence: 0.74 },
      { from: "T-1A5", to: "MCC-1A1", label: "480 V", confidence: 0.92 },
      { from: "MCC-1A1", to: "MOV-E11-F004A", label: "480 V", confidence: 0.9 },
      { from: "MCC-1A1", to: "FN-1A", label: "480 V", confidence: 0.9 },
    ],
    connectors: [],
    notes: [
      "NOTES: 1. 52-1A01 and 52-1A05 normally closed. 52-1A02, 52-1A03 and 52-1A04 normally open (EDG and pumps in standby). See SAMPLE-E-003.",
      "2. MCC-1A1 bucket detail on SAMPLE-E-002.",
    ],
  },
  {
    fileName: "SAMPLE-E-002_revA_MCC-1A1_detail.pdf",
    drawingType: "switchgear_notes",
    titleBlock: {
      drawing_number: "SAMPLE-E-002",
      revision: "A",
      date: "2026-03-09",
      unit: "Unit 1",
      site: SITE,
      author: "R. Sample",
      system: "480 V Class 1E Distribution",
      title: "MCC-1A1 480 V Bucket Detail",
    },
    status: "parsed",
    resolvedPct: 100,
    ingestMs: 27_900,
    tokensIn: 30_500,
    tokensOut: 2_100,
    edgeKind: "power",
    nodes: [
      { tag: "MCC-1A1", x: 330, y: 260, params: { voltage: "480 V", bus_rating: "800 A", buckets: "24" }, confidence: 0.94 },
      { tag: "MOV-E11-F004A", x: 620, y: 150, params: { actuator: "SMB-00", motor_rating: "2 HP", bucket: "1A1-03" }, confidence: 0.76 },
      { tag: "FN-1A", x: 620, y: 370, params: { motor_rating: "20 HP", bucket: "1A1-07" }, confidence: 0.68 },
    ],
    edges: [
      { from: "MCC-1A1", to: "MOV-E11-F004A", label: "Bucket 1A1-03", confidence: 0.88 },
      { from: "MCC-1A1", to: "FN-1A", label: "Bucket 1A1-07", confidence: 0.8 },
    ],
    connectors: [
      {
        label: "FROM SAMPLE-E-001 / T-1A5",
        direction: "from",
        targetDrawingNumber: "SAMPLE-E-001",
        targetTag: "T-1A5",
        atTag: "MCC-1A1",
        x: 70,
        y: 268,
      },
    ],
    notes: [
      "BUCKET SCHEDULE: 1A1-03 MOV-E11-F004A RHR SUCTION VALVE, SIZE 1 STARTER. 1A1-07 FN-1A ROOM COOLER FAN, 20 HP, SIZE 2 STARTER.",
      "NOTE: Incoming supply from load center transformer T-1A5 on SAMPLE-E-001.",
    ],
  },
  {
    fileName: "SAMPLE-E-003_revB_EDG-1A_elementary.pdf",
    drawingType: "elementary",
    titleBlock: {
      drawing_number: "SAMPLE-E-003",
      revision: "B",
      date: "2026-04-14",
      unit: "Unit 1",
      site: SITE,
      author: "J. Example",
      system: "Emergency Diesel Generator 1A",
      title: "EDG-1A Start and Output Breaker Elementary",
    },
    status: "partial",
    partialReason: "legend block illegible",
    resolvedPct: 70,
    ingestMs: 33_100,
    tokensIn: 35_800,
    tokensOut: 1_700,
    edgeKind: "control",
    nodes: [
      { tag: "EDG-1A", x: 140, y: 200, params: { rated_speed: "900 rpm", start_time: "10 s or less" }, confidence: 0.9 },
      { tag: "52-1A02", x: 460, y: 200, params: { close_permissive: "EDG-1A at rated voltage and frequency" }, confidence: 0.85 },
    ],
    edges: [{ from: "EDG-1A", to: "52-1A02", label: "Close permissive", confidence: 0.82 }],
    connectors: [
      {
        label: "TO SAMPLE-E-004 / LS-1A",
        direction: "to",
        targetDrawingNumber: "SAMPLE-E-004",
        targetTag: "LS-1A",
        atTag: "52-1A02",
        x: 720,
        y: 208,
      },
    ],
    notes: [
      "START CIRCUIT: Undervoltage on BUS-1A energizes start relay; EDG-1A to rated speed and voltage in 10 s or less.",
      "52-1A02 CLOSE: permissive when EDG-1A at rated voltage and frequency; load sequencer LS-1A on SAMPLE-E-004 (not in this set).",
    ],
    illegible: { x: 140, y: 380, w: 520, h: 150, label: "LEGEND" },
  },
];

/** Box bbox in normalized 0..1 page coordinates (top-left origin). */
export function sheetBBox(n: { x: number; y: number }): [number, number, number, number] {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return [r(n.x / PAGE_W), r(n.y / PAGE_H), r((n.x + BOX_W) / PAGE_W), r((n.y + BOX_H) / PAGE_H)];
}

/** The node's display data, falling back to the shared sample asset definitions. */
export function sheetAsset(tag: string): { name: string; type: AssetType; description: string } {
  const a = SAMPLE_ASSETS.find((x) => x.tag === tag);
  if (!a) throw new Error(`Unknown sample tag ${tag}`);
  return { name: a.name, type: a.type, description: a.description };
}

export function sheetImageName(sheet: SampleSheet): string {
  return sheet.fileName.replace(/\.pdf$/, ".png");
}
