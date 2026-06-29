/**
 * Alert Stream Manager — persistent ISAPI alert stream connections.
 *
 * Connects to each camera's /ISAPI/Event/notification/alertStream endpoint
 * using Digest Authentication, parses multipart/mixed XML events, normalizes
 * them, and broadcasts via SSE to all connected browsers.
 *
 * Features:
 *   - Per-camera persistent HTTP connections with Digest Auth
 *   - Multipart/mixed boundary parsing for XML event extraction
 *   - Exponential backoff reconnection (5s base, 60s max)
 *   - Account lock detection and wait
 *   - NVR dedup: one connection per IP:port, dispatch by channelID
 *   - Stale connection detection (5 min no-event threshold)
 *   - Runtime camera add/update/remove via cameraManager listeners
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');
const { extractEventFromXml, parseAccountLockStatus } = require('./xml-parser');
const { normalizeIsapiEvent } = require('../events/event-normalizer');
const { isDuplicate } = require('../events/event-dedup');
const sseBroadcaster = require('../events/sse-broadcaster');

const ALERT_STREAM_PATH = '/ISAPI/Event/notification/alertStream';
const STALE_CHECK_INTERVAL = 60000;    // check every 60s
const STALE_THRESHOLD = 300000;        // 5 minutes no events
const BASE_RETRY_DELAY = 5000;         // 5s
const MAX_RETRY_DELAY = 60000;         // 60s
const RETRY_FACTOR = 1.5;

// Per-connection state: Map<connectionKey, state>
// connectionKey = `${ip}:${isapiPort}` (dedup NVR connections)
const connections = new Map();

// Map cameraId → connectionKey for reverse lookup
const cameraToConnection = new Map();

let cameraManager = null;
let staleCheckTimer = null;

/**
 * Initialize alert stream connections for all ISAPI-enabled cameras.
 */
function init() {
  cameraManager = require('../camera-manager');

  const cameras = cameraManager.getAll();
  const grouped = groupByEndpoint(cameras);

  for (const [connKey, group] of grouped) {
    startConnection(connKey, group);
  }

  // Listen for runtime camera changes
  cameraManager.onCameraChange((action, camera) => {
    if (action === 'add' || action === 'update') {
      handleCameraChange(camera);
    } else if (action === 'remove') {
      handleCameraRemove(camera);
    }
  });

  // Stale connection checker
  staleCheckTimer = setInterval(checkStaleConnections, STALE_CHECK_INTERVAL);
  if (staleCheckTimer.unref) staleCheckTimer.unref();

  console.log(`[isapi] Initialized — ${grouped.size} endpoint(s) to connect`);
}

/**
 * Group cameras by ISAPI endpoint (IP:port) to avoid duplicate NVR connections.
 */
function groupByEndpoint(cameras) {
  const groups = new Map();
  for (const cam of cameras) {
    if (!cam.isapiPort || !cam.detection || !cam.detection.isapi) continue;
    const key = `${cam.ip}:${cam.isapiPort}`;
    if (!groups.has(key)) {
      groups.set(key, { ip: cam.ip, port: cam.isapiPort, username: cam.username, password: cam.password, cameras: [] });
    }
    groups.get(key).cameras.push(cam);
    cameraToConnection.set(cam.id, key);
  }
  return groups;
}

/**
 * Start a connection to an ISAPI endpoint.
 */
function startConnection(connKey, group) {
  const state = {
    connKey,
    ip: group.ip,
    port: group.port,
    username: group.username,
    password: group.password,
    cameras: group.cameras,
    request: null,
    connected: false,
    retryCount: 0,
    retryTimer: null,
    lastEventAt: Date.now(),
    buffer: '',
    boundary: null,
  };

  connections.set(connKey, state);
  connectEndpoint(state);
}

/**
 * Connect to the ISAPI alert stream endpoint.
 * Step 1: Send unauthenticated request to get Digest challenge.
 */
function connectEndpoint(state) {
  const { ip, port } = state;
  const uri = ALERT_STREAM_PATH;

  console.log(`[isapi] Connecting to ${ip}:${port}${uri}...`);

  const options = {
    hostname: ip,
    port: port,
    path: uri,
    method: 'GET',
    timeout: 10000,
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 401) {
      // Step 1 complete: got challenge
      const wwwAuth = res.headers['www-authenticate'];
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        // Check for account lock
        const lockStatus = parseAccountLockStatus(body);
        if (lockStatus.locked) {
          console.warn(`[isapi] ${ip}:${port} account LOCKED — waiting ${lockStatus.unlockTime}s`);
          scheduleReconnect(state, lockStatus.unlockTime * 1000);
          return;
        }

        const challenge = parseDigestChallenge(wwwAuth);
        if (!challenge) {
          console.error(`[isapi] ${ip}:${port} — cannot parse Digest challenge`);
          scheduleReconnect(state);
          return;
        }

        // Step 2: authenticate
        connectWithAuth(state, challenge);
      });
    } else if (res.statusCode === 200) {
      // Some cameras don't require auth (unusual but possible)
      handleAlertStream(state, res);
    } else {
      console.warn(`[isapi] ${ip}:${port} — unexpected status ${res.statusCode}`);
      res.resume(); // drain
      scheduleReconnect(state);
    }
  });

  req.on('error', (err) => {
    console.error(`[isapi] ${ip}:${port} — connection error: ${err.message}`);
    scheduleReconnect(state);
  });

  req.on('timeout', () => {
    console.warn(`[isapi] ${ip}:${port} — connection timeout`);
    req.destroy();
    scheduleReconnect(state);
  });

  req.end();
  state.request = req;
}

/**
 * Step 2: Connect with Digest Authentication header.
 */
function connectWithAuth(state, challenge) {
  const { ip, port, username, password } = state;
  const uri = ALERT_STREAM_PATH;

  const authHeader = buildDigestHeader('GET', uri, username, password, challenge);

  const options = {
    hostname: ip,
    port: port,
    path: uri,
    method: 'GET',
    headers: {
      'Authorization': authHeader,
    },
    timeout: 15000,
  };

  const req = http.request(options, (res) => {
    if (res.statusCode === 200) {
      handleAlertStream(state, res);
    } else if (res.statusCode === 401) {
      console.error(`[isapi] ${ip}:${port} — auth failed (bad credentials?)`);
      // Don't auto-retry on bad credentials to prevent account lock
      updateCameraStatus(state, false);
      res.resume();
    } else if (res.statusCode === 403) {
      console.warn(`[isapi] ${ip}:${port} — 403 Forbidden (VCA resource not enabled?)`);
      res.resume();
    } else if (res.statusCode === 404) {
      console.warn(`[isapi] ${ip}:${port} — 404 (alertStream not supported on this model)`);
      res.resume();
    } else {
      console.warn(`[isapi] ${ip}:${port} — auth response ${res.statusCode}`);
      res.resume();
      scheduleReconnect(state);
    }
  });

  req.on('error', (err) => {
    console.error(`[isapi] ${ip}:${port} — auth request error: ${err.message}`);
    scheduleReconnect(state);
  });

  req.on('timeout', () => {
    console.warn(`[isapi] ${ip}:${port} — auth request timeout`);
    req.destroy();
    scheduleReconnect(state);
  });

  req.end();
  state.request = req;
}

/**
 * Handle the authenticated alert stream (200 response).
 * Parse multipart/mixed boundary and process incoming XML events.
 */
function handleAlertStream(state, res) {
  const { ip, port } = state;

  state.connected = true;
  state.retryCount = 0;
  state.lastEventAt = Date.now();
  state.buffer = '';

  // Extract boundary from Content-Type header
  const contentType = res.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=([^\s;]+)/);
  state.boundary = boundaryMatch ? boundaryMatch[1] : null;

  console.log(`[isapi] Connected to ${ip}:${port} (boundary: ${state.boundary || 'none'})`);
  updateCameraStatus(state, true);

  // Disable timeout on the long-lived connection
  res.setTimeout(0);

  res.on('data', (chunk) => {
    state.buffer += chunk.toString();
    state.lastEventAt = Date.now();
    processBuffer(state);
  });

  res.on('end', () => {
    console.log(`[isapi] ${ip}:${port} — stream ended`);
    state.connected = false;
    state.retryCount = 0; // clean disconnect, reset retry
    updateCameraStatus(state, false);
    scheduleReconnect(state, BASE_RETRY_DELAY);
  });

  res.on('error', (err) => {
    console.error(`[isapi] ${ip}:${port} — stream error: ${err.message}`);
    state.connected = false;
    updateCameraStatus(state, false);
    scheduleReconnect(state);
  });
}

/**
 * Process the accumulated buffer, extracting complete multipart parts.
 */
function processBuffer(state) {
  if (!state.boundary) {
    // No boundary — try to parse as plain XML
    tryExtractXml(state);
    return;
  }

  const delimiter = `--${state.boundary}`;

  while (true) {
    const delimIdx = state.buffer.indexOf(delimiter);
    if (delimIdx === -1) break;

    // Find the next delimiter
    const nextDelimIdx = state.buffer.indexOf(delimiter, delimIdx + delimiter.length);
    if (nextDelimIdx === -1) break; // incomplete part, wait for more data

    // Extract the part between delimiters
    const part = state.buffer.substring(delimIdx + delimiter.length, nextDelimIdx);
    state.buffer = state.buffer.substring(nextDelimIdx);

    // Process this part
    processPart(state, part);
  }

  // Prevent unbounded buffer growth
  if (state.buffer.length > 100000) {
    state.buffer = state.buffer.substring(state.buffer.length - 50000);
  }
}

/**
 * Try to extract XML events from buffer when no boundary is present.
 */
function tryExtractXml(state) {
  // Look for complete XML event blocks
  const startTag = '<EventNotificationAlert';
  const endTag = '</EventNotificationAlert>';

  while (true) {
    const startIdx = state.buffer.indexOf(startTag);
    if (startIdx === -1) break;

    const endIdx = state.buffer.indexOf(endTag, startIdx);
    if (endIdx === -1) break;

    const xml = state.buffer.substring(startIdx, endIdx + endTag.length);
    state.buffer = state.buffer.substring(endIdx + endTag.length);

    handleXmlEvent(state, xml);
  }

  // Prevent unbounded buffer growth
  if (state.buffer.length > 100000) {
    state.buffer = state.buffer.substring(state.buffer.length - 50000);
  }
}

/**
 * Process a single multipart part.
 */
function processPart(state, part) {
  // Split headers from body (double CRLF or double LF)
  const headerEnd = part.indexOf('\r\n\r\n');
  const headerEndAlt = part.indexOf('\n\n');
  const splitIdx = headerEnd !== -1 ? headerEnd : headerEndAlt;
  const splitLen = headerEnd !== -1 ? 4 : 2;

  if (splitIdx === -1) return;

  const headers = part.substring(0, splitIdx).toLowerCase();
  const body = part.substring(splitIdx + splitLen);

  if (headers.includes('application/xml') || headers.includes('text/xml')) {
    handleXmlEvent(state, body);
  }
  // image/jpeg parts are discarded (snapshot saving not implemented yet)
}

/**
 * Handle a parsed XML event — normalize, dedup, broadcast.
 */
function handleXmlEvent(state, xml) {
  const rawEvent = extractEventFromXml(xml);
  if (!rawEvent) return;

  // Resolve which camera this event belongs to
  const cameraId = resolveCameraId(state, rawEvent);
  if (!cameraId) return;

  // Check if this event type is whitelisted for this camera
  const cam = cameraManager.getById(cameraId);
  if (cam && cam.detection && cam.detection.events) {
    if (!cam.detection.events.includes(rawEvent.eventType)) return;
  }

  // Normalize to unified event format
  const event = normalizeIsapiEvent(rawEvent, cameraId);
  if (!event) return;

  // Server-side dedup
  if (isDuplicate(event)) return;

  // Broadcast to all SSE clients
  sseBroadcaster.broadcast(event);

  console.log(`[isapi] Event: ${rawEvent.eventType} @ ${cam ? cam.name : cameraId} (${event.source})`);
}

/**
 * Resolve which camera ID an ISAPI event belongs to.
 * For NVR: match by channelID. For direct cameras: use the first camera in the group.
 */
function resolveCameraId(state, rawEvent) {
  const channelID = rawEvent.channelID;

  // Try to match by channelID (important for NVR)
  if (channelID) {
    const match = state.cameras.find(c =>
      c.detection && String(c.detection.channelID) === String(channelID)
    );
    if (match) return match.id;
  }

  // Fallback: if only one camera on this endpoint, use it
  if (state.cameras.length === 1) {
    return state.cameras[0].id;
  }

  // Can't resolve — log for debugging
  console.warn(`[isapi] Cannot resolve camera for event on ${state.ip}:${state.port} ch=${channelID}`);
  return null;
}

/**
 * Schedule a reconnection with exponential backoff.
 */
function scheduleReconnect(state, fixedDelay) {
  // Clear any pending reconnect
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }

  // Destroy existing request
  if (state.request) {
    try { state.request.destroy(); } catch (e) {}
    state.request = null;
  }

  const delay = fixedDelay || Math.min(
    BASE_RETRY_DELAY * Math.pow(RETRY_FACTOR, state.retryCount),
    MAX_RETRY_DELAY
  );

  console.log(`[isapi] ${state.ip}:${state.port} — reconnecting in ${Math.round(delay / 1000)}s (attempt ${state.retryCount + 1})`);

  state.retryTimer = setTimeout(() => {
    state.retryCount++;
    state.retryTimer = null;
    connectEndpoint(state);
  }, delay);
}

/**
 * Update camera status via SSE broadcast (for frontend sidebar indicators).
 */
function updateCameraStatus(state, connected) {
  const type = connected ? '_isapi_connected' : '_isapi_disconnected';
  for (const cam of state.cameras) {
    sseBroadcaster.broadcast({ type, cameraId: cam.id });
  }
}

/**
 * Check for stale connections and reconnect.
 */
function checkStaleConnections() {
  const now = Date.now();
  for (const [connKey, state] of connections) {
    if (state.connected && (now - state.lastEventAt > STALE_THRESHOLD)) {
      console.log(`[isapi] ${state.ip}:${state.port} — stale (no events for ${Math.round(STALE_THRESHOLD / 60000)}m), reconnecting...`);
      state.connected = false;
      updateCameraStatus(state, false);
      if (state.request) {
        try { state.request.destroy(); } catch (e) {}
        state.request = null;
      }
      state.retryCount = 0;
      scheduleReconnect(state, BASE_RETRY_DELAY);
    }
  }
}

/**
 * Handle camera add/update — reconnect if ISAPI config changed.
 */
function handleCameraChange(camera) {
  if (!camera.isapiPort || !camera.detection || !camera.detection.isapi) {
    // Camera no longer has ISAPI — disconnect if connected
    handleCameraRemove(camera);
    return;
  }

  const newKey = `${camera.ip}:${camera.isapiPort}`;
  const oldKey = cameraToConnection.get(camera.id);

  if (oldKey && oldKey !== newKey) {
    // Endpoint changed — disconnect from old
    removeFromConnection(oldKey, camera.id);
  }

  cameraToConnection.set(camera.id, newKey);

  if (connections.has(newKey)) {
    // Endpoint already connected — just update camera list
    const state = connections.get(newKey);
    if (!state.cameras.find(c => c.id === camera.id)) {
      state.cameras.push(camera);
    } else {
      // Update camera reference
      const idx = state.cameras.findIndex(c => c.id === camera.id);
      if (idx !== -1) state.cameras[idx] = camera;
    }
  } else {
    // New endpoint — start connection
    startConnection(newKey, {
      ip: camera.ip,
      port: camera.isapiPort,
      username: camera.username,
      password: camera.password,
      cameras: [camera],
    });
  }
}

/**
 * Handle camera removal — disconnect if no cameras left on this endpoint.
 */
function handleCameraRemove(camera) {
  const connKey = cameraToConnection.get(camera.id);
  if (!connKey) return;
  cameraToConnection.delete(camera.id);
  removeFromConnection(connKey, camera.id);
}

/**
 * Remove a camera from a connection. If no cameras left, disconnect.
 */
function removeFromConnection(connKey, cameraId) {
  const state = connections.get(connKey);
  if (!state) return;

  state.cameras = state.cameras.filter(c => c.id !== cameraId);

  if (state.cameras.length === 0) {
    // No cameras left — disconnect
    disconnectEndpoint(connKey);
  }
}

/**
 * Disconnect a specific endpoint.
 */
function disconnectEndpoint(connKey) {
  const state = connections.get(connKey);
  if (!state) return;

  if (state.retryTimer) clearTimeout(state.retryTimer);
  if (state.request) {
    try { state.request.destroy(); } catch (e) {}
  }
  state.connected = false;
  updateCameraStatus(state, false);
  connections.delete(connKey);
}

/**
 * Force reconnect a specific camera.
 */
function reconnectCamera(cameraId) {
  const connKey = cameraToConnection.get(cameraId);
  if (!connKey) return;
  const state = connections.get(connKey);
  if (!state) return;

  console.log(`[isapi] Force reconnecting ${cameraId} (${connKey})`);

  // Clear pending retry timer to prevent race condition
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }

  state.connected = false;
  if (state.request) {
    try { state.request.destroy(); } catch (e) {}
    state.request = null;
  }
  state.retryCount = 0;
  connectEndpoint(state);
}

/**
 * Get connection status for all cameras.
 */
function getStatus() {
  const status = {};
  for (const [connKey, state] of connections) {
    for (const cam of state.cameras) {
      status[cam.id] = {
        connected: state.connected,
        endpoint: connKey,
        retryCount: state.retryCount,
        lastEventAt: state.lastEventAt,
      };
    }
  }
  return status;
}

/**
 * Graceful shutdown — destroy all connections.
 */
function stop() {
  if (staleCheckTimer) {
    clearInterval(staleCheckTimer);
    staleCheckTimer = null;
  }

  // Collect keys first to avoid mutating Map during iteration
  const keys = [...connections.keys()];
  for (const connKey of keys) {
    disconnectEndpoint(connKey);
  }
  connections.clear();
  cameraToConnection.clear();

  console.log('[isapi] All alert stream connections closed');
}

module.exports = { init, stop, getStatus, reconnectCamera };
