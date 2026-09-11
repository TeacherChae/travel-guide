(function () {
  'use strict';

  var Model = window.TravelPlaces;
  var Seed = window.TRAVEL_PLACES_SEED || { version: 1, timeZone: 'Europe/Paris', days: [], places: [] };
  var SeedNameAliases = window.TRAVEL_PLACE_NAME_ALIASES || {};
  var TIME_ZONE = 'Europe/Paris';
  var STORAGE_KEY = 'travel-guide.places.v1';
  var API_KEY = 'travel-guide.maps-api-key.v1';
  var SEED_MIGRATION_KEY = 'travel-guide.seed-migration.v2';
  var PROPERTY_LABELS = {
    'Name': '장소명',
    'Date&Time': '일시',
    'Reservation Status': '예약 상태',
    'Reservation': '예약 필요 여부',
    'Total Fee': '총액',
    'Pay per Each': '1개당 금액',
    'EA': '수량',
    'Priority': '우선순위',
    'Category': '분류',
    'URL': '참고 링크',
    'Maps': '지도',
    'memo': '메모',
  };
  var PROPERTY_VALUE_LABELS = {
    'Reservation Status': { 'Done': '완료', 'In Progress': '진행 중', 'Not Yet': '시작 전' },
    'Reservation': { 'Necessary': '필수', 'Recommended': '권장', 'Not Needed': '불필요' },
    'Priority': { 'HIGH': '높음', 'MID': '중간', 'LOW': '낮음' },
    'Category': {
      'Museum': '미술관·박물관',
      'Architecture·Landscape Design': '건축·조경',
      'Cathedral·Historic': '성당·역사',
      'Market': '시장',
      'Park·Plaza': '공원·광장',
      'Restaurant': '식당',
      'Shopping': '쇼핑',
      'Transportation': '교통',
      'Accomodation': '숙소',
    },
  };

  var state = {
    places: [],
    seedPlaces: [],
    baseDays: Array.isArray(Seed.days) ? Seed.days.slice() : [],
    timeZone: TIME_ZONE,
    activeDay: '',
    selectedRouteId: '',
    routeMode: 'transit',
    persistedRaw: null,
    corruptRaw: null,
    editingId: null,
    pendingImportRaw: '',
    picker: { controller: null, token: 0, candidate: null },
  };

  var $ = function (id) { return document.getElementById(id); };
  var nodes = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    nodes = {
      status: $('status-banner'), add: $('add-place'), exportPlaces: $('export-places'), importPlaces: $('import-places'), importFile: $('import-file'),
      dayTabs: $('day-tabs'), dayPanel: $('day-panel'), dayTitle: $('day-title'), daySummary: $('day-summary'), dayTotal: $('day-total'), dayUnknown: $('day-unknown'),
      placesList: $('places-list'),
      routeDetails: $('route-details-dialog'), routeDetailsTitle: $('route-details-title'), routeDetailsSummary: $('route-details-summary'), routeModeTabs: $('route-mode-tabs'), routeDetailsFrame: $('route-details-frame'), routeDetailsExternal: $('route-details-external'),
      editor: $('place-editor'), form: $('place-form'), formErrors: $('form-errors'), editorTitle: $('editor-title'),
      name: $('place-name'), start: $('place-start'), end: $('place-end'), allDay: $('all-day'), maps: $('place-maps'),
      reservationStatus: $('place-reservation-status'), reservation: $('place-reservation'), totalFee: $('place-total-fee'), unitFee: $('place-unit-fee'), quantity: $('place-quantity'),
      priority: $('place-priority'), category: $('place-category'), url: $('place-url'), memo: $('place-memo'), save: $('save-place'), feePreview: $('fee-preview'),
      mapPicker: $('map-picker'), openMapPicker: $('open-map-picker'), googleSearch: $('google-search'), googleCanvas: $('google-map-canvas'), pickerFrame: $('picker-map-frame'),
      pickerSearch: $('picker-search'), pickerResults: $('picker-results'), pickerManual: $('picker-manual-url'), previewMapUrl: $('preview-map-url'), pickerStatus: $('picker-status'),
      pickerSelection: $('picker-selection'), applyMap: $('apply-map'), pickerSettings: $('picker-settings'),
      settings: $('settings-dialog'), openSettings: $('open-settings'), settingsForm: $('settings-form'), googleApiKey: $('google-api-key'), settingsErrors: $('settings-errors'), clearGoogleKey: $('clear-google-key'),
      confirm: $('confirm-dialog'), confirmTitle: $('confirm-title'), confirmMessage: $('confirm-message'), confirmAccept: $('confirm-accept'), confirmCancel: $('confirm-cancel'), seedNote: $('seed-note'),
    };

    if (!Model) {
      showStatus('필수 모델 스크립트 assets/place-model.js를 불러오지 못했습니다.', 'error');
      return;
    }
    bootData();
    bindEvents();
    render();
  }

  function bootData() {
    state.timeZone = TIME_ZONE;
    try { localStorage.removeItem('travel-guide.time-zone.v1'); } catch (_) {}
    migrateApiKeyStorage();
    var seeded = normalizeMany(Seed.places || [], true);
    state.seedPlaces = seeded;
    var stored = safeGet(STORAGE_KEY, true);
    if (stored !== null) {
      try {
        var parsed = Model.parsePlaces(stored);
        var migration = migrateStoredPlaces(parsed.places);
        state.places = migration.places;
        state.persistedRaw = stored;
        if (migration.changed) {
          var migratedRaw = Model.serializePlaces(state.places, TIME_ZONE);
          if (safeLocalSet(STORAGE_KEY, migratedRaw)) {
            state.persistedRaw = migratedRaw;
            safeLocalSet(SEED_MIGRATION_KEY, 'done');
          } else {
            state.places = parsed.places;
          }
        } else {
          safeLocalSet(SEED_MIGRATION_KEY, 'done');
        }
      } catch (error) {
        state.corruptRaw = stored;
        state.places = seeded;
        state.persistedRaw = null;
      }
    } else {
      state.places = seeded;
      state.persistedRaw = null;
      safeLocalSet(SEED_MIGRATION_KEY, 'done');
    }
    if (nodes.seedNote) nodes.seedNote.textContent = Seed.source || '수동 Notion 스냅샷 기반 · 자동 동기화 없음';
    state.activeDay = firstDay();
    if (state.corruptRaw !== null) showCorruptNotice();
    else showStatus('일정은 파리 시간(Europe/Paris)으로 표시·편집됩니다. Google API 키 없이도 URL 직접 입력과 저장된 장소 검색은 가능합니다.', 'ok');
  }

  function normalizeMany(places, allowIncomplete) {
    var seen = new Set();
    return places.map(function (place) {
      var normalized = Model.normalizePlace(place, { allowIncomplete: allowIncomplete });
      if (seen.has(normalized.id)) throw new Error('Duplicate seed id: ' + normalized.id);
      seen.add(normalized.id);
      return normalized;
    });
  }

  function migrateStoredPlaces(places) {
    if (safeGet(SEED_MIGRATION_KEY) === 'done') return { places: places, changed: false };
    var seedById = new Map(state.seedPlaces.map(function (place) { return [place.id, place]; }));
    var changed = false;
    var migrated = places.map(function (place) {
      var source = seedById.get(place.id);
      if (!source) return place;
      var next = place;
      var aliases = SeedNameAliases[place.id] || [];
      if (aliases.indexOf(place.Name) >= 0 && place.Name !== source.Name) {
        next = Object.assign({}, next, { Name: source.Name });
        changed = true;
      }
      if (place.id === '3d5ea411129f81fc9555f75365404c8f' && isOldWorshipTime(place['Date&Time'])) {
        next = Object.assign({}, next, { 'Date&Time': source['Date&Time'] });
        changed = true;
      }
      return next;
    });
    return { places: migrated, changed: changed };
  }

  function isOldWorshipTime(dateTime) {
    if (!dateTime) return false;
    var key = String(dateTime.start || '') + '|' + String(dateTime.end || '');
    return key === '2026-09-12T05:00:00.000Z|2026-09-12T06:30:00.000Z' ||
      key === '2026-09-12T22:00:00.000Z|2026-09-12T23:30:00.000Z';
  }

  function bindEvents() {
    nodes.add.addEventListener('click', function () { openEditor(); });
    nodes.form.addEventListener('submit', onSubmitPlace);
    nodes.allDay.addEventListener('change', syncAllDayInputs);
    [nodes.totalFee, nodes.unitFee, nodes.quantity].forEach(function (input) { input.addEventListener('input', updateFeePreview); });
    nodes.openMapPicker.addEventListener('click', openMapPicker);
    nodes.previewMapUrl.addEventListener('click', previewManualMap);
    nodes.pickerManual.addEventListener('input', function () { chooseCandidate(null); });
    nodes.pickerSearch.addEventListener('input', renderPickerResults);
    nodes.applyMap.addEventListener('click', applyPickerCandidate);
    nodes.pickerSettings.addEventListener('click', function () { openSettings(); });
    nodes.openSettings.addEventListener('click', openSettings);
    nodes.routeModeTabs.addEventListener('click', onRouteModeClick);
    nodes.settingsForm.addEventListener('submit', saveSettings);
    nodes.clearGoogleKey.addEventListener('click', function () { nodes.googleApiKey.value = ''; });
    nodes.exportPlaces.addEventListener('click', exportPlaces);
    nodes.importFile.addEventListener('change', onImportFileChange);
    nodes.importPlaces.addEventListener('click', importPlaces);
    document.addEventListener('click', onDocumentClick);
    window.addEventListener('storage', onStorageEvent);
    document.querySelectorAll('[data-close-dialog]').forEach(function (button) {
      button.addEventListener('click', function () { closeDialog($(button.dataset.closeDialog)); });
    });
    nodes.mapPicker.addEventListener('close', function () { destroyPicker(true); });
    nodes.dayTabs.addEventListener('keydown', onDayTabsKeydown);
  }

  function onDocumentClick(event) {
    var dayButton = event.target.closest('.day-tab');
    if (dayButton) {
      state.activeDay = dayButton.dataset.day;
      state.selectedRouteId = '';
      state.routeMode = 'transit';
      render();
      return;
    }
    var routeButton = event.target.closest('.route-tab');
    if (routeButton) {
      state.selectedRouteId = routeButton.dataset.routeId;
      state.routeMode = 'transit';
      openRouteDetails();
      return;
    }
    var action = event.target.closest('[data-action]');
    if (!action) return;
    var card = event.target.closest('.place-card');
    var id = card && card.dataset.placeId;
    if (!id) return;
    if (action.dataset.action === 'edit') openEditor(id);
    if (action.dataset.action === 'delete') deletePlace(id);
    if (action.dataset.action === 'map') showPlaceMap(id);
  }

  function render() {
    var days = allDays();
    if (!days.includes(state.activeDay)) state.activeDay = days[0] || 'unassigned';
    renderDayTabs(days);
    renderDayPanel();
  }

  function allDays() {
    var days = new Set(state.baseDays);
    state.places.forEach(function (place) {
      var key = Model.dayKey(place, state.timeZone);
      if (key !== 'unassigned') days.add(key);
    });
    var sorted = Array.from(days).sort();
    sorted.push('unassigned');
    return sorted;
  }

  function firstDay() {
    var populated = Model.sortPlaces(state.places, state.timeZone).find(function (place) { return Model.dayKey(place, state.timeZone) !== 'unassigned'; });
    return populated ? Model.dayKey(populated, state.timeZone) : allDays()[0] || 'unassigned';
  }

  function renderDayTabs(days) {
    nodes.dayTabs.replaceChildren();
    days.forEach(function (day) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'day-tab';
      button.dataset.day = day;
      button.id = 'tab-' + day.replace(/[^a-zA-Z0-9_-]/g, '-');
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-controls', 'day-panel');
      button.tabIndex = day === state.activeDay ? 0 : -1;
      button.setAttribute('aria-selected', String(day === state.activeDay));
      button.textContent = dayLabel(day);
      nodes.dayTabs.append(button);
    });
  }

  function renderDayPanel() {
    var places = placesForDay(state.activeDay);
    var sorted = Model.sortPlaces(places, state.timeZone);
    var total = dailyTotal(sorted);
    nodes.dayPanel.setAttribute('aria-labelledby', 'tab-' + state.activeDay.replace(/[^a-zA-Z0-9_-]/g, '-'));
    nodes.dayTitle.textContent = state.activeDay === 'unassigned' ? '미배정' : formatDayTitle(state.activeDay);
    nodes.daySummary.textContent = sorted.length + '개 장소 · 파리 시간';
    nodes.dayTotal.textContent = euro(total.value) + ' 입력분';
    nodes.dayUnknown.textContent = total.unknown ? '금액 미입력/제외 ' + total.unknown + '개' : '금액 입력 완료';
    renderPlaces(sorted);
  }

  function placesForDay(day) {
    return state.places.filter(function (place) { return Model.dayKey(place, state.timeZone) === day; });
  }

  function showPlaceMap(id) {
    var place = state.places.find(function (candidate) { return candidate.id === id; });
    if (!place) return;
    state.selectedRouteId = '';
    nodes.routeDetailsTitle.textContent = place.Name;
    nodes.routeDetailsSummary.textContent = '저장된 장소 위치입니다.';
    nodes.routeModeTabs.hidden = true;
    setMapDialog(Model.mapEmbedUrl(place.Maps), place.Maps);
    showDialog(nodes.routeDetails);
  }

  function currentRoute() {
    return Model.buildRoutes(placesForDay(state.activeDay), state.timeZone).find(function (route) {
      return route.id === state.selectedRouteId;
    }) || null;
  }

  function openRouteDetails() {
    var route = currentRoute();
    if (!route) return;
    state.routeMode = 'transit';
    nodes.routeDetailsTitle.textContent = route.fromName + ' → ' + route.toName;
    nodes.routeDetailsSummary.textContent = '이동 수단을 선택하면 같은 출발지와 도착지의 Google Maps 경로를 다시 표시합니다.';
    nodes.routeModeTabs.hidden = false;
    renderRouteDetails(route);
    showDialog(nodes.routeDetails);
  }

  function onRouteModeClick(event) {
    var button = event.target.closest('[data-route-mode]');
    if (!button) return;
    state.routeMode = button.dataset.routeMode;
    var route = currentRoute();
    if (route) renderRouteDetails(route);
  }

  function renderRouteDetails(route) {
    var urls = Model.routeUrls(route, state.routeMode);
    nodes.routeModeTabs.querySelectorAll('[data-route-mode]').forEach(function (button) {
      button.setAttribute('aria-pressed', String(button.dataset.routeMode === state.routeMode));
    });
    setMapDialog(urls.embed, urls.external);
  }

  function setMapDialog(embed, external) {
    if (embed) nodes.routeDetailsFrame.src = embed;
    else nodes.routeDetailsFrame.removeAttribute('src');
    if (external && /^https?:\/\//.test(external)) {
      nodes.routeDetailsExternal.href = external;
      nodes.routeDetailsExternal.classList.remove('disabled');
      nodes.routeDetailsExternal.removeAttribute('aria-disabled');
    } else {
      nodes.routeDetailsExternal.href = '#';
      nodes.routeDetailsExternal.classList.add('disabled');
      nodes.routeDetailsExternal.setAttribute('aria-disabled', 'true');
    }
  }

  function renderPlaces(places) {
    nodes.placesList.replaceChildren();
    if (!places.length) {
      var empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.textContent = '이 일자에 표시할 장소가 없습니다.';
      nodes.placesList.append(empty);
      return;
    }
    var routesByPair = new Map();
    var explicitRoutesByDestination = new Map();
    Model.buildRoutes(places, state.timeZone).forEach(function (route) {
      if (route.kind === 'explicit') explicitRoutesByDestination.set(route.toId, route);
      else routesByPair.set(route.fromId + '::' + route.toId, route);
    });
    places.forEach(function (place, index) {
      var explicit = explicitRoutesByDestination.get(place.id);
      if (explicit) nodes.placesList.append(routeBetween(explicit));
      nodes.placesList.append(placeCard(place));
      var next = places[index + 1];
      var route = next && routesByPair.get(place.id + '::' + next.id);
      if (route) nodes.placesList.append(routeBetween(route));
    });
  }

  function routeBetween(route) {
    var wrap = document.createElement('div');
    wrap.className = 'route-between';
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'route-tab';
    button.dataset.routeId = route.id;
    button.dataset.fromId = route.fromId;
    button.dataset.toId = route.toId;
    button.textContent = '경로 · ' + route.fromName + ' → ' + route.toName;
    wrap.append(button);
    return wrap;
  }

  function placeCard(place) {
    var card = document.createElement('article');
    card.className = 'place-card';
    card.dataset.placeId = place.id;

    var top = document.createElement('div');
    top.className = 'place-top';
    var titleBox = document.createElement('div');
    var time = document.createElement('div');
    time.className = 'place-time';
    time.textContent = '일시 · ' + displayCompactTime(place);
    var title = document.createElement('h3');
    title.className = 'place-title';
    title.textContent = place.Name;
    titleBox.append(time, title);
    var actions = document.createElement('div');
    actions.className = 'place-actions';
    var mapButton = actionButton('지도', 'map');
    mapButton.disabled = !Model.mapEmbedUrl(place.Maps);
    actions.append(mapButton, actionButton('수정', 'edit'), actionButton('삭제', 'delete'));
    top.append(titleBox, actions);
    card.append(top);

    var pills = document.createElement('div');
    pills.className = 'pill-row';
    var fee = Model.getFee(place);
    pills.append(pill(fee.value === null ? '총액 · 미입력' : '총액 · ' + euro(fee.value), fee.value === null ? 'warn' : 'ok'));
    card.append(pills);

    var details = document.createElement('details');
    details.className = 'place-details';
    var detailsSummary = document.createElement('summary');
    detailsSummary.textContent = '상세 정보';
    details.append(detailsSummary);

    var grid = document.createElement('dl');
    grid.className = 'property-grid';
    addProp(grid, '일시', displayDateTime(place));
    addProp(grid, '예약 상태', propertyValue('Reservation Status', place['Reservation Status']));
    addProp(grid, '예약 필요 여부', propertyValue('Reservation', place.Reservation), 'reservation');
    addProp(grid, '총액', effectiveFeeText(place));
    addProp(grid, '1개당 금액', moneyOrDash(place['Pay per Each']));
    addProp(grid, '수량', numberOrDash(place.EA));
    addProp(grid, '우선순위', propertyValue('Priority', place.Priority));
    addProp(grid, '분류', propertyValue('Category', place.Category));
    addProp(grid, '참고 링크', place.URL, 'urls');
    addProp(grid, '지도', place.Maps, 'map');
    details.append(grid);

    var memo = document.createElement('div');
    memo.className = 'memo';
    var summary = document.createElement('strong');
    summary.textContent = '메모';
    var body = document.createElement('div');
    body.className = 'memo-body';
    body.textContent = place.memo || '미입력';
    memo.append(summary, body);
    details.append(memo);
    card.append(details);
    return card;
  }

  function actionButton(label, action) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = action === 'delete' ? 'button small danger' : 'button small';
    button.dataset.action = action;
    button.textContent = label;
    return button;
  }

  function pill(text, kind) {
    var span = document.createElement('span');
    span.className = 'pill' + (kind ? ' ' + kind : '');
    span.textContent = text;
    return span;
  }

  function addProp(grid, name, value, kind) {
    var box = document.createElement('div');
    box.className = 'property' + (['일시', '참고 링크', '지도'].includes(name) ? ' wide' : '');
    var dt = document.createElement('dt');
    dt.textContent = name;
    var dd = document.createElement('dd');
    if (kind === 'urls') appendLinks(dd, value);
    else if (kind === 'map' && value) appendSingleLink(dd, value, 'Google Maps');
    else if (kind === 'reservation') appendReservation(dd, value);
    else dd.textContent = value || '—';
    box.append(dt, dd);
    grid.append(box);
  }

  function appendReservation(node, value) {
    if (!value) { node.textContent = '—'; return; }
    var lines = String(value).split(/\r?\n/).filter(Boolean);
    lines.forEach(function (line, index) {
      if (index) node.append(document.createElement('br'));
      if (/^https?:\/\//i.test(line)) appendSingleLink(node, line, line);
      else node.append(document.createTextNode(line));
    });
  }

  function appendLinks(node, value) {
    if (!value) { node.textContent = '—'; return; }
    String(value).split(/\r?\n/).filter(Boolean).forEach(function (line, index) {
      if (index) node.append(document.createElement('br'));
      appendSingleLink(node, line, line);
    });
  }

  function appendSingleLink(node, href, label) {
    try {
      var url = new URL(href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsafe');
      var a = document.createElement('a');
      a.href = url.toString();
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      node.append(a);
    } catch (_) {
      node.textContent = '—';
    }
  }

  function openEditor(id) {
    state.editingId = id || null;
    clearErrors();
    var place = id ? state.places.find(function (candidate) { return candidate.id === id; }) : null;
    nodes.editorTitle.textContent = place ? '장소 수정' : '장소 추가';
    nodes.name.value = place ? place.Name : '';
    nodes.reservationStatus.value = place ? propertyValue('Reservation Status', place['Reservation Status']) : '';
    nodes.reservation.value = place ? propertyValue('Reservation', place.Reservation) : '';
    nodes.maps.value = place ? place.Maps : '';
    nodes.totalFee.value = place && place['Total Fee'] !== null ? place['Total Fee'] : '';
    nodes.unitFee.value = place && place['Pay per Each'] !== null ? place['Pay per Each'] : '';
    nodes.quantity.value = place && place.EA !== null ? place.EA : '';
    nodes.priority.value = place ? propertyValue('Priority', place.Priority) : '';
    nodes.category.value = place ? propertyValue('Category', place.Category) : '';
    nodes.url.value = place ? place.URL : '';
    nodes.memo.value = place ? place.memo : '';
    var start = place && place['Date&Time'] ? place['Date&Time'].start : '';
    var end = place && place['Date&Time'] ? place['Date&Time'].end : '';
    nodes.allDay.checked = Boolean(start && /^\d{4}-\d{2}-\d{2}$/.test(start));
    syncAllDayInputs();
    nodes.start.value = start ? (nodes.allDay.checked ? start : Model.formatDateTime(start, state.timeZone)) : '';
    nodes.end.value = end ? (nodes.allDay.checked ? end : Model.formatDateTime(end, state.timeZone)) : '';
    updateFeePreview();
    showDialog(nodes.editor);
  }

  function syncAllDayInputs() {
    var startValue = nodes.start.value;
    var endValue = nodes.end.value;
    if (nodes.allDay.checked) {
      nodes.start.type = 'date';
      nodes.end.type = 'date';
      if (startValue.includes('T')) nodes.start.value = startValue.slice(0, 10);
      if (endValue.includes('T')) nodes.end.value = endValue.slice(0, 10);
    } else {
      nodes.start.type = 'datetime-local';
      nodes.end.type = 'datetime-local';
      if (/^\d{4}-\d{2}-\d{2}$/.test(startValue)) nodes.start.value = startValue + 'T09:00';
      if (/^\d{4}-\d{2}-\d{2}$/.test(endValue)) nodes.end.value = endValue + 'T10:00';
    }
  }

  function formPlace() {
    var dateTime = null;
    if (nodes.start.value) {
      dateTime = {
        start: nodes.allDay.checked ? nodes.start.value : Model.zonedDateTime(nodes.start.value, state.timeZone),
        end: nodes.end.value ? (nodes.allDay.checked ? nodes.end.value : Model.zonedDateTime(nodes.end.value, state.timeZone)) : null,
      };
    }
    return {
      id: state.editingId || undefined,
      Name: nodes.name.value,
      'Date&Time': dateTime,
      'Reservation Status': propertyCode('Reservation Status', nodes.reservationStatus.value),
      Reservation: propertyCode('Reservation', nodes.reservation.value),
      'Total Fee': nodes.totalFee.value,
      'Pay per Each': nodes.unitFee.value,
      EA: nodes.quantity.value,
      Priority: propertyCode('Priority', nodes.priority.value),
      Category: propertyCode('Category', nodes.category.value),
      URL: nodes.url.value,
      Maps: nodes.maps.value,
      memo: nodes.memo.value,
    };
  }

  function onSubmitPlace(event) {
    event.preventDefault();
    clearErrors();
    if (state.corruptRaw !== null) {
      setErrors(nodes.formErrors, ['깨진 localStorage 원본이 있습니다. 먼저 원본을 다운로드하고 시드로 복구하거나 JSON을 가져오세요.']);
      return;
    }
    var normalized;
    try {
      normalized = Model.normalizePlace(formPlace(), { allowIncomplete: false });
    } catch (error) {
      setErrors(nodes.formErrors, fieldErrors(error));
      return;
    }
    var next = state.editingId ? state.places.map(function (place) { return place.id === state.editingId ? normalized : place; }) : state.places.concat(normalized);
    try {
      persistPlaces(next, false);
    } catch (error) {
      setErrors(nodes.formErrors, [error.message]);
      return;
    }
    state.places = next;
    state.activeDay = Model.dayKey(normalized, state.timeZone);
    state.selectedRouteId = '';
    closeDialog(nodes.editor);
    showStatus('저장했습니다. 경로 탭을 다시 계산했습니다.', 'ok');
    render();
  }

  function deletePlace(id) {
    var place = state.places.find(function (candidate) { return candidate.id === id; });
    if (!place) return;
    confirmAction('장소 삭제', '삭제하면 연결된 인접 경로 탭이 즉시 재계산됩니다.\n\n' + place.Name, function () {
      var next = state.places.filter(function (candidate) { return candidate.id !== id; });
      try { persistPlaces(next, false); }
      catch (error) { showStatus(error.message, 'error'); return; }
      state.places = next;
      state.selectedRouteId = '';
      showStatus('삭제했습니다. 경로 탭을 다시 계산했습니다.', 'ok');
      render();
    });
  }

  function persistPlaces(next, force) {
    var current = safeGet(STORAGE_KEY, true);
    if (current !== (force && state.corruptRaw !== null ? state.corruptRaw : state.persistedRaw)) throw new Error('다른 탭에서 저장된 변경이 있습니다. 페이지를 새로고침하거나 JSON으로 백업한 뒤 다시 시도하세요.');
    var serialized = Model.serializePlaces(next, state.timeZone);
    try { localStorage.setItem(STORAGE_KEY, serialized); }
    catch (error) { throw new Error('브라우저 저장소에 저장하지 못했습니다. 저장공간/권한을 확인하세요.'); }
    state.persistedRaw = serialized;
    state.corruptRaw = null;
  }

  function dailyTotal(places) {
    var value = 0;
    var unknown = 0;
    places.forEach(function (place) {
      var fee = Model.getFee(place);
      if (fee.value === null) unknown += 1;
      else value += fee.value;
    });
    return { value: value, unknown: unknown };
  }

  function updateFeePreview() {
    try {
      var normalized = Model.normalizePlace(Object.assign(formPlace(), { Name: 'preview', 'Date&Time': { start: '2026-01-01T00:00:00.000Z', end: null }, Maps: 'https://www.google.com/maps/search/?api=1&query=Paris' }));
      var fee = Model.getFee(normalized);
      nodes.feePreview.textContent = fee.value === null ? '합계: —' : '합계: ' + euro(fee.value) + ' · ' + (fee.source === 'manual' ? '총액 직접 입력' : '1개당 금액 × 수량');
    } catch (_) { nodes.feePreview.textContent = '합계: —'; }
  }

  function displayDateTime(place) {
    if (!place || !place['Date&Time']) return '미입력';
    var start = place['Date&Time'].start;
    var end = place['Date&Time'].end;
    var startText = /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : Model.formatDateTime(start, state.timeZone).replace('T', ' ');
    var endText = end ? (/^\d{4}-\d{2}-\d{2}$/.test(end) ? end : Model.formatDateTime(end, state.timeZone).replace('T', ' ')) : '';
    return endText ? startText + '–' + endText : startText;
  }

  function displayCompactTime(place) {
    if (!place || !place['Date&Time']) return '시간 미입력';
    var start = place['Date&Time'].start;
    var end = place['Date&Time'].end;
    if (/^\d{4}-\d{2}-\d{2}$/.test(start)) return '시간 미정';
    var startText = Model.formatDateTime(start, state.timeZone).slice(11);
    var endText = end && !/^\d{4}-\d{2}-\d{2}$/.test(end) ? Model.formatDateTime(end, state.timeZone).slice(11) : '';
    return endText ? startText + '–' + endText : startText;
  }

  function propertyValue(property, value) {
    if (!value) return '';
    var labels = PROPERTY_VALUE_LABELS[property] || {};
    return labels[value] || value;
  }

  function propertyCode(property, value) {
    if (!value) return '';
    var labels = PROPERTY_VALUE_LABELS[property] || {};
    var code = Object.keys(labels).find(function (key) { return labels[key] === value; });
    return code || value;
  }

  function openMapPicker() {
    destroyPicker(true);
    var token = state.picker.token;
    state.picker.candidate = null;
    nodes.pickerManual.value = nodes.maps.value || '';
    nodes.pickerSearch.value = '';
    nodes.googleSearch.replaceChildren();
    nodes.googleCanvas.replaceChildren();
    nodes.applyMap.disabled = true;
    chooseCandidate(null);
    nodes.mapPicker.classList.toggle('map-picker-keyless', !savedApiKey());
    showDialog(nodes.mapPicker);
    renderPickerResults();
    previewManualMap();
    mountGooglePicker(token);
  }

  function mountGooglePicker(token) {
    destroyPicker(false);
    var key = savedApiKey();
    if (!key) {
      nodes.pickerStatus.textContent = 'API 키가 없습니다. 저장된 장소 검색 또는 수동 Maps URL을 사용하세요.';
      return;
    }
    nodes.mapPicker.classList.remove('map-picker-keyless');
    if (!window.TravelMapPicker || typeof window.TravelMapPicker.mount !== 'function') {
      nodes.pickerStatus.textContent = 'Google Maps 어댑터를 불러오지 못했습니다. 수동 입력은 계속 가능합니다.';
      return;
    }
    nodes.pickerStatus.textContent = 'Google Maps SDK를 불러오는 중입니다…';
    window.TravelMapPicker.mount({
      mapElement: nodes.googleCanvas,
      searchElement: nodes.googleSearch,
      key: key,
      initialMaps: nodes.maps.value,
      onSelect: function (selection) {
        if (token !== state.picker.token) return;
        chooseCandidate(selection);
        nodes.pickerStatus.textContent = 'Google 결과를 선택했습니다. 적용을 누르면 지도 속성에 반영됩니다.';
      },
      onError: function (message) {
        if (token === state.picker.token) nodes.pickerStatus.textContent = message;
      },
    }).then(function (controller) {
      if (token !== state.picker.token || !nodes.mapPicker.open) {
        controller.destroy();
        return;
      }
      state.picker.controller = controller;
      nodes.pickerStatus.textContent = 'Google 검색 또는 지도 POI 클릭으로 후보를 선택하세요.';
    }).catch(function (error) {
      if (token === state.picker.token) nodes.pickerStatus.textContent = error.message || 'Google Maps를 사용할 수 없습니다. URL 직접 입력은 가능합니다.';
    });
  }

  function destroyPicker(invalidate) {
    if (invalidate) state.picker.token += 1;
    if (state.picker.controller) {
      try { state.picker.controller.destroy(); } catch (_) {}
      state.picker.controller = null;
    }
  }

  function renderPickerResults() {
    var query = nodes.pickerSearch.value.trim().toLowerCase();
    var results = state.places.filter(function (place) {
      return place.Maps && (!query || place.Name.toLowerCase().includes(query) || place.Maps.toLowerCase().includes(query));
    }).slice(0, 40);
    nodes.pickerResults.replaceChildren();
    if (!results.length) {
      var empty = document.createElement('p');
      empty.className = 'muted small-text';
      empty.textContent = '검색 결과 없음';
      nodes.pickerResults.append(empty);
      return;
    }
    results.forEach(function (place) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'saved-result';
      button.textContent = place.Name;
      var small = document.createElement('small');
      small.textContent = place.Maps;
      button.append(small);
      button.addEventListener('click', function () { chooseCandidate({ name: place.Name, maps: place.Maps, address: '' }); });
      nodes.pickerResults.append(button);
    });
  }

  function previewManualMap() {
    var maps = nodes.pickerManual.value.trim();
    if (!maps) {
      var fallback = 'https://www.google.com/maps/search/?api=1&query=Paris';
      nodes.pickerFrame.src = Model.mapEmbedUrl(fallback);
      chooseCandidate(null);
      return;
    }
    var embed = Model.mapEmbedUrl(maps);
    if (!embed) {
      nodes.pickerStatus.textContent = '지원되는 Google Maps URL이 아닙니다.';
      chooseCandidate(null);
      return;
    }
    nodes.pickerFrame.src = embed;
    chooseCandidate({ name: '', maps: maps, address: '' });
    nodes.pickerStatus.textContent = 'URL 후보를 미리보는 중입니다. iframe 클릭은 선택값으로 캡처되지 않습니다.';
  }

  function chooseCandidate(candidate) {
    state.picker.candidate = candidate;
    nodes.applyMap.disabled = !candidate || !candidate.maps || !Model.mapTarget(candidate.maps);
    nodes.pickerSelection.textContent = candidate && candidate.maps ? ((candidate.name || '수동 URL') + '\n' + candidate.maps + (candidate.address ? '\n' + candidate.address : '')) : '선택 없음';
    if (candidate && candidate.maps) {
      var embed = Model.mapEmbedUrl(candidate.maps);
      if (embed) nodes.pickerFrame.src = embed;
    }
  }

  function applyPickerCandidate() {
    var candidate = state.picker.candidate;
    if (!candidate || !candidate.maps) return;
    nodes.maps.value = candidate.maps;
    if (!nodes.name.value.trim() && candidate.name) nodes.name.value = candidate.name;
    closeDialog(nodes.mapPicker);
  }

  function openSettings() {
    nodes.settingsErrors.textContent = '';
    nodes.googleApiKey.value = savedApiKey();
    showDialog(nodes.settings);
  }

  function saveSettings(event) {
    event.preventDefault();
    nodes.settingsErrors.textContent = '';
    var key = nodes.googleApiKey.value.trim();
    if (key && !/^[A-Za-z0-9_-]{20,200}$/.test(key)) {
      nodes.settingsErrors.textContent = 'Google Maps API 키 형식이 이상합니다.';
      return;
    }
    var keySaved = key ? safeLocalSet(API_KEY, key) : safeLocalRemove(API_KEY);
    if (!keySaved && key) {
      nodes.settingsErrors.textContent = 'API 키를 이 브라우저에 저장하지 못했습니다. 브라우저 권한을 확인하세요. 장소 편집과 URL 입력은 계속 사용할 수 있습니다.';
      return;
    }
    closeDialog(nodes.settings);
    showStatus('설정을 저장했습니다. API 키를 바꾼 뒤 이미 지도가 로드되어 있으면 새로고침이 필요할 수 있습니다.', 'ok');
    render();
    if (nodes.mapPicker.open) {
      destroyPicker(true);
      nodes.mapPicker.classList.toggle('map-picker-keyless', !key);
      mountGooglePicker(state.picker.token);
    }
  }

  function exportPlaces() {
    if (state.corruptRaw !== null) {
      download('travel-guide-corrupt-storage.json', state.corruptRaw);
      showStatus('깨진 localStorage 원본을 다운로드했습니다. 복구 전까지 자동 덮어쓰기는 하지 않습니다.', 'warn');
      return;
    }
    download('travel-guide-places.json', Model.serializePlaces(state.places, state.timeZone));
  }

  function onImportFileChange(event) {
    var file = event.target.files && event.target.files[0];
    state.pendingImportRaw = '';
    if (!file) return;
    file.text().then(function (text) {
      state.pendingImportRaw = text;
      showStatus('가져올 JSON을 읽었습니다. “가져오기 실행”을 누르면 현재 로컬 데이터를 교체합니다.', 'warn');
    }).catch(function () { showStatus('파일을 읽지 못했습니다.', 'error'); });
  }

  function importPlaces() {
    if (!state.pendingImportRaw) { showStatus('먼저 JSON 파일을 선택하세요.', 'warn'); return; }
    var parsed;
    try { parsed = Model.parsePlaces(state.pendingImportRaw); }
    catch (error) { showStatus(error.message, 'error'); return; }
    confirmAction('JSON 가져오기', '현재 브라우저 로컬 일정이 가져온 JSON으로 교체됩니다. 계속할까요?', function () {
      var serialized = Model.serializePlaces(parsed.places, TIME_ZONE);
      var expectedRaw = state.corruptRaw !== null ? state.corruptRaw : state.persistedRaw;
      if (safeGet(STORAGE_KEY, true) !== expectedRaw) { showStatus('다른 탭에서 변경된 데이터가 있어 가져오기를 중단했습니다. 새로고침 후 다시 확인하세요.', 'error'); return; }
      try { localStorage.setItem(STORAGE_KEY, serialized); }
      catch (_) { showStatus('브라우저 저장소에 저장하지 못해서 가져오기를 취소했습니다.', 'error'); return; }
      state.places = parsed.places;
      state.persistedRaw = serialized;
      state.corruptRaw = null;
      state.activeDay = firstDay();
      state.selectedRouteId = '';
      state.pendingImportRaw = '';
      nodes.importFile.value = '';
      showStatus('JSON을 가져왔습니다. 경로 탭을 다시 계산했습니다.', 'ok');
      render();
    });
  }

  function showCorruptNotice() {
    nodes.status.replaceChildren();
    var box = document.createElement('div');
    box.className = 'notice error';
    var text = document.createElement('span');
    text.textContent = 'localStorage의 기존 JSON이 손상되어 시드 스냅샷만 임시 표시합니다. 원본을 다운로드한 뒤 명시적으로 복구하세요.';
    var downloadButton = document.createElement('button');
    downloadButton.className = 'button small';
    downloadButton.type = 'button';
    downloadButton.textContent = '깨진 원본 다운로드';
    downloadButton.addEventListener('click', function () { download('travel-guide-corrupt-storage.json', state.corruptRaw); });
    var restoreButton = document.createElement('button');
    restoreButton.className = 'button small danger';
    restoreButton.type = 'button';
    restoreButton.textContent = '시드로 복구';
    restoreButton.addEventListener('click', function () {
      confirmAction('시드로 복구', '깨진 localStorage 값을 현재 시드 스냅샷으로 교체합니다. 원본 다운로드를 권장합니다.', function () {
        try { persistPlaces(state.seedPlaces, true); }
        catch (error) { showStatus(error.message, 'error'); return; }
        state.places = state.seedPlaces.slice();
        showStatus('시드 스냅샷으로 복구했습니다.', 'ok');
        render();
      });
    });
    box.append(text, downloadButton, restoreButton);
    nodes.status.append(box);
  }

  function showStatus(message, kind) {
    nodes.status.replaceChildren();
    if (!message) return;
    var box = document.createElement('div');
    box.className = 'notice ' + (kind || '');
    box.textContent = message;
    nodes.status.append(box);
  }

  function confirmAction(title, message, onAccept) {
    nodes.confirmTitle.textContent = title;
    nodes.confirmMessage.textContent = message;
    var settled = false;
    function cleanup(accepted) {
      if (settled) return;
      settled = true;
      nodes.confirmAccept.removeEventListener('click', accept);
      nodes.confirmCancel.removeEventListener('click', cancel);
      nodes.confirm.removeEventListener('close', closed);
      nodes.confirm.removeEventListener('cancel', cancel);
      if (accepted) onAccept();
    }
    function accept() { closeDialog(nodes.confirm); cleanup(true); }
    function cancel(event) { if (event) event.preventDefault(); closeDialog(nodes.confirm); cleanup(false); }
    function closed() { cleanup(false); }
    nodes.confirmAccept.addEventListener('click', accept);
    nodes.confirmCancel.addEventListener('click', cancel);
    nodes.confirm.addEventListener('cancel', cancel);
    nodes.confirm.addEventListener('close', closed);
    showDialog(nodes.confirm);
  }

  function onStorageEvent(event) {
    if (event.key !== STORAGE_KEY) return;
    if (nodes.editor.open) {
      setErrors(nodes.formErrors, ['다른 탭에서 데이터가 변경되었습니다. 저장하려면 먼저 새로고침하거나 JSON으로 백업하세요.']);
      return;
    }
    if (event.newValue === state.persistedRaw) return;
    try {
      if (event.newValue !== null) {
        var parsed = Model.parsePlaces(event.newValue);
        state.places = parsed.places;
        state.persistedRaw = event.newValue;
        state.corruptRaw = null;
        showStatus('다른 탭의 변경사항을 반영했습니다.', 'ok');
      } else {
        state.places = state.seedPlaces.slice();
        state.persistedRaw = null;
        state.corruptRaw = null;
      }
      render();
    } catch (_) {
      state.corruptRaw = event.newValue || '';
      showCorruptNotice();
    }
  }

  function onDayTabsKeydown(event) {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    var tabs = Array.from(nodes.dayTabs.querySelectorAll('.day-tab'));
    var current = tabs.findIndex(function (tab) { return tab.dataset.day === state.activeDay; });
    if (current < 0) current = 0;
    var next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    if (event.key === 'ArrowLeft') next = (current - 1 + tabs.length) % tabs.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = tabs.length - 1;
    event.preventDefault();
    tabs[next].focus();
    state.activeDay = tabs[next].dataset.day;
    state.selectedRouteId = '';
    render();
  }

  function savedApiKey() { return safeGet(API_KEY) || ''; }
  function safeLocalSet(key, value) { try { localStorage.setItem(key, value); return true; } catch (_) { return false; } }
  function safeLocalRemove(key) { try { localStorage.removeItem(key); return true; } catch (_) { return false; } }
  function migrateApiKeyStorage() {
    try {
      var legacy = sessionStorage.getItem(API_KEY) || '';
      if (!savedApiKey() && legacy) safeLocalSet(API_KEY, legacy);
      sessionStorage.removeItem(API_KEY);
    } catch (_) {}
  }

  function effectiveFeeText(place) {
    var fee = Model.getFee(place);
    if (fee.value === null) return '—';
    return euro(fee.value) + (fee.source === 'calculated' ? ' (자동)' : '');
  }

  function clearErrors() { nodes.formErrors.textContent = ''; }
  function setErrors(node, errors) { node.textContent = errors.join('\n'); }
  function fieldErrors(error) {
    if (!error || !error.fields) return [error && error.message ? error.message : '입력값을 확인하세요.'];
    return Object.keys(error.fields).map(function (field) { return (PROPERTY_LABELS[field] || field) + ': ' + error.fields[field]; });
  }

  function showDialog(dialog) { if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); }
  function closeDialog(dialog) { if (!dialog) return; if (dialog.close) dialog.close(); else dialog.removeAttribute('open'); }
  function safeGet(key, raw) { try { var value = localStorage.getItem(key); return raw ? value : value; } catch (_) { return null; } }
  function download(name, content) {
    var blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function euro(value) { return '€' + Number(value).toFixed(2); }
  function moneyOrDash(value) { return value === null || value === undefined ? '—' : euro(value); }
  function numberOrDash(value) { return value === null || value === undefined ? '—' : String(value); }
  function dayLabel(day) {
    if (day === 'unassigned') return '미배정';
    var parts = day.split('-').map(Number);
    var weekday = ['일', '월', '화', '수', '목', '금', '토'][new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay()];
    return parts[1] + '/' + parts[2] + '(' + weekday + ')';
  }
  function formatDayTitle(day) { return day + ' 일정'; }
})();
