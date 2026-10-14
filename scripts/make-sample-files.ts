// npm run sample:files — writes fictional sample uploads to ./sample-data so the live
// upload paths (diagram extraction, PDF manual ingestion, CSV import) can be tried by hand.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { renderFirstPagePng } from "../src/lib/render";
import { BOX_H, BOX_W, PAGE_H, PAGE_W, SAMPLE_SHEETS, sheetAsset, sheetImageName, type SampleSheet } from "../src/lib/sample/drawings";
import {
  ASSET_REGISTER_CSV,
  ASSET_REGISTER_FILE,
  HISTORIAN_CSV,
  HISTORIAN_FILE,
  MANUAL_PAGES,
} from "../src/lib/sample/data";

const OUT = path.resolve("sample-data");
fs.mkdirSync(OUT, { recursive: true });

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > width && line) {
        out.push(line);
        line = word;
      } else line = next;
    }
    out.push(line);
  }
  return out;
}

async function manualPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle("SAMPLE Bus 1A O&M Manual (fictional)");
  for (const pageText of MANUAL_PAGES) {
    const page = doc.addPage([612, 792]);
    const [title, banner, ...rest] = pageText.split("\n");
    let y = 740;
    for (const l of wrap(title, bold, 11, 512)) {
      page.drawText(l, { x: 50, y, size: 11, font: bold });
      y -= 15;
    }
    page.drawText(banner, { x: 50, y, size: 9, font, color: rgb(0.7, 0.1, 0.1) });
    y -= 24;
    for (const l of wrap(rest.join("\n"), font, 10.5, 512)) {
      page.drawText(l, { x: 50, y, size: 10.5, font });
      y -= 15;
    }
  }
  fs.writeFileSync(path.join(OUT, "SAMPLE_Bus1A_OM_Manual.pdf"), await doc.save());
}

/** Draws one fictional sheet: equipment boxes, routed connections, off-page flags, notes and a title block. */
async function sheetPdf(sheet: SampleSheet) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`${sheet.titleBlock.drawing_number} rev ${sheet.titleBlock.revision} (fictional)`);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ink = rgb(0.08, 0.08, 0.08);
  const grey = rgb(0.35, 0.35, 0.35);
  // Helpers take top-left coordinates and flip to PDF space.
  const Y = (y: number) => PAGE_H - y;
  const text = (t: string, x: number, y: number, size: number, f: PDFFont = font, color = ink) =>
    page.drawText(t, { x, y: Y(y) - size, size, font: f, color });
  const line = (x1: number, y1: number, x2: number, y2: number, dashed = false) =>
    page.drawLine({
      start: { x: x1, y: Y(y1) },
      end: { x: x2, y: Y(y2) },
      thickness: 1.2,
      color: ink,
      ...(dashed ? { dashArray: [5, 3] } : {}),
    });
  const arrow = (x: number, y: number, dir: "right" | "down") => {
    if (dir === "right") {
      line(x - 6, y - 4, x, y);
      line(x - 6, y + 4, x, y);
    } else {
      line(x - 4, y - 6, x, y);
      line(x + 4, y - 6, x, y);
    }
  };

  // Border and banner
  page.drawRectangle({ x: 18, y: 18, width: PAGE_W - 36, height: PAGE_H - 36, borderColor: ink, borderWidth: 1.5 });
  text("FICTIONAL - FOR SOFTWARE DEMONSTRATION ONLY - NOT FOR PLANT USE", 36, 30, 11, bold, rgb(0.7, 0.1, 0.1));
  text(sheet.titleBlock.title.toUpperCase(), 36, 48, 13, bold);

  const pos = new Map(sheet.nodes.map((n) => [n.tag, n]));
  const dashed = sheet.edgeKind === "control";
  for (const e of sheet.edges) {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    if (b.x >= a.x + BOX_W) {
      const sx = a.x + BOX_W;
      const sy = a.y + BOX_H / 2;
      const ex = b.x;
      const ey = b.y + BOX_H / 2;
      const mx = sx + (ex - sx) / 2;
      line(sx, sy, mx, sy, dashed);
      line(mx, sy, mx, ey, dashed);
      line(mx, ey, ex, ey, dashed);
      arrow(ex, ey, "right");
      if (e.label) text(e.label, mx + 4, ey - 12, 7.5);
    } else {
      // Vertical drop: from the bottom of the source to the top of the target.
      const sx = a.x + BOX_W / 2;
      const sy = a.y + BOX_H;
      const ex = b.x + BOX_W / 2;
      const ey = b.y;
      const my = sy + (ey - sy) / 2;
      line(sx, sy, sx, my, dashed);
      line(sx, my, ex, my, dashed);
      line(ex, my, ex, ey, dashed);
      arrow(ex, ey, "down");
      if (e.label) text(e.label, ex + 4, my + 4, 7.5);
    }
  }

  for (const n of sheet.nodes) {
    const a = sheetAsset(n.tag);
    page.drawRectangle({ x: n.x, y: Y(n.y + BOX_H), width: BOX_W, height: BOX_H, borderColor: ink, borderWidth: 1.2 });
    text(n.tag, n.x + 6, n.y + 5, 10, bold);
    wrap(n.name ?? a.name, font, 8, BOX_W - 12)
      .slice(0, 2)
      .forEach((l, i) => text(l, n.x + 6, n.y + 19 + i * 10, 8));
    const firstParam = Object.values(n.params ?? {})[0];
    if (firstParam) text(wrap(firstParam, font, 7.5, BOX_W - 12)[0], n.x + 6, n.y + BOX_H - 12, 7.5, font, grey);
  }

  for (const c of sheet.connectors) {
    // Pentagon-style off-page flag, pointing toward the sheet for FROM, away for TO.
    const w = 150;
    const h = 22;
    page.drawRectangle({ x: c.x, y: Y(c.y + h), width: w, height: h, borderColor: ink, borderWidth: 1.2 });
    text(c.label, c.x + 6, c.y + 7, 8, bold);
    const at = pos.get(c.atTag)!;
    if (c.direction === "from") {
      line(c.x + w, c.y + h / 2, at.x, c.y + h / 2);
      arrow(at.x, c.y + h / 2, "right");
    } else {
      line(at.x + BOX_W, c.y + h / 2, c.x, c.y + h / 2);
      arrow(c.x, c.y + h / 2, "right");
    }
  }

  if (sheet.illegible) {
    const b = sheet.illegible;
    page.drawRectangle({ x: b.x, y: Y(b.y + b.h), width: b.w, height: b.h, borderColor: ink, borderWidth: 1 });
    text(b.label, b.x + 6, b.y + 6, 9, bold);
    // Smudged, overprinted marks that cannot be read.
    for (let i = 0; i < 46; i++) {
      const x = b.x + 10 + ((i * 37) % (b.w - 40));
      const y = b.y + 24 + ((i * 23) % (b.h - 34));
      page.drawRectangle({ x, y: Y(y + 6), width: 18 + (i % 5) * 7, height: 5, color: rgb(0.45, 0.45, 0.45), opacity: 0.55 });
    }
    for (let x = b.x; x < b.x + b.w; x += 14) line(x, b.y + b.h, Math.min(x + 40, b.x + b.w), b.y + 20);
  }

  let ny = 600;
  for (const note of sheet.notes) {
    for (const l of wrap(note, font, 8, 700)) {
      text(l, 36, ny, 8);
      ny += 11;
    }
    ny += 4;
  }

  // Title block, bottom right
  const tb = sheet.titleBlock;
  const tx = PAGE_W - 18 - 380;
  const ty = PAGE_H - 18 - 120;
  page.drawRectangle({ x: tx, y: Y(ty + 120), width: 380, height: 120, borderColor: ink, borderWidth: 1.5 });
  const rows: [string, string][] = [
    ["TITLE", tb.title],
    ["SYSTEM", tb.system],
    ["SITE / UNIT", `${tb.site} / ${tb.unit}`],
    ["DRAWN BY", tb.author],
    ["DATE", tb.date],
  ];
  rows.forEach(([k, v], i) => {
    text(k, tx + 6, ty + 6 + i * 15, 6.5, bold, grey);
    text(v, tx + 70, ty + 5 + i * 15, 8);
  });
  line(tx, ty + 82, tx + 380, ty + 82);
  text("DWG NO.", tx + 6, ty + 88, 6.5, bold, grey);
  text(tb.drawing_number, tx + 6, ty + 98, 13, bold);
  line(tx + 300, ty + 82, tx + 300, ty + 120);
  text("REV", tx + 306, ty + 88, 6.5, bold, grey);
  text(tb.revision, tx + 330, ty + 96, 15, bold);

  const bytes = await doc.save();
  fs.writeFileSync(path.join(OUT, sheet.fileName), bytes);
  fs.writeFileSync(path.join(OUT, sheetImageName(sheet)), await renderFirstPagePng(bytes));
}

async function main() {
  await manualPdf();
  for (const sheet of SAMPLE_SHEETS) await sheetPdf(sheet);
  fs.rmSync(path.join(OUT, "SAMPLE_Bus1A_one_line.pdf"), { force: true });
  fs.writeFileSync(path.join(OUT, ASSET_REGISTER_FILE), ASSET_REGISTER_CSV);
  fs.writeFileSync(path.join(OUT, HISTORIAN_FILE), HISTORIAN_CSV);
  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# Sample data (fictional)\n\nEverything in this folder is invented for a software demo. It does not describe any real plant and must not be used for operations.\n\n- \`SAMPLE-E-001_revA_Bus1A_one_line.pdf\`, \`SAMPLE-E-002_revA_MCC-1A1_detail.pdf\`, \`SAMPLE-E-003_revB_EDG-1A_elementary.pdf\` — three fictional drawings for the diagram upload (needs ANTHROPIC_API_KEY); the matching PNGs are the pre-rendered page images the seed uses\n- \`SAMPLE_Bus1A_OM_Manual.pdf\` — 11-page O&M manual for the O & M Manuals card\n- \`${ASSET_REGISTER_FILE}\` — asset register for the Asset Database card\n- \`${HISTORIAN_FILE}\` — historian export for the Telemetry card\n\nRegenerate with \`npm run sample:files\`.\n`,
  );
  console.log(`Wrote sample files to ${OUT}`);
}

void main();
