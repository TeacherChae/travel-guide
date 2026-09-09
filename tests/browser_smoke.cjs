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
    const scenarioTotals = plan => Object.values(data.days).map(day => day.items.reduce((n, item) => {
      if (item.rodin_day && item.rodin_day !== plan) return n;
      if (item.optional && !item.included) return n;
      return n + item.cents;
    }, 0));
    const defaultTotals = scenarioTotals('friday');
    const sundayRodinTotals = scenarioTotals('sunday');
    const totals = () => page.locator('[data-budget-total]').evaluateAll(nodes => nodes.map(n => Number(n.dataset.cents)));
    const expectedHome = '48.8484866,2.3540618';
    const visibleLabels = dayKey => page.locator(`#${dayKey} .stop[data-label], #${dayKey} .card[data-dining]`)
      .evaluateAll(nodes => nodes.filter(node => node.offsetParent !== null).map(node => node.dataset.label || node.dataset.dining));

    assert.equal(data.admission_plan, 'carte-blanche-jeunes-duo');
    assert.equal(data.rodin_plan, 'friday');
    assert.equal(await page.locator('body').getAttribute('data-rodin-plan'), 'friday');
    const membership = Object.values(data.days).flatMap(day => day.items)
      .filter(item => item.id === 'carte-blanche-jeunes-duo');
    assert.equal(membership.length, 1);
    assert.equal(membership[0].cents, 4000);
    assert.equal(membership[0].purchase_status, 'planned');
    assert.equal(data.days.p3.items.includes(membership[0]), true);
    assert.equal(data.days.p3.items.find(item => item.id === 'orangerie').cents, 0);
    assert.equal(data.days.p4.items.find(item => item.id === 'orsay').cents, 0);
    assert.equal(data.days.p7.items.find(item => item.id === 'rodin-friday').cents, 2800);
    assert.equal(data.days.p2.items.find(item => item.id === 'rodin-sunday').cents, 2800);
    const selectedPass = page.locator('#pc tr', {has: page.locator('[data-pass-comparison="selected"]')});
    assert.equal(await selectedPass.count(), 1);
    assert.match(await selectedPass.textContent(), /Carte Blanche Jeunes Duo/);
    assert.doesNotMatch(await selectedPass.textContent(), /PMP/);
    assert.deepEqual(await totals(), defaultTotals);
    assert.deepEqual(defaultTotals, [11000,16820,19710,20630,28320,21110,20930,15420]);
    assert.deepEqual(sundayRodinTotals, [11000,19620,19710,20630,28320,21110,20130,15420]);

    // Arrival route tabs update map, external link and budget without affecting Rodin scenario.
    const frame = page.locator('#p1 .mapbox iframe');
    const frameParams = async () => new URL(await frame.getAttribute('src')).searchParams;
    const externalParams = async () => new URL(await page.locator('#p1 [data-open-map]').getAttribute('href')).searchParams;
    assert.equal((await frameParams()).get('dirflg'), 'r');
    await page.locator('#arrival-taxi-tab').click();
    assert.equal((await frameParams()).get('dirflg'), 'd');
    assert.equal((await externalParams()).get('travelmode'), 'driving');
    assert.equal((await externalParams()).get('destination'), expectedHome);
    assert.deepEqual(await totals(), [defaultTotals[0] + 3700, ...defaultTotals.slice(1)]);
    await page.locator('#arrival-taxi-tab').press('ArrowLeft');
    assert.equal((await frameParams()).get('dirflg'), 'r');
    assert.deepEqual(await totals(), defaultTotals);

    // Default route: Sunday festival stays open-ended; Friday contains the Rodin fallback.
    await page.locator('.tabbar [aria-controls="p2"]').click();
    assert.deepEqual(await visibleLabels('p2'), ['노트르담', '생트샤펠', 'La Fête de Paris', '바토 파리지앵']);
    assert.equal(await page.locator('#p2 .stop[data-label="로댕 미술관"]').isVisible(), false);
    let p2Params = new URL(await page.locator('#p2 .mapbox iframe').getAttribute('src')).searchParams;
    assert.equal(p2Params.get('dirflg'), 'w');
    assert.doesNotMatch(p2Params.get('daddr'), /2\.3158354/);
    assert.equal(new URL(await page.locator('#p2 [data-open-map]').getAttribute('href')).searchParams.get('travelmode'), 'walking');
    assert.match(await page.locator('#p2').textContent(), /18시까지 반드시 머물 필요는 없습니다/);
    assert.match(await page.locator('#p2').textContent(), /생트샤펠은 현재 정기 미사/);
    assert.equal(await page.locator('#p2 .stop[data-label="바토 파리지앵"] .time').textContent(), '21:00 목표');
    const cruise = data.days.p2.items.find(item => item.id === 'cruise');
    assert.equal(cruise.cents, 0);
    assert.equal(cruise.purchase_status, 'paid');
    assert.equal(cruise.paid_currency, 'KRW');
    assert.equal(cruise.paid_amount, 27052);
    assert.match(await page.locator('#p2 .stop[data-label="바토 파리지앵"] [data-place-budget]').textContent(), /₩27,052/);

    await page.locator('.tabbar [aria-controls="p7"]').click();
    assert.deepEqual(await visibleLabels('p7'), ['로댕 미술관', '풀만 체크인', '트로카데로 광장', 'Le Café du Commerce']);
    assert.equal(await page.locator('#p7 .stop[data-label="몽소 공원"]').isVisible(), false);
    let p7Params = new URL(await page.locator('#p7 .mapbox iframe').getAttribute('src')).searchParams;
    assert.equal(p7Params.get('dirflg'), 'w');
    assert.match(p7Params.get('daddr'), /2\.3158354/);
    assert.equal(new URL(await page.locator('#p7 [data-open-map]').getAttribute('href')).searchParams.get('travelmode'), 'walking');

    // Switching to Sunday Rodin synchronizes both control groups, maps, budget and visible routes.
    await page.locator('#p2 [data-rodin-choice][value="sunday"]').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', {bubbles:true})); });
    assert.equal(await page.locator('body').getAttribute('data-rodin-plan'), 'sunday');
    assert.equal(await page.locator('[data-rodin-choice][value="sunday"]:checked').count(), 2);
    assert.equal(await page.locator('[data-rodin-choice][value="friday"]:checked').count(), 0);
    assert.deepEqual(await totals(), sundayRodinTotals);
    await page.locator('.tabbar [aria-controls="p2"]').click();
    assert.deepEqual(await visibleLabels('p2'), ['노트르담', '생트샤펠', 'La Fête de Paris', '로댕 미술관', '바토 파리지앵']);
    p2Params = new URL(await page.locator('#p2 .mapbox iframe').getAttribute('src')).searchParams;
    assert.equal(p2Params.get('dirflg'), 'w');
    assert.match(p2Params.get('daddr'), /2\.3158354/);
    await page.locator('#p2 [data-reset]').click();
    assert.match(new URL(await page.locator('#p2 .mapbox iframe').getAttribute('src')).searchParams.get('daddr'), /2\.3158354/);
    await page.locator('.tabbar [aria-controls="p7"]').click();
    assert.deepEqual(await visibleLabels('p7'), ['몽소 공원', 'Pleincœur', '풀만 체크인', '트로카데로 광장', 'Le Café du Commerce']);
    assert.equal(await page.locator('#p7 .stop[data-label="로댕 미술관"]').isVisible(), false);
    p7Params = new URL(await page.locator('#p7 .mapbox iframe').getAttribute('src')).searchParams;
    assert.equal(p7Params.get('dirflg'), 'w');
    assert.doesNotMatch(p7Params.get('daddr'), /2\.3158354/);

    // Optional items add once, update cards and cost overview, and disappear on deselection.
    for (const [dayKey, id, scenario] of [['p3','gelato','sunday'], ['p5','impressionisms','sunday'], ['p7','pleincoeur','sunday']]) {
      await page.locator('.tabbar [aria-controls="'+dayKey+'"]').click();
      await page.locator('#'+dayKey+' .budget-details').evaluate(el => el.open = true);
      const item = data.days[dayKey].items.find(item => item.id === id);
      const checkbox = page.locator('[data-budget-toggle="'+id+'"]');
      const wasChecked = await checkbox.isChecked();
      await checkbox.setChecked(!wasChecked);
      const expected = scenarioTotals(scenario)[Number(dayKey.slice(1))-1] + (wasChecked ? -item.cents : item.cents);
      assert.equal((await totals())[Number(dayKey.slice(1))-1], expected);
      const displayedTrip = Number(await page.locator('[data-trip-total]').getAttribute('data-cents'));
      assert.equal(displayedTrip, (await totals()).reduce((a,b) => a+b,0));
      assert.equal(await page.locator('[data-trip-total]').getAttribute('data-krw'), '27052');
      assert.match(await page.locator('[data-place-budget="'+id+'"]').textContent(), wasChecked ? /선택 시 추가/ : /합계 포함/);
      await checkbox.setChecked(wasChecked);
    }

    // Revised route contracts include dining cards and the new museums.
    await page.locator('.tabbar [aria-controls="p3"]').click();
    assert.deepEqual(await visibleLabels('p3'), [
      '오랑주리', '옥동식 파리', 'Fer à Cheval', '퐁뇌프 · 센강 산책',
      'Bouillon Racine', 'Il Gelato del Marchese'
    ]);
    assert.equal(await page.locator('#p3 .stop[data-label="들라크루아 미술관"]').count(), 0);
    assert.match(await page.locator('#p3 .card[data-dining="Bouillon Racine"] .label').textContent(), /^18:30–19:45/);
    const mondayFrame = page.locator('#p3 .mapbox iframe');
    const mondayOverview = await mondayFrame.getAttribute('src');
    const diningSrc = await page.locator('#p3 .card[data-dining="옥동식 파리"]').getAttribute('data-src');
    await page.locator('#p3 .card[data-dining="옥동식 파리"] .show-dining-map').click();
    assert.equal(await mondayFrame.getAttribute('src'), diningSrc);
    await page.locator('#p3 [data-reset]').click();
    assert.equal(await mondayFrame.getAttribute('src'), mondayOverview);
    assert.deepEqual(await visibleLabels('p4'), []); // hidden panel sanity; click before checking below.
    await page.locator('.tabbar [aria-controls="p4"]').click();
    assert.deepEqual(await visibleLabels('p4'), ['Les Deux Magots', '마르모탕 모네', '오르세 미술관']);
    assert.equal(await page.locator('#p4 .stop[data-label="로댕 미술관"]').count(), 0);
    await page.locator('.tabbar [aria-controls="p6"]').click();
    assert.deepEqual(await visibleLabels('p6'), ['루브르', '들라크루아 미술관']);
    assert.equal(await page.locator('#p6 .stop[data-label="들라크루아 미술관"]').getAttribute('data-tier'), '1');

    for (const [dayKey, label] of [['p6', '들라크루아 미술관'], ['p7', '몽소 공원']]) {
      await page.locator('.tabbar [aria-controls="'+dayKey+'"]').click();
      const stop = page.locator('#'+dayKey+' .stop[data-label="'+label+'"]');
      await stop.click();
      assert.equal(await page.locator('#place-dialog').isVisible(), true);
      assert.equal(await page.locator('#place-dialog-title').textContent(), label);
      await page.locator('#place-dialog [data-place-close]').first().click();
      assert.equal(await page.locator('#place-dialog').isVisible(), false);
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

    // Return to default and verify reload/reset.
    await page.locator('#p7 [data-rodin-choice][value="friday"]').evaluate(input => { input.checked = true; input.dispatchEvent(new Event('change', {bubbles:true})); });
    assert.equal(await page.locator('[data-rodin-choice][value="friday"]:checked').count(), 2);
    assert.deepEqual(await totals(), defaultTotals);
    await page.locator('.tabbar [aria-controls="pc"]').click();
    assert.equal(await page.locator('#budget-summary-body tr').count(), 8);
    assert.equal(await page.locator('[data-budget-day="p2"] [data-summary-total]').getAttribute('data-krw'), '27052');
    assert.match(await page.locator('[data-budget-day="p2"] [data-summary-total]').textContent(), /₩27,052/);
    assert.equal(await page.locator('[data-trip-total]').getAttribute('data-krw'), '27052');
    await page.locator('[data-budget-day="p1"] button').click();
    assert.equal(await page.locator('#p1').isVisible(), true);
    await page.reload();
    assert.equal(await page.locator('body').getAttribute('data-rodin-plan'), 'friday');
    assert.deepEqual(await totals(), defaultTotals);
    assert.equal(await page.locator('[data-trip-total]').getAttribute('data-krw'), '27052');
    assert.deepEqual(errors, []);
    console.log('PASS: flexible Rodin scenario, route maps/reset, airport taxi, paid KRW cruise, optional rows, 320/390/1280px layout, reload; zero page errors.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode=1; });
