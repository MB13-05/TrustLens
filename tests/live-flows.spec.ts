import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import sharp from 'sharp';

/** Live-mode flows against tests/e2e-server.ts: the real UI and API with deterministic adapters (no keys, no network). */
test.use({ baseURL: 'http://127.0.0.1:3100' });

const MAUERFALL = 'Die Berliner Mauer fiel am 9. November 1989.';
const png = (width: number, height: number) => sharp({ create: { width, height, channels: 3, background: '#e8e8e8' } }).png().toBuffer();
const file = async (width = 400, height = 300, name = 'screenshot.png') => ({ name, mimeType: 'image/png', buffer: await png(width, height) });
const noHorizontalOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const a11y = async (page: Page) => (await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()).violations.map(v => `${v.id}: ${v.nodes[0]?.html}`);

async function openLive(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('radio', { name: /Live-Recherche/ })).toBeChecked();
}
async function checkText(page: Page, text: string) {
  await openLive(page);
  await page.getByLabel('Dein Text').fill(text);
  await page.getByRole('button', { name: 'Behauptungen erkennen' }).click();
  await expect(page.getByRole('heading', { name: 'Welche Aussage prüfen wir?' })).toBeVisible();
  await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
}
async function confirmClaimAndWait(page: Page) {
  await expect(page.getByRole('heading', { name: 'Welche Aussage prüfen wir?' })).toBeVisible();
  await page.getByRole('button', { name: 'Diese Aussage prüfen' }).click();
}

test.describe('research quality in the interface', () => {
  test('a well supported claim shows numbered quotations that match the reasoning', async ({ page }) => {
    await checkText(page, MAUERFALL);
    await expect(page.getByRole('heading', { name: 'Die Recherche läuft.' })).toBeVisible();
    // Progress shows real activity and sources found so far, never percentages.
    await expect(page.locator('.found-list li').first()).toBeVisible();
    await expect(page.locator('.progress-status')).not.toContainText('%');
    expect(await page.locator('.narrow .card').innerText()).not.toMatch(/ds?%/);
    await expect(page.locator('.found-list li').filter({ hasText: 'Nicht zugänglich' })).toHaveCount(1, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.verdict-label')).toHaveText('✓Belegt');
    await expect(page.locator('.mode-banner.live')).toBeVisible();
    await expect(page.locator('.evidence-card')).toHaveCount(2);
    for (const link of await page.locator('.references a').all()) {
      await expect(page.locator((await link.getAttribute('href'))!)).toHaveCount(1);
    }
    for (const link of await page.locator('.cited-by a').all()) {
      await expect(page.locator((await link.getAttribute('href'))!)).toHaveCount(1);
    }
    const card = page.locator('.evidence-card').first();
    await expect(card.locator('a[target=_blank]')).toHaveAttribute('rel', /noopener/);
    await expect(card).toContainText('Ohne Veröffentlichungsdatum');
    await expect(page.locator('.evidence-card').nth(1)).toContainText('Veröffentlicht 09.11.2024');
    await expect(page.locator('.evidence-card').nth(1)).toContainText('abgerufen');
    const readable = await page.locator('.results').innerText();
    expect(readable).not.toMatch(/s\d:p\d|Herkunftsgruppe|Quelle s\d/);
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await a11y(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('belegt.png'), fullPage: true });
  });

  test('a wrong date is contradicted with the quotation that contradicts it', async ({ page }) => {
    await checkText(page, 'Die Berliner Mauer fiel am 3. Oktober 1989.');
    await expect(page.locator('.verdict-label')).toHaveText('✕Widersprochen', { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'Diese Fundstellen widersprechen der Aussage' })).toBeVisible();
    await expect(page.locator('.tag.relation.contradicts').first()).toHaveText('Widersprechend');
  });

  test('an unsupported claim without evidence is not presented as a verified report', async ({ page }) => {
    await checkText(page, 'Die Hauptstadt von Atlantis hat drei Millionen Einwohner.');
    await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt', { timeout: 20_000 });
    await expect(page.getByText('Keine Fundstelle als Beleg verwendet')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Belege im Wortlaut' })).toHaveCount(0);
    await expect(page.locator('.evidence-card')).toHaveCount(0);
    await expect(page.getByText(/Gelesene Quellen \(\d\)/)).toBeVisible();
    await expect(page.locator('.limitations')).toContainText('Keine der gelesenen Quellen behandelt diese Aussage direkt.');
    await expect(page.locator('.notice.technical')).toHaveCount(0);
  });

  test('a technical failure is shown as a technical limitation with a next step, not as missing evidence', async ({ page }) => {
    await checkText(page, 'FEHLERFALL: Die Berliner Mauer fiel am 9. November 1989.');
    await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
    const notice = page.locator('.notice.technical');
    await expect(notice).toContainText('Technische Einschränkung – kein Befund über die Aussage');
    await expect(notice).toContainText('nicht zuverlässig ausgewertet');
    await expect(page.locator('.verdict .meta-line')).toContainText('Die technische Auswertung ist unvollständig.');
    await expect(page.locator('.verdict .meta-line')).not.toContainText('Die Belege reichen');
    await expect(page.locator('.limitations')).not.toContainText(/validier|Schema|Belegverweis/i);
    await expect(page.getByRole('heading', { name: 'Belege im Wortlaut' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Prüfung erneut starten' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Aussage anpassen' })).toBeVisible();
    expect(await page.locator('.results').innerText()).not.toMatch(/reasoningItems|The '/);
    expect(await a11y(page)).toEqual([]);
  });

  test('verified quotations stay visible, without a verdict, when the model report cannot be validated', async ({ page }) => {
    await checkText(page, 'ZITATRETTUNG: Die Berliner Mauer fiel am 9. November 1989.');
    await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
    await expect(page.locator('.notice.technical')).toContainText('Schema');
    await expect(page.locator('.notice.technical')).toContainText('einzeln als wörtlich vorhanden geprüft');
    await expect(page.getByRole('heading', { name: 'Wörtlich geprüfte Zitate (Einordnung nicht gegengeprüft)' })).toBeVisible();
    await expect(page.locator('.evidence-card')).toHaveCount(1);
    await expect(page.locator('.evidence-card')).toContainText('Einordnung (stützend, widersprechend, Umfang) wurde nicht gegengeprüft');
    await expect(page.locator('.evidence-card blockquote')).toContainText('bis zum 9. November 1989 West-Berlin.');
    await expect(page.locator('.reasons')).toHaveCount(0);
    expect(await a11y(page)).toEqual([]);
  });

  test('research can be cancelled while sources are still being read', async ({ page }) => {
    await checkText(page, MAUERFALL);
    await expect(page.getByRole('button', { name: 'Recherche abbrechen' })).toBeVisible();
    await page.getByRole('button', { name: 'Recherche abbrechen' }).click();
    await expect(page.getByRole('heading', { name: 'Recherche abgebrochen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Prüfung erneut starten' })).toBeVisible();
  });
});

test.describe('input paths', () => {
  test('live and demo are clearly different and the input tabs explain themselves', async ({ page }) => {
    await openLive(page);
    await expect(page.locator('.mode-banner.live')).toContainText('Live-Recherche');
    await expect(page.locator('.mode-banner.demo')).toHaveCount(0);
    await page.getByRole('radio', { name: /Synthetische Demo/ }).check();
    await expect(page.locator('.mode-banner.demo')).toContainText('Fiktive Stadt, fiktive Quellen');
    await expect(page.locator('.mode-banner.live')).toHaveCount(0);
    await page.getByRole('radio', { name: /Live-Recherche/ }).check();
    for (const name of ['Text', 'Bild', 'Post-Link']) await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible();
    expect(await noHorizontalOverflow(page)).toBe(true);
    expect(await a11y(page)).toEqual([]);
    await page.screenshot({ path: test.info().outputPath('eingabe.png'), fullPage: true });
  });

  test('image: preview, removal, recognition, correction and confirmation lead to a checked claim', async ({ page }) => {
    await openLive(page);
    await page.getByRole('tab', { name: /^Bild/ }).click();
    await expect(page.getByText('Screenshot oder Foto hierher ziehen')).toBeVisible();
    await page.locator('#image-file').setInputFiles(await file());
    await expect(page.getByAltText('Vorschau des ausgewählten Bildes')).toBeVisible();
    await expect(page.locator('.filename')).toHaveText('screenshot.png');
    await page.getByRole('button', { name: 'Bild entfernen' }).click();
    await expect(page.getByText('Screenshot oder Foto hierher ziehen')).toBeVisible();
    await page.locator('#image-file').setInputFiles(await file());
    expect(await a11y(page)).toEqual([]);
    await page.getByRole('button', { name: 'Text im Bild erkennen' }).click();
    const recognized = page.getByLabel('Erkannter Text – bitte prüfen und korrigieren');
    await expect(recognized).toHaveValue(MAUERFALL);
    await expect(page.getByText('Bitte prüfen, bevor es weitergeht.')).toBeVisible();
    // Nothing is evaluated until the user confirms; the screen is still the input screen.
    await expect(page.getByRole('heading', { name: 'Welche Aussage prüfen wir?' })).toHaveCount(0);
    await recognized.fill(MAUERFALL + ' (Quelle: Screenshot)');
    await page.getByRole('button', { name: /Text bestätigen und Behauptungen erkennen/ }).click();
    await expect(page.locator('.origin-note')).toContainText('hochgeladenen Bild');
    await confirmClaimAndWait(page);
    await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('.verdict .origin-note')).toContainText('aus einem hochgeladenen Bild erkannt');
    await expect(page.locator('.verdict .origin-note')).toContainText('korrigiert');
  });

  test('image: drag and drop works and an unreadable image gets a clear way forward', async ({ page, isMobile }) => {
    test.skip(Boolean(isMobile), 'Drag and drop is a desktop interaction.');
    await openLive(page);
    await page.getByRole('tab', { name: /^Bild/ }).click();
    const data = await file(200, 200, 'unleserlich.png');
    const transfer = await page.evaluateHandle(({ name, mimeType, bytes }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], name, { type: mimeType }));
      return dt;
    }, { name: data.name, mimeType: data.mimeType, bytes: [...data.buffer] });
    await page.locator('.dropzone').dispatchEvent('drop', { dataTransfer: transfer });
    await expect(page.locator('.filename')).toHaveText('unleserlich.png');
    await page.getByRole('button', { name: 'Text im Bild erkennen' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Kein Text erkannt.');
    await expect(alert).toContainText('kein lesbarer Text');
    await alert.getByRole('button', { name: 'den Text stattdessen einfügen' }).click();
    await expect(page.getByRole('tab', { name: /^Text/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('image: unsupported or invalid files are rejected with a specific message', async ({ page }) => {
    await openLive(page);
    await page.getByRole('tab', { name: /^Bild/ }).click();
    await page.locator('#image-file').setInputFiles({ name: 'notiz.txt', mimeType: 'text/plain', buffer: Buffer.from('kein Bild') });
    await expect(page.getByRole('alert')).toContainText('Dieses Dateiformat wird nicht unterstützt');
    await page.locator('#image-file').setInputFiles(await file(20, 20, 'winzig.png'));
    await page.getByRole('button', { name: 'Text im Bild erkennen' }).click();
    await expect(page.getByRole('alert')).toContainText('zu klein');
    await expect(page.getByRole('button', { name: 'Text im Bild erkennen' })).toBeVisible();
  });

  test('post link: the caption that was actually read is shown, editable and marked as input', async ({ page }) => {
    await openLive(page);
    await page.getByRole('tab', { name: /^Post-Link/ }).click();
    await expect(page.locator('#post-help')).toContainText('nur die öffentliche Beschreibung');
    await page.getByLabel('Link zu einem öffentlichen Beitrag').fill('https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789?utm=1');
    await page.getByRole('button', { name: 'Beitrag einlesen' }).click();
    await expect(page.getByText('Das wurde tatsächlich gelesen: die Beschreibung.')).toBeVisible();
    await expect(page.locator('.post-card')).toContainText('TikTok');
    await expect(page.locator('.post-card')).toContainText('@geschichte_kurz');
    await expect(page.locator('.notice.info')).toContainText('nicht ausgewertet');
    expect(await a11y(page)).toEqual([]);
    await expect(page.getByLabel(/Beschreibung des Beitrags/)).toHaveValue(/Berliner Mauer fiel am 9\. November 1989/);
    await page.getByRole('button', { name: /Text bestätigen und Behauptungen erkennen/ }).click();
    await expect(page.locator('.origin-note')).toContainText('kein unabhängiger Beleg');
    await confirmClaimAndWait(page);
    await expect(page.getByRole('heading', { name: 'Ergebnis mit Einschränkungen' })).toBeVisible({ timeout: 20_000 });
    const origin = page.locator('.verdict .origin-note');
    await expect(origin).toContainText('TikTok-Beitrag von @geschichte_kurz');
    await expect(origin).toContainText('kein unabhängiger Beleg');
    await expect(origin.getByRole('link', { name: /Beitrag öffnen/ })).toHaveAttribute('href', 'https://www.tiktok.com/@geschichte_kurz/video/7234567890123456789');
    await expect(page.locator('.evidence-card a[href*="tiktok.com"]')).toHaveCount(0);
  });

  test('post link: an inaccessible post offers screenshot or pasted text as the direct fallback', async ({ page }) => {
    await openLive(page);
    await page.getByRole('tab', { name: /^Post-Link/ }).click();
    await page.getByLabel('Link zu einem öffentlichen Beitrag').fill('https://www.instagram.com/p/GESPERRT1/');
    await page.getByRole('button', { name: 'Beitrag einlesen' }).click();
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Der Beitrag konnte nicht gelesen werden.');
    await expect(alert).toContainText('verlangt eine Anmeldung');
    await expect(alert).toContainText('TrustLens umgeht das nicht');
    await alert.getByRole('button', { name: 'Screenshot des Beitrags' }).click();
    await expect(page.getByRole('tab', { name: /^Bild/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByText('Screenshot oder Foto hierher ziehen')).toBeVisible();
  });

  test('post link: unsupported links are explained', async ({ page }) => {
    await openLive(page);
    await page.getByRole('tab', { name: /^Post-Link/ }).click();
    const input = page.getByLabel('Link zu einem öffentlichen Beitrag');
    await input.fill('https://www.instagram.com/stories/user/3012345678901234567/');
    await page.getByRole('button', { name: 'Beitrag einlesen' }).click();
    await expect(page.getByRole('alert')).toContainText('Stories, Profile und Suchseiten nicht');
    await input.fill('https://example.org/p/ABC123def/');
    await page.getByRole('button', { name: 'Beitrag einlesen' }).click();
    await expect(page.getByRole('alert')).toContainText('Instagram und TikTok');
  });
});


test('edited compound statements return to selection and start only the explicitly chosen claim',async({page})=>{
 const combined='Die aktuelle deutsche Regierung wird durch Lobbyverbände beeinflusst, sodass die Energiewende ausgebremst wird.';
 const causal='Der Einfluss von Lobbyverbänden auf die aktuelle deutsche Regierung bremst die Energiewende aus.';
 const submitted:unknown[]=[];
 page.on('request',request=>{if(new URL(request.url()).pathname==='/api/runs'&&request.method()==='POST')submitted.push(request.postDataJSON());});
 await openLive(page);await page.getByLabel('Dein Text').fill('Lobbyverbände beeinflussen die aktuelle deutsche Regierung.');
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await page.getByLabel('Zu prüfende Formulierung').fill(combined);
 await page.getByRole('button',{name:'Diese Aussage prüfen'}).click();
 await expect(page.getByRole('status')).toContainText('Wähle eine Teilbehauptung aus.');
 await expect(page.getByRole('radio')).toHaveCount(2);await expect(page.getByRole('alert')).toHaveCount(0);
 await expect(page.getByRole('group',{name:'Erkannte Behauptungen'})).toBeFocused();
 expect(submitted).toHaveLength(1);
 await page.getByRole('radio').nth(1).check();await expect(page.getByLabel('Zu prüfende Formulierung')).toHaveValue(causal);
 await page.getByRole('button',{name:'Diese Aussage prüfen'}).click();
 await expect(page.getByRole('heading',{name:'Ergebnis mit Einschränkungen'})).toBeVisible({timeout:20000});
 expect(submitted).toHaveLength(2);expect(submitted[1]).toMatchObject({claim:{id:'c2',normalizedText:causal}});
 await expect(page.locator('.verdict')).toContainText(causal);
});


test('an unclear claim can explicitly be researched without inventing its missing scope',async({page})=>{
 const text='Lobbyverbände beeinflussen diese Regierung.';
 const requests:unknown[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/runs'&&request.method()==='POST')requests.push(request.postDataJSON());});
 await openLive(page);await page.getByLabel('Dein Text').fill(text);await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await expect(page.getByText('Recherche mit offenen Bezügen')).toBeVisible();
 await page.getByRole('button',{name:'Trotzdem prüfen'}).click();
 await expect(page.getByRole('heading',{name:'Ergebnis mit Einschränkungen'})).toBeVisible({timeout:20000});
 expect(requests[0]).toMatchObject({claim:{normalizedText:text,checkability:'unclear',timeScope:null},allowUnclear:true});
 await expect(page.locator('.results')).toContainText('offene Bezüge');await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByText('Recherchehistorie & Laufgrenzen').click();await expect(page.locator('.history')).toContainText('Suche abgeschlossen');
});
test('a clarification response after editing offers research anyway instead of a dead end',async({page})=>{
 const requests:unknown[]=[];page.on('request',request=>{if(new URL(request.url()).pathname==='/api/runs'&&request.method()==='POST')requests.push(request.postDataJSON());});
 await openLive(page);await page.getByLabel('Dein Text').fill('Lobbyverbände beeinflussen die deutsche Regierung.');
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();await page.getByLabel('Zu prüfende Formulierung').fill('Lobbyverbände beeinflussen diese Regierung.');
 await page.getByRole('button',{name:'Diese Aussage prüfen'}).click();
 await expect(page.getByRole('button',{name:'Trotzdem prüfen'})).toBeVisible();await expect(page.getByRole('alert')).toHaveCount(0);
 await page.getByRole('button',{name:'Trotzdem prüfen'}).click();
 await expect(page.getByRole('heading',{name:'Ergebnis mit Einschränkungen'})).toBeVisible({timeout:20000});
 expect(requests).toHaveLength(2);expect(requests[1]).toMatchObject({allowUnclear:true});
});
