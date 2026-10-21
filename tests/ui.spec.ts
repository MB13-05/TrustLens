import {test,expect} from '@playwright/test';

async function startExample(page:import('@playwright/test').Page,example:string){
 await page.goto('/');
 await page.getByRole('button',{name:`Beispiel: ${example}`}).click();
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await expect(page.getByRole('heading',{name:'Welche Aussage prüfen wir?'})).toBeVisible();
 await expect(page.getByRole('radio')).toHaveCount(1);
 await page.getByRole('button',{name:'Diese Aussage prüfen'}).click();
}

test('synthetic context demo links every reasoning item to registered evidence',async({page})=>{
 await startExample(page,'Kontext fehlt ↗');
 await expect(page.getByRole('heading',{name:'Einordnung mit Belegen.'})).toBeVisible();
 await expect(page.locator('.verdict-label')).toHaveText('◈Kontext fehlt');
 await expect(page.locator('.mode-banner')).toContainText('Synthetische Demo');
 await expect(page.locator('.verdict')).toContainText('FIKTIVE QUELLEN');
 const references=page.locator('.references a');
 expect(await references.count()).toBeGreaterThan(0);
 for(const link of await references.all()){
  const href=await link.getAttribute('href');
  await expect(page.locator(href!)).toHaveCount(1);
 }
 await expect(page.locator('.source').first()).toContainText('Veröffentlicht');
 await expect(page.getByRole('heading',{name:'Was offenbleibt'})).toBeVisible();
 await page.getByText('Recherchehistorie & Laufgrenzen').click();
 await expect(page.locator('.history')).toContainText('Runden: 2');
 await expect(page.locator('.history .timeline')).toContainText(/Nachrecherche|Weitere|gezielt/i);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:`/tmp/trustlens-${test.info().project.name}-result.png`,fullPage:true});
 await page.getByRole('button',{name:'Neue Prüfung'}).click();
 await expect(page.getByRole('heading',{name:'Was möchtest du überprüfen?'})).toBeFocused();
 await page.screenshot({path:`/tmp/trustlens-${test.info().project.name}-input.png`,fullPage:true});
});

test('insufficient demo remains ungeklärt',async({page})=>{
 await startExample(page,'Ungeklärt ↗');
 await expect(page.getByRole('heading',{name:'Einordnung mit Belegen.'})).toBeVisible();
 await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
 await expect(page.locator('.limitations')).toContainText('Fehlende Bestätigung allein widerlegt eine Aussage nicht.');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});

test('empty and unsupported demo input produce useful recoverable errors',async({page})=>{
 await page.goto('/');
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await expect(page.getByRole('alert')).toContainText('Bitte gib zuerst einen Text ein.');
 await page.getByLabel('Dein Text').fill('Diese eigene Aussage ist keine vorbereitete Demo.');
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await expect(page.getByRole('alert')).toContainText('vorbereiteten Beispiele');
 await page.getByRole('button',{name:'Beispiel: Kontext fehlt ↗'}).click();
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await expect(page.getByRole('heading',{name:'Welche Aussage prüfen wir?'})).toBeVisible();
});

test('run failure is displayed and can be restarted',async({page})=>{
 await page.route('**/api/runs',async route=>{
  const response=await route.fetch();const run=await response.json();
  await route.fulfill({response,json:{...run,status:'failed',error:'Der Suchdienst ist derzeit nicht erreichbar.',result:null}});
 });
 await startExample(page,'Kontext fehlt ↗');
 await expect(page.getByRole('heading',{name:'Recherche fehlgeschlagen'})).toBeVisible();
 await expect(page.getByText('Der Suchdienst ist derzeit nicht erreichbar.')).toBeVisible();
 await page.getByRole('button',{name:'Erneut beginnen'}).click();
 await expect(page.getByRole('heading',{name:'Was möchtest du überprüfen?'})).toBeVisible();
});

test('poll failure offers retry and cancellation remains available',async({page})=>{
 let fail=true;
 await page.route('**/api/runs/*',async route=>{
  if(route.request().method()==='GET'&&fail){await route.fulfill({status:503,json:{error:'Status ist vorübergehend nicht erreichbar.'}});return;}
  await route.continue();
 });
 await startExample(page,'Kontext fehlt ↗');
 await expect(page.getByRole('button',{name:'Status erneut laden'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Recherche abbrechen'})).toBeVisible();
 fail=false;
 await page.getByRole('button',{name:'Status erneut laden'}).click();
 await expect(page.getByRole('heading',{name:'Einordnung mit Belegen.'})).toBeVisible();
});


test('unavailable registered sources remain visible without invented evidence',async({page})=>{
 await page.goto('/');
 await page.getByLabel('Dein Text').fill('Die Lindenstädter Solaranlage hat im Jahr 2025 genau 900 Megawattstunden erzeugt.');
 await page.getByRole('button',{name:'Behauptungen erkennen'}).click();
 await page.getByRole('button',{name:'Diese Aussage prüfen'}).click();
 await expect(page.getByRole('heading',{name:'Einordnung mit Belegen.'})).toBeVisible();
 const unavailable=page.locator('.source').filter({hasText:'Nicht zugänglich'});
 await expect(unavailable).toHaveCount(1);
 await expect(unavailable.locator('blockquote')).toHaveCount(0);
 await expect(page.locator('.verdict-label')).toHaveText('?Ungeklärt');
});

test('active research can be cancelled and restarted',async({page})=>{
 const pending={id:'cancel-ui-test',mode:'demo',status:'researching',createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+1800000).toISOString(),deadlineAt:new Date(Date.now()+90000).toISOString(),counters:{model:1,search:0,fetch:0,rounds:0},events:[],result:null,error:null};
 await page.route('**/api/runs',route=>route.fulfill({status:201,json:pending}));
 await page.route('**/api/runs/cancel-ui-test',route=>route.fulfill({json:pending}));
 await page.route('**/api/runs/cancel-ui-test/cancel',route=>route.fulfill({json:{...pending,status:'cancelled'}}));
 await startExample(page,'Kontext fehlt ↗');
 await page.getByRole('button',{name:'Recherche abbrechen'}).click();
 await expect(page.getByRole('heading',{name:'Recherche abgebrochen'})).toBeVisible();
 await page.getByRole('button',{name:'Erneut beginnen'}).click();
 await expect(page.getByRole('heading',{name:'Was möchtest du überprüfen?'})).toBeVisible();
});
