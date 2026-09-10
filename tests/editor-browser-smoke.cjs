// Deterministic current-app CRUD smoke test.  It deliberately uses a tiny
// localStorage fixture instead of the public seed so route adjacency and
// destructive operations are independent of the travel plan.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/home/keonheechae/TeacherChae.github.io/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROMIUM = process.env.CHROMIUM_PATH || '/home/keonheechae/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome';
const STORAGE_KEY = 'travel-guide.places.v1';
const MAPS_KEY = 'travel-guide.maps-api-key.v1';
const TIME_ZONE = 'Europe/Paris';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

function mapUrl(name) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(name);
}

function place(id, name, hour, day = '2026-09-14', maps = mapUrl(name)) {
  return {
    id,
    Name: name,
    'Date&Time': {start: `${day}T${String(hour).padStart(2, '0')}:00:00.000Z`, end: null},
    'Reservation Status': '',
    Reservation: '',
    'Total Fee': null,
    'Pay per Each': null,
    EA: null,
    Priority: '',
    Category: '',
    URL: '',
    Maps: maps,
    memo: '',
  };
}

function fixture({crossDay = false} = {}) {
  return [
    place('fixture-a', 'Alpha', 8),
    place('fixture-b', 'Bravo', 10),
    place('fixture-c', 'Charlie', 12, crossDay ? '2026-09-15' : '2026-09-14'),
  ];
}

function backup(places) {
  return {version: 1, timeZone: TIME_ZONE, places};
}

async function createServer() {
  const server = http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const relative = pathname.replace(/^\/+/, '') || 'index.html';
    const file = path.resolve(ROOT, relative);
    if (!file.startsWith(ROOT + path.sep) && file !== ROOT) {
      response.writeHead(403); response.end('forbidden'); return;
    }
    fs.readFile(file, (error, data) => {
      if (error) { response.writeHead(error.code === 'ENOENT' ? 404 : 500); response.end(error.code); return; }
      response.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream'});
      response.end(data);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {server, origin: `http://127.0.0.1:${address.port}`};
}

async function newAppPage(browser, data) {
  const page = await browser.newPage({viewport: {width: 390, height: 900}, reducedMotion: 'reduce'});
  await page.addInitScript(({storageKey, value}) => {
    if (window.top !== window) return;
    // Session storage survives reloads, so initialization is one-shot.  This
    // is important: reload must prove persistence rather than reseed data.
    if (sessionStorage.getItem('editor-browser-test-initialized') !== '1') {
      localStorage.clear();
      sessionStorage.clear();
      localStorage.setItem(storageKey, JSON.stringify(value));
      sessionStorage.setItem('editor-browser-test-initialized', '1');
    }
  }, {storageKey: STORAGE_KEY, value: backup(data)});
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') return route.continue();
    return route.abort();
  });
  return page;
}

async function openApp(page, origin) {
  await page.goto(`${origin}/index.html`);
  await selectDay(page, '2026-09-14');
  await page.locator('#places-list [data-place-id]').first().waitFor({state: 'visible'});
}

function cards(page) { return page.locator('#places-list [data-place-id]'); }
function card(page, id) { return page.locator(`#places-list [data-place-id="${id}"]`); }

async function clickAction(target, kind) {
  const attrs = kind === 'edit'
    ? '[data-edit-place], [data-action="edit"]'
    : '[data-delete-place], [data-action="delete"]';
  const button = target.locator(attrs).first();
  if (await button.count()) { await button.click(); return; }
  const label = kind === 'edit' ? /수정|편집|edit/i : /삭제|delete/i;
  await target.getByRole('button', {name: label}).first().click();
}

async function selectDay(page, value) {
  const direct = page.locator(`#day-tabs [data-day="${value}"], #day-tabs [data-day-key="${value}"], #day-tabs [data-date="${value}"]`).first();
  if (await direct.count()) { await direct.click(); return; }
  const wanted = value.slice(5).replace(/^0/, '').replace('-0', '-');
  const buttons = page.locator('#day-tabs button');
  for (let i = 0; i < await buttons.count(); i += 1) {
    const text = await buttons.nth(i).textContent();
    if (text && (text.includes(wanted) || text.includes(value))) { await buttons.nth(i).click(); return; }
  }
  throw new Error(`No day tab for ${value}`);
}

async function routeCount(page) {
  const routes = page.locator('.route-tab[data-from-id][data-to-id]');
  return routes.count();
}

async function routeText(page) {
  const routes = page.locator('.route-tab[data-from-id][data-to-id]');
  return routes.allTextContents();
}

async function assertInterleaved(page, placeCount, routeCountExpected) {
  const nodes = page.locator('.place-card, .route-tab[data-from-id][data-to-id]');
  const sequence = await nodes.evaluateAll((items) => items.map((item) => item.classList.contains('route-tab') ? 'route' : 'place'));
  const expected = [];
  for (let i = 0; i < placeCount; i += 1) {
    expected.push('place');
    if (i < routeCountExpected) expected.push('route');
  }
  assert.deepEqual(sequence, expected);
}

async function openAdd(page) {
  await page.locator('#add-place').click();
  await page.locator('#place-editor').waitFor({state: 'visible'});
}

async function fillForm(page, {name, localStart, maps, localEnd = '', memo = '', url = '', optional = {}}) {
  await page.locator('#place-name').fill(name);
  await page.locator('#place-start').fill(localStart);
  if (localEnd) await page.locator('#place-end').fill(localEnd);
  await page.locator('#place-maps').fill(maps);
  await page.locator('#place-memo').fill(memo);
  await page.locator('#place-url').fill(url);
  for (const [id, value] of Object.entries({
    'place-category': optional.Category,
    'place-priority': optional.Priority,
    'place-reservation-status': optional['Reservation Status'],
    'place-reservation': optional.Reservation,
    'place-total-fee': optional['Total Fee'],
    'place-unit-fee': optional['Pay per Each'],
    'place-quantity': optional.EA,
  })) {
    if (value !== undefined) await page.locator(`#${id}`).fill(String(value));
  }
}

async function saveForm(page) {
  await page.locator('#save-place').click();
  await page.locator('#place-editor').waitFor({state: 'hidden'});
}

async function closeDialog(page, id) {
  const dialog = page.locator(`#${id}`);
  if (!(await dialog.isVisible())) return;
  const close = dialog.locator('[data-close-dialog]').first();
  if (await close.count()) await close.click();
  else await page.keyboard.press('Escape');
  await dialog.waitFor({state: 'hidden'});
}

async function deleteWith(page, id, accept) {
  await clickAction(card(page, id), 'delete');
  await page.locator('#confirm-dialog').waitFor({state: 'visible'});
  assert.match(await page.locator('#confirm-message').textContent(), new RegExp(id === 'fixture-b' ? 'Bravo' : '.+'));
  await page.locator(accept ? '#confirm-accept' : '#confirm-cancel').click();
  await page.locator('#confirm-dialog').waitFor({state: 'hidden'});
}

async function setStorageAndReload(page, value) {
  await page.evaluate(({storageKey, next}) => localStorage.setItem(storageKey, JSON.stringify(next)), {storageKey: STORAGE_KEY, next: backup(value)});
  await page.reload();
  await selectDay(page, '2026-09-14');
  await page.locator('#places-list [data-place-id]').first().waitFor({state: 'visible'});
}

async function importFile(page, filename, content) {
  await page.locator('#import-file').setInputFiles({name: filename, mimeType: 'application/json', buffer: Buffer.from(content)});
  await page.waitForFunction(() => document.querySelector('#status-banner')?.textContent.includes('읽었습니다'));
  await page.locator('#import-places').click();
  const confirm = page.locator('#confirm-dialog');
  if (await confirm.isVisible()) {
    await page.locator('#confirm-accept').click();
    await confirm.waitFor({state: 'hidden'});
  }
}

async function downloadText(download) {
  const file = await download.path();
  return fsp.readFile(file, 'utf8');
}

async function assertNoOverflow(page, width) {
  await page.setViewportSize({width, height: 900});
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `horizontal overflow at ${width}px`);
}

(async () => {
  const {server, origin} = await createServer();
  const browser = await chromium.launch({headless: true, executablePath: CHROMIUM});
  const page = await newAppPage(browser, fixture());
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  try {
    await openApp(page, origin);
    assert.equal(await cards(page).count(), 3);
    assert.deepEqual(await card(page, 'fixture-a').locator('dt').allTextContents(), [
      'Date&Time', 'Reservation Status', 'Reservation', 'Total Fee', 'Pay per Each',
      'EA', 'Priority', 'Category', 'URL', 'Maps',
    ]);
    assert.equal(await card(page, 'fixture-a').locator('dt').filter({hasText: 'Payment'}).count(), 0);
    assert.equal(await routeCount(page), 2);
    await assertInterleaved(page, 3, 2);
    const initialRoutes = await routeText(page);
    assert.match(initialRoutes[0], /Alpha.*Bravo/);
    assert.match(initialRoutes[1], /Bravo.*Charlie/);
    await page.locator('.route-tab[data-from-id="fixture-b"]').click();
    assert.equal(await page.locator('.route-tab[aria-pressed="true"]').count(), 1);
    assert.equal(await page.locator('.route-tab[data-from-id="fixture-b"]').getAttribute('aria-pressed'), 'true');
    const selectedMap = new URL(await page.locator('#day-map-frame').getAttribute('src'));
    assert.equal(selectedMap.searchParams.get('saddr'), 'Bravo');
    assert.equal(selectedMap.searchParams.get('daddr'), 'Charlie');
    await card(page, 'fixture-a').locator('[data-action="map"]').click();
    assert.equal(await page.locator('.route-tab[aria-pressed="true"]').count(), 0);
    assert.equal(new URL(await page.locator('#day-map-frame').getAttribute('src')).searchParams.get('q'), 'Alpha');

    // Required fields fail together; optional properties may remain blank.
    await openAdd(page);
    await page.locator('#save-place').click();
    assert.match(await page.locator('#form-errors').textContent(), /Name|Name is required/);
    assert.match(await page.locator('#form-errors').textContent(), /Date|Date&Time/);
    assert.match(await page.locator('#form-errors').textContent(), /Maps/);
    await fillForm(page, {name: 'Delta', localStart: '2026-09-14T11:00', maps: mapUrl('Delta')});
    await page.locator('#place-unit-fee').fill('12.5');
    await page.locator('#place-quantity').fill('2');
    assert.match(await page.locator('#fee-preview').textContent(), /25/);
    await page.locator('#place-total-fee').fill('0');
    assert.match(await page.locator('#fee-preview').textContent(), /0/);
    await page.locator('#place-total-fee').fill('');
    await page.locator('#place-unit-fee').fill('');
    await page.locator('#place-quantity').fill('');
    await saveForm(page);
    const delta = page.locator('#places-list [data-place-id]').filter({hasText: 'Delta'}).first();
    assert.equal(await delta.count(), 1);
    const deltaId = await delta.getAttribute('data-place-id');
    assert.equal(await cards(page).count(), 4);
    assert.equal(await routeCount(page), 3);
    await assertInterleaved(page, 4, 3);
    const storedAfterCreate = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), STORAGE_KEY);
    const savedDelta = storedAfterCreate.places.find((item) => item.Name === 'Delta');
    assert.equal(savedDelta['Total Fee'], null);
    assert.equal(savedDelta['Pay per Each'], null);
    assert.equal(savedDelta.EA, null);
    assert.equal(savedDelta.memo, '');

    // Editing name/date/maps changes order, destination data and adjacency.
    await clickAction(card(page, 'fixture-b'), 'edit');
    await page.locator('#place-name').fill('Bravo Renamed');
    await page.locator('#place-start').fill('2026-09-14T13:00');
    await page.locator('#place-maps').fill(mapUrl('Bravo Renamed'));
    await page.locator('#place-unit-fee').fill('12.5');
    await page.locator('#place-quantity').fill('2');
    await saveForm(page);
    assert.equal(await page.locator('#places-list').getByText('Bravo', {exact: true}).count(), 0);
    assert.equal(await page.locator('#places-list').getByText('Bravo Renamed', {exact: true}).count(), 1);
    assert.match(await card(page, 'fixture-b').textContent(), /€25\.00/);
    assert.equal(await routeCount(page), 3);
    const routesAfterEdit = (await routeText(page)).join(' | ');
    assert.match(routesAfterEdit, /Delta/);
    assert.match(routesAfterEdit, /Bravo Renamed/);

    // The enabled Maps path is exercised with a local provider stub.  This
    // proves the editor accepts a Places result without making a live Google
    // request and that the selected map is applied to the form.
    await openAdd(page);
    await page.evaluate((key) => sessionStorage.setItem(key, 'AIza-test-key-is-not-a-live-request'), MAPS_KEY);
    await page.evaluate((maps) => {
      window.TravelMapPicker = {
        mount: async function (options) {
          options.onSelect({name: 'Stub Place', maps: maps, address: 'Stub address'});
          return {destroy: function () {}};
        },
      };
    }, mapUrl('Stub Place'));
    await page.locator('#open-map-picker').click();
    await page.locator('#map-picker').waitFor({state: 'visible'});
    await page.locator('#picker-selection').waitFor({state: 'visible'});
    assert.match(await page.locator('#picker-selection').textContent(), /Stub Place/);
    assert.equal(await page.locator('#apply-map').isDisabled(), false);
    await page.locator('#apply-map').click();
    await page.locator('#map-picker').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#place-maps').inputValue(), mapUrl('Stub Place'));
    assert.equal(await page.locator('#place-name').inputValue(), 'Stub Place');
    await closeDialog(page, 'place-editor');
    await page.evaluate((key) => sessionStorage.removeItem(key), MAPS_KEY);

    // Keyless local saved-place search and picker cancel are deterministic.
    await openAdd(page);
    await page.locator('#open-map-picker').click();
    await page.locator('#map-picker').waitFor({state: 'visible'});
    await page.locator('#picker-search').fill('Bravo Renamed');
    const savedPlace = (await page.evaluate((key) => JSON.parse(localStorage.getItem(key)).places, STORAGE_KEY))
      .find((item) => item.Name === 'Bravo Renamed');
    const savedResult = page.locator('#picker-results button').filter({hasText: 'Bravo Renamed'}).first();
    assert.equal(await savedResult.count(), 1);
    await savedResult.click();
    assert.match(await page.locator('#picker-selection').textContent(), /Bravo Renamed/);
    await page.locator('#apply-map').click();
    await page.locator('#map-picker').waitFor({state: 'hidden'});
    assert.equal(await page.locator('#place-maps').inputValue(), savedPlace.Maps);
    await page.locator('#open-map-picker').click();
    await page.locator('#picker-manual-url').fill(mapUrl('Different place'));
    await page.locator('#preview-map-url').click();
    await closeDialog(page, 'map-picker');
    assert.equal(await page.locator('#place-maps').inputValue(), savedPlace.Maps);
    await closeDialog(page, 'place-editor');

    // Escape must clean up an old confirmation callback.  Accepting the next
    // confirmation deletes only its newly selected (middle) place.
    await clickAction(card(page, 'fixture-a'), 'delete');
    await page.locator('#confirm-dialog').waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#confirm-dialog').waitFor({state: 'hidden'});
    await deleteWith(page, deltaId, true);
    assert.equal(await cards(page).count(), 3);
    assert.equal(await card(page, 'fixture-a').count(), 1);
    assert.equal(await card(page, 'fixture-b').count(), 1);
    assert.equal(await routeCount(page), 2);
    await assertInterleaved(page, 3, 2);
    await deleteWith(page, 'fixture-a', false);
    assert.equal(await cards(page).count(), 3);
    await deleteWith(page, 'fixture-a', true);
    assert.equal(await cards(page).count(), 2);
    assert.equal(await routeCount(page), 1);
    await assertInterleaved(page, 2, 1);
    await deleteWith(page, 'fixture-c', true);
    assert.equal(await cards(page).count(), 1);
    assert.equal(await routeCount(page), 0);
    await assertInterleaved(page, 1, 0);
    await deleteWith(page, 'fixture-b', true);
    assert.equal(await cards(page).count(), 0);
    assert.equal(await routeCount(page), 0);
    await assertInterleaved(page, 0, 0);
    assert.equal(await page.locator('#places-list .empty-state').isVisible(), true);

    // Reload keeps the deletion (and the empty state) instead of reseeding.
    const afterDeleteStore = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    await page.reload();
    await selectDay(page, '2026-09-14');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), afterDeleteStore);
    assert.equal(await page.locator('#places-list .empty-state').isVisible(), true);

    // Invalid import rolls back; valid import replaces the whole collection.
    const beforeBadImport = await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    await importFile(page, 'bad.json', '{not-json');
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), beforeBadImport);
    assert.match(await page.locator('#status-banner').textContent(), /오류|실패|유효|JSON|가져오지 못/i);
    await importFile(page, 'bad-time-zone.json', JSON.stringify({version: 1, timeZone: 'Not/AZone', places: [place('invalid-tz', 'Invalid timezone', 8)]}));
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), beforeBadImport);
    // Selecting an import and then changing the actual store (without a
    // storage event) must trigger the stale-write guard at confirmation time.
    const newer = [place('newer-a', 'Newer data', 8)];
    const newerRaw = JSON.stringify(backup(newer));
    await page.locator('#import-file').setInputFiles({name: 'stale.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(backup([place('stale-a', 'Stale candidate', 8)])))});
    await page.waitForFunction(() => document.querySelector('#status-banner')?.textContent.includes('읽었습니다'));
    await page.evaluate(({key, raw}) => localStorage.setItem(key, raw), {key: STORAGE_KEY, raw: newerRaw});
    await page.locator('#import-places').click();
    await page.locator('#confirm-dialog').waitFor({state: 'visible'});
    await page.locator('#confirm-accept').click();
    await page.locator('#confirm-dialog').waitFor({state: 'hidden'});
    assert.equal(await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), newerRaw);
    assert.match(await page.locator('#status-banner').textContent(), /다른 탭|새로고침|변경|취소|최신/i);
    await page.reload();
    await selectDay(page, '2026-09-14');
    await page.locator('#places-list [data-place-id]').first().waitFor({state: 'visible'});
    const replacement = [place('replacement-a', 'Replacement A', 8), place('replacement-b', 'Replacement B', 10)];
    await importFile(page, 'good.json', JSON.stringify(backup(replacement)));
    await selectDay(page, '2026-09-14');
    assert.equal(await cards(page).count(), 2);
    assert.equal(await page.locator('#places-list').getByText('Replacement A', {exact: true}).count(), 1);
    assert.equal(await routeCount(page), 1);

    // Export is portable and excludes the session-only API key.
    const downloadPromise = page.waitForEvent('download');
    await page.evaluate((key) => sessionStorage.setItem(key, 'AIza-test-key-is-not-a-live-request'), MAPS_KEY);
    await page.locator('#export-places').click();
    const exported = await downloadText(await downloadPromise);
    assert.equal(exported.includes('AIza-test-key-is-not-a-live-request'), false);
    const parsedExport = JSON.parse(exported);
    assert.deepEqual(parsedExport.places.map((item) => item.Name), ['Replacement A', 'Replacement B']);

    // User content is rendered as text, not executable markup.
    await openAdd(page);
    await fillForm(page, {
      name: '<img src=x onerror=alert(1)>',
      localStart: '2026-09-14T12:00',
      maps: mapUrl('XSS'),
      memo: '<script>window.__xss = true</script>',
    });
    await saveForm(page);
    assert.equal(await page.locator('#places-list img, #places-list script').count(), 0);
    assert.equal(await page.locator('#places-list').getByText('<img src=x onerror=alert(1)>', {exact: true}).count(), 1);
    assert.equal(await page.evaluate(() => window.__xss), undefined);

    // A corrupt store stays corrupt and is reported rather than silently
    // replaced with the public seed.
    const corruptPage = await browser.newPage({viewport: {width: 390, height: 900}});
    await corruptPage.addInitScript((key) => {
      if (window.top !== window) return;
      localStorage.clear(); localStorage.setItem(key, '{corrupt');
    }, STORAGE_KEY);
    await corruptPage.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await corruptPage.goto(`${origin}/index.html`);
    assert.match(await corruptPage.locator('#status-banner').textContent(), /오류|손상|불러오지|JSON|실패/i);
    assert.equal(await corruptPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), '{corrupt');
    await corruptPage.close();

    const emptyCorruptPage = await browser.newPage({viewport: {width: 390, height: 900}});
    await emptyCorruptPage.addInitScript((key) => {
      if (window.top !== window) return;
      localStorage.clear(); localStorage.setItem(key, '');
    }, STORAGE_KEY);
    await emptyCorruptPage.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await emptyCorruptPage.goto(`${origin}/index.html`);
    assert.match(await emptyCorruptPage.locator('#status-banner').textContent(), /오류|손상|깨진|비어|복구|JSON/i);
    assert.equal(await emptyCorruptPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), '');
    await emptyCorruptPage.close();

    // Quota errors are visible and do not claim a successful save.
    const quotaPage = await newAppPage(browser, fixture());
    await quotaPage.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await openApp(quotaPage, origin);
    const originalQuotaStore = await quotaPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY);
    await quotaPage.evaluate((key) => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function setItemWithQuota(k, value) {
        if (k === key) throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, k, value);
      };
    }, STORAGE_KEY);
    await openAdd(quotaPage);
    await fillForm(quotaPage, {name: 'Quota failure', localStart: '2026-09-14T15:00', maps: mapUrl('Quota failure')});
    await quotaPage.locator('#save-place').click();
    assert.match(await quotaPage.locator('#form-errors').textContent(), /오류|실패|저장하지|저장할 수/i);
    assert.equal(await quotaPage.locator('#place-editor').isVisible(), true);
    assert.equal(await quotaPage.evaluate((key) => localStorage.getItem(key), STORAGE_KEY), originalQuotaStore);
    await quotaPage.close();

    // A blocked sessionStorage implementation must not make settings or
    // keyless CRUD crash.  The browser API key is optional and stays out of
    // the local place store.
    const blockedPage = await newAppPage(browser, fixture());
    const blockedErrors = [];
    blockedPage.on('pageerror', (error) => blockedErrors.push(error.message));
    await openApp(blockedPage, origin);
    await blockedPage.evaluate((key) => {
      const originalSet = Storage.prototype.setItem;
      Storage.prototype.setItem = function blockedSessionKey(k, value) {
        if (k === key) throw new DOMException('blocked', 'SecurityError');
        return originalSet.call(this, k, value);
      };
    }, MAPS_KEY);
    await blockedPage.locator('#open-settings').click();
    await blockedPage.locator('#google-api-key').fill('A'.repeat(24));
    await blockedPage.locator('#settings-form button[type="submit"]').click();
    if (await blockedPage.locator('#settings-dialog').isVisible()) await closeDialog(blockedPage, 'settings-dialog');
    await openAdd(blockedPage);
    await fillForm(blockedPage, {name: 'Keyless CRUD', localStart: '2026-09-14T15:00', maps: mapUrl('Keyless CRUD')});
    await saveForm(blockedPage);
    assert.equal(await blockedPage.locator('#places-list').getByText('Keyless CRUD', {exact: true}).count(), 1);
    assert.deepEqual(blockedErrors, []);
    await blockedPage.close();

    // Cross-day grouping never creates an edge between dates.
    await setStorageAndReload(page, fixture({crossDay: true}));
    await selectDay(page, '2026-09-14');
    assert.equal(await routeCount(page), 1);
    await selectDay(page, '2026-09-15');
    assert.equal(await routeCount(page), 0);

    // Dialog escape/cancel and responsive layout must remain usable.
    await page.locator('#open-settings').click();
    await page.locator('#settings-dialog').waitFor({state: 'visible'});
    await page.keyboard.press('Escape');
    await page.locator('#settings-dialog').waitFor({state: 'hidden'});
    await openAdd(page);
    await page.keyboard.press('Escape');
    await page.locator('#place-editor').waitFor({state: 'hidden'});
    for (const width of [320, 390, 1280]) await assertNoOverflow(page, width);

    // Changing the display timezone in a second tab persists across reload,
    // but does not silently rewrite an open editor's unsaved local input.
    const tzContext = await browser.newContext({viewport: {width: 390, height: 900}});
    const tzPage = await newAppPage(tzContext, fixture());
    const tzErrors = [];
    tzPage.on('pageerror', (error) => tzErrors.push(error.message));
    await openApp(tzPage, origin);
    await openAdd(tzPage);
    await fillForm(tzPage, {name: 'Unsaved timezone', localStart: '2026-09-14T10:00', maps: mapUrl('Unsaved timezone')});
    const unsavedStart = await tzPage.locator('#place-start').inputValue();
    const peer = await tzContext.newPage({viewport: {width: 390, height: 900}});
    await peer.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' ? route.continue() : route.abort();
    });
    await peer.goto(`${origin}/index.html`);
    await peer.locator('#open-settings').click();
    await peer.locator('#settings-time-zone').fill('UTC');
    await peer.locator('#settings-form button[type="submit"]').click();
    await peer.locator('#settings-dialog').waitFor({state: 'hidden'});
    assert.equal(await tzPage.locator('#place-start').inputValue(), unsavedStart);
    await closeDialog(tzPage, 'place-editor');
    await peer.close();
    await tzPage.reload();
    await selectDay(tzPage, '2026-09-14');
    await tzPage.locator('#open-settings').click();
    assert.equal(await tzPage.locator('#settings-time-zone').inputValue(), 'UTC');
    await closeDialog(tzPage, 'settings-dialog');
    assert.deepEqual(tzErrors, []);
    await tzPage.close();
    await tzContext.close();

    assert.deepEqual(pageErrors, []);
    console.log('PASS: editor CRUD, required/optional fields, fee semantics, route rewiring, cross-day grouping, reload, import rollback/replacement, export secret exclusion, XSS text rendering, storage corruption/quota, keyless map picker, dialogs, 320/390/1280 layout.');
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
})().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
