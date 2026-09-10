(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
    return;
  }
  var api = factory();
  if (root) {
    root.TravelPlaces = api;
    if (root.window && root.window !== root) {
      root.window.TravelPlaces = api;
    }
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var PLACE_FIELDS = [
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
  ];

  var TEXT_FIELDS = ['Reservation Status', 'Priority', 'Category', 'memo'];
  var MAX_STRING_LENGTH = 20000;
  var MAX_BACKUP_BYTES = 1024 * 1024;
  var MAX_PLACES = 1000;

  function validationError(fields) {
    var error = new Error('Place validation failed');
    error.fields = fields;
    return error;
  }

  function isBlank(value) {
    return value === undefined || value === null || value === '';
  }

  function asString(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
  }

  function normalizeText(value) {
    if (!isBlank(value) && typeof value !== 'string') throw new Error('Value must be text');
    var text = asString(value);
    if (text.length > MAX_STRING_LENGTH) throw new Error('Value is too long');
    return text;
  }

  function normalizeId(value) {
    if (!isBlank(value) && typeof value !== 'string') throw new Error('id must be text');
    var id = asString(value);
    if (!id) return createId();
    if (id.length > 200) throw new Error('id is too long');
    return id;
  }

  function createId() {
    var random = Math.random().toString(36).slice(2, 10);
    return 'place_' + Date.now().toString(36) + '_' + random;
  }

  function normalizeNumber(value, field) {
    if (isBlank(value)) return null;
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(field + ' must be a number');
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'boolean') throw new Error(field + ' must be a finite non-negative number');
    var number = typeof value === 'number' ? value : Number(String(value).trim());
    if (!Number.isFinite(number)) throw new Error(field + ' must be a finite number');
    if (number < 0) throw new Error(field + ' must be non-negative');
    return number;
  }

  function isDateOnly(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function isLocalDateTime(value) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?$/.test(value);
  }

  function isValidDateOnly(value) {
    if (!isDateOnly(value)) return false;
    var parts = value.split('-').map(Number);
    var d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return d.getUTCFullYear() === parts[0] && d.getUTCMonth() === parts[1] - 1 && d.getUTCDate() === parts[2];
  }

  function isValidDateTime(value) {
    if (typeof value !== 'string') return false;
    if (isDateOnly(value)) return isValidDateOnly(value);
    if (isLocalDateTime(value)) {
      return localParts(value) !== null;
    }
    if (isOffsetDateTime(value)) return offsetDateTimeValid(value);
    var time = Date.parse(value);
    return Number.isFinite(time);
  }

  function isOffsetDateTime(value) {
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value);
  }

  function offsetDateTimeValid(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):?(\d{2}))$/.exec(value);
    if (!match) return false;
    var parts = {
      year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
      hour: Number(match[4]), minute: Number(match[5]), second: match[6] ? Number(match[6]) : 0,
      millisecond: match[7] ? Number((match[7] + '000').slice(0, 3)) : 0,
    };
    if (!validLocalParts(parts)) return false;
    var offset = 0;
    if (match[8] !== 'Z') {
      offset = (Number(match[10]) * 60 + Number(match[11])) * 60 * 1000;
      if (match[9] === '-') offset = -offset;
    }
    var utc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond) - offset;
    var shifted = new Date(utc + offset);
    return shifted.getUTCFullYear() === parts.year && shifted.getUTCMonth() === parts.month - 1 && shifted.getUTCDate() === parts.day && shifted.getUTCHours() === parts.hour && shifted.getUTCMinutes() === parts.minute && shifted.getUTCSeconds() === parts.second;
  }

  function localParts(value) {
    var match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(value);
    if (!match) return null;
    var year = Number(match[1]);
    var month = Number(match[2]);
    var day = Number(match[3]);
    var hour = Number(match[4]);
    var minute = Number(match[5]);
    var second = match[6] ? Number(match[6]) : 0;
    var ms = match[7] ? Number((match[7] + '000').slice(0, 3)) : 0;
    if (!validLocalParts({ year: year, month: month, day: day, hour: hour, minute: minute, second: second, millisecond: ms })) return null;
    var d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day || d.getUTCHours() !== hour || d.getUTCMinutes() !== minute || d.getUTCSeconds() !== second) {
      return null;
    }
    return { year: year, month: month, day: day, hour: hour, minute: minute, second: second, millisecond: ms };
  }

  function validLocalParts(parts) {
    return parts.month >= 1 && parts.month <= 12 && parts.day >= 1 && parts.day <= 31 &&
      parts.hour >= 0 && parts.hour <= 23 && parts.minute >= 0 && parts.minute <= 59 &&
      parts.second >= 0 && parts.second <= 59 && parts.millisecond >= 0 && parts.millisecond <= 999;
  }

  function normalizeDateTime(value, allowIncomplete) {
    if (isBlank(value)) {
      if (allowIncomplete) return null;
      throw new Error('Date&Time is required');
    }
    var dateTime;
    if (typeof value === 'string') {
      dateTime = { start: asString(value), end: null };
    } else if (typeof value === 'object') {
      dateTime = {
        start: asString(value.start),
        end: isBlank(value.end) ? null : asString(value.end),
      };
    } else {
      throw new Error('Date&Time must be an object or string');
    }
    if (!dateTime.start) throw new Error('Date&Time.start is required');
    if (!isValidDateTime(dateTime.start)) throw new Error('Date&Time.start is invalid');
    if (dateTime.end !== null && !isValidDateTime(dateTime.end)) throw new Error('Date&Time.end is invalid');
    if (dateTime.end !== null) {
      var startMs = valueToMs(dateTime.start, 'UTC');
      var endMs = valueToMs(dateTime.end, 'UTC');
      if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs < startMs) {
        throw new Error('Date&Time.end must be after start');
      }
    }
    return dateTime;
  }

  function normalizeHttpLines(value, field) {
    if (isBlank(value)) return '';
    if (typeof value !== 'string') throw new Error(field + ' must be text');
    var lines = String(value)
      .split(/\r?\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean);
    if (!lines.length) return '';
    lines.forEach(function (line) { validateHttpUrl(line, field); });
    return lines.join('\n');
  }

  function normalizeReservation(value) {
    var text = normalizeText(value);
    if (!text) return '';
    text.split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean).forEach(function (line) {
      if (/^[a-z][a-z0-9+.-]*:/i.test(line)) validateHttpUrl(line, 'Reservation');
    });
    return text;
  }

  function validateHttpUrl(value, field) {
    var url;
    try {
      url = new URL(value);
    } catch (error) {
      throw new Error(field + ' must be a valid HTTP(S) URL');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(field + ' must be an HTTP(S) URL');
    if (url.username || url.password) throw new Error(field + ' URL credentials are not allowed');
  }

  function normalizeMaps(value, allowIncomplete) {
    var maps = normalizeText(value);
    if (!maps) {
      if (allowIncomplete) return '';
      throw new Error('Maps is required');
    }
    if (!mapTarget(maps)) throw new Error('Maps must be a supported Google Maps URL without API credentials');
    return maps;
  }

  function normalizePlace(raw, options) {
    options = options || {};
    var allowIncomplete = Boolean(options.allowIncomplete);
    var source = raw && typeof raw === 'object' ? raw : {};
    var errors = {};
    var place = {};

    try { place.id = normalizeId(source.id); } catch (error) { errors.id = error.message; }
    try {
      var name = normalizeText(source.Name);
      if (!name) throw new Error('Name is required');
      place.Name = name;
    } catch (error) { errors.Name = error.message; }
    try { place['Date&Time'] = normalizeDateTime(source['Date&Time'], allowIncomplete); } catch (error) { errors['Date&Time'] = error.message; }
    TEXT_FIELDS.forEach(function (field) {
      try { place[field] = normalizeText(source[field]); } catch (error) { errors[field] = error.message; }
    });
    try { place.Reservation = normalizeReservation(source.Reservation); } catch (error) { errors.Reservation = error.message; }
    try { place['Total Fee'] = normalizeNumber(source['Total Fee'], 'Total Fee'); } catch (error) { errors['Total Fee'] = error.message; }
    try { place['Pay per Each'] = normalizeNumber(source['Pay per Each'], 'Pay per Each'); } catch (error) { errors['Pay per Each'] = error.message; }
    try { place.EA = normalizeNumber(source.EA, 'EA'); } catch (error) { errors.EA = error.message; }
    try { place.URL = normalizeHttpLines(source.URL, 'URL'); } catch (error) { errors.URL = error.message; }
    try { place.Maps = normalizeMaps(source.Maps, allowIncomplete); } catch (error) { errors.Maps = error.message; }

    if (Object.keys(errors).length) throw validationError(errors);
    return PLACE_FIELDS.reduce(function (copy, field) {
      copy[field] = place[field];
      return copy;
    }, {});
  }

  function validatePlace(raw, options) {
    try {
      normalizePlace(raw, options);
      return { valid: true, errors: {} };
    } catch (error) {
      if (error && error.fields) return { valid: false, errors: error.fields };
      return { valid: false, errors: { _error: error.message || String(error) } };
    }
  }

  function getFee(place) {
    if (place && place['Total Fee'] !== null && place['Total Fee'] !== undefined) {
      return { value: place['Total Fee'], source: 'manual' };
    }
    if (place && place['Pay per Each'] !== null && place['Pay per Each'] !== undefined && place.EA !== null && place.EA !== undefined) {
      var calculated = place['Pay per Each'] * place.EA;
      if (!Number.isFinite(calculated)) return { value: null, source: 'unknown' };
      return { value: roundMoney(calculated), source: 'calculated' };
    }
    return { value: null, source: 'unknown' };
  }

  function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }

  function dateFormatter(timeZone) {
    return new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timeZone || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
  }

  function partsFor(ms, timeZone) {
    var parts = dateFormatter(timeZone).formatToParts(new Date(ms));
    var result = {};
    parts.forEach(function (part) {
      if (part.type !== 'literal') result[part.type] = Number(part.value);
    });
    return {
      year: result.year,
      month: result.month,
      day: result.day,
      hour: result.hour,
      minute: result.minute,
      second: result.second,
    };
  }

  function sameLocalParts(a, b) {
    return a.year === b.year && a.month === b.month && a.day === b.day && a.hour === b.hour && a.minute === b.minute && (a.second || 0) === (b.second || 0);
  }

  function formatDateOnly(parts) {
    return pad(parts.year, 4) + '-' + pad(parts.month, 2) + '-' + pad(parts.day, 2);
  }

  function pad(value, length) {
    return String(value).padStart(length, '0');
  }

  function offsetMsAt(ms, timeZone) {
    var parts = partsFor(ms, timeZone);
    var localAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0);
    return localAsUtc - Math.floor(ms / 1000) * 1000;
  }

  function possibleOffsets(approx, timeZone) {
    var offsets = new Set();
    for (var delta = -48; delta <= 48; delta += 6) {
      offsets.add(offsetMsAt(approx + delta * 60 * 60 * 1000, timeZone));
    }
    return Array.from(offsets);
  }

  function zonedDateTime(local, timeZone) {
    var value = asString(local);
    if (isDateOnly(value)) {
      if (!isValidDateOnly(value)) throw new Error('Invalid date');
      value = value + 'T00:00';
    }
    var desired = localParts(value);
    if (!desired) throw new Error('Invalid local datetime');
    var localAsUtc = Date.UTC(desired.year, desired.month - 1, desired.day, desired.hour, desired.minute, desired.second || 0, desired.millisecond || 0);
    var matches = possibleOffsets(localAsUtc, timeZone).map(function (offset) {
      return localAsUtc - offset;
    }).filter(function (candidate, index, candidates) {
      return candidates.indexOf(candidate) === index && sameLocalParts(partsFor(candidate, timeZone), desired);
    });
    if (!matches.length) throw new Error('Local datetime does not exist in ' + timeZone);
    matches.sort(function (a, b) { return a - b; });
    return new Date(matches[0]).toISOString();
  }

  function formatDateTime(value, timeZone) {
    var start = value && typeof value === 'object' && value.start ? value.start : value;
    if (isBlank(start)) return '';
    start = asString(start);
    if (isDateOnly(start)) return start;
    var ms;
    if (isLocalDateTime(start)) ms = Date.parse(zonedDateTime(start.slice(0, 16), timeZone));
    else ms = Date.parse(start);
    if (!Number.isFinite(ms)) throw new Error('Invalid datetime');
    var parts = partsFor(ms, timeZone);
    return formatDateOnly(parts) + 'T' + pad(parts.hour, 2) + ':' + pad(parts.minute, 2);
  }

  function valueToMs(value, timeZone) {
    if (isBlank(value)) return Infinity;
    var text = asString(value);
    if (isDateOnly(text)) return Date.parse(zonedDateTime(text + 'T00:00', timeZone || 'UTC'));
    if (isLocalDateTime(text)) return Date.parse(zonedDateTime(text.slice(0, 16), timeZone || 'UTC'));
    var parsed = Date.parse(text);
    return parsed;
  }

  function sortPlaces(places, timeZone) {
    return (Array.isArray(places) ? places : [])
      .map(function (place, index) { return { place: place, index: index, time: place && place['Date&Time'] ? valueToMs(place['Date&Time'].start, timeZone) : Infinity }; })
      .sort(function (a, b) {
        if (a.time !== b.time) return a.time - b.time;
        return a.index - b.index;
      })
      .map(function (entry) { return entry.place; });
  }

  function dayKey(place, timeZone) {
    if (!place || !place['Date&Time'] || !place['Date&Time'].start) return 'unassigned';
    var start = asString(place['Date&Time'].start);
    if (isDateOnly(start)) return start;
    var ms = isLocalDateTime(start) ? Date.parse(zonedDateTime(start.slice(0, 16), timeZone || 'UTC')) : Date.parse(start);
    if (!Number.isFinite(ms)) return 'unassigned';
    return formatDateOnly(partsFor(ms, timeZone || 'UTC'));
  }

  function buildRoutes(places, timeZone) {
    var sorted = sortPlaces(places, timeZone);
    var byDay = new Map();
    sorted.forEach(function (place) {
      var key = dayKey(place, timeZone);
      if (key === 'unassigned') return;
      if (!byDay.has(key)) byDay.set(key, []);
      byDay.get(key).push(place);
    });
    var routes = [];
    byDay.forEach(function (dayPlaces, date) {
      for (var i = 0; i < dayPlaces.length - 1; i += 1) {
        var from = dayPlaces[i];
        var to = dayPlaces[i + 1];
        if (!mapTarget(from.Maps) || !mapTarget(to.Maps)) continue;
        routes.push({
          id: 'route:' + from.id + ':' + to.id,
          fromId: from.id,
          toId: to.id,
          fromName: from.Name,
          toName: to.Name,
          date: date,
          origin: from.Maps,
          destination: to.Maps,
        });
      }
    });
    return routes;
  }

  function mapTarget(input) {
    var raw = asString(input);
    if (!raw || raw.length > MAX_STRING_LENGTH) return null;
    var url;
    try {
      url = new URL(raw);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    var host = url.hostname.toLowerCase();
    if (!isGoogleMapsHost(host)) return null;
    if (host === 'maps.app.goo.gl' || host.endsWith('.goo.gl')) return null;
    if (!url.pathname.startsWith('/maps') && !url.searchParams.has('q') && !url.searchParams.has('query')) return null;
    if (hasCredentialParams(url.searchParams)) return null;

    var params = url.searchParams;
    var query = params.get('query') || params.get('q') || params.get('destination') || finalDestination(params.get('daddr')) || params.get('to') || '';
    if (!query && params.get('ll')) query = params.get('ll');
    var placeId = params.get('query_place_id') || params.get('place_id') || undefined;
    var coords = bangCoordinates(url.href) || pathCoordinates(url.pathname) || queryCoordinates(query);
    var pathName = placeName(url.pathname);
    if (!query && pathName) query = pathName;
    if (!query && coords) query = coords.lat + ',' + coords.lng;
    query = query ? query.trim() : '';
    if (!query && !coords) return null;
    var target = { query: query };
    if (placeId) target.placeId = placeId;
    if (coords) {
      target.lat = coords.lat;
      target.lng = coords.lng;
    }
    return target;
  }

  function hasCredentialParams(params) {
    var blocked = new Set(['key', 'api_key', 'apikey', 'signature', 'client']);
    var found = false;
    params.forEach(function (_value, key) {
      if (blocked.has(String(key).toLowerCase())) found = true;
    });
    return found;
  }

  function finalDestination(value) {
    if (!value) return '';
    var parts = String(value).split(/\s+to\s+/i).map(function (part) { return part.trim(); }).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : value;
  }

  function isGoogleMapsHost(host) {
    if (host === 'google.com' || host === 'www.google.com' || host === 'maps.google.com') return true;
    return /^(www\.|maps\.)?google\.(?:[a-z]{2}|com\.[a-z]{2}|co\.[a-z]{2})$/.test(host);
  }

  function pathCoordinates(pathname) {
    var match = /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:[,/]|$)/.exec(pathname);
    if (!match) return null;
    return validCoords(Number(match[1]), Number(match[2]));
  }

  function bangCoordinates(href) {
    var match = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(href);
    if (!match) return null;
    return validCoords(Number(match[1]), Number(match[2]));
  }

  function queryCoordinates(query) {
    if (!query) return null;
    var match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(query);
    if (!match) return null;
    return validCoords(Number(match[1]), Number(match[2]));
  }

  function validCoords(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
    return { lat: lat, lng: lng };
  }

  function placeName(pathname) {
    var match = /\/maps\/place\/([^/@]+)/.exec(pathname);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1].replace(/\+/g, ' '));
    } catch (error) {
      return match[1].replace(/\+/g, ' ');
    }
  }

  function targetQuery(target) {
    if (!target) return '';
    if (Number.isFinite(target.lat) && Number.isFinite(target.lng)) return target.lat + ',' + target.lng;
    if (target.placeId) return 'place_id:' + target.placeId;
    return target.query || '';
  }

  function mapEmbedUrl(maps) {
    var target = mapTarget(maps);
    if (!target) return null;
    var params = new URLSearchParams();
    params.set('q', targetQuery(target));
    params.set('output', 'embed');
    return 'https://www.google.com/maps?' + params.toString();
  }

  function routeUrls(route, mode) {
    var travelMode = normalizeMode(mode);
    var origin = targetQuery(mapTarget(route && route.origin));
    var destination = targetQuery(mapTarget(route && route.destination));
    if (!origin || !destination) return { embed: null, external: null };
    var embedParams = new URLSearchParams();
    embedParams.set('saddr', origin);
    embedParams.set('daddr', destination);
    embedParams.set('dirflg', modeFlag(travelMode));
    embedParams.set('output', 'embed');
    var externalParams = new URLSearchParams();
    externalParams.set('api', '1');
    externalParams.set('origin', origin);
    externalParams.set('destination', destination);
    externalParams.set('travelmode', travelMode);
    return {
      embed: 'https://www.google.com/maps?' + embedParams.toString(),
      external: 'https://www.google.com/maps/dir/?' + externalParams.toString(),
    };
  }

  function normalizeMode(mode) {
    return ['driving', 'walking', 'bicycling', 'transit'].indexOf(mode) >= 0 ? mode : 'transit';
  }

  function modeFlag(mode) {
    return { driving: 'd', walking: 'w', bicycling: 'b', transit: 'r' }[mode] || 'r';
  }

  function serializePlaces(places, timeZone) {
    var normalized = (Array.isArray(places) ? places : []).map(function (place) {
      return normalizePlace(place, { allowIncomplete: true });
    });
    ensureUniqueIds(normalized);
    return JSON.stringify({ version: 1, timeZone: normalizeTimeZone(timeZone), places: normalized }, null, 2);
  }

  function parsePlaces(json) {
    if (typeof json !== 'string') throw new Error('Invalid JSON backup');
    if (json.length > MAX_BACKUP_BYTES) throw new Error('Backup is too large');
    var parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      throw new Error('Invalid JSON backup');
    }
    if (!parsed || parsed.version !== 1) throw new Error('Unsupported backup version');
    if (!Array.isArray(parsed.places)) throw new Error('Backup places must be an array');
    if (parsed.places.length > MAX_PLACES) throw new Error('Too many places in backup');
    var timeZone = normalizeTimeZone(parsed.timeZone);
    var places = parsed.places.map(function (place) {
      return normalizePlace(place, { allowIncomplete: true });
    });
    ensureUniqueIds(places);
    return { version: 1, timeZone: timeZone, places: places };
  }

  function normalizeTimeZone(timeZone) {
    var value = asString(timeZone) || 'Europe/Paris';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
      return value;
    } catch (error) {
      throw new Error('Invalid timeZone: ' + value);
    }
  }

  function ensureUniqueIds(places) {
    var seen = new Set();
    places.forEach(function (place) {
      if (seen.has(place.id)) throw new Error('Duplicate place id: ' + place.id);
      seen.add(place.id);
    });
  }

  return {
    PLACE_FIELDS: PLACE_FIELDS.slice(),
    normalizePlace: normalizePlace,
    validatePlace: validatePlace,
    getFee: getFee,
    sortPlaces: sortPlaces,
    dayKey: dayKey,
    buildRoutes: buildRoutes,
    mapTarget: mapTarget,
    mapEmbedUrl: mapEmbedUrl,
    routeUrls: routeUrls,
    formatDateTime: formatDateTime,
    zonedDateTime: zonedDateTime,
    serializePlaces: serializePlaces,
    parsePlaces: parsePlaces,
  };
});
