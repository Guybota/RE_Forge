import { test, expect } from "@playwright/test";
import { buildCardSearchQuery, emptyCardSearch, hasSearchCriteria } from "../src/lib/card-search";
import { applyPrintingVisual, getCachedVisual, searchScryfallCards } from "../src/lib/scryfall";

test("search filters preserve phrases, literal values, identity, exclusions and alternatives", () => {
  const filters = emptyCardSearch();
  expect(hasSearchCriteria(filters)).toBe(false);
  filters.name = 'Angel "Font of Hope"';
  filters.oracle = "draw a card";
  filters.commanderColors = ["W", "U"];
  filters.colors = ["W"];
  filters.colorMode = "exactly";
  filters.types = [{ id: "t", text: "Goblin", include: false, kind: "keyword" }];
  filters.rarities = ["r", "m"];
  filters.games.arena = true;
  filters.priceValue = "5.00";
  filters.statValue = "2";
  filters.statOp = "gte";
  const query = buildCardSearchQuery(filters);
  expect(hasSearchCriteria(filters)).toBe(true);
  expect(query).toContain('name:"Angel" name:"Font of Hope"');
  expect(query).toContain('oracle:"draw" oracle:"a" oracle:"card"');
  expect(query).toContain("identity<=wu");
  expect(query).toContain("color=w");
  expect(query).toContain("-type:/\\bGoblin\\b/");
  expect(query).toContain("(rarity:r or rarity:m)");
  expect(query).toContain("(game:paper or game:arena)");
  expect(query).toContain("cmc>=2");
  expect(query).toContain("eur<=5.00");
  filters.oracleTogether = true;
  filters.commanderColorless = true;
  filters.statValue = "2 or *";
  filters.priceValue = "0 or name:Black";
  const phrase = buildCardSearchQuery(filters);
  expect(phrase).toContain('oracle:"draw a card"');
  expect(phrase).toContain("identity=c");
  expect(phrase).not.toContain("cmc");
  expect(phrase).not.toContain("eur");
  filters.criteria = [{ id: "k", text: "fly", kind: "keyword", include: true }];
  filters.criteriaPartial = true;
  expect(buildCardSearchQuery(filters)).toContain('keyword:"Flying"');
  expect(buildCardSearchQuery(filters)).not.toContain("keyword:/");
});

test("Scryfall search validates pagination and keeps a deck's preferred printing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  applyPrintingVisual("Integration Search Card", { name: "Integration Search Card", scryfallId: "preferred", eur: 12 });
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return new Response(JSON.stringify({
      data: [{ id: "search-printing", name: "Integration Search Card", set: "TST", set_name: "Test Set", rarity: "rare", prices: { eur: "1.23", usd: "2.34" }, card_faces: [{ oracle_text: "Front face." }, { oracle_text: "Back face." }] }],
      total_cards: 2, has_more: true,
      next_page: "https://api.scryfall.com/cards/search?q=test&page=2",
    }), { headers: { "content-type": "application/json" } });
  };
  try {
    const invalid = await searchScryfallCards("test", { pageUrl: "https://example.com/cards/search" });
    expect(invalid.error).toBeTruthy();
    expect(calls).toHaveLength(0);
    const result = await searchScryfallCards('name:"Integration Search Card"');
    expect(result.cards[0]).toMatchObject({ id: "search-printing", eur: 1.23, usd: 2.34, setName: "Test Set", oracleText: "Front face.\n\nBack face." });
    expect(result.total).toBe(2);
    expect(result.nextPage).toContain("page=2");
    expect(new URL(calls[0]).searchParams.get("q")).toBe('name:"Integration Search Card"');
    expect(getCachedVisual("Integration Search Card")?.scryfallId).toBe("preferred");
    const controller = new AbortController();
    controller.abort();
    await searchScryfallCards("test", { signal: controller.signal });
    expect(calls).toHaveLength(1);
    globalThis.fetch = async () => new Response("", { status: 404 });
    expect((await searchScryfallCards("missing")).cards).toHaveLength(0);
  } finally { globalThis.fetch = originalFetch; }
});

test("search opens a result and steps through the loaded cards", async ({ page }) => {
  await page.route("https://api.scryfall.com/cards/search?**", async (route) => {
    await route.fulfill({ json: { data: [
      { id: "first-search-result", name: "First Search Result", oracle_text: "First rules text.", type_line: "Creature", prices: { eur: "1.00" } },
      { id: "second-search-result", name: "Second Search Result", oracle_text: "Second rules text.", type_line: "Artifact", prices: {} },
    ], total_cards: 2, has_more: false } });
  });
  await page.goto("/search");
  await page.getByPlaceholder(/Any words in the name/).fill("Result");
  await page.getByRole("button", { name: "Search with these options" }).click();
  await page.getByRole("button", { name: /First Search Result/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "First Search Result" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Previous card" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Next card" }).click();
  await expect(dialog.getByRole("heading", { name: "Second Search Result" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Next card" })).toBeDisabled();
  await page.keyboard.press("ArrowLeft");
  await expect(dialog.getByRole("heading", { name: "First Search Result" })).toBeVisible();
});
