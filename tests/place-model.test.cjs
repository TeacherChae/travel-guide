const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const previousGlobal = globalThis.TravelPlaces;
delete globalThis.TravelPlaces;
const TravelPlaces = require('../assets/place-model.js');
const requiredGlobal = globalThis.TravelPlaces;
if (previousGlobal === undefined) {
  delete globalThis.TravelPlaces;
} else {
  globalThis.TravelPlaces = previousGlobal;
}

function base(overrides = {}) {
  return {
    id: 'p1',
    Name: ' Musée d’Orsay ',
    'Date&Time': { start: '2026-09-15T11:30:00.000Z', end: null },
    'Reservation Status': '',
    Reservation: '',
    'Total Fee': '',
    'Pay per Each': '',
    EA: '',
    Priority: '',
    Category: 'museum',
    URL: '',
    Maps: 'https://www.google.com/maps/search/?api=1&query=Mus%C3%A9e%20d%27Orsay&query_place_id=ChIJG6ZwLQFu5kcR2CK0_i2cC8A',
    memo: '',
    ignored: '<script>bad()</script>',
    ...overrides,
  };
}

test('exports CommonJS API and UMD browser global without side effects', () => {
  assert.equal(requiredGlobal, undefined);
  for (const name of [
    'normalizePlace',
    'validatePlace',
    'getFee',
    'sortPlaces',
    'dayKey',
    'buildRoutes',
    'mapTarget',
    'mapEmbedUrl',
    'routeUrls',
    'formatDateTime',
    'zonedDateTime',
    'serializePlaces',
    'parsePlaces',
  ]) {
    assert.equal(typeof TravelPlaces[name], 'function', name);
  }

  const code = fs.readFileSync(path.join(__dirname, '../assets/place-model.js'), 'utf8');
  const sandbox = { window: {}, console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(code, sandbox, { filename: 'place-model.js' });
  assert.equal(typeof sandbox.window.TravelPlaces.normalizePlace, 'function');
});

test('normalizePlace keeps only allowlisted fields and normalizes blanks/nulls', () => {
  const place = TravelPlaces.normalizePlace(base({
    'Total Fee': '0',
    'Pay per Each': '12.50',
    EA: 2,
    URL: ' https://example.com/a \n\nhttps://example.com/b ',
    Reservation: ' https://tickets.example.com/order ',
    memo: '123',
  }));
  assert.deepEqual(Object.keys(place), [
    'id',
    'Name',
    'Date&Time',
    'Reservation Status',
    'Reservation',
    'Total Fee',
    'Pay per Each',
    'EA',
    'Priority',
    'Category',
    'URL',
    'Maps',
    'memo',
  ]);
  assert.equal(place.Name, 'Musée d’Orsay');
  assert.equal(place['Total Fee'], 0);
  assert.equal(place['Pay per Each'], 12.5);
  assert.equal(place.EA, 2);
  assert.equal(place.URL, 'https://example.com/a\nhttps://example.com/b');
  assert.equal(place.Reservation, 'https://tickets.example.com/order');
  assert.equal(TravelPlaces.normalizePlace(base({ Reservation: '현장 확인' })).Reservation, '현장 확인');
  assert.equal(place.memo, '123');
  assert.equal(place.ignored, undefined);
});

test('validatePlace distinguishes required fields, optional empties, false and zero', () => {
  const ok = TravelPlaces.validatePlace(base({
    'Reservation Status': 'false',
    'Total Fee': 0,
    'Pay per Each': 0,
    EA: 0,
  }));
  assert.equal(ok.valid, true);
  const blankNumbers = TravelPlaces.normalizePlace(base({ 'Total Fee': '   ', 'Pay per Each': ' ', EA: '   ' }));
  assert.equal(blankNumbers['Total Fee'], null);
  assert.equal(blankNumbers['Pay per Each'], null);
  assert.equal(blankNumbers.EA, null);
  assert.equal(TravelPlaces.validatePlace(base({ 'Reservation Status': false })).valid, false);
  const normalized = TravelPlaces.normalizePlace(base({ 'Reservation Status': 'false', 'Total Fee': 0, 'Pay per Each': 0, EA: 0 }));
  assert.equal(normalized['Reservation Status'], 'false');
  assert.equal(normalized['Total Fee'], 0);
  assert.equal(normalized['Pay per Each'], 0);
  assert.equal(normalized.EA, 0);

  const missing = TravelPlaces.validatePlace({ id: 'x', Name: '', Maps: '', 'Date&Time': null });
  assert.equal(missing.valid, false);
  assert.match(missing.errors.Name, /required/);
  assert.match(missing.errors['Date&Time'], /required/);
  assert.match(missing.errors.Maps, /required/);
});

test('allowIncomplete permits missing Date&Time or Maps for source records but always requires Name', () => {
  const source = TravelPlaces.normalizePlace({ id: 'legacy', Name: 'Legacy source', 'Date&Time': null, Maps: '' }, { allowIncomplete: true });
  assert.equal(source['Date&Time'], null);
  assert.equal(source.Maps, '');
  assert.throws(() => TravelPlaces.normalizePlace({ id: 'bad', Name: '', 'Date&Time': null, Maps: '' }, { allowIncomplete: true }), /validation failed/);
  assert.throws(() => TravelPlaces.normalizePlace({ id: 'bad-url', Name: 'Bad', Maps: 'not a map', 'Date&Time': null }, { allowIncomplete: true }), /validation failed/);
});

test('rejects malformed filled values, unsafe schemes, credentials and bad numbers', () => {
  const result = TravelPlaces.validatePlace(base({
    URL: 'https://ok.example\njavascript:alert(1)',
    Reservation: 'ftp://example.com/ticket',
    'Total Fee': '-1',
    'Pay per Each': 'Infinity',
    Maps: 'https://evil.example/maps?q=Paris',
  }));
  assert.equal(result.valid, false);
  assert.match(result.errors.URL, /HTTP/);
  assert.match(result.errors.Reservation, /HTTP/);
  assert.match(result.errors['Total Fee'], /non-negative/);
  assert.match(result.errors['Pay per Each'], /finite/);
  assert.match(result.errors.Maps, /Google Maps/);

  assert.equal(TravelPlaces.validatePlace(base({ URL: 'https://user:pass@example.com' })).valid, false);
  assert.equal(TravelPlaces.validatePlace(base({ 'Date&Time': { start: '2026-02-30T00:00:00Z' } })).valid, false);
});

test('fee semantics prefer manual override, otherwise calculate only when unit and EA both exist', () => {
  assert.deepEqual(TravelPlaces.getFee(TravelPlaces.normalizePlace(base({ 'Total Fee': '20', 'Pay per Each': '999', EA: 2 }))), { value: 20, source: 'manual' });
  assert.deepEqual(TravelPlaces.getFee(TravelPlaces.normalizePlace(base({ 'Total Fee': '', 'Pay per Each': '11.5', EA: '2' }))), { value: 23, source: 'calculated' });
  assert.deepEqual(TravelPlaces.getFee(TravelPlaces.normalizePlace(base({ 'Total Fee': '', 'Pay per Each': '11.5', EA: '' }))), { value: null, source: 'unknown' });
  assert.deepEqual(TravelPlaces.getFee(TravelPlaces.normalizePlace(base({ 'Total Fee': '', 'Pay per Each': 1e308, EA: 1e308 }))), { value: null, source: 'unknown' });
  assert.deepEqual(TravelPlaces.getFee(TravelPlaces.normalizePlace(base({ 'Total Fee': 0, 'Pay per Each': 11.5, EA: 2 }))), { value: 0, source: 'manual' });
});

test('timezone conversion formats instants and converts local Paris inputs across days', () => {
  assert.equal(TravelPlaces.formatDateTime('2026-09-15T11:30:00.000Z', 'Europe/Paris'), '2026-09-15T13:30');
  assert.equal(TravelPlaces.formatDateTime({ start: '2026-09-15T11:30:00.000Z' }, 'Europe/Paris'), '2026-09-15T13:30');
  assert.equal(TravelPlaces.formatDateTime('2026-09-15', 'Europe/Paris'), '2026-09-15');
  assert.equal(TravelPlaces.zonedDateTime('2026-09-15', 'Europe/Paris'), '2026-09-14T22:00:00.000Z');
  assert.equal(TravelPlaces.zonedDateTime('2026-09-15T13:30', 'Europe/Paris'), '2026-09-15T11:30:00.000Z');
  assert.equal(TravelPlaces.zonedDateTime('2026-09-15T00:15', 'Europe/Paris'), '2026-09-14T22:15:00.000Z');
  assert.equal(TravelPlaces.formatDateTime('2026-09-15T13:30', 'Europe/Paris'), '2026-09-15T13:30');
  assert.equal(TravelPlaces.dayKey({ 'Date&Time': { start: '2026-09-15T00:15' } }, 'Europe/Paris'), '2026-09-15');
});

test('timezone conversion rejects DST gaps and picks earlier instant in repeated hour', () => {
  assert.throws(() => TravelPlaces.zonedDateTime('2026-03-29T02:30', 'Europe/Paris'), /does not exist/);
  assert.equal(TravelPlaces.zonedDateTime('2026-10-25T02:30', 'Europe/Paris'), '2026-10-25T00:30:00.000Z');
});

test('sortPlaces is chronological, stable for ties, date-only aware and undated last', () => {
  const places = [
    TravelPlaces.normalizePlace(base({ id: 'b', Name: 'B', 'Date&Time': { start: '2026-09-14T10:00:00.000Z', end: null } })),
    TravelPlaces.normalizePlace(base({ id: 'a', Name: 'A', 'Date&Time': { start: '2026-09-14', end: null } })),
    TravelPlaces.normalizePlace(base({ id: 'c', Name: 'C', 'Date&Time': { start: '2026-09-14T10:00:00.000Z', end: null } })),
    TravelPlaces.normalizePlace(base({ id: 'u', Name: 'U', 'Date&Time': null, Maps: '' }), { allowIncomplete: true }),
  ];
  assert.deepEqual(TravelPlaces.sortPlaces(places, 'Europe/Paris').map((p) => p.id), ['a', 'b', 'c', 'u']);
});

test('dayKey groups ISO instants in target timezone and marks undated as unassigned', () => {
  assert.equal(TravelPlaces.dayKey(TravelPlaces.normalizePlace(base({ 'Date&Time': { start: '2026-09-14T22:15:00.000Z', end: null } })), 'Europe/Paris'), '2026-09-15');
  assert.equal(TravelPlaces.dayKey(TravelPlaces.normalizePlace(base({ 'Date&Time': { start: '2026-09-15', end: null } })), 'Europe/Paris'), '2026-09-15');
  assert.equal(TravelPlaces.dayKey(TravelPlaces.normalizePlace(base({ 'Date&Time': null, Maps: '' }), { allowIncomplete: true }), 'Europe/Paris'), 'unassigned');
});

test('buildRoutes creates adjacent within-day routes and breaks at missing Maps without bridging', () => {
  const mapA = 'https://www.google.com/maps/search/?api=1&query=A';
  const mapB = 'https://www.google.com/maps/search/?api=1&query=B';
  const mapC = 'https://www.google.com/maps/search/?api=1&query=C';
  const places = [
    TravelPlaces.normalizePlace(base({ id: 'a', Name: 'A', 'Date&Time': { start: '2026-09-14T08:00:00.000Z', end: null }, Maps: mapA })),
    TravelPlaces.normalizePlace(base({ id: 'missing', Name: 'Missing', 'Date&Time': { start: '2026-09-14T09:00:00.000Z', end: null }, Maps: '' }), { allowIncomplete: true }),
    TravelPlaces.normalizePlace(base({ id: 'c', Name: 'C', 'Date&Time': { start: '2026-09-14T10:00:00.000Z', end: null }, Maps: mapC })),
    TravelPlaces.normalizePlace(base({ id: 'b', Name: 'B', 'Date&Time': { start: '2026-09-15T08:00:00.000Z', end: null }, Maps: mapB })),
  ];
  assert.deepEqual(TravelPlaces.buildRoutes(places, 'Europe/Paris').map((r) => r.id), []);

  const compact = places.filter((p) => p.id !== 'missing');
  assert.deepEqual(TravelPlaces.buildRoutes(compact, 'Europe/Paris').map((r) => r.id), ['route:a:c']);
});

test('mapTarget parses safe Google URLs and rejects shortened, unrelated, credentials and scripts', () => {
  assert.deepEqual(TravelPlaces.mapTarget('https://www.google.com/maps/search/?api=1&query=Mus%C3%A9e%20Rodin&query_place_id=abc'), {
    query: 'Musée Rodin',
    placeId: 'abc',
  });
  assert.deepEqual(TravelPlaces.mapTarget('https://www.google.com/maps/dir/?api=1&origin=A&destination=B&travelmode=transit'), { query: 'B' });
  assert.deepEqual(TravelPlaces.mapTarget('https://maps.google.com/maps?saddr=A&daddr=B%20to%20C&output=embed'), { query: 'C' });
  assert.deepEqual(TravelPlaces.mapTarget('https://www.google.com/maps/place/Mus%C3%A9e+d%27Orsay/@48.8599614,2.3265614,17z'), {
    query: "Musée d'Orsay",
    lat: 48.8599614,
    lng: 2.3265614,
  });
  assert.equal(TravelPlaces.mapTarget('https://www.google.com/maps/place/X/@1,2,17z/data=!3d48.1!4d2.2').lat, 48.1);
  assert.equal(TravelPlaces.mapTarget('https://maps.app.goo.gl/abc'), null);
  assert.equal(TravelPlaces.mapTarget('https://evil.example/maps/search/?query=Paris'), null);
  assert.equal(TravelPlaces.mapTarget('https://www.google.com.evil/maps/search/?query=Paris'), null);
  assert.equal(TravelPlaces.mapTarget('https://www.google.fr/maps/search/?query=Paris')?.query, 'Paris');
  assert.equal(TravelPlaces.mapTarget('https://www.google.com/maps/search/?api=1&query=Paris&key=AIzaSecret'), null);
  assert.equal(TravelPlaces.validatePlace(base({ Maps: 'https://www.google.com/maps/search/?api=1&query=Paris&signature=sig' })).valid, false);
  assert.equal(TravelPlaces.mapTarget('javascript:alert(1)'), null);
  assert.equal(TravelPlaces.mapTarget('https://user:pass@www.google.com/maps/search/?query=Paris'), null);
});

test('mapEmbedUrl and routeUrls return escaped HTTPS Google URLs without travel claims', () => {
  const map = 'https://www.google.com/maps/place/Mus%C3%A9e+d%27Orsay/@48.8599614,2.3265614,17z';
  const embed = TravelPlaces.mapEmbedUrl(map);
  assert.match(embed, /^https:\/\/www\.google\.com\/maps\?/);
  assert.match(embed, /output=embed/);
  assert.match(embed, /48\.8599614%2C2\.3265614/);

  const route = {
    origin: 'https://www.google.com/maps/search/?api=1&query=A%20%26%20B',
    destination: 'https://www.google.com/maps/search/?api=1&query=Café',
  };
  const urls = TravelPlaces.routeUrls(route, 'walking');
  assert.match(urls.embed, /^https:\/\/www\.google\.com\/maps\?/);
  assert.match(urls.embed, /output=embed/);
  assert.match(urls.external, /^https:\/\/www\.google\.com\/maps\/dir\/?/);
  assert.match(urls.external, /travelmode=walking/);
  assert.equal(TravelPlaces.routeUrls(route, 'flying').external.includes('travelmode=transit'), true);
});

test('serializePlaces and parsePlaces are strict, versioned, duplicate-safe and strip extras/API keys', () => {
  const places = [TravelPlaces.normalizePlace(base({ id: 'p1', googleMapsApiKey: 'SECRET', extra: 'drop' }))];
  const json = TravelPlaces.serializePlaces(places, 'Europe/Paris');
  assert.equal(json.includes('SECRET'), false);
  const parsed = TravelPlaces.parsePlaces(json);
  assert.equal(parsed.version, 1);
  assert.equal(parsed.timeZone, 'Europe/Paris');
  assert.equal(parsed.places[0].extra, undefined);

  assert.throws(() => TravelPlaces.parsePlaces('{bad'), /Invalid JSON/);
  assert.throws(() => TravelPlaces.parsePlaces(JSON.stringify({ version: 2, timeZone: 'Europe/Paris', places: [] })), /Unsupported/);
  assert.throws(() => TravelPlaces.parsePlaces(JSON.stringify({ version: 1, timeZone: 'Not/AZone', places: [] })), /Invalid timeZone/);
  assert.throws(() => TravelPlaces.serializePlaces([], 'Not/AZone'), /Invalid timeZone/);
  assert.throws(() => TravelPlaces.parsePlaces(JSON.stringify({ version: 1, timeZone: 'Europe/Paris', places: [base({ id: 'dup' }), base({ id: 'dup' })] })), /Duplicate/);
  assert.throws(() => TravelPlaces.parsePlaces(JSON.stringify({ version: 1, timeZone: 'Europe/Paris', places: Array.from({ length: 1001 }, (_, i) => base({ id: `p${i}` })) })), /Too many/);
});

test('malformed imported fields are rejected rather than coerced into text or numbers', () => {
  for (const [field, value] of [['Name', {}], ['memo', ['a', 'b']], ['Category', false], ['id', {}], ['EA', []], ['Total Fee', [2]], ['URL', ['https://example.com']]]) {
    assert.throws(() => TravelPlaces.normalizePlace(base({[field]: value})), /validation/i, field);
    assert.throws(() => TravelPlaces.parsePlaces(JSON.stringify({version: 1, timeZone: 'Europe/Paris', places: [base({[field]: value})]})), /validation/i, field);
  }
});
