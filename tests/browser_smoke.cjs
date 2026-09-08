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
