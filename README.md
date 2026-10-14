# SiteAId · Drawing Intelligence

**Prototype.** SiteAId turns engineering drawings (process flow diagrams, P&IDs, electrical one-lines, elementaries) into a reviewed, connected knowledge graph for an industrial site. Several drawings merge into one asset model, linked back to the sheets they came from and to the sections of O&M documents that describe them. SMEs review every extraction, with timed review minutes. A value baseline measures accuracy, effort and cost from that review data. A Copilot answers operations questions with citations that click back to the source drawing, and traces through the electrical system.

The app shows what Sand's SiteAId Phase 1 Proof of Value promises Southern Nuclear. The repository keeps its original name (`Sand-acd`); earlier commits call the product Capital Delivery Accelerator.

**All sample data is fictional** and labeled that way. It describes no real plant and must not be used for operations.

## Phase 1 deliverables and where they live

| Phase 1 promise | In the app |
| --- | --- |
| 50-drawing knowledge graph for one electrical division | Multi-drawing ingest that adds to the model: assets keyed by tag across drawings, off-page connectors resolved into connections. **Overview** canvas, **Documentation** register and JSON export. |
| Drawing register | **Drawings** tab: number, revision, title, system, type, date, components, average confidence, status (partial reads keep their reason and % resolved), review progress, ingest time. Filters by type, status and system. |
| SME review with timed review minutes | **Review** tab: page image beside every extracted component, attribute and connection. Accept, Edit, Reject, Mark ambiguous, Add missing. Active review time is tracked per drawing, with flagged-item time tracked separately. Full or exception-based mode; safety-related items are always fully reviewed. |
| Measured value baseline | **Baseline** tab: precision and recall per item type against the 90% target, ingest time (mean and p90), SME minutes, confidence-flag effectiveness, discrepancies, cost per drawing and the document-link test. Per drawing type and overall, with CSV and JSON export. |
| Components linked to document sections | Enrichment links each asset to the manual sections that describe it (operating, maintenance, design data, other). SMEs add, remove and sample-check links. |
| Answers that click back to the source drawing | Drawing viewer with the asset's bounding box highlighted. "Appears on" chips in the asset drawer. Copilot answers carry drawing source chips ("DWG SAMPLE-E-002") beside the numbered section sources. |
| Tracing through the electrical system | Trace upstream and downstream, "What if opened" isolation with a lineup bar, and the matching Copilot tools. All labeled **Decision support only**. |

The **Accelerating Capital Delivery** tab is an honest placeholder: a later enabled use case built on the site model. **Telemetry** is hidden behind "Show later-phase sources" on the Enrich panel (labeled Phase 3+), because Phase 1 uses no operating data.

## Setup

Requirements: Node.js 20.9+ (22 recommended). SQLite ships inside `better-sqlite3`, and PDF page rendering uses the prebuilt `@napi-rs/canvas`, so nothing else needs installing.

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
| `npm run sample:files` | Regenerates the fictional sheets (PDF plus pre-rendered PNG), the manual PDF and the CSVs in `./sample-data` |
| `npm run typecheck` / `npm run lint` | TypeScript (after `next typegen`) and ESLint |
| `npm run test:e2e` | Playwright tests (builds, then runs `next start` on port 3200 with its own `./data/e2e` database) |

### Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (empty) | Server-only. Enables drawing extraction, manual enrichment (parameters and section links), manual summaries and the Copilot. Never sent to the browser. |
| `CDA_MODEL_MAIN` | `claude-sonnet-5-5` | Drawing extraction, manual enrichment, Copilot |
| `CDA_MODEL_FAST` | `claude-haiku-5-5` | Short summaries |
| `MAX_UPLOAD_MB` | `50` | Upload size limit, per file, checked in the browser and on the server |
| `CDA_PRICE_IN_PER_MTOK`, `CDA_PRICE_OUT_PER_MTOK` | none | USD per million input and output tokens, used for cost per drawing. No defaults: when unset, the Baseline shows token counts only and says rates aren't configured. |
| `CDA_DATA_DIR` | `./data` | Where `cda.db` and `uploads/` live |

Without a key the app still runs, and the whole sample site works end to end. Each live feature shows a clear "ANTHROPIC_API_KEY is not set" message instead of failing.

## The sample demo

**Add sample site** on the home page (or `npm run seed`) creates **Sample Site: Bus 1A (fictional)**, location "Demo data". It uses three fictional sheets, generated as PDFs by `npm run sample:files` and seeded through the same merge code that live uploads use:

| Sheet | What it shows |
| --- | --- |
| **SAMPLE-E-001 rev A**, single line | The Bus 1A one-line: switchyard, station aux transformer, EDG, five breakers, pumps, load center transformer, MCC-1A1, MOV and room cooler fan. FN-1A is **15 HP**. Low-confidence reads: SWYD-230 (0.78), 52-1A04 (0.72) and the 52-1A05 → T-1A5 connection (0.74). |
| **SAMPLE-E-002 rev A**, switchgear notes | MCC-1A1 480 V bucket detail with off-page connector **FROM SAMPLE-E-001 / T-1A5** (it resolves). FN-1A is drawn as **20 HP**: the seeded discrepancy. Low confidence: FN-1A (0.68), MOV-E11-F004A (0.76). |
| **SAMPLE-E-003 rev B**, elementary | EDG-1A start and output-breaker elementary, seeded as **partial** ("legend block illegible", 70% resolved). Its connector **TO SAMPLE-E-004 / LS-1A** stays open, because E-004 isn't in the set. |

The seed also adds title blocks, bounding boxes, token counts and ingest times; marks BUS-1A and its five breakers safety-related; and adds 56 component-to-section links from the 11-page sample manual. Two of those links are deliberately wrong (SWYD-230 → EDG surveillance, T-1A5 → MOV stroke test) so the link test has something to catch. The manual, asset register and historian export are ingested but not yet applied. **No review records are seeded.**

A walkthrough:

1. **Drawings**: the register shows E-003 as Partial with its reason. Click a row to open the viewer.
2. **Overview** → FN-1A (or Documentation → FN-1A): the drawer shows the 15 vs 20 HP discrepancy and "Appears on" SAMPLE-E-001 and SAMPLE-E-002. A chip opens the viewer centred on FN-1A.
3. **Review** → SAMPLE-E-001: flagged items sort first. Accept, Edit or Reject a few. The timer in the header counts active review time.
4. **Baseline**: accuracy, SME minutes and flag effectiveness update from those decisions. Draw a link sample and mark it.
5. BUS-1A → **Trace downstream**, or 52-1A01 → **What if opened**: the lineup bar lists what loses supply, then **Reset to normal lineup**.
6. **Enrich** → **Run Enrichment**, then ask the Copilot "What is the start procedure for P-1A?" (needs the key).

## Features in detail

### Multiple drawings and the merge rules

- The diagram upload modal takes several files. They go through a queue two at a time, with progress per file. Every drawing adds to the site model; nothing is replaced, except that a new revision of the same drawing number replaces that drawing's content.
- At ingest, page 1 is rendered to PNG for the viewer. PDFs are rendered with pdfjs-dist and @napi-rs/canvas; PNG and JPG uploads are used as-is.
- The extraction prompt adds a title block, the drawing type, per-node bounding boxes (normalized 0..1, top-left origin) with confidence, edge confidence, off-page connectors, and `status: "partial"` with a reason and % resolved when part of a sheet can't be read. It never guesses. Nodes under 0.8 confidence get one verification pass with the image attached.
- **Assets are keyed by normalized tag** (uppercase, alphanumerics only) within a site, so the same tag on two drawings is one asset. Untagged assets are never merged across drawings.
- Each read is an **appearance** (asset, drawing, bbox, confidence, the extracted JSON). Parameters keep per-drawing provenance.
- **Off-page connectors** become connections when a drawing with the target drawing number exists and the target tag appears on it. Unresolved ones stay listed as open connectors in the viewer. Resolution re-runs after every drawing, so the order of uploads doesn't matter.
- **Discrepancies:** when two drawings give different values for the same parameter of one asset (compared case- and space-insensitively), a discrepancy records each value and the drawings that gave it. It shows in the asset drawer, where an SME can resolve it by adopting a value (written as an SME correction) or with a note only.
- **Revision replacement:** a drawing whose drawing number matches an existing parsed or partial drawing replaces it. The old drawing's appearances, connections, connectors, parameter provenance and page image are removed; assets that no longer appear on any drawing are deleted. Other drawings are untouched.
- Failed reads stay in the register as Failed, with the reason. A later successful read of the same file supersedes them.

### SME review

- Each drawing lists every **component** (appearance), **attribute** (each parameter as read from that drawing) and **connection** (edges read from that drawing, including resolved connectors). Items below 0.8 confidence are flagged and sort first.
- **Accept**; **Edit** with field-level before and after stored (component name, type and description; attribute value; connection label); **Reject**; **Mark ambiguous** (needs a comment). **Add missing** adds a component or connection and counts it as a miss.
- **Write-back:** corrections go into the model through a per-site "SME review" source that always wins over drawing and document values. Rejections remove the item from the graph: rejecting a component removes its appearance, that drawing's parameters for it and that drawing's connections to it, and deletes the asset if it appears nowhere else. The review record (with a before snapshot) stays and is listed greyed out.
- **Reviewer** is a free-text name saved in localStorage; there's no auth.
- **Timing:** active time counts once per second only while the tab is visible and there has been input in the last 2 minutes. Time with a flagged item selected also counts toward flagged minutes. Totals go to `review_sessions` every 15 s, after each action, and when the reviewer leaves. The server never lets them decrease or exceed wall-clock time.
- **Review mode** (per site): Full verification (the default) requires every item. Exception-based requires flagged items only. **Safety-related** assets (a toggle in the asset drawer) are always required, whatever the mode or confidence; a connection counts as safety-related if either end is.

### Document-section links

During Run Enrichment the manual is sent as its indexed sections (`[Section N | page P]`). The model returns, per asset, the section numbers that describe it and a link type (operating, maintenance, design_data, other). These are stored in `asset_doc_links` (created_by `model`, status `unreviewed`). The asset drawer lists the sections, opens each one's text, and lets SMEs add links (created_by `sme`) or remove them.

### Drawing viewer and click-back

The viewer modal shows the page image with wheel, button and pinch zoom and drag panning; every component's bbox, with the selected one highlighted and centred; the title-block summary; the component list; and off-page connectors. It goes full screen on phones. The asset drawer's "Appears on" chips open it at that asset. The Copilot's `get_asset` returns appearances, discrepancies and linked sections, and each answer saves drawing references that render as chips.

### Tracing and isolation (decision support only)

- **Trace** follows power connections downstream (from sources toward loads) or upstream, up to 15 hops, and returns every path. Control wiring from elementaries is excluded.
- **Energization:** sources are assets of type `source` or `generator`. Breakers (and disconnects and fuses) conduct unless their `normal_state` reads open or the what-if opened them; an open breaker is reached on its line side but passes nothing on. Generators feed only through breakers (their output breaker). An asset with no power connections isn't part of the analysis.
- **What if opened** marks every power-path asset without supply from any source in red. The lineup bar shows the opened breakers, a de-energized count (and how many were energized in the normal lineup), a list with counts by type, and **Reset to normal lineup**. The Copilot has the same logic as `trace` and `what_if_open` tools.

### Symbols

Breaker, transformer, motor, generator, bus, relay, CT, PT, fuse, disconnect and valve nodes use inline SVG symbols in a simplified ANSI/IEEE 315 style. They are recognisable stand-ins, not a drafting-standard library. Other types keep the lucide icons. The asset types list gained `relay`, `ct`, `pt`, `fuse` and `disconnect` for this.

## Value baseline: how each metric is calculated

Everything is computed live from the database at request time, for all drawings and per drawing type. Each card shows its formula in a tooltip. Exports: `GET /api/sites/{id}/baseline?format=csv|json`.

| Metric | Calculation |
| --- | --- |
| Precision (components, attributes and connections, each separately) | accepted / (accepted + corrected + rejected), shown against the 90% target |
| Recall | (accepted + corrected) / (accepted + corrected + added_missing), shown against the 90% target |
| Ambiguous | Counted and shown, but excluded from precision and recall until adjudicated |
| Ingestion time per drawing | Mean and p90 (nearest rank) of `ingest_ms` over parsed and partial drawings. Live uploads measure from job start (including page rendering and the verification pass) to save. |
| SME minutes per drawing | Sum of `active_ms` over a drawing's review sessions, in minutes, averaged over drawings that have review time. Flagged-item minutes are the same over `flagged_ms`. |
| Confidence-flag effectiveness | Share of decided items (accepted, corrected or rejected) that were corrected or rejected, for flagged items versus unflagged items. "Flagged" is captured at review time (confidence < 0.8). |
| Discrepancies | Open and resolved counts. Per type, a discrepancy counts for every type of the drawings it involves. |
| Cost per drawing | (tokens_in × `CDA_PRICE_IN_PER_MTOK` + tokens_out × `CDA_PRICE_OUT_PER_MTOK`) / 1,000,000, averaged over drawings. Without rates, only mean tokens are shown. Live tokens include the retry and verification calls. |
| Document-link test | "Draw link sample" picks N random links (default 30), replacing the previous sample and resetting their verdicts. % correct = links marked correct / links marked, within the sample, against the 90% target. |

## Data model

SQLite at `./data/cda.db`. The Drizzle schema is in `src/lib/db/schema.ts`. Tables are created idempotently on startup, and columns added since the first release are migrated in place with `ALTER TABLE`.

| Table | Purpose |
| --- | --- |
| `sites` | Name, location, status, `review_mode` (full or exception), last enrichment run |
| `sources` | Uploaded files: `pfd` (one per drawing), `om`, `assetdb`, `telemetry`, plus one internal `sme` source per site for review corrections |
| `drawings` | One per uploaded drawing: title block (`drawing_number`, `revision`, `date_drawn`, `unit`, `system`, `title`, `author`, `site_label`), `drawing_type`, `status` (queued, processing, parsed, partial, failed), `partial_reason`, `resolved_pct`, `component_count`, `confidence_avg`, `ingest_ms`, `tokens_in`, `tokens_out`, `page_image_path` |
| `assets` | One per tag per site (untagged ones per read), plus `safety_related` |
| `asset_appearances` | asset × drawing: bbox (JSON, normalized), confidence, extracted JSON |
| `asset_param_sources` | Provenance for every parameter value: asset, key, value, source. `params_json`, description and enrichment status are recomputed from it, with SME corrections always winning. |
| `edges` | Connections: `drawing_id`, `kind` (`power`, or `control` for elementaries), `confidence`, `via` (drawing, connector or sme) |
| `off_page_connectors` | Label, direction, target drawing number and tag, attach point, resolved edge |
| `discrepancies` | asset, key, values JSON (`[{value, drawingIds}]`), status (open or resolved), resolution |
| `review_items` | target_type (component, attribute or connection), target_id (appearance id, or edge id), `attr_key` (for attributes), drawing_id, state (accepted, corrected, rejected, ambiguous, added_missing), before_json, after_json, comment, reviewer, flagged, reviewed_at. One row per target per drawing; there is no row while unreviewed. |
| `review_sessions` | drawing, reviewer, active_ms, flagged_ms, started_at, ended_at |
| `asset_doc_links` | asset, KB chunk, link_type, created_by (model or sme), status (unreviewed, correct or incorrect), `in_sample` |
| `kb_chunks` + `kb_fts` | Manual sections (sequential section numbers per site) and the FTS5 index ranked with bm25() |
| `staged_rows`, `chat_messages` | CSV rows awaiting enrichment; chat history with tools, highlights, section sources and drawing references |

## Architecture

```
Browser (Next.js App Router client components)
  Overview / Enrich canvas (React Flow + dagre), asset drawer, lineup bar, Copilot
  Drawings register · drawing viewer (pan/zoom image + bbox) · Review · Baseline · Documentation

API routes (Node runtime)
  /api/sites/{id}/sources              upload (diagrams start a job each; client queue runs 2 at a time)
  /api/jobs/{jobId}                    job polling (steps: rendering, reading, verifying, building)
  /api/sites/{id}/drawings/{d}[/image|/review]   viewer data, page PNG, review list
  /api/sites/{id}/review[/missing]     review actions and add-missing
  /api/sites/{id}/review-sessions[/{s}]          timed sessions
  /api/sites/{id}/baseline[?format=]   baseline JSON, CSV and JSON exports
  /api/sites/{id}/link-sample, /link-test/{l}    document-link test
  /api/sites/{id}/assets/{a}[/links]   safety flag, SME doc links
  /api/sites/{id}/discrepancies/{x}    resolve
  /api/sites/{id}/copilot              SSE tool-use loop

src/lib
  ai.ts          the only module that calls Claude (streaming, zod, one retry, token usage, user-safe errors)
  extract.ts     drawing extraction + saveDrawing(): merge by tag, appearances, connectors, discrepancies, revisions
  review.ts      review list, actions with write-back, add-missing, sessions
  baseline.ts    every baseline metric, link sampling, CSV rows
  electrical.ts  trace / energization / what-if (pure, shared by browser and Copilot)
  drawings.ts    drawing register rows; render.ts renders page 1 to PNG
  enrich.ts, ingest.ts, copilot.ts, model.ts, jobs.ts, sample/*
```

## Decisions made where the brief was open

**From this build**

- **Branching:** PR #1 was still open, so this work branches from its head and is opened as a new PR stacked on it.
- **Sample asset count:** the three sheets keep the site at 15 assets and 14 connections, so the original smoke test's counts still hold. E-002 and E-003 re-read existing equipment (that's what makes the cross-drawing merge, the discrepancy and the connector visible) instead of adding new tags.
- **Edge ownership:** a connection drawn on two drawings is stored once and belongs to the first drawing that read it. That drawing reviews it.
- **Attribute review targets** are identified by appearance id plus `attr_key`. Attribute items list the values as read from that drawing; the "current" value shows that drawing's value, or the SME correction.
- **Component edits** cover name, type and description. Changing a tag would re-key the merge, so a wrong tag is handled by Reject plus Add missing.
- **Elementary connections** are stored as `control` edges, drawn dashed and purple, and excluded from tracing and energization.
- **Breaker state:** `normal_state` comes from the drawings. A breaker with no stated state is assumed closed. In the sample, 52-1A03 and 52-1A04 are normally open, matching the manual's normal lineup, so the what-if list marks P-1A and P-1C "already off in normal lineup".
- **Safety-related seed:** "BUS-1A and its feeders" is read as BUS-1A plus all five breakers on it (two incoming, three outgoing).
- **Exception mode** hides items that aren't required behind a "Show N not required" link instead of removing them.
- **Review time** starts when a drawing is open on the Review tab, even before the first decision, because reading the sheet is part of the review.
- **Link test:** SME-added links are stored as `correct`. Drawing a new sample resets the sampled links to unreviewed.
- **Telemetry** stays seeded for the sample, and Run Enrichment still applies it, so the existing demo and test keep working. The toggle only hides the card.
- **Copilot** is renamed "SiteAId Copilot".
- **Page images** for the sample are pre-rendered PNGs committed in `sample-data/`, so seeding doesn't need the renderer.

**From the first build**

- **shadcn/ui:** the registry wasn't reachable from the build environment, so `src/components/ui/*` are hand-written in shadcn style on `radix-ui`. `components.json` is present.
- **Enrichment status:** pending until an enrichment source (manual, asset database or telemetry) contributes; enriched with 2 or more distinct enrichment kinds or 6 or more non-tag parameters; partial otherwise. Drawing values alone don't count as enrichment.
- **Refusal fallback:** when the main model is Sonnet 5.5, Opus 5.x or Fable 5.x, requests opt into the API's server-side refusal fallback (`fallbacks: "default"`).
- **Fonts:** the system sans stack with Inter first, so builds need no network access for fonts.

## Deploying

**SQLite and local files won't persist on serverless hosts** such as Vercel or Netlify functions. Their filesystem is ephemeral and per instance, and the in-process job runner needs a long-lived Node process. Before deploying anywhere but a single long-running server or container:

- swap SQLite for Postgres (Drizzle supports it; FTS5 with bm25 maps to `tsvector` with `ts_rank`)
- move `./data/uploads` (source files and rendered page images) to object storage
- move the in-process jobs to a queue or background worker

## Testing

```bash
npm run typecheck && npm run lint && npm run build
npm run test:e2e
```

The Playwright tests (also run in CI) cover:

- add sample site → Enrich → Run Enrichment → statuses update → Documentation CSV and JSON export, plus the phone layout
- the Drawings tab shows 3 drawings, with E-003 partial and its reason
- review E-001 (accept, correct, reject) → Baseline shows single-line accuracy and SME minutes
- FN-1A shows the 15 vs 20 HP discrepancy and appears on both drawings; a chip opens the viewer at FN-1A
- trace downstream from BUS-1A highlights P-1A and MCC-1A1
- what if 52-1A01 opens → BUS-1A and its loads are de-energized; Reset restores them
- a link sample of 5, marked → Baseline shows 80%

The Copilot test is skipped unless `ANTHROPIC_API_KEY` is set. Locally, if Playwright's bundled Chromium isn't installed, set `PLAYWRIGHT_CHROMIUM_PATH=/path/to/chrome`.

## Troubleshooting

- **The dev page keeps reloading** after you switch between dev servers with different env vars: stop the server, delete `.next`, and start again.
- **"This PDF looks scanned. Run OCR first."** means a manual has almost no extractable text. Run it through OCR and upload again.
- **No page image in the viewer:** the PDF couldn't be rendered (the upload shows a warning). Extraction still works; re-upload a cleaner PDF or a PNG.
