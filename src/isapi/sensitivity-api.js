/**
 * Sensitivity API — GET/PUT VCA sensitivity on Hikvision cameras via ISAPI.
 *
 * Supports Motion (VMD), Line Crossing, and Field/Intrusion detection.
 * Uses GET-Modify-PUT pattern: fetch current XML → regex replace sensitivityLevel → PUT back.
 * This preserves all other camera settings (grid, regions, etc.).
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');
const cameraManager = require('../camera-manager');

const TIMEOUT_MS = 5000;

// Maps frontend detector IDs to ISAPI endpoints
const DETECTOR_ENDPOINTS = {
  motion:    '/ISAPI/System/Video/inputs/channels/{ch}/motionDetection',
  line:      '/ISAPI/Smart/LineDetection/{ch}',
  loitering: '/ISAPI/Smart/FieldDetection/{ch}',
};

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
 * Perform an authenticated ISAPI request (2-step Digest Auth).
 * Returns { statusCode, body } after authentication.
 */
async function isapiRequest(method, ip, port, uri, user, pass, body) {
  // Step 1: unauthenticated — expect 401
  const first = await httpRequest(method, ip, port, uri, null, body);
  if (first.statusCode === 200) return first;
  if (first.statusCode !== 401) return first;

  // Step 2: Digest Auth retry
  const challenge = parseDigestChallenge(first.headers['www-authenticate']);
  if (!challenge) return { statusCode: 401, body: 'Failed to parse digest challenge' };

  const authHeader = buildDigestHeader(method, uri, user, pass, challenge);
  return httpRequest(method, ip, port, uri, authHeader, body);
}

/**
 * Extract sensitivityLevel from ISAPI XML response.
 * Works for MotionDetection, LineDetection, and FieldDetection XML.
 */
function parseSensitivity(xml) {
  const sensMatch = xml.match(/<sensitivityLevel>(\d+)<\/sensitivityLevel>/);
  const enabledMatch = xml.match(/<enabled>(true|false)<\/enabled>/);
  return {
    sensitivity: sensMatch ? parseInt(sensMatch[1], 10) : null,
    enabled: enabledMatch ? enabledMatch[1] === 'true' : null,
  };
}

/**
 * Get current sensitivity for a specific detector on a camera.
 */
async function getSensitivity(cameraId, detectorId) {
  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) return { error: 'Camera not found or no ISAPI port' };

  const endpointTemplate = DETECTOR_ENDPOINTS[detectorId];
  if (!endpointTemplate) return { error: `Unsupported detector: ${detectorId}` };

  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const uri = endpointTemplate.replace('{ch}', channelID);

  const res = await isapiRequest('GET', cam.ip, cam.isapiPort, uri, cam.username || 'admin', cam.password || '');

  if (res.statusCode !== 200) {
    return { error: `ISAPI returned ${res.statusCode}` };
  }

  const parsed = parseSensitivity(res.body);
  return { detectorId, ...parsed };
}

/**
 * Get sensitivities for all supported detectors on a camera.
 */
async function getAllSensitivities(cameraId) {
  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) return { error: 'Camera not found or no ISAPI port' };

  const caps = cam.hwCapabilities || {};
  const results = {};

  // Only query detectors that have ISAPI endpoints and camera supports
  const queries = Object.keys(DETECTOR_ENDPOINTS).map(async (detId) => {
    if (!caps[detId]) {
      results[detId] = { sensitivity: null, enabled: null, supported: false };
      return;
    }
    const data = await getSensitivity(cameraId, detId);
    results[detId] = data.error
      ? { sensitivity: null, enabled: null, supported: true, error: data.error }
      : { ...data, supported: true };
  });

  await Promise.all(queries);
  return results;
}

/**
 * Set sensitivity for a specific detector on a camera.
 * Uses GET-Modify-PUT pattern to preserve all other XML fields.
 */
async function setSensitivity(cameraId, detectorId, value) {
  const cam = cameraManager.getById(cameraId);
  if (!cam || !cam.isapiPort) return { error: 'Camera not found or no ISAPI port' };

  const endpointTemplate = DETECTOR_ENDPOINTS[detectorId];
  if (!endpointTemplate) return { error: `Unsupported detector: ${detectorId}` };

  const sensitivity = Math.max(0, Math.min(100, parseInt(value, 10)));
  if (isNaN(sensitivity)) return { error: 'Invalid sensitivity value' };

  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const uri = endpointTemplate.replace('{ch}', channelID);
  const user = cam.username || 'admin';
  const pass = cam.password || '';

  // Step 1: GET current XML
  const getRes = await isapiRequest('GET', cam.ip, cam.isapiPort, uri, user, pass);
  if (getRes.statusCode !== 200) {
    return { error: `GET failed: ${getRes.statusCode}` };
  }

  // Step 2: Replace sensitivityLevel in XML
  const currentXml = getRes.body;
  if (!currentXml.includes('<sensitivityLevel>')) {
    return { error: 'sensitivityLevel field not found in camera response' };
  }
  const newXml = currentXml.replace(
    /<sensitivityLevel>\d+<\/sensitivityLevel>/,
    `<sensitivityLevel>${sensitivity}</sensitivityLevel>`
  );

  // Step 3: PUT modified XML back
  const putRes = await isapiRequest('PUT', cam.ip, cam.isapiPort, uri, user, pass, newXml);
  if (putRes.statusCode !== 200) {
    return { error: `PUT failed: ${putRes.statusCode}` };
  }

  console.log(`[isapi-sensitivity] ${cameraId} ${detectorId} → ${sensitivity}`);
  return { ok: true, detectorId, sensitivity };
}

module.exports = { getSensitivity, getAllSensitivities, setSensitivity };
