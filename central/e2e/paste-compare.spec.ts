import { test, expect } from "@playwright/test";

test("paste a list and open it in compare", async ({ page }) => {
  await page.goto("/decks");
  await expect(page.getByRole("heading", { name: "My Decks" })).toBeVisible();

  await page.getByRole("button", { name: "Paste a list" }).click();
  await page.getByLabel("Deck name").fill("Smoke Angels");
  await page.getByLabel("Commander").fill("Giada, Font of Hope");
  await page.getByLabel("Decklist").fill("1 Sol Ring\n1 Swords to Plowshares\n\nSideboard\n1 Path to Exile");
  await page.getByRole("button", { name: "Save deck" }).click();

  await expect(page.getByRole("heading", { name: "Smoke Angels" })).toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole("link", { name: "Compare" }).click();
  await expect(page).toHaveURL(/\/compare\?a=/);
  await expect(page.getByRole("heading", { name: "Compare Decks" })).toBeVisible();
  await expect(page.getByText("Smoke Angels").first()).toBeVisible();
});
