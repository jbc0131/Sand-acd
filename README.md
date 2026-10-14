# Capital Delivery Accelerator (CDA)

**Prototype.** CDA turns engineering diagrams (process flow diagrams, P&IDs, electrical one-lines) into a connected asset model for an industrial site. It then enriches each asset from O&M manuals, an asset register and telemetry. A chat copilot answers operations questions with citations and highlights assets on the schematic.

This is a rebuild of an internal SAND product demo, retargeted at Southern Nuclear. **All sample data in this repository is fictional** and labeled that way. It describes no real plant and must not be used for operations.

## Setup

Requirements: Node.js 20.9+ (22 recommended). SQLite ships inside `better-sqlite3`, so nothing else needs installing.

```bash
npm install
cp .env.example .env.local     # add ANTHROPIC_API_KEY to enable the live model features
npm run seed                   # optional: creates the fictional sample site
npm run dev                    # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Next.js dev server |
| `npm run build` / `npm start` | Production build and server |
| `npm run seed` | (Re)creates "Sample Site: Bus 1A (fictional)" in `./data/cda.db`. No API key needed. |
| `npm run sample:files` | Regenerates the fictional upload files in `./sample-data` |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint |
| `npm run test:e2e` | Playwright smoke test (builds, then runs `next start` on port 3200 with a separate `./data/e2e` database) |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (empty) | Server-only. Enables diagram extraction, manual enrichment, manual summaries and the Copilot. Never sent to the browser. |
| `CDA_MODEL_MAIN` | `claude-sonnet-5-5` | Diagram extraction, manual enrichment, Copilot |
| `CDA_MODEL_FAST` | `claude-haiku-5-5` | Short cleanup and summaries (O&M manual summary in View Details) |
| `MAX_UPLOAD_MB` | `50` | Upload size limit, checked in the browser and on the server |
| `CDA_DATA_DIR` | `./data` | Where `cda.db` and `uploads/` live. The e2e test points this at `./data/e2e`. |

Without a key the app still runs. The sample site works end to end from seeded data, and every live feature (diagram upload, manual enrichment for non-sample manuals, Copilot) shows a clear "ANTHROPIC_API_KEY is not set" message instead of failing.

## The sample demo

Click **Add sample site** on the home page (or run `npm run seed`). It creates **Sample Site: Bus 1A (fictional)**, location "Demo data":

- **Diagram (applied):** a fictional 4.16 kV safety bus one-line with 15 assets (switchyard, station aux transformer, EDG, breakers, RHR and core spray pump motors, load center transformer, MCC, MOV and room cooler fan) and 14 connections. It's pre-extracted, so no model call is needed.
- **O&M manual (ingested, not applied):** an 11-page "SAMPLE Bus 1A Operating and Maintenance Manual (fictional training document, not for plant use)". It's already chunked and indexed in FTS5, so the Copilot can cite it. The manual's parameter extraction is pre-computed, so Run Enrichment works without a key.
- **Asset register CSV and historian CSV (ingested, not applied):** "Example ... Co" manufacturers, install years, criticality and Maximo locations for 10 tags, plus the latest readings for P-1A motor current and bearing temperature, EDG-1A day tank level, BUS-1A bus voltage and SAT-1A top oil temperature.

Demo flow: open the sample site → **Enrich** → **Run Enrichment**. The status dots pulse orange, then settle one by one into Partial or Enriched, and the new chips get a green outline. Then ask the Copilot **"What is the start procedure for P-1A?"** (needs the key). It searches the manual, answers with numbered steps, highlights P-1A and 52-1A03 on the canvas, and cites section 9.

`./sample-data` holds the same fictional content as real files (a PDF one-line, a PDF manual and both CSVs), so you can try the live upload paths on a new site.

## How it works

```
Browser (React, App Router client components)
  ├─ Home: site cards ───────────────► GET/POST /api/sites, POST /api/sites/sample
  ├─ Site: Overview / Enrich canvas (React Flow + dagre)
  │    ├─ Upload modal ─────────────► POST /api/sites/:id/sources  (multipart)
  │    │     diagram → job id ──────► GET /api/jobs/:jobId  (polling: "Reading diagram", "Building site model")
  │    ├─ Run Enrichment ───────────► POST /api/sites/:id/enrich → job id → polling
  │    ├─ Unlink ───────────────────► DELETE /api/sites/:id/sources/:sourceId
  │    └─ ACD Copilot ──────────────► POST /api/sites/:id/copilot  (SSE stream), chat history + feedback
  └─ Documentation ─────────────────► GET /api/sites/:id/export?format=csv|json

Server (Node runtime)
  src/lib/ai.ts       the only module that talks to Claude: streaming, zod validation, one retry on bad JSON, user-safe errors
  src/lib/extract.ts  diagram → nodes/edges (PDF document block, first page if large; PNG/JPG image block),
                      drops dangling edges, runs one verification pass on nodes below 0.8 confidence, saves + lays out
  src/lib/ingest.ts   uploads, pdfjs-dist text per page, ~1,200-char sentence chunks per page, FTS5 indexing,
                      bm25 search, CSV staging (papaparse)
  src/lib/enrich.ts   applies staged CSV rows by normalized tag and manual parameters via Claude (excerpts ≤ 60k chars)
  src/lib/model.ts    site model reads, provenance-based recompute of params/description/status, unlink, dagre layout
  src/lib/copilot.ts  tool-use loop: query_knowledge_base, get_asset, list_assets, highlight_asset
  src/lib/jobs.ts     in-process job runner so long model calls stay off the request path
  SQLite (better-sqlite3 + Drizzle schema) at ./data/cda.db, uploads in ./data/uploads/{siteId}/
```

### Data model

`sites`, `sources`, `assets`, `asset_param_sources`, `edges`, `kb_chunks` plus the `kb_fts` FTS5 table, `staged_rows` and `chat_messages`, as specified. The Drizzle schema is in `src/lib/db/schema.ts`. Tables are created idempotently on first use, so there's no migration step. `drizzle.config.ts` is there if you want drizzle-kit.

Every parameter value is a row in `asset_param_sources` (asset, key, value, source). `assets.params_json`, `description` and `enrichment_status` are always recomputed from those rows. That is what makes **Unlink** exact: deleting a source cascades to its provenance rows, staged rows and KB chunks (an SQLite trigger keeps `kb_fts` in sync), and the assets are recomputed.

### Enrichment status

- **pending**: no enrichment source (asset database, manual, telemetry) has contributed
- **enriched**: 2 or more distinct enrichment source kinds contributed, or 6 or more non-tag parameters
- **partial**: everything else

## Decisions made where the brief was open

- **shadcn/ui:** the shadcn registry wasn't reachable from the build environment, so `src/components/ui/*` are hand-written in the shadcn style on `radix-ui` + `class-variance-authority`. `components.json` is present, so `npx shadcn add …` works later.
- **Status counting:** the "6 or more non-tag parameters" rule counts all of an asset's parameters (diagram values included), but only once at least one enrichment source has contributed. Diagram-only assets always stay pending.
- **Description provenance:** descriptions are stored as a hidden `_description` provenance row per source, so a manual's better description disappears again if the manual is unlinked.
- **"New chips" outline:** each Run Enrichment gets a run id (`sites.last_run_id`, `asset_param_sources.run_id`). Chips written by the latest run get the green outline.
- **Source card chips:** "Data Ingested" means at least one file of that kind exists. "Connected" means at least one has been applied.
- **Unlink on a card** removes every file of that kind. Unlinking the diagram asks for confirmation, wipes assets and edges, sets the site back to In Planning, and returns applied enrichment sources to "ingested" so they can be re-applied to a new model.
- **More than one diagram:** extra diagrams merge into the model (matching on normalized tag, then on name) and the layout is re-run.
- **Failed diagram uploads** leave nothing behind, and the modal keeps the file selected so **Retry** resends it.
- **Manuals without a key:** Run Enrichment still applies the CSVs and leaves the manual "ingested" with a warning toast. The sample manual uses its pre-computed extraction (`sources.precomputed_json`).
- **Enrich canvas layout:** the Enrich tab re-runs dagre in the browser with taller cards so parameter chips never overlap. Overview uses the stored layout.
- **Copilot sources:** the server keeps every chunk retrieved during the turn, then shows the ones whose section numbers appear on the answer's "Sources:" line (or all retrieved chunks if none are cited).
- **Refusal fallback:** when the main model is Sonnet 5.5, Opus 5.x or Fable 5.x, requests opt into the API's server-side refusal fallback (`fallbacks: "default"`). Other models get a plain request with a clear message on refusal.
- **Design tab:** neither reference demo shows it, so it's an honest placeholder describing future design optioneering. No functionality is implied.
- **Fonts:** the system sans stack with Inter first, so the build needs no network access for fonts.

## Deploying

**SQLite and local files won't persist on serverless hosts** such as Vercel or Netlify functions. The filesystem there is ephemeral and per-instance, and the in-process job runner needs a long-lived Node process. Before deploying anywhere but a single long-running server or container:

- swap SQLite for Postgres (Drizzle supports it; FTS5/bm25 maps to Postgres `tsvector` + `ts_rank`, or a vector store)
- move `./data/uploads` to object storage (S3, GCS, Azure Blob)
- move the in-process jobs to a queue or background worker

## Testing

```bash
npm run typecheck && npm run lint && npm run build
npm run test:e2e
```

The smoke test covers: add sample site → Enrich → Run Enrichment → statuses update → Documentation CSV and JSON export (JSON checked for edges and provenance), plus the phone layout (Enrich slide-over, collapsed Copilot). The Copilot test is skipped unless `ANTHROPIC_API_KEY` is set.

If Playwright's bundled Chromium isn't installed, point it at an existing build: `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome npm run test:e2e`.

## Troubleshooting

- **The dev page keeps reloading** after you switch between dev servers with different env vars: stop the server, delete `.next`, and start again.
- **"This PDF looks scanned. Run OCR first."** means the manual has almost no extractable text. Run it through OCR (for example `ocrmypdf`) and upload the result.
