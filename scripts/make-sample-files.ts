// npm run sample:files — writes fictional sample uploads to ./sample-data so the live
// upload paths (diagram extraction, PDF manual ingestion, CSV import) can be tried by hand.
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import {
  ASSET_REGISTER_CSV,
  ASSET_REGISTER_FILE,
  HISTORIAN_CSV,
  HISTORIAN_FILE,
  MANUAL_PAGES,
  SAMPLE_ASSETS,
  SAMPLE_EDGES,
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

/** A simple left-to-right one-line drawing of the fictional bus. */
async function oneLinePdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([1224, 792]); // 17x11 landscape
  const pos: Record<string, [number, number]> = {
    "SWYD-230": [60, 560],
    "SAT-1A": [230, 560],
    "52-1A01": [400, 560],
    "EDG-1A": [230, 380],
    "52-1A02": [400, 380],
    "BUS-1A": [570, 470],
    "52-1A03": [740, 620],
    "P-1A": [910, 620],
    "52-1A04": [740, 470],
    "P-1C": [910, 470],
    "52-1A05": [740, 300],
    "T-1A5": [910, 300],
    "MCC-1A1": [1050, 300],
    "MOV-E11-F004A": [1050, 160],
    "FN-1A": [1050, 60],
  };
  const W = 130;
  const H = 54;
  const drawBox = (p: PDFPage, tag: string) => {
    const a = SAMPLE_ASSETS.find((x) => x.tag === tag)!;
    const [x, y] = pos[tag];
    p.drawRectangle({ x, y, width: W, height: H, borderColor: rgb(0.1, 0.1, 0.1), borderWidth: 1.2 });
    p.drawText(tag, { x: x + 6, y: y + H - 15, size: 10, font: bold });
    wrap(a.name, font, 8, W - 12).forEach((l, i) => p.drawText(l, { x: x + 6, y: y + H - 28 - i * 10, size: 8, font }));
    const extra = a.params ? Object.values(a.params)[0] : "";
    if (extra) p.drawText(extra, { x: x + 6, y: y + 5, size: 7.5, font, color: rgb(0.3, 0.3, 0.3) });
  };
  for (const tag of Object.keys(pos)) drawBox(page, tag);
  for (const [f, t, label] of SAMPLE_EDGES) {
    const [fx, fy] = pos[f];
    const [tx, ty] = pos[t];
    const sx = fx + W;
    const sy = fy + H / 2;
    const ex = tx;
    const ey = ty + H / 2;
    const vertical = Math.abs(sx - ex) < 20;
    if (vertical || ex < sx) {
      // Feed drops down from MCC: draw from bottom of source to top of target.
      const bx = fx + W / 2;
      page.drawLine({ start: { x: bx, y: fy }, end: { x: bx, y: ty + H }, thickness: 1.2 });
      if (label) page.drawText(label, { x: bx + 4, y: (fy + ty + H) / 2, size: 7.5, font });
      continue;
    }
    const mx = (sx + ex) / 2;
    page.drawLine({ start: { x: sx, y: sy }, end: { x: mx, y: sy }, thickness: 1.2 });
    page.drawLine({ start: { x: mx, y: sy }, end: { x: mx, y: ey }, thickness: 1.2 });
    page.drawLine({ start: { x: mx, y: ey }, end: { x: ex, y: ey }, thickness: 1.2 });
    page.drawLine({ start: { x: ex - 6, y: ey + 4 }, end: { x: ex, y: ey }, thickness: 1.2 });
    page.drawLine({ start: { x: ex - 6, y: ey - 4 }, end: { x: ex, y: ey }, thickness: 1.2 });
    if (label) page.drawText(label, { x: mx + 3, y: (sy + ey) / 2 + 3, size: 7.5, font });
  }
  page.drawText("SAMPLE BUS 1A ELECTRICAL ONE-LINE  -  FICTIONAL, FOR SOFTWARE DEMONSTRATION ONLY, NOT FOR PLANT USE", {
    x: 60,
    y: 750,
    size: 12,
    font: bold,
  });
  page.drawText("Drawing SAMPLE-E-001 Rev 0. Breakers 52-1A01 normally closed, 52-1A02 normally open.", { x: 60, y: 732, size: 9, font });
  fs.writeFileSync(path.join(OUT, "SAMPLE_Bus1A_one_line.pdf"), await doc.save());
}

async function main() {
  await manualPdf();
  await oneLinePdf();
  fs.writeFileSync(path.join(OUT, ASSET_REGISTER_FILE), ASSET_REGISTER_CSV);
  fs.writeFileSync(path.join(OUT, HISTORIAN_FILE), HISTORIAN_CSV);
  fs.writeFileSync(
    path.join(OUT, "README.md"),
    `# Sample data (fictional)\n\nEverything in this folder is invented for a software demo. It does not describe any real plant and must not be used for operations.\n\n- \`SAMPLE_Bus1A_one_line.pdf\` — one-line drawing for the diagram upload (needs ANTHROPIC_API_KEY)\n- \`SAMPLE_Bus1A_OM_Manual.pdf\` — 11-page O&M manual for the O & M Manuals card\n- \`${ASSET_REGISTER_FILE}\` — asset register for the Asset Database card\n- \`${HISTORIAN_FILE}\` — historian export for the Telemetry card\n\nRegenerate with \`npm run sample:files\`.\n`,
  );
  console.log(`Wrote sample files to ${OUT}`);
}

void main();
