/* Google Maps is optional. No SDK request is made until a key is supplied.
 * API contract checked 2026-09-11:
 * https://developers.google.com/maps/documentation/javascript/place-autocomplete-new
 * https://developers.google.com/maps/documentation/javascript/examples/event-poi
 */
(function (root) {
  'use strict';
  let loading = null;
  let loadedKey = '';
  let authError = null;
  const authListeners = new Set();

  function ensureGoogle(rawKey) {
    const key = String(rawKey || '').trim();
    if (!/^[A-Za-z0-9_-]{20,200}$/.test(key)) return Promise.reject(new Error('올바른 Google Maps API 키를 설정해주세요.'));
    if (loadedKey && loadedKey !== key) return Promise.reject(new Error('API 키를 바꿨습니다. 편집 내용을 저장한 뒤 새로고침해주세요.'));
    if (authError) return Promise.reject(authError);
    loadedKey = key;
    if (root.google && typeof root.google.maps?.importLibrary === 'function') return Promise.resolve(root.google.maps);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      let settled = false;
      const script = root.document.createElement('script');
      const timer = root.setTimeout(function () { fail(new Error('Google 지도를 불러오는 시간이 초과됐습니다. 연결을 확인하고 새로고침해주세요.')); }, 15000);
      function fail(error) {
        if (settled) return;
        settled = true;
        root.clearTimeout(timer);
        reject(error);
      }
      root.__travelGoogleMapsReady = function () {
        if (settled) return;
        if (typeof root.google?.maps?.importLibrary !== 'function') {
          fail(new Error('Google 지도 초기화에 실패했습니다. 새로고침해주세요.'));
          return;
        }
        settled = true;
        root.clearTimeout(timer);
        resolve(root.google.maps);
      };
      root.gm_authFailure = function () {
        authError = new Error('Google Maps 인증 실패: 키의 웹사이트 제한, API 활성화와 결제 설정을 확인해주세요.');
        fail(authError);
        authListeners.forEach(function (listener) { listener(authError.message); });
      };
      script.async = true;
      script.onerror = function () { fail(new Error('Google 지도 연결에 실패했습니다. URL 직접 입력은 계속 사용할 수 있습니다.')); };
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.searchParams.set('key', key);
      url.searchParams.set('v', 'weekly');
      url.searchParams.set('loading', 'async');
      url.searchParams.set('language', 'ko');
      url.searchParams.set('callback', '__travelGoogleMapsReady');
      script.src = url.toString();
      root.document.head.appendChild(script);
    });
    return loading;
  }

  function coordinates(location) {
    const lat = typeof location?.lat === 'function' ? location.lat() : location?.lat;
    const lng = typeof location?.lng === 'function' ? location.lng() : location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('장소 좌표를 확인할 수 없습니다. 다른 결과를 선택해주세요.');
    return {lat, lng};
  }

  async function mount(options) {
    const googleMaps = await ensureGoogle(options.key);
    const [mapsLibrary, placesLibrary] = await Promise.all([googleMaps.importLibrary('maps'), googleMaps.importLibrary('places')]);
    if (authError) throw authError;
    const {Map: GoogleMap, InfoWindow} = mapsLibrary;
    const {PlaceAutocompleteElement, Place} = placesLibrary;
    if (!GoogleMap || !PlaceAutocompleteElement || !Place) throw new Error('Maps JavaScript API와 Places API (New)를 활성화해주세요.');
    let active = true;
    let selectionNumber = 0;
    const target = root.TravelPlaces.mapTarget(options.initialMaps);
    const center = target && Number.isFinite(target.lat) && Number.isFinite(target.lng) ? {lat: target.lat, lng: target.lng} : {lat: 48.8566, lng: 2.3522};
    const map = new GoogleMap(options.mapElement, {center, zoom: 14, mapTypeControl: false, streetViewControl: false});
    const info = new InfoWindow();
    const autocomplete = new PlaceAutocompleteElement();
    autocomplete.placeholder = '장소 이름 또는 주소 검색';
    autocomplete.locationBias = {center, radius: 30000};
    options.searchElement.replaceChildren(autocomplete);
    const reportError = function () {
      if (active && options.onError) options.onError('장소 정보를 가져오지 못했습니다. API 설정·연결을 확인하거나 Maps URL을 직접 입력해주세요.');
    };
    const authListener = function (message) { if (active && options.onError) options.onError(message); };
    authListeners.add(authListener);

    function choose(place, location, requestNumber) {
      if (!active || requestNumber !== selectionNumber) return;
      const point = coordinates(location);
      const name = typeof place?.displayName === 'string' ? place.displayName : point.lat.toFixed(5) + ', ' + point.lng.toFixed(5);
      const address = typeof place?.formattedAddress === 'string' ? place.formattedAddress : '';
      const url = new URL('https://www.google.com/maps/search/');
      url.searchParams.set('api', '1');
      url.searchParams.set('query', point.lat + ',' + point.lng);
      if (place?.id) url.searchParams.set('query_place_id', place.id);
      const content = root.document.createElement('div');
      const heading = root.document.createElement('strong');
      heading.textContent = name;
      const description = root.document.createElement('p');
      description.textContent = address;
      content.append(heading, description);
      info.setContent(content);
      info.setPosition(point);
      info.open({map});
      map.setCenter(point);
      map.setZoom(17);
      options.onSelect({name, maps: url.toString(), address});
    }

    async function fetchAndChoose(place) {
      const requestNumber = ++selectionNumber;
      try {
        await place.fetchFields({fields: ['id', 'displayName', 'formattedAddress', 'location']});
        choose(place, place.location, requestNumber);
      } catch (_) { if (requestNumber === selectionNumber) reportError(); }
    }
    const onSearch = function (event) {
      if (!active || !event.placePrediction) return;
      try { void fetchAndChoose(event.placePrediction.toPlace()); } catch (_) { reportError(); }
    };
    autocomplete.addEventListener('gmp-select', onSearch);
    autocomplete.addEventListener('gmp-error', reportError);
    const clickListener = map.addListener('click', function (event) {
      if (!active) return;
      if (event.placeId) {
        if (typeof event.stop === 'function') event.stop();
        void fetchAndChoose(new Place({id: event.placeId}));
      } else if (event.latLng) {
        try { choose(null, event.latLng, ++selectionNumber); } catch (_) { reportError(); }
      }
    });
    return {
      destroy: function () {
        active = false;
        selectionNumber++;
        clickListener.remove();
        autocomplete.removeEventListener('gmp-select', onSearch);
        autocomplete.removeEventListener('gmp-error', reportError);
        autocomplete.remove();
        authListeners.delete(authListener);
        info.close();
      }
    };
  }
  root.TravelMapPicker = {mount};
})(typeof window !== 'undefined' ? window : globalThis);
