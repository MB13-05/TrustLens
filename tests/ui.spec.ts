import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/** Demo-mode flows against the regular dev server. They choose the demo explicitly, so a local .env with live keys does not matter. */
async function openDemo(page: Page) {
  await page.goto('/');
  await page.getByRole('radio', { name: /Synthetische Demo/ }).check();
}
async function startExample(page: Page, example: string) {
  await openDemo(page);
  await page.getByRole('button', { name: `Beispiel: ${example}` }).click();
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await expect(page.getByRole('heading', { name: 'Welche Aussage prüfen wir?' })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
}
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test('synthetic context demo links every reasoning point to a numbered quotation', async ({ page }) => {
  await startExample(page, 'Kontext fehlt ↗');
  await expect(page.getByRole('heading', { name: 'Dein Rechercheergebnis' })).toBeVisible();
  await expect(page.locator('.verdict-label')).toHaveText('◐Kontext fehlt');
  await expect(page.locator('.mode-banner')).toContainText('Synthetische Demo');
  await expect(page.locator('.verdict')).toContainText('fiktive Quellen');
  const references = page.locator('.references a');
  expect(await references.count()).toBeGreaterThan(0);
  for (const link of await references.all()) {
    const href = await link.getAttribute('href');
    await expect(page.locator(href!)).toHaveCount(1);
  }
  await expect(page.locator('.evidence-card').first()).toContainText('abgerufen');
  await expect(page.locator('.evidence-card blockquote').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Was offenbleibt' })).toBeVisible();
  // Technical ids are not part of the main reading flow.
  const readable = await page.locator('.results').innerText(); // rendered text only; collapsed details are not part of it
  expect(readable).not.toMatch(/s\d:p\d|Herkunftsgruppe|Quelle s\d/);
  await page.getByText('Recherchehistorie & Laufgrenzen').click();
  await expect(page.locator('.history')).toContainText('Runden: 2');
  await expect(page.locator('.history .timeline')).toContainText(/Nachrecherche|Weitere|gezielt/i);
  expect(await noHorizontalOverflow(page)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('result.png'), fullPage: true });
  await page.getByRole('button', { name: 'Neue Prüfung' }).click();
  await expect(page.getByRole('heading', { name: 'Was möchtest du überprüfen?' })).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('input.png'), fullPage: true });
});

test('insufficient demo remains ungeklärt and says what stays open', async ({ page }) => {
  await startExample(page, 'Ungeklärt ↗');
  await expect(page.getByRole('heading', { name: 'Dein Rechercheergebnis' })).toBeVisible();
  await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
  await expect(page.locator('.limitations')).toContainText('Fehlende Bestätigung allein widerlegt eine Aussage nicht.');
  expect(await noHorizontalOverflow(page)).toBe(true);
});

test('empty and unsupported demo input produce useful recoverable errors', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await expect(page.getByRole('alert')).toContainText('Bitte gib zuerst einen Text ein.');
  await page.getByLabel('Dein Text').fill('Diese eigene Aussage ist keine vorbereitete Demo.');
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await expect(page.getByRole('alert')).toContainText('vorbereiteten Beispiele');
  await page.getByRole('button', { name: 'Beispiel: Kontext fehlt ↗' }).click();
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await expect(page.getByRole('heading', { name: 'Welche Aussage prüfen wir?' })).toBeVisible();
});

test('image and post input explain that they need live mode instead of failing', async ({ page }) => {
  await openDemo(page);
  await page.getByRole('tab', { name: /^Bild/ }).click();
  await expect(page.getByText('Bilder gibt es nur im Live-Modus')).toBeVisible();
  await page.getByRole('tab', { name: /^Post-Link/ }).click();
  await expect(page.getByText('Post-Links gibt es nur im Live-Modus')).toBeVisible();
});

test('run failure is displayed and can be restarted', async ({ page }) => {
  await page.route('**/api/runs', async route => {
    const response = await route.fetch();
    const run = await response.json();
    await route.fulfill({ response, json: { ...run, status: 'failed', error: 'Der Suchdienst ist derzeit nicht erreichbar.', result: null } });
  });
  await startExample(page, 'Kontext fehlt ↗');
  await expect(page.getByRole('heading', { name: 'Recherche fehlgeschlagen' })).toBeVisible();
  await expect(page.getByText('Der Suchdienst ist derzeit nicht erreichbar.')).toBeVisible();
  await page.getByRole('button', { name: 'Erneut beginnen' }).click();
  await expect(page.getByRole('heading', { name: 'Was möchtest du überprüfen?' })).toBeVisible();
});

test('poll failure offers retry and cancellation remains available', async ({ page }) => {
  let fail = true;
  await page.route('**/api/runs/*', async route => {
    if (route.request().method() === 'GET' && fail) { await route.fulfill({ status: 503, json: { error: 'Status ist vorübergehend nicht erreichbar.' } }); return; }
    await route.continue();
  });
  await startExample(page, 'Kontext fehlt ↗');
  await expect(page.getByRole('button', { name: 'Status erneut laden' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Recherche abbrechen' })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: 'Status erneut laden' }).click();
  await expect(page.getByRole('heading', { name: 'Dein Rechercheergebnis' })).toBeVisible();
});

test('unavailable sources stay visible as a list without becoming evidence', async ({ page }) => {
  await openDemo(page);
  await page.getByLabel('Dein Text').fill('Die Lindenstädter Solaranlage hat im Jahr 2025 genau 900 Megawattstunden erzeugt.');
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
  // One source could not be read, so the run is honestly reported as limited.
  await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible();
  await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
  await page.getByText(/Gelesene Quellen|Weitere gelesene Quellen/).click();
  const unavailable = page.locator('.found-list li').filter({ hasText: 'Nicht zugänglich' });
  await expect(unavailable).toHaveCount(1);
  await expect(unavailable).toContainText('dient nicht als Beleg');
  await expect(unavailable.locator('blockquote')).toHaveCount(0);
});

test('active research can be cancelled and restarted', async ({ page }) => {
  const pending = { id: 'cancel-ui-test', mode: 'demo', status: 'researching', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 1800000).toISOString(), deadlineAt: new Date(Date.now() + 90000).toISOString(), counters: { model: 1, search: 0, fetch: 0, rounds: 0 }, events: [], result: null, error: null };
  await page.route('**/api/runs', route => route.fulfill({ status: 201, json: pending }));
  await page.route('**/api/runs/cancel-ui-test', route => route.fulfill({ json: pending }));
  await page.route('**/api/runs/cancel-ui-test/cancel', route => route.fulfill({ json: { ...pending, status: 'cancelled' } }));
  await startExample(page, 'Kontext fehlt ↗');
  // An older server response without "found" must not break the screen.
  await expect(page.getByText('Noch keine Quelle gelesen.')).toBeVisible();
  await page.getByRole('button', { name: 'Recherche abbrechen' }).click();
  await expect(page.getByRole('heading', { name: 'Recherche abgebrochen' })).toBeVisible();
  await page.getByRole('button', { name: 'Erneut beginnen' }).click();
  await expect(page.getByRole('heading', { name: 'Was möchtest du überprüfen?' })).toBeVisible();
});

test('location ambiguity can be clarified without adding an unrelated date', async ({ page }) => {
  const original = 'Hier ist das Fahrradfahren verboten.';
  const clarified = 'Auf dem Marktplatz in Lindenstadt ist das Fahrradfahren während des Wochenmarkts verboten.';
  await page.route('**/api/claims', route => route.fulfill({ json: { claims: [{ id: 'c1', originalText: original, normalizedText: original, timeScope: null, locationScope: null, entities: [], checkability: 'unclear' }] } }));
  let submitted: Record<string, unknown> | undefined;
  await page.route('**/api/runs', async route => {
    submitted = route.request().postDataJSON();
    const now = new Date().toISOString();
    await route.fulfill({ status: 201, json: { id: 'clarified-ui', mode: 'demo', status: 'completed', createdAt: now, expiresAt: now, deadlineAt: now, counters: { model: 0, search: 0, fetch: 0, rounds: 0 }, events: [], result: { claim: submitted!.claim, checkedAt: now, verdict: { claimId: 'c1', label: 'Ungeklärt', summary: 'Der Ort wurde geklärt; Belege fehlen im Testlauf.', reasoningItems: [], evidenceIds: [], limitations: ['Synthetischer UI-Test.'] }, evidence: [], sources: [], chunks: [] }, error: null } });
  });
  await openDemo(page);
  await page.getByLabel('Dein Text').fill(original);
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await page.getByLabel('Zu prüfende Formulierung').fill(clarified);
  await expect(page.getByLabel('Zeitbezug (optional präzisieren)')).toHaveValue('');
  await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
  await expect(page.getByRole('heading', { name: 'Dein Rechercheergebnis' })).toBeVisible();
  expect(submitted?.claim).toMatchObject({ normalizedText: clarified, timeScope: null });
});

test('keyboard users reach the main content first and can operate the tabs with arrow keys', async ({ page, isMobile }) => {
  test.skip(Boolean(isMobile), 'Keyboard navigation is checked on the desktop viewport.');
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Zum Inhalt springen' })).toBeFocused();
  await page.getByRole('tab', { name: /^Text/ }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: /^Bild/ })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: /^Bild/ })).toBeFocused();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: /^Post-Link/ })).toHaveAttribute('aria-selected', 'true');
});

for (const scheme of ['light'] as const) {
  test(`input and result screens have no automatically detectable accessibility violations (${scheme})`, async ({ page }) => {
    await openDemo(page);
    const input = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(input.violations.map(v => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    await page.getByRole('button', { name: 'Beispiel: Kontext fehlt ↗' }).click();
    await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
    const claims = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(claims.violations.map(v => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
    await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
    await expect(page.getByRole('heading', { name: 'Dein Rechercheergebnis' })).toBeVisible();
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
    expect(result.violations.map(v => `${v.id}: ${v.nodes[0]?.html}`)).toEqual([]);
  });
}
