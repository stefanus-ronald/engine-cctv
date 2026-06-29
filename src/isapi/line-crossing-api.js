/**
 * Line Crossing API — fetch line crossing configuration from Hikvision cameras via ISAPI.
 *
 * Returns the configured line crossing rules (coordinates, direction, enabled state)
 * so the frontend can render them as overlays on live video tiles.
 *
 * Reuses the 2-step Digest Auth pattern from sensitivity-api.js.
 * Results cached in-memory with 5-minute TTL.
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');
const cameraManager = require('../camera-manager');

const TIMEOUT_MS = 5000;
const LINE_DETECTION_ENDPOINT = '/ISAPI/Smart/LineDetection/{ch}';
const FIELD_DETECTION_ENDPOINT = '/ISAPI/Smart/FieldDetection/{ch}';

// In-memory cache: cameraId -> { data, fetchedAt }
const _cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * HTTP request with optional Digest Auth. Supports GET and PUT.
 */
function httpRequest(method, host, port, uri, authHeader, body) {
  return new Promise((resolve) => {
    const headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    if (body) {
      headers['Content-Type'] = 'application/xml';
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = http.request({
      hostname: host, port, path: uri, method, headers, timeout: TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });

    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, headers: {}, body: '' }); });
    req.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
    if (body) req.write(body);
    req.end();
  });
}

/**
 * Perform an authenticated ISAPI GET request (2-step Digest Auth).
 */
async function isapiGet(ip, port, uri, user, pass) {
  // Step 1: unauthenticated — expect 401
  const first = await httpRequest('GET', ip, port, uri, null);
  if (first.statusCode === 200) return first;
  if (first.statusCode !== 401) return first;

  // Step 2: Digest Auth retry
  const challenge = parseDigestChallenge(first.headers['www-authenticate']);
  if (!challenge) return { statusCode: 401, body: 'Failed to parse digest challenge' };

  const authHeader = buildDigestHeader('GET', uri, user, pass, challenge);
  return httpRequest('GET', ip, port, uri, authHeader);
}

/**
 * Perform an authenticated ISAPI PUT request (2-step Digest Auth).
 */
async function isapiPut(ip, port, uri, user, pass, xmlBody) {
  const first = await httpRequest('PUT', ip, port, uri, null, xmlBody);
  if (first.statusCode === 200) return first;
  if (first.statusCode !== 401) return first;

  const challenge = parseDigestChallenge(first.headers['www-authenticate']);
  if (!challenge) return { statusCode: 401, body: 'Failed to parse digest challenge' };

  const authHeader = buildDigestHeader('PUT', uri, user, pass, challenge);
  return httpRequest('PUT', ip, port, uri, authHeader, xmlBody);
}

/**
 * Parse LineDetection XML into structured JSON.
 * Extracts LineItem entries with id, enabled, sensitivity, direction, and coordinates.
 *
 * @param {string} xml - Raw XML from ISAPI GET /ISAPI/Smart/LineDetection/{ch}
 * @returns {object|null} { enabled, lines: [{ id, enabled, sensitivity, direction, coordinates }] }
 */
function parseLineDetectionXml(xml) {
  if (!xml || typeof xml !== 'string') return null;

  // Master enabled flag (first <enabled> inside <LineDetection>)
  const masterMatch = xml.match(/<LineDetection[^>]*>[\s\S]*?<enabled>(true|false)<\/enabled>/);
  const masterEnabled = masterMatch ? masterMatch[1] === 'true' : false;

  const lines = [];

  // Extract each <LineItem>...</LineItem> block
  const itemRegex = /<LineItem>([\s\S]*?)<\/LineItem>/g;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];

    const get = (tag) => {
      const m = block.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m ? m[1].trim() : null;
    };

    const id = get('id');
    const enabled = get('enabled') === 'true';
    const sensitivity = parseInt(get('sensitivityLevel') || '50', 10);
    const direction = get('directionSensitivity') || 'both';

    // Extract coordinates (2 points for a line)
    const coords = [];
    const coordRegex = /<Coordinates>\s*<positionX>(\d+)<\/positionX>\s*<positionY>(\d+)<\/positionY>\s*<\/Coordinates>/g;
    let cm;
    while ((cm = coordRegex.exec(block)) !== null) {
      coords.push({ x: parseInt(cm[1], 10), y: parseInt(cm[2], 10) });
    }

    if (coords.length >= 2) {
      lines.push({ id, enabled, sensitivity, direction, coordinates: coords });
    }
  }

  return { enabled: masterEnabled, lines };
}

/**
 * Parse FieldDetection (Intrusion/Loitering) XML into structured JSON.
 * Extracts FieldDetectionRegion entries with polygon coordinates.
 *
 * @param {string} xml - Raw XML from ISAPI GET /ISAPI/Smart/FieldDetection/{ch}
 * @returns {object|null} { enabled, regions: [{ id, enabled, sensitivity, coordinates }] }
 */
function parseFieldDetectionXml(xml) {
  if (!xml || typeof xml !== 'string') return null;

  const masterMatch = xml.match(/<FieldDetection[^>]*>[\s\S]*?<enabled>(true|false)<\/enabled>/);
  const masterEnabled = masterMatch ? masterMatch[1] === 'true' : false;

  const regions = [];

  // Extract each region block
  const regionRegex = /<FieldDetectionRegion(?:List)?>([\s\S]*?)<\/FieldDetectionRegion(?:List)?>/g;
  let match;
  while ((match = regionRegex.exec(xml)) !== null) {
    const block = match[1];

    // Could be nested FieldDetectionRegion inside FieldDetectionRegionList
    const innerRegex = /<FieldDetectionRegion>([\s\S]*?)<\/FieldDetectionRegion>/g;
    let innerMatch;
    const blocks = [];
    while ((innerMatch = innerRegex.exec(block)) !== null) {
      blocks.push(innerMatch[1]);
    }
    // If no inner matches, the outer match IS the region
    if (blocks.length === 0) blocks.push(block);

    for (const rb of blocks) {
      const get = (tag) => {
        const m = rb.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m ? m[1].trim() : null;
      };

      const id = get('id');
      const enabled = get('enabled') === 'true';
      const sensitivity = parseInt(get('sensitivityLevel') || '50', 10);

      const coords = [];
      const coordRegex2 = /<Coordinates>\s*<positionX>(\d+)<\/positionX>\s*<positionY>(\d+)<\/positionY>\s*<\/Coordinates>/g;
      let cm;
      while ((cm = coordRegex2.exec(rb)) !== null) {
        coords.push({ x: parseInt(cm[1], 10), y: parseInt(cm[2], 10) });
      }

      if (coords.length >= 3) {
        regions.push({ id, enabled, sensitivity, coordinates: coords });
      }
    }
  }

  return { enabled: masterEnabled, regions };
}

/**
 * Get line crossing configuration for a camera.
 * Returns cached data if fresh, otherwise fetches from camera.
 *
 * @param {string} cameraId
 * @returns {object} { lines: [...], regions: [...] } or { error: string }
 */
async function getLineConfig(cameraId, forceRefresh = false) {
  // Check cache first (skip if forceRefresh requested)
  if (!forceRefresh) {
    const cached = _cache.get(cameraId);
    if (cached && (Date.now() - cached.fetchedAt < CACHE_TTL_MS)) {
      return cached.data;
    }
  }

  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) {
    return { error: 'Camera not found or no ISAPI port' };
  }

  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const user = cam.username || 'admin';
  const pass = cam.password || '';

  const result = { lines: [], regions: [] };

  // Fetch LineDetection (line crossing)
  const caps = cam.hwCapabilities || {};
  if (caps.line) {
    const uri = LINE_DETECTION_ENDPOINT.replace('{ch}', channelID);
    const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
    if (res.statusCode === 200) {
      const parsed = parseLineDetectionXml(res.body);
      if (parsed) {
        result.lineDetectionEnabled = parsed.enabled;
        result.lines = parsed.lines;
      }
    }
  }

  // Fetch FieldDetection (intrusion/loitering zones)
  if (caps.loitering) {
    const uri = FIELD_DETECTION_ENDPOINT.replace('{ch}', channelID);
    const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
    if (res.statusCode === 200) {
      const parsed = parseFieldDetectionXml(res.body);
      if (parsed) {
        result.fieldDetectionEnabled = parsed.enabled;
        result.regions = parsed.regions;
      }
    }
  }

  // Master-enabled state for motion & face, so the UI reflects the REAL on/off
  // from the camera instead of assuming "capable = enabled" (which made disables
  // appear to revert on refresh). First <enabled> in each doc = the master flag.
  if (caps.motion) {
    const uri = `/ISAPI/System/Video/inputs/channels/${channelID}/motionDetection`;
    const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
    if (res.statusCode === 200) {
      const m = res.body.match(/<enabled>(true|false)<\/enabled>/);
      if (m) result.motionEnabled = m[1] === 'true';
    }
  }
  if (caps.face) {
    const uri = `/ISAPI/Smart/FaceDetect/${channelID}`;
    const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
    if (res.statusCode === 200) {
      const m = res.body.match(/<enabled>(true|false)<\/enabled>/);
      if (m) result.faceEnabled = m[1] === 'true';
    }
  }

  // Cache the result
  _cache.set(cameraId, { data: result, fetchedAt: Date.now() });

  const totalLines = result.lines.length;
  const activeLines = result.lines.filter(l => l.enabled).length;
  const totalRegions = result.regions.length;
  const activeRegions = result.regions.filter(r => r.enabled).length;
  console.log(`[isapi-lines] ${cameraId}: ${totalLines} line(s) (${activeLines} active), ${totalRegions} region(s) (${activeRegions} active)`);

  return result;
}

// ISAPI endpoints for detector enable/disable operations
const ENABLE_ENDPOINTS = {
  line:      LINE_DETECTION_ENDPOINT,
  loitering: FIELD_DETECTION_ENDPOINT,
  motion:    '/ISAPI/System/Video/inputs/channels/{ch}/motionDetection',
};

/**
 * Enable or disable a detector rule in the camera via ISAPI (GET → modify → PUT).
 * Replaces ALL <enabled> tags in the XML (master + all rule items) with the new value.
 *
 * @param {string} cameraId
 * @param {string} detectorId - 'line' | 'loitering' | 'motion'
 * @param {boolean} enabled
 * @returns {object} { ok: true, ... } or { error: string }
 */
async function setDetectionEnabled(cameraId, detectorId, enabled) {
  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) return { error: 'Camera not found or no ISAPI port' };

  const endpointTemplate = ENABLE_ENDPOINTS[detectorId];
  if (!endpointTemplate) return { error: `Unsupported detectorId: ${detectorId}` };

  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const uri = endpointTemplate.replace('{ch}', channelID);
  const user = cam.username || 'admin';
  const pass = cam.password || '';

  // Step 1: GET current XML
  const getRes = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
  if (getRes.statusCode !== 200) return { error: `GET failed: ${getRes.statusCode}` };

  // Step 2: Replace ONLY the master <enabled> (the first one, which belongs to
  // the root detector element). A global replace would also flip nested
  // sub-element flags (motion grid/highlight layout, every LineItem, every
  // region) — enabling features the user never set or corrupting layout state.
  const val = enabled ? 'true' : 'false';
  const newXml = getRes.body.replace(/<enabled>(true|false)<\/enabled>/, `<enabled>${val}</enabled>`);

  // Step 3: PUT modified XML back to camera
  const putRes = await isapiPut(cam.ip, cam.isapiPort, uri, user, pass, newXml);
  if (putRes.statusCode !== 200) return { error: `PUT failed: ${putRes.statusCode}` };

  // Invalidate overlay cache so next GET returns fresh data
  invalidateCache(cameraId);

  console.log(`[isapi-rule] ${cameraId} ${detectorId} → ${val}`);
  return { ok: true, cameraId, detectorId, enabled };
}

/**
 * Invalidate cached config for a specific camera or all cameras.
 */
function invalidateCache(cameraId) {
  if (cameraId) {
    _cache.delete(cameraId);
  } else {
    _cache.clear();
  }
}

/**
 * Create or update Line 1 in the camera's LineDetection config via ISAPI.
 * Uses surgical replacement: only updates CoordinatesList, enabled, and direction
 * inside the existing LineItem — preserving all other camera fields/ordering.
 *
 * Coordinates are in Hikvision space (0-1000, Y=0 at bottom).
 * Direction: 'any' (both), 'left-right' (A→B), 'right-left' (B→A)
 *
 * @param {string} cameraId
 * @param {number} x1, y1 - Start point
 * @param {number} x2, y2 - End point
 * @param {string} direction - 'any' | 'left-right' | 'right-left'
 * @returns {object} { ok: true } or { error: string }
 */
async function setLineCoordinates(cameraId, x1, y1, x2, y2, direction = 'any') {
  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) return { error: 'Camera not found or no ISAPI port' };

  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const uri = LINE_DETECTION_ENDPOINT.replace('{ch}', channelID);
  const user = cam.username || 'admin';
  const pass = cam.password || '';

  // Step 1: GET current config
  const getRes = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
  if (getRes.statusCode !== 200) return { error: `GET failed: ${getRes.statusCode}` };

  let xml = getRes.body;

  // New CoordinatesList block (matches camera's actual XML structure)
  const newCoordsListXml =
    `<CoordinatesList>\n` +
    `<Coordinates>\n<positionX>${x1}</positionX>\n<positionY>${y1}</positionY>\n</Coordinates>\n` +
    `<Coordinates>\n<positionX>${x2}</positionX>\n<positionY>${y2}</positionY>\n</Coordinates>\n` +
    `</CoordinatesList>`;

  // Step 2: Surgically update the first LineItem — preserve all other fields
  if (/<LineItem>/.test(xml)) {
    xml = xml.replace(/<LineItem>([\s\S]*?)<\/LineItem>/, (match, body) => {
      // Replace CoordinatesList block
      let updated = /<CoordinatesList>/.test(body)
        ? body.replace(/<CoordinatesList>[\s\S]*?<\/CoordinatesList>/, newCoordsListXml)
        : body + '\n' + newCoordsListXml;
      // Enable LineItem
      updated = updated.replace(/<enabled>(true|false)<\/enabled>/, '<enabled>true</enabled>');
      // Update direction
      updated = /<directionSensitivity>/.test(updated)
        ? updated.replace(/<directionSensitivity>[^<]*<\/directionSensitivity>/, `<directionSensitivity>${direction}</directionSensitivity>`)
        : updated.replace(/<\/id>/, `</id>\n<directionSensitivity>${direction}</directionSensitivity>`);
      return `<LineItem>${updated}</LineItem>`;
    });
  } else {
    // No LineItem exists — build a minimal one inside LineItemList
    const newItemXml =
      `<LineItem>\n<id>1</id>\n<enabled>true</enabled>\n` +
      `<sensitivityLevel>50</sensitivityLevel>\n<directionSensitivity>${direction}</directionSensitivity>\n` +
      `${newCoordsListXml}\n</LineItem>`;
    if (/<LineItemList/.test(xml)) {
      xml = xml.replace(/<LineItemList([^>]*)>([\s\S]*?)<\/LineItemList>/, `<LineItemList$1>\n${newItemXml}\n</LineItemList>`);
    } else {
      xml = xml.replace(/<\/LineDetection>/, `<LineItemList>\n${newItemXml}\n</LineItemList>\n</LineDetection>`);
    }
  }

  // Step 3: Ensure master enabled (first <enabled> tag = LineDetection master)
  xml = xml.replace(/<enabled>(true|false)<\/enabled>/, '<enabled>true</enabled>');

  // Step 4: PUT back
  const putRes = await isapiPut(cam.ip, cam.isapiPort, uri, user, pass, xml);
  if (putRes.statusCode !== 200) return { error: `PUT failed: ${putRes.statusCode}` };

  invalidateCache(cameraId);
  console.log(`[isapi-draw] ${cameraId} line 1 [${direction}] → (${x1},${y1})→(${x2},${y2})`);
  return { ok: true };
}

module.exports = { getLineConfig, invalidateCache, setDetectionEnabled, setLineCoordinates };
