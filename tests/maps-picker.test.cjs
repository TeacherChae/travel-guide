const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const model = require('../assets/place-model.js');

function harness(withSDK = true) {
  class Element extends EventTarget {
    constructor() { super(); this.children = []; this.textContent = ''; this.style = {}; }
    appendChild(child) { this.children.push(child); child.parent = this; return child; }
    append(...children) { children.forEach(child => this.appendChild(child)); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  }
  const maps = [], windows = [], autocompletes = [], selections = [], failures = [], scripts = [];
  class Map {
    constructor(el, options) { this.el = el; this.options = options; this.listeners = {}; maps.push(this); }
    addListener(type, handler) { this.listeners[type] = handler; return {remove: () => { delete this.listeners[type]; }}; }
    setCenter(value) { this.center = value; }
    setZoom(value) { this.zoom = value; }
  }
  class InfoWindow {
    constructor() { windows.push(this); }
    setContent(value) { this.content = value; }
    setPosition(value) { this.position = value; }
    open(value) { this.opened = value; }
    close() { this.closed = true; }
  }
  class PlaceAutocompleteElement extends Element { constructor() { super(); autocompletes.push(this); } }
  class Place {
    constructor({id}) { this.id = id; }
    async fetchFields({fields}) {
      this.fields = fields;
      this.displayName = '<img onerror=alert(1)>';
      this.formattedAddress = 'Paris';
      this.location = {lat: () => 48.86, lng: () => 2.34};
    }
  }
  const document = {createElement: () => new Element(), head: {appendChild: script => { scripts.push(script); }} };
  const root = {document, URL, URLSearchParams, setTimeout, clearTimeout, Event, Promise, TravelPlaces: model};
  if (withSDK) root.google = {maps: {importLibrary: async name => name === 'maps' ? {Map, InfoWindow} : {PlaceAutocompleteElement, Place}}};
  root.window = root;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../assets/maps-picker.js'), 'utf8'), root);
  const options = {mapElement: new Element(), searchElement: new Element(), key: 'AIza' + 'x'.repeat(35), initialMaps: 'https://www.google.com/maps?q=48.8,2.3', onSelect: x => selections.push(x), onError: x => failures.push(x)};
  return {root, options, maps, windows, autocompletes, selections, failures, scripts, Place};
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('blank/invalid keys never load a remote script', async () => {
  const h = harness(false);
  await assert.rejects(h.root.TravelMapPicker.mount({...h.options, key: ''}));
  await assert.rejects(h.root.TravelMapPicker.mount({...h.options, key: '<script>'}));
  assert.equal(h.scripts.length, 0);
});
test('Places New search returns a selected Google Maps URL without HTML injection', async () => {
  const h = harness();
  const controller = await h.root.TravelMapPicker.mount(h.options);
  const place = new h.Place({id: 'test-place'});
  const event = new Event('gmp-select');
  event.placePrediction = {toPlace: () => place};
  h.autocompletes[0].dispatchEvent(event);
  await tick();
  assert.equal(h.selections.length, 1);
  assert.equal(h.selections[0].name, '<img onerror=alert(1)>');
  const url = new URL(h.selections[0].maps);
  assert.equal(url.hostname, 'www.google.com');
  assert.equal(url.searchParams.get('query_place_id'), 'test-place');
  assert.equal(url.searchParams.get('query'), '48.86,2.34');
  assert.equal(h.windows[0].content.children[0].textContent, '<img onerror=alert(1)>');
  assert.ok(place.fields.includes('location'));
  controller.destroy();
  assert.equal(h.options.searchElement.children.length, 0);
});
test('clicking a POI fetches its place and coordinate clicks can also be applied', async () => {
  const h = harness();
  const controller = await h.root.TravelMapPicker.mount(h.options);
  let stopped = false;
  h.maps[0].listeners.click({placeId: 'poi-1', stop: () => { stopped = true; }});
  await tick();
  assert.equal(stopped, true);
  assert.equal(new URL(h.selections[0].maps).searchParams.get('query_place_id'), 'poi-1');
  h.maps[0].listeners.click({latLng: {lat: () => 49.07, lng: () => 1.53}});
  assert.equal(new URL(h.selections[1].maps).searchParams.get('query'), '49.07,1.53');
  controller.destroy();
});
test('out-of-order lookups and results after closing cannot change the chosen location', async () => {
  const h = harness();
  const controller = await h.root.TravelMapPicker.mount(h.options);
  let finish;
  const slow = new h.Place({id: 'slow'});
  slow.fetchFields = () => new Promise(resolve => { finish = async () => { await h.Place.prototype.fetchFields.call(slow, {fields: []}); resolve(); }; });
  const event = new Event('gmp-select'); event.placePrediction = {toPlace: () => slow};
  h.autocompletes[0].dispatchEvent(event);
  h.maps[0].listeners.click({placeId: 'newer', stop() {}});
  await tick(); await finish(); await tick();
  assert.equal(h.selections.length, 1);
  assert.equal(new URL(h.selections[0].maps).searchParams.get('query_place_id'), 'newer');
  h.autocompletes[0].dispatchEvent(event);
  controller.destroy(); await finish(); await tick();
  assert.equal(h.selections.length, 1);
});
test('network loading failures are explicit, and the SDK origin is fixed', async () => {
  const h = harness(false);
  const pending = h.root.TravelMapPicker.mount(h.options);
  assert.equal(h.scripts.length, 1);
  const url = new URL(h.scripts[0].src);
  assert.equal(url.origin, 'https://maps.googleapis.com');
  assert.equal(url.pathname, '/maps/api/js');
  h.scripts[0].onerror();
  await assert.rejects(pending, /Google|지도/);
});
test('changing a loaded key requires reload rather than injecting competing SDKs', async () => {
  const h = harness();
  const controller = await h.root.TravelMapPicker.mount(h.options);
  controller.destroy();
  await assert.rejects(h.root.TravelMapPicker.mount({...h.options, key: 'AIza' + 'y'.repeat(35)}), /새로고침/);
});

test('late Google authorization failures notify the active picker without leaking the key', async () => {
  const h = harness(false);
  const sdk = harness();
  const pending = h.root.TravelMapPicker.mount(h.options);
  h.root.google = sdk.root.google;
  h.root.__travelGoogleMapsReady();
  const controller = await pending;
  h.root.gm_authFailure();
  assert.match(h.failures[0], /인증 실패/);
  assert.equal(h.failures[0].includes(h.options.key), false);
  controller.destroy();
  h.root.gm_authFailure();
  assert.equal(h.failures.length, 1);
  await assert.rejects(h.root.TravelMapPicker.mount(h.options), /인증 실패/);
});

test('invalid map coordinates are never applied', async () => {
  const h = harness();
  const controller = await h.root.TravelMapPicker.mount(h.options);
  h.maps[0].listeners.click({latLng: {lat: () => 91, lng: () => 0}});
  assert.equal(h.selections.length, 0);
  assert.equal(h.failures.length, 1);
  controller.destroy();
});
