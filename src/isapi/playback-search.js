/**
 * Playback Search — Hikvision ISAPI RaCM recorded-video search.
 *
 * Searches recorded segments on an NVR/DVR for a camera + time range via
 * POST /ISAPI/ContentMgmt/search, returning the matched segments and a
 * rebuildable playback RTSP URL for each.
 *
 * Reuses the 2-step Digest Auth pattern (parseDigestChallenge/buildDigestHeader)
 * exactly like line-crossing-api.js / capabilities-probe.js — only the HTTP
 * method differs (POST + XML body).
 *
 * Verified against DS-7616NI-E2 (firmware V3.4.106), 2026-06-22. See
 * RESEARCH/NVR-DVR_Playback/07_VERIFIED_LIVE_TEST.md.
 *
 * CRITICAL findings baked in here:
 *   - searchID MUST be a GUID/UUID, else firmware replies "400 Invalid XML
 *     Content". We use crypto.randomUUID().
 *   - timeSpan times MUST be UTC (Z).
 *   - The device-returned <playbackURI> uses the device-internal RTSP port
 *     (default 554) and no credentials — NOT necessarily reachable from us.
 *     For streaming we rebuild the URL via camera-manager.buildPlaybackRtspUrl()
 *     using the configured RTSP port + credentials.
 */

const http = require('http');
const crypto = require('crypto');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');
const { config } = require('../config');
const cameraManager = require('../camera-manager');
const playbackSource = require('./playback-source');

const TIMEOUT_MS = 12000;
const SEARCH_URI = '/ISAPI/ContentMgmt/search';

// ─── HTTP (2-step Digest, POST + XML) ───────────────────────────────────

function httpRequest(method, host, port, uri, authHeader, body) {
  return new Promise((resolve) => {
    const headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    if (body) {
      headers['Content-Type'] = 'application/xml';
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = http.request({ hostname: host, port, path: uri, method, headers, timeout: TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, headers: {}, body: '' }); });
    req.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

async function isapiPost(ip, port, uri, user, pass, xmlBody) {
  const first = await httpRequest('POST', ip, port, uri, null, xmlBody);
  if (first.statusCode === 200) return first;
  if (first.statusCode !== 401) return first;

  const challenge = parseDigestChallenge(first.headers['www-authenticate']);
  if (!challenge) return { statusCode: 401, body: 'Failed to parse digest challenge' };

  const authHeader = buildDigestHeader('POST', uri, user, pass, challenge);
  return httpRequest('POST', ip, port, uri, authHeader, xmlBody);
}

// ─── Device time convention / display offset ─────────────────────────────
// Display timezone: a SINGLE fixed offset (minutes to ADD to the device's
// UTC-tagged recording numerals to get the wall-clock the user wants to see).
// Hikvision search times are tagged "Z" (UTC); adding the configured country
// offset yields local wall-clock matching the OSD. The offset is chosen by
// country in Settings (capital-city offset) and stored in config.displayTzOffsetMin
// — NO per-device auto-detection (deterministic & user-controlled). The frontend
// works in UTC-labeled wall-clock; this module converts to/from device UTC.
//
// @returns {number} configured display offset in minutes (e.g. 420 for WIB).
async function getDisplayOffsetMin(/* src */) {
  return config.displayTzOffsetMin || 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────

/** channelID (1-based) → Hikvision trackID (CH1=101, CH6=601). */
function channelToTrack(channelID) {
  return Number(channelID) * 100 + 1;
}

/** JS Date → UTC ISO without milliseconds: "2026-06-22T00:00:00Z". */
function toUtcIso(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Build CMSearchDescription. Minimal body verified to work on V3.4.106:
 * searchID(GUID) + trackIDList + timeSpanList + maxResults. searchResultPostion
 * (note the canonical Hikvision misspelling) included for paging.
 */
function buildSearchXml({ trackID, startIso, endIso, max, pos }) {
  return `<?xml version="1.0" encoding="utf-8"?>
<CMSearchDescription>
  <searchID>${crypto.randomUUID()}</searchID>
  <trackIDList><trackID>${trackID}</trackID></trackIDList>
  <timeSpanList><timeSpan>
    <startTime>${startIso}</startTime>
    <endTime>${endIso}</endTime>
  </timeSpan></timeSpanList>
  <maxResults>${max}</maxResults>
  <searchResultPostion>${pos}</searchResultPostion>
</CMSearchDescription>`;
}

/** Parse CMSearchResult XML (regex-based, consistent with engine's other parsers). */
function parseSearchResult(xml) {
  const items = [];
  const re = /<searchMatchItem>([\s\S]*?)<\/searchMatchItem>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const grab = (tag) => (block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`)) || [])[1];
    const rawUri = grab('playbackURI');
    items.push({
      trackID: grab('trackID') || null,
      startTime: grab('startTime') || null,
      endTime: grab('endTime') || null,
      contentType: grab('contentType') || null,
      codecType: grab('codecType') || null,
      // Decode XML entities; kept mainly for ISAPI download (POST back to device).
      playbackURI: rawUri ? rawUri.replace(/&amp;/g, '&') : null,
    });
  }
  const statusStrg = (xml.match(/<responseStatusStrg>([\s\S]*?)<\/responseStatusStrg>/) || [])[1] || '';
  const numMatch = (xml.match(/<numOfMatches>(\d+)<\/numOfMatches>/) || [])[1];
  return {
    items,
    numOfMatches: numMatch ? parseInt(numMatch, 10) : items.length,
    more: /MORE/i.test(statusStrg),
    statusStrg,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Search recorded segments for a camera in [start, end].
 *
 * @param {string} cameraId
 * @param {Date} startDate  - inclusive start (any tz; converted to UTC)
 * @param {Date} endDate    - inclusive end
 * @param {object} [opts]   - { max=40, pos=0 }
 * @returns {Promise<object>} { camera, trackID, numOfMatches, more, segments[] } or { error }
 */
async function searchRecordings(cameraId, startDate, endDate, opts = {}) {
  if (!(startDate instanceof Date) || isNaN(startDate) || !(endDate instanceof Date) || isNaN(endDate)) {
    return { error: 'invalid start/end date' };
  }

  // Resolve where playback comes from. Default = the NVR channel that carries
  // this camera; the caller may force 'nvr' or 'sd' via opts.source. The SD card
  // is an explicit choice, never a silent fallback. See playback-source.js.
  const src = await playbackSource.resolve(cameraId, opts.source);
  if (!src) return { error: 'camera not found' };
  if (src.error) {
    return { error: src.message || src.error, code: src.error, sources: src.options, nvrAvailable: src.nvrAvailable };
  }
  if (!src.isapiPort) return { error: 'no ISAPI port for playback source' };

  const max = Number(opts.max) > 0 ? Number(opts.max) : 40;
  const pos = Number(opts.pos) >= 0 ? Number(opts.pos) : 0;
  const trackID = src.track;

  // Frontend works in LOCAL wall-clock. Convert the requested window to the
  // device's search convention (subtract the display offset) before querying.
  const offsetMin = await getDisplayOffsetMin(src);
  const offMs = offsetMin * 60000;

  const xml = buildSearchXml({
    trackID,
    startIso: toUtcIso(new Date(startDate.getTime() - offMs)),
    endIso: toUtcIso(new Date(endDate.getTime() - offMs)),
    max,
    pos,
  });

  const r = await isapiPost(src.ip, src.isapiPort, SEARCH_URI, src.username, src.password, xml);
  if (r.statusCode !== 200) {
    const reason = (r.body && (r.body.match(/<statusString>([^<]*)<\/statusString>/) || [])[1]) || '';
    return { error: `search failed: HTTP ${r.statusCode}${reason ? ' — ' + reason : ''}` };
  }

  const parsed = parseSearchResult(r.body);

  // Shift each segment's times from the device convention back to LOCAL
  // wall-clock for display (so the timeline matches the OSD). Keep playbackURI
  // as-is (device-true times + name= file id) for the actual stream request.
  const shiftIso = (iso) => (iso ? toUtcIso(new Date(Date.parse(iso) + offMs)) : iso);
  const segments = parsed.items.map((seg) => ({
    ...seg,
    startTime: shiftIso(seg.startTime),
    endTime: shiftIso(seg.endTime),
    streamUri: null,  // streaming goes through /api/playback/stream/start
  }));

  return {
    camera: cameraId,
    via: src.via,                 // 'nvr' | 'self' | 'sd'
    source: src.recorderName,     // which device served the recording
    sourceKey: src.sourceKey,     // 'nvr' | 'self' | 'sd' (the chosen option)
    sourceLabel: src.sourceLabel, // human label for the chosen source
    nvrAvailable: src.nvrAvailable,
    sources: src.options,         // [{ key, via, label }] available alternatives
    trackID,
    tzOffsetMin: offsetMin,       // minutes added to device numerals → local wall-clock
    numOfMatches: parsed.numOfMatches,
    more: parsed.more,
    segments,
  };
}

/** ISO "2026-06-22T00:02:48Z" → compact "20260622T000248Z" for RTSP tracks query. */
function toHikCompact(isoZ) {
  return String(isoZ).replace(/[-:]/g, '');
}

module.exports = { searchRecordings, channelToTrack, toUtcIso, toHikCompact, getDisplayOffsetMin };
