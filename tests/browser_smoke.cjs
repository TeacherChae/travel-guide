// Reuses an existing Playwright installation; this static site adds no npm dependency.
const assert = require('node:assert/strict');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({headless:true, ...(process.env.CHROMIUM_PATH ? {executablePath:process.env.CHROMIUM_PATH} : {})});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}, reducedMotion:'reduce'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    // Test our own UI deterministically, not Google availability or live routing.
    await page.route('https://**/*', route => route.abort());
    await page.goto(pathToFileURL(path.resolve(__dirname, '../index.html')).href);
    const data = await page.locator('#daily-budget-data').textContent().then(JSON.parse);
    const totals = () => page.locator('[data-budget-total]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.cents)));
    const baseline = Object.values(data.days).map(day => day.items.reduce((n, item) => n + (item.optional && !item.included ? 0 : item.cents), 0));
    assert.equal(data.admission_plan, 'carte-blanche-jeunes-duo');
    const membership = Object.values(data.days).flatMap(day => day.items)
      .filter(item => item.id === 'carte-blanche-jeunes-duo');
    assert.equal(membership.length, 1);
    assert.equal(membership[0].cents, 4000);
    assert.equal(membership[0].purchase_status, 'planned');
    assert.equal(data.days.p2.items.includes(membership[0]), true);
    assert.equal(data.days.p2.items.find(item => item.id === 'orangerie').cents, 0);
    assert.equal(data.days.p4.items.find(item => item.id === 'orsay').cents, 0);
    const selectedPass = page.locator('#pc tr', {has: page.locator('[data-pass-comparison="selected"]')});
    assert.equal(await selectedPass.count(), 1);
    assert.match(await selectedPass.textContent(), /Carte Blanche Jeunes Duo/);
    assert.doesNotMatch(await selectedPass.textContent(), /PMP/);
    assert.deepEqual(await totals(), baseline);
    assert.equal(await page.locator('[data-place-budget]').count(), Object.values(data.days).flatMap(day => day.items).filter(item => item.place).length);
    const frame = page.locator('#p1 .mapbox iframe');
    const frameParams = async () => new URL(await frame.getAttribute('src')).searchParams;
    const externalParams = async () => new URL(await page.locator('#p1 [data-open-map]').getAttribute('href')).searchParams;
    const expectedHome = '48.8484866,2.3540618';
    assert.equal((await frameParams()).get('dirflg'), 'r');
    await page.locator('#arrival-taxi-tab').click();
    assert.equal((await frameParams()).get('dirflg'), 'd');
    assert.equal((await externalParams()).get('travelmode'), 'driving');
    assert.equal((await externalParams()).get('destination'), expectedHome);
    assert.deepEqual(await totals(), [baseline[0] + 3700, ...baseline.slice(1)]);
    assert.equal(await page.locator('.panel:not([hidden])').count(), 1);
    await page.locator('#arrival-taxi-tab').click();
    assert.equal((await totals())[0], baseline[0] + 3700);
    // Airport detail must retain the chosen mode instead of falling back to RER.
    await page.locator('#p1 .stop[data-label="CDG → 5구 숙소"]').click();
    await page.locator('[data-place-map]').click();
    assert.equal((await frameParams()).get('dirflg'), 'd');
    await page.locator('#p1 [data-day-overview]').click();
    assert.equal((await frameParams()).get('saddr'), '49.0097,2.5479');
    assert.equal((await frameParams()).get('daddr').split(' to:').at(-1), expectedHome);
    await page.locator('#p1 [data-reset]').click();
    assert.equal((await frameParams()).get('daddr'), expectedHome);
    assert.equal((await frameParams()).get('dirflg'), 'd');
    await page.locator('#arrival-taxi-tab').press('ArrowLeft');
    assert.equal((await frameParams()).get('dirflg'), 'r');
    assert.equal((await externalParams()).get('travelmode'), 'transit');
    assert.equal(await page.locator('#arrival-rer-tab').getAttribute('tabindex'), '0');
    assert.equal(await page.locator('#arrival-taxi-tab').getAttribute('tabindex'), '-1');
    assert.deepEqual(await totals(), baseline);
    // Optional items add once, update cards and cost overview, and disappear on deselection.
    for (const [dayKey, id] of [['p3','gelato'], ['p5','impressionisms'], ['p7','pleincoeur']]) {
      await page.locator('.tabbar [aria-controls="'+dayKey+'"]').click();
      await page.locator('#'+dayKey+' .budget-details').evaluate(el => el.open = true);
      const item = data.days[dayKey].items.find(item => item.id === id);
      const checkbox = page.locator('[data-budget-toggle="'+id+'"]');
      const wasChecked = await checkbox.isChecked();
      await checkbox.setChecked(!wasChecked);
      const expected = baseline[Number(dayKey.slice(1))-1] + (wasChecked ? -item.cents : item.cents);
      assert.equal((await totals())[Number(dayKey.slice(1))-1], expected);
      const displayedTrip = Number(await page.locator('[data-trip-total]').getAttribute('data-cents'));
      assert.equal(displayedTrip, (await totals()).reduce((a,b) => a+b,0));
      assert.match(await page.locator('[data-place-budget="'+id+'"]').textContent(), wasChecked ? /선택 시 추가/ : /합계 포함/);
      await checkbox.setChecked(wasChecked);
    }
    // Revised Monday/Tuesday route contracts include dining cards and the new museums.
    const dayNodes = dayKey => page.locator(`#${dayKey} .stop[data-label], #${dayKey} .card[data-dining]`)
      .evaluateAll(nodes => nodes.map(node => node.dataset.label || node.dataset.dining));
    const mondayLabels = await dayNodes('p3');
    assert.deepEqual(mondayLabels, [
      '루브르', '옥동식 파리', 'Fer à Cheval', '퐁뇌프 · 센강 산책',
      '들라크루아 미술관', 'Bouillon Racine', 'Il Gelato del Marchese'
    ]);
    assert.match(await page.locator('#p3 .card[data-dining="Bouillon Racine"] .label').textContent(), /^18:30–19:45/);
    assert.match(await page.locator('#p3 .card[data-dining="Il Gelato del Marchese"] .label').textContent(), /^20:00–20:20/);
    assert.equal(await page.locator('#p3 .stop[data-label="바토 파리지앵"]').count(), 0);
    assert.equal(await page.locator('#p2 .stop[data-label="바토 파리지앵"] .time').textContent(), '21:00');
    assert.equal(data.days.p2.items.some(item => item.id === 'cruise'), true);
    assert.equal(data.days.p3.items.some(item => item.id === 'cruise'), false);
    const sundayStops = await page.locator('#p2 .stop[data-label]').evaluateAll(nodes => nodes.map(node => node.dataset.label));
    assert.deepEqual(sundayStops, ['노트르담', '오랑주리', '마르모탕 모네', '바토 파리지앵']);
    assert.equal(await page.locator('#p2 .stop[data-label="샹드마르스 · 에펠탑"]').count(), 0);
    assert.deepEqual(await dayNodes('p4'), [
      'Les Deux Magots', '로댕 미술관', '오르세 미술관'
    ]);
    assert.equal(await page.locator('#p4 .stop[data-label="샹드마르스 · 에펠탑"]').count(), 0);
    assert.equal(await page.locator('#p3 .stop[data-label="들라크루아 미술관"]').getAttribute('data-tier'), '1');
    assert.equal(await page.locator('#p4 .stop[data-label="로댕 미술관"]').count(), 1);
    for (const [dayKey, label] of [['p3', '들라크루아 미술관'], ['p4', '로댕 미술관']]) {
      await page.locator('.tabbar [aria-controls="'+dayKey+'"]').click();
      const stop = page.locator('#'+dayKey+' .stop[data-label="'+label+'"]');
      await stop.click();
      assert.equal(await page.locator('#place-dialog').isVisible(), true);
      assert.equal(await page.locator('#place-dialog-title').textContent(), label);
      await page.locator('#place-dialog [data-place-close]').first().click();
      assert.equal(await page.locator('#place-dialog').isVisible(), false);
    }
    await page.locator('.tabbar [aria-controls="p3"]').click();
    const mondayFrame = page.locator('#p3 .mapbox iframe');
    const mondayOverview = await mondayFrame.getAttribute('src');
    const diningSrc = await page.locator('#p3 .card[data-dining="옥동식 파리"]').getAttribute('data-src');
    assert.ok(diningSrc, 'dining card must expose its map source');
    await page.locator('#p3 .card[data-dining="옥동식 파리"] .show-dining-map').click();
    assert.equal(await mondayFrame.getAttribute('src'), diningSrc);
    await page.locator('#p3 [data-reset]').click();
    assert.equal(await mondayFrame.getAttribute('src'), mondayOverview);
    // Sticky map's containing block must end before daily budget, on mobile and desktop.
    for (const width of [320,390,1280]) {
      await page.setViewportSize({width,height:900});
      for (let day=1; day<=8; day++) {
        await page.locator('.tabbar [aria-controls="p'+day+'"]').click();
        const aside = page.locator('#p'+day+' .daily-budget');
        await aside.evaluate(el => el.scrollIntoView({block:'start'}));
        const geometry = await page.evaluate(day => {
          const budget=document.querySelector('#p'+day+' .daily-budget').getBoundingClientRect();
          const map=document.querySelector('#p'+day+' .mapbox').getBoundingClientRect();
          return {overlap:map.bottom > budget.top + 1, overflow:document.documentElement.scrollWidth > innerWidth};
        }, day);
        assert.equal(geometry.overlap, false, `Map covers p${day} budget at ${width}px`);
        assert.equal(geometry.overflow, false, `Horizontal overflow p${day} at ${width}px`);
      }
    }
    await page.locator('.tabbar [aria-controls="pc"]').click();
    assert.equal(await page.locator('#budget-summary-body tr').count(), 8);
    await page.locator('[data-budget-day="p1"] button').click();
    assert.equal(await page.locator('#p1').isVisible(), true);
    await page.reload();
    assert.deepEqual(await totals(), baseline);
    assert.deepEqual(errors, []);
    console.log('PASS: route modes, airport detail, overview/reset, keyboard, 8-day totals, optional rows, 320/390/1280px layout, reload; zero page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
