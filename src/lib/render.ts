import path from "node:path";

// Renders page 1 of a PDF to PNG with pdfjs-dist and @napi-rs/canvas (no browser needed).
// Used at drawing ingest for the drawing viewer, and by `npm run sample:files`.

const FONT_DIR = path.join(/*turbopackIgnore: true*/ process.cwd(), "node_modules/pdfjs-dist/standard_fonts/");

export async function renderFirstPagePng(data: Uint8Array, targetWidth = 2000): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");
  const task = pdfjs.getDocument({ data, standardFontDataUrl: FONT_DIR, isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]);
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, Math.max(0.5, targetWidth / base.width));
    const vp = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport: vp,
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}
