import { test, expect } from "@playwright/test";
import fs from "node:fs";

test("sample site: enrich, statuses update, documentation export", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Add sample site" }).first().click();
  await page.waitForURL(/\/sites\/\d+$/);

  // Overview: model, legend and copilot are present.
  const nodes = page.getByTestId("asset-node");
  await expect(nodes).toHaveCount(15);
  await expect(page.getByTestId("status-legend")).toBeVisible();
  await expect(page.getByText("Sample Site: Bus 1A (fictional)").first()).toBeVisible();
  await expect(page.locator('[data-testid="asset-node"][data-status="pending"]')).toHaveCount(15);

  // Drawer opens on click.
  await page.locator('[data-testid="asset-node"][data-tag="P-1A"]').click();
  const drawer = page.getByTestId("asset-drawer");
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText("Ask Copilot about this asset")).toBeVisible();
  await drawer.getByRole("button", { name: "Close details" }).click();

  // Enrich.
  await page.getByRole("tab", { name: "Enrich" }).click();
  await expect(page.getByTestId("source-card-om").getByText("Data Ingested")).toBeVisible();
  await expect(page.getByTestId("source-card-om").getByText("Disconnected")).toBeVisible();
  await page.getByRole("button", { name: /Run Enrichment/ }).click();
  await expect(page.getByText(/Enrichment complete/)).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-testid="asset-node"][data-status="enriching"]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.locator('[data-testid="asset-node"][data-tag="P-1A"]')).toHaveAttribute("data-status", "enriched");
  expect(await page.locator('[data-testid="asset-node"][data-status="enriched"]').count()).toBeGreaterThan(5);
  await expect(page.getByTestId("source-card-om").getByText("Connected", { exact: true })).toBeVisible();

  // Documentation + exports.
  await page.getByRole("tab", { name: "Documentation" }).click();
  await expect(page.getByTestId("asset-row")).toHaveCount(15);
  const [csvDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-csv").click()]);
  const csv = fs.readFileSync((await csvDl.path())!, "utf8");
  expect(csv.split("\n")[0]).toContain("tag,name,type,enrichment_status");
  expect(csv).toContain("P-1A");
  const [jsonDl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-json").click()]);
  const json = JSON.parse(fs.readFileSync((await jsonDl.path())!, "utf8"));
  expect(json.assets).toHaveLength(15);
  expect(json.edges).toHaveLength(14);
  const p1a = json.assets.find((a: { tag: string }) => a.tag === "P-1A");
  expect(p1a.enrichmentStatus).toBe("enriched");
  expect(p1a.provenance.some((p: { source: string }) => p.source.includes("historian"))).toBe(true);
});

test("phone layout: enrich panel is a slide-over", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  await page.goto("/");
  await page.getByTestId("site-card").first().click();
  await page.waitForURL(/\/sites\/\d+$/);
  // Copilot starts collapsed on small screens.
  await expect(page.getByPlaceholder("Ask Copilot anything")).toHaveCount(0);
  await page.getByRole("tab", { name: "Enrich" }).click();
  await page.getByRole("button", { name: "Enrich Site" }).click();
  await expect(page.getByRole("dialog").getByText("Upload documentation to enrich site")).toBeVisible();
  await ctx.close();
});

test("copilot answers the P-1A start question", async ({ page }) => {
  test.skip(!process.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is not set");
  await page.goto("/");
  await page.getByTestId("site-card").first().click();
  await page.waitForURL(/\/sites\/\d+$/);
  await page.getByPlaceholder("Ask Copilot anything").fill("What is the start procedure for P-1A?");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByTestId("copilot-answer").last();
  await expect(answer).toContainText("52-1A03", { timeout: 90_000 });
  await expect(answer.getByText(/query_knowledge_base/)).toBeVisible();
});
