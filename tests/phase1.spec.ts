import { test, expect, type Page } from "@playwright/test";

// Phase 1 Proof of Value flows on a fresh fictional sample site per test.

async function openSample(page: Page) {
  const res = await page.request.post("/api/sites/sample");
  expect(res.ok()).toBeTruthy();
  const { id } = (await res.json()) as { id: number };
  await page.goto(`/sites/${id}`);
  await expect(page.getByTestId("asset-node")).toHaveCount(15);
  return id;
}

async function openAssetFromRegister(page: Page, tag: string) {
  await page.getByRole("tab", { name: "Documentation" }).click();
  await page.locator(`[data-testid="asset-row"][data-tag="${tag}"]`).click();
  await expect(page.getByTestId("asset-drawer")).toBeVisible();
}

test("drawings tab lists 3 drawings with the partial read and its reason", async ({ page }) => {
  await openSample(page);
  await page.getByRole("tab", { name: "Drawings" }).click();
  const rows = page.getByTestId("drawing-row");
  await expect(rows).toHaveCount(3);
  const e3 = page.locator('[data-testid="drawing-row"][data-drawing="SAMPLE-E-003"]');
  await expect(e3.locator('[data-status="partial"]')).toBeVisible();
  await expect(e3.getByTestId("partial-reason")).toContainText("legend block illegible");
  await expect(e3.getByTestId("partial-reason")).toContainText("70% resolved");
  await expect(page.locator('[data-testid="drawing-row"] [data-status="parsed"]')).toHaveCount(2);
});

test("review E-001: accept, correct and reject, then baseline shows single_line accuracy and SME minutes", async ({ page }) => {
  await openSample(page);
  await page.getByRole("tab", { name: "Review" }).click();
  await expect(page.getByTestId("review-drawing-select")).toHaveValue(/\d+/);
  await expect(page.getByTestId("review-drawing-select").locator("option:checked")).toContainText("SAMPLE-E-001");
  const item = (text: string) => page.getByTestId("review-item").filter({ hasText: text });
  // Rows expand on click; the panel also auto-advances to the next unreviewed item after each action.
  const open = async (text: string) => {
    const header = item(text).locator("button[aria-expanded]");
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");
  };

  // Flagged items sort first.
  await expect(page.getByTestId("review-item").first()).toHaveAttribute("data-flagged", "true");

  // Accept a component.
  await open("52-1A04 · Core Spray Feeder");
  await item("52-1A04 · Core Spray Feeder").getByRole("button", { name: "Accept" }).click();
  await expect(item("52-1A04 · Core Spray Feeder")).toHaveAttribute("data-state", "accepted");

  // Correct an attribute.
  await open("SWYD-230 · voltage");
  await item("SWYD-230 · voltage").getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Corrected value").fill("230 kV nominal");
  await page.mouse.move(200, 300);
  await page.waitForTimeout(2500); // some active review time
  await page.getByRole("button", { name: "Save correction" }).click();
  await expect(item("SWYD-230 · voltage")).toHaveAttribute("data-state", "corrected");

  // Reject a connection.
  await open("52-1A05 → T-1A5");
  await item("52-1A05 → T-1A5").getByRole("button", { name: "Reject" }).click();
  await expect(item("52-1A05 → T-1A5")).toHaveAttribute("data-state", "rejected");

  await page.getByRole("tab", { name: "Baseline" }).click();
  await page.getByTestId("baseline-type-single_line").click();
  const acc = page.getByTestId("accuracy-single_line");
  await expect(acc.getByTestId("accuracy-single_line-component").getByTestId("precision")).toContainText("100.0%");
  await expect(acc.getByTestId("accuracy-single_line-attribute").getByTestId("precision")).toContainText("0.0%");
  await expect(acc.getByTestId("accuracy-single_line-connection").getByTestId("precision")).toContainText("0.0%");
  await expect(page.getByTestId("sme-single_line").getByTestId("sme-full")).toHaveText(/\d+\.\d\d min/);
});

test("FN-1A shows the 15 vs 20 HP discrepancy, appears on both drawings, and a chip opens the viewer", async ({ page }) => {
  await openSample(page);
  await openAssetFromRegister(page, "FN-1A");
  const drawer = page.getByTestId("asset-drawer");
  const disc = drawer.getByTestId("discrepancy");
  await expect(disc).toContainText("motor_rating");
  await expect(disc).toContainText("15 HP");
  await expect(disc).toContainText("20 HP");
  const chips = drawer.getByTestId("appears-on-chip");
  await expect(chips).toHaveCount(2);
  await expect(chips.nth(0)).toContainText("SAMPLE-E-001");
  await expect(chips.nth(1)).toContainText("SAMPLE-E-002");
  await chips.nth(1).click();
  const viewer = page.getByTestId("drawing-viewer");
  await expect(viewer).toBeVisible();
  await expect(viewer).toContainText("SAMPLE-E-002 rev A");
  await expect(viewer.getByTestId("viewer-active-asset")).toHaveText("FN-1A");
  await expect(viewer.getByTestId("title-block")).toContainText("MCC-1A1 480 V Bucket Detail");
  await expect(viewer.locator('[data-box][data-active="true"]')).toHaveCount(1);
});

test("trace downstream from BUS-1A highlights P-1A and MCC-1A1", async ({ page }) => {
  await openSample(page);
  await openAssetFromRegister(page, "BUS-1A");
  await page.getByTestId("trace-downstream").click();
  await expect(page.getByTestId("trace-bar")).toContainText("Trace downstream from BUS-1A");
  await expect(page.getByTestId("trace-bar")).toContainText("Decision support only");
  await expect(page.locator('[data-testid="asset-node"][data-tag="P-1A"]')).toHaveAttribute("data-traced", "true");
  await expect(page.locator('[data-testid="asset-node"][data-tag="MCC-1A1"]')).toHaveAttribute("data-traced", "true");
  await expect(page.locator('[data-testid="asset-node"][data-tag="SAT-1A"]')).not.toHaveAttribute("data-traced", "true");
});

test("what if 52-1A01 opens: BUS-1A and its loads de-energized, reset restores them", async ({ page }) => {
  await openSample(page);
  await openAssetFromRegister(page, "52-1A01");
  await page.getByTestId("what-if-open").click();
  await expect(page.getByTestId("lineup-bar")).toContainText("What-if lineup active");
  await expect(page.getByTestId("lineup-bar")).toContainText("52-1A01");
  await expect(page.getByTestId("lineup-bar")).toContainText("Decision support only");
  for (const tag of ["BUS-1A", "52-1A05", "T-1A5", "MCC-1A1", "P-1A", "FN-1A"]) {
    await expect(page.locator(`[data-testid="asset-node"][data-tag="${tag}"]`)).toHaveAttribute("data-deenergized", "true");
  }
  await expect(page.locator('[data-testid="asset-node"][data-tag="SAT-1A"]')).not.toHaveAttribute("data-deenergized", "true");
  await page.getByTestId("reset-lineup").click();
  await expect(page.getByTestId("lineup-bar")).toHaveCount(0);
  await expect(page.locator('[data-testid="asset-node"][data-deenergized="true"]')).toHaveCount(0);
});

test("link sample of 5 marked shows the % correct on the baseline", async ({ page }) => {
  await openSample(page);
  await page.getByRole("tab", { name: "Baseline" }).click();
  await page.getByLabel("Link sample size").fill("5");
  await page.getByRole("button", { name: "Draw link sample" }).click();
  const items = page.getByTestId("link-sample-item");
  await expect(items).toHaveCount(5);
  for (let i = 0; i < 4; i++) await items.nth(i).getByRole("button", { name: / correct$/ }).click();
  await items.nth(4).getByRole("button", { name: / incorrect$/ }).click();
  await expect(page.getByTestId("link-test-count")).toContainText("4 correct of 5 marked");
  await expect(page.getByTestId("link-test")).toContainText("80.0%");
});
