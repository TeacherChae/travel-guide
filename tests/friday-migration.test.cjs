/* Friday 9/18 was planned mid-trip, after the seed had already been saved into
 * the traveller's browser.  Publishing a new seed is not enough on its own:
 * stored places win over the seed, so without the Friday migration the day stays
 * empty on the device actually being carried around Paris.  These tests drive
 * the real page against storage shaped like that phone.
 */
const assert = require('node:assert');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const ROOT = path.resolve(__dirname, '..');
const CHROMIUM = process.env.CHROMIUM_PATH;
const TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css'};

const SCHEDULED_IDS = [
  '3d5ea411129f8163b6f2f1453dc87d07',
  '3d5ea411129f8176817cf304e36538db',
  '3d5ea411129f819e8e29c38107cdc6ec',
  '3d5ea411129f81308318c867d62d6830',
  '3d5ea411129f81d69b05f2a638a0341e',
  '3d5ea411129f81e590bbd5aecbb2f174',
];
const NEW_IDS = [
  'plan_20260918_montmartre',
  'plan_20260918_ruecler',
  'plan_20260918_parisik',
  'plan_20260918_arc',
];
const EXPECTED_ORDER = [
  '파리 5구 숙소 체크아웃',
  '풀만 호텔 · 체크인 전 짐 보관',
  '몽소 공원',
  '몽마르뜨 · 사크레쾨르',
  'rue Cler 장보기',
  '샹드마르스 공원 · 에펠탑',
  '풀만 호텔 체크인',
  '갤러리 라파예트 · 프렝탕',
  '파리식 (Parisik)',
  '개선문 전망대',
];

function seedPlaces() {
  const source = fs.readFileSync(path.join(ROOT, 'data', 'places-seed.js'), 'utf8');
  const match = source.match(/const seed = (\{[\s\S]*\});\s*\n\s*if \(typeof module/);
  if (!match) throw new Error('places-seed.js must contain a JSON seed object');
  return JSON.parse(match[1]).places;
}

/** Storage as it looked before Friday was planned: no new places, six undated. */
function storageBeforeFriday(places) {
  return JSON.stringify({
    version: 1,
    timeZone: 'Europe/Paris',
    places: places
      .filter((place) => !NEW_IDS.includes(place.id))
      .map((place) => (SCHEDULED_IDS.includes(place.id)
        ? Object.assign({}, place, {'Date&Time': null})
        : place)),
  });
}

function createServer() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, {'Content-Type': TYPES[path.extname(file)] || 'text/plain'});
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({server, origin: `http://127.0.0.1:${server.address().port}`}));
  });
}

async function boot(browser, origin, storage, flags) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${origin}/index.html`);
  await page.evaluate(([raw, keys]) => {
    localStorage.clear();
    if (raw) localStorage.setItem('travel-guide.places.v1', raw);
    keys.forEach((key) => localStorage.setItem(key, 'done'));
  }, [storage, flags]);
  await page.reload({waitUntil: 'networkidle'});
  await page.waitForTimeout(500);
  return {page, errors};
}

async function fridayNames(page) {
  const tab = page.locator('#day-tabs button').filter({hasText: '9/18'});
  assert.equal(await tab.count(), 1, 'the 9/18 tab should exist');
  await tab.first().click();
  await page.waitForTimeout(300);
  const names = await page.locator('.place-card .place-name, .place-card h3').allTextContents();
  return names.map((name) => name.trim());
}

(async () => {
  const {server, origin} = await createServer();
  const browser = await chromium.launch({headless: true, executablePath: CHROMIUM});
  try {
    const places = seedPlaces();

    // A phone that already ran the v2 migration still receives Friday.
    const used = await boot(browser, origin, storageBeforeFriday(places), ['travel-guide.seed-migration.v2']);
    assert.deepEqual(await fridayNames(used.page), EXPECTED_ORDER);
    assert.deepEqual(used.errors, []);
    assert.equal(
      await used.page.evaluate(() => localStorage.getItem('travel-guide.seed-migration.v4')),
      'done',
      'the migration must record itself so it does not re-run',
    );
    await used.page.close();

    // A fresh browser reads the same day straight from the seed.
    const fresh = await boot(browser, origin, null, []);
    assert.deepEqual(await fridayNames(fresh.page), EXPECTED_ORDER);
    assert.deepEqual(fresh.errors, []);
    await fresh.page.close();

    // A record the traveller already dated by hand must not be overwritten.
    const edited = JSON.parse(storageBeforeFriday(places));
    const mine = edited.places.find((place) => place.id === '3d5ea411129f819e8e29c38107cdc6ec');
    mine.Name = '몽소 공원 (내가 정한 시간)';
    mine['Date&Time'] = {start: '2026-09-19T08:00:00.000Z', end: '2026-09-19T09:00:00.000Z'};
    const kept = await boot(browser, origin, JSON.stringify(edited), ['travel-guide.seed-migration.v2']);
    const names = await fridayNames(kept.page);
    assert.ok(!names.includes('몽소 공원'), 'a hand-dated record must stay on its own day');
    assert.equal(names.length, EXPECTED_ORDER.length - 1);
    assert.deepEqual(kept.errors, []);
    await kept.page.close();

    // Browsers cache editor.js and places-seed.js separately.  A fresh script
    // running beside a stale seed must not retire the migration having copied
    // nothing, or the day stays empty forever.
    const stalePage = await browser.newPage();
    await stalePage.route('**/data/places-seed.js', (route) => {
      const stale = {
        version: 1,
        timeZone: 'Europe/Paris',
        capturedAt: '2026-09-11',
        source: 'stale cache',
        days: ['2026-09-17', '2026-09-18'],
        places: JSON.parse(storageBeforeFriday(places)).places,
      };
      route.fulfill({
        contentType: 'text/javascript',
        body: `(function (root) { const seed = ${JSON.stringify(stale)};\n`
          + 'root.TRAVEL_PLACES_SEED = seed;\nroot.TRAVEL_PLACE_NAME_ALIASES = {};\n'
          + '})(typeof window !== "undefined" ? window : this);',
      });
    });
    await stalePage.goto(`${origin}/index.html`);
    await stalePage.evaluate(([raw]) => {
      localStorage.clear();
      localStorage.setItem('travel-guide.places.v1', raw);
      localStorage.setItem('travel-guide.seed-migration.v2', 'done');
    }, [storageBeforeFriday(places)]);
    await stalePage.reload({waitUntil: 'networkidle'});
    await stalePage.waitForTimeout(500);
    assert.equal(
      await stalePage.evaluate(() => localStorage.getItem('travel-guide.seed-migration.v4')),
      null,
      'a stale cached seed must leave the migration pending for the next load',
    );
    await stalePage.close();

    console.log('PASS: Friday 9/18 reaches used phones, fresh browsers, survives a stale cached seed, and leaves hand-edited records alone.');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
