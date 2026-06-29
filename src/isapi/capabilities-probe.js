/**
 * Capabilities Probe — discovers real VCA features from Hikvision cameras via ISAPI.
 *
 * Replaces the simulated buildCameraCapabilities() hash on the frontend.
 * Queries ISAPI Smart endpoints per camera to check which VCA features
 * the hardware actually supports (200 = supported, 404/403 = not).
 *
 * Uses Digest Auth from digest-auth.js (same as alert-stream-manager).
 * Results stored in-memory on camera objects via camera-manager.setHwCapabilities().
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');
const cameraManager = require('../camera-manager');
const sseBroadcaster = require('../events/sse-broadcaster');

const PROBE_TIMEOUT_MS = 5000; // 5s per endpoint

// ISAPI endpoints to probe, mapped to frontend detector IDs.
// {ch} is replaced with the camera's channelID (default "1").
const PROBE_ENDPOINTS = [
  { detectorId: 'motion',    path: '/ISAPI/System/Video/inputs/channels/{ch}/motionDetection' },
  { detectorId: 'line',      path: '/ISAPI/Smart/LineDetection/{ch}' },
  { detectorId: 'loitering', path: '/ISAPI/Smart/FieldDetection/{ch}' },
  { detectorId: 'face',      path: '/ISAPI/Smart/FaceDetect/{ch}' },
  { detectorId: 'vehicle',   path: '/ISAPI/Smart/VehicleDetection/{ch}' },
];

// Detectors that are server-only (Python VCA / YOLO) — always false for ISAPI probe.
const SERVER_ONLY_DETECTORS = ['person', 'lpr'];

// Maps ISAPI event type names (from cameras.json detection.events) to frontend detector IDs.
// Used as fallback when Smart endpoint probing returns 403 (common on NVRs).
const EVENT_TO_DETECTOR = {
  'VMD': 'motion',
  'linedetection': 'line',
  'fielddetection': 'loitering',
  'facedetection': 'face',
  'vehicledetection': 'vehicle',
};

/**
 * Send a single HTTP GET request with optional Digest Auth.
 * Returns the HTTP status code (200, 401, 403, 404, etc.) or 0 on timeout/error.
 */
function httpGet(host, port, uri, authHeader) {
  return new Promise((resolve) => {
    const headers = {};
    if (authHeader) headers['Authorization'] = authHeader;

    const req = http.request({
      hostname: host,
      port,
      path: uri,
      method: 'GET',
      headers,
      timeout: PROBE_TIMEOUT_MS,
    }, (res) => {
      // Collect response for digest challenge extraction
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', () => {
        resolve({ statusCode: 0, headers: {}, body: '' });
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString(),
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: 0, headers: {}, body: '' });
    });

    req.on('error', () => {
      resolve({ statusCode: 0, headers: {}, body: '' });
    });

    req.end();
  });
}

/**
 * Probe a single ISAPI endpoint with Digest Auth (2-step: 401 → retry with auth).
 *
 * @returns {boolean} true if the feature is supported (HTTP 200)
 */
async function probeEndpoint(ip, port, uri, username, password) {
  // Step 1: unauthenticated request — expect 401 with Digest challenge
  const first = await httpGet(ip, port, uri, null);

  if (first.statusCode === 200) return true; // no auth required, feature exists
  if (first.statusCode !== 401) return false; // 404/403/timeout = not supported

  // Step 2: parse Digest challenge and retry with credentials
  const wwwAuth = first.headers['www-authenticate'];
  const challenge = parseDigestChallenge(wwwAuth);
  if (!challenge) return false;

  const authHeader = buildDigestHeader('GET', uri, username, password, challenge);
  const second = await httpGet(ip, port, uri, authHeader);

  return second.statusCode === 200;
}

/**
 * Probe one camera for all VCA capabilities.
 *
 * @param {object} cam - Camera object from camera-manager.getAll()
 * @returns {object} Capabilities map: { motion: bool, line: bool, loitering: bool, ... }
 */
async function probeCamera(cam) {
  const channelID = (cam.detection && cam.detection.channelID) || '1';
  const ip = cam.ip;
  const port = cam.isapiPort;
  const user = cam.username || 'admin';
  const pass = cam.password || '';

  // Probe all endpoints in parallel for this camera
  const results = await Promise.all(
    PROBE_ENDPOINTS.map(async (ep) => {
      const uri = ep.path.replace('{ch}', channelID);
      const supported = await probeEndpoint(ip, port, uri, user, pass);
      return { detectorId: ep.detectorId, supported };
    })
  );

  // Build capabilities object from probe results
  const caps = {};
  for (const r of results) {
    caps[r.detectorId] = r.supported;
  }

  // Fallback: if no probe succeeded but camera has detection.events configured,
  // treat those as confirmed capabilities. This handles NVRs where ISAPI Smart
  // config endpoints return 403 but the alert stream still delivers events.
  const configuredEvents = (cam.detection && cam.detection.events) || [];
  for (const evt of configuredEvents) {
    const detId = EVENT_TO_DETECTOR[evt];
    if (detId && !caps[detId]) {
      caps[detId] = true;
    }
  }

  // Server-only detectors always false for hardware probe
  for (const d of SERVER_ONLY_DETECTORS) {
    caps[d] = false;
  }

  return caps;
}

/**
 * Probe all cameras that have isapiPort configured.
 * Cameras are probed sequentially to avoid overwhelming the network.
 * Results stored via cameraManager.setHwCapabilities().
 */
async function probeAllCameras() {
  const allCameras = cameraManager.getAll();
  const isapiCameras = allCameras.filter(c => c.isapiPort);

  if (isapiCameras.length === 0) {
    console.log('[isapi-probe] No cameras with isapiPort configured — skipping probe');
    return;
  }

  console.log(`[isapi-probe] Probing ${isapiCameras.length} camera(s) for hardware capabilities...`);

  for (const cam of isapiCameras) {
    try {
      const caps = await probeCamera(cam);
      cameraManager.setHwCapabilities(cam.id, caps);

      // Friendly log
      const supported = Object.entries(caps)
        .filter(([k, v]) => v && !SERVER_ONLY_DETECTORS.includes(k))
        .map(([k]) => k);

      console.log(`[isapi-probe] ${cam.id} (${cam.ip}:${cam.isapiPort}): ${supported.length ? supported.join(', ') : 'none'}`);
    } catch (err) {
      console.error(`[isapi-probe] ${cam.id} probe failed:`, err.message);
      // Set empty capabilities on failure — frontend will use fallback
      cameraManager.setHwCapabilities(cam.id, null);
    }
  }

  console.log('[isapi-probe] Hardware capabilities probe complete');

  // Notify connected frontends so they refresh capabilities
  // (probe runs async after server start — browsers may have loaded before it finished)
  sseBroadcaster.broadcast({ type: 'capabilities-updated' });
}

module.exports = { probeCamera, probeAllCameras };
