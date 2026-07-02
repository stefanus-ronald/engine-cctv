const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { config, loadDashboard, saveDashboard, loadTimezone, saveTimezone } = require('./config');
const cameraManager = require('./camera-manager');
const mjpegManager = require('./mjpeg/mjpeg-manager');
const go2rtcProxy = require('./webrtc/go2rtc-proxy');
const go2rtcManager = require('./webrtc/go2rtc-manager');
const playbackStream = require('./webrtc/playback-stream');
const playbackSearch = require('./isapi/playback-search');
const playbackSource = require('./isapi/playback-source');
const nvrChannelMap = require('./isapi/nvr-channel-map');
const storageApi = require('./isapi/storage-api');
const onvifDriver = require('./drivers/onvif-driver');
const sseBroadcaster = require('./events/sse-broadcaster');

// MIME types for static file serving
const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// ─── Helpers ──────────────────────────────────────────────────────────

/**
 * Probe a single camera's hardware (Edge AI) capabilities right after it's
 * added/edited, so HW detectors light up without a full server restart.
 * No-op when ISAPI is disabled or the camera has no ISAPI/HTTP port.
 */
function probeCameraCapabilities(cam) {
  if (!cam) return;
  // ONVIF cameras (V-014, Fase 5): probe via GetServices + GetEventProperties.
  if (String(cam.protocol || '').toLowerCase() === 'onvif') {
    const onvifDriver = require('./drivers/onvif-driver');
    Promise.resolve()
      .then(() => onvifDriver.getCapabilities(cam))
      .then((caps) => {
        cameraManager.setHwCapabilities(cam.id, caps);
        sseBroadcaster.broadcast({ type: 'capabilities-updated', cameraId: cam.id });
      })
      .catch((err) => console.warn(`[onvif-probe] ${cam.id} on-add probe failed:`, err.message));
    return;
  }
  if (!cam.isapiPort || !config.isapiEnabled) return;
  const capabilitiesProbe = require('./isapi/capabilities-probe');
  Promise.resolve()
    .then(() => capabilitiesProbe.probeCamera(cam))
    .then((caps) => {
      cameraManager.setHwCapabilities(cam.id, caps);
      sseBroadcaster.broadcast({ type: 'capabilities-updated', cameraId: cam.id });
    })
    .catch((err) => console.warn(`[isapi-probe] ${cam.id} on-add probe failed:`, err.message));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString()));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', reject);
  });
}

/**
 * Normalize a time string to Hikvision compact UTC "YYYYMMDDTHHmmSSZ".
 * Accepts already-compact values, ISO 8601, or datetime-local ("2026-06-22T07:00").
 * Returns null if unparseable.
 */
function _toCompactUtc(value) {
  if (!value) return null;
  if (/^\d{8}T\d{6}Z$/.test(value)) return value; // already compact UTC
  const d = new Date(value);
  if (isNaN(d)) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

/** Compact UTC "YYYYMMDDTHHmmSSZ" → epoch ms (UTC), or NaN. */
function _compactUtcToMs(s) {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/** Strip "user:pass@" credentials from any URL(s) in a string before logging. */
function _redact(text) {
  return String(text == null ? '' : text).replace(/\/\/[^/@\s]*@/g, '//***@');
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(data));
}

function serveStaticFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    // Revalidate code/markup every load so UI changes always reach the browser
    // (these files have no cache-busting query; without this header a normal
    // refresh keeps serving a stale app.js/style.css).
    const noCache = ['.js', '.css', '.html'].includes(ext);
    const headers = { 'Content-Type': mimeType };
    if (noCache) headers['Cache-Control'] = 'no-cache, must-revalidate';
    res.writeHead(200, headers);
    res.end(data);
  });
}

// ─── Route Handler ────────────────────────────────────────────────────

/**
 * Top-level request handler. Wraps the router so a thrown error or rejected
 * promise from ANY route can never crash the process (no global try/catch here
 * previously → an unhandled rejection took the server down). Always answers the
 * client with a 500 instead of hanging the socket.
 */
async function handleRequest(req, res) {
  try {
    await routeRequest(req, res);
  } catch (err) {
    console.error('[router] Unhandled request error:', (err && err.stack) || err);
    try {
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: 'internal server error' }));
    } catch (e) { /* socket already gone */ }
  }
}

async function routeRequest(req, res) {
  let url;
  try {
    url = new URL(req.url, `http://localhost:${config.port}`);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad request URL' }));
    return;
  }
  const pathname = url.pathname;
  const method = req.method;

  // CORS preflight
  if (method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  // Optional auth guard for state-mutating endpoints. Only enforced when an
  // operator sets config.apiToken (env CCTV_API_TOKEN) — default is open so the
  // existing LAN deployment keeps working unchanged. Streaming routes
  // (/api/webrtc, /api/streams, /api/playback/stream/*) are intentionally NOT
  // gated so live/playback video keeps working without a token.
  if (config.apiToken && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    const guarded = pathname === '/api/cameras'
      || /^\/api\/cameras\//.test(pathname)
      || pathname === '/api/nvr/channels'
      || pathname === '/api/nvr/import'
      || pathname === '/api/onvif/discover'
      || pathname === '/api/onvif/profiles'
      || pathname === '/api/onvif/playback/start'
      || /^\/api\/onvif\/ptz\//.test(pathname)
      || pathname === '/api/storage/check'
      || /^\/api\/detection\//.test(pathname);
    if (guarded) {
      const tok = req.headers['x-api-token'] || url.searchParams.get('token');
      if (tok !== config.apiToken) return sendJSON(res, 401, { error: 'unauthorized' });
    }
  }

  // ── API Routes ──────────────────────────────────────────────────

  // Health check
  if (pathname === '/health' && method === 'GET') {
    return sendJSON(res, 200, {
      status: 'ok',
      go2rtc: go2rtcManager.isReady() ? 'ready' : 'unavailable',
      cameras: cameraManager.list().length,
      timestamp: new Date().toISOString(),
    });
  }

  // ── Dashboard layout (auto-restored grid arrangement) ───────────
  // GET returns the saved layout (or {} if none); PUT persists the current one.
  if (pathname === '/api/dashboard' && method === 'GET') {
    return sendJSON(res, 200, loadDashboard() || {});
  }
  if (pathname === '/api/dashboard' && method === 'PUT') {
    const body = await readBody(req);
    if (!body || typeof body !== 'object') return sendJSON(res, 400, { error: 'invalid dashboard body' });
    try {
      saveDashboard(body);
      return sendJSON(res, 200, { ok: true });
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // ── Playback display timezone (country → fixed offset) ──────────
  if (pathname === '/api/timezone' && method === 'GET') {
    return sendJSON(res, 200, loadTimezone());
  }
  if (pathname === '/api/timezone' && method === 'PUT') {
    const body = await readBody(req);
    if (!body || !Number.isFinite(Number(body.offsetMin))) {
      return sendJSON(res, 400, { error: 'offsetMin (number, minutes) is required' });
    }
    try {
      return sendJSON(res, 200, saveTimezone({ country: body.country, offsetMin: Number(body.offsetMin) }));
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // Camera list
  if (pathname === '/api/cameras' && method === 'GET') {
    return sendJSON(res, 200, cameraManager.list());
  }

  // Add camera
  if (pathname === '/api/cameras' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.ip) {
      return sendJSON(res, 400, { error: 'ip is required' });
    }
    const cam = cameraManager.add(body);
    sseBroadcaster.broadcast({ type: 'camera-added', camera: { id: cam.id, name: cam.name } });
    probeCameraCapabilities(cam);
    return sendJSON(res, 201, cam);
  }

  // Scan an NVR/DVR for its channel list (names + source IPs).
  // POST /api/nvr/channels  { ip, port (ISAPI/HTTP port), username, password }
  if (pathname === '/api/nvr/channels' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.ip || !body.port) {
      return sendJSON(res, 400, { error: 'ip and port (the device HTTP/ISAPI port) are required' });
    }
    const result = await nvrChannelMap.scanChannels({
      ip: body.ip, port: parseInt(body.port, 10),
      username: body.username, password: body.password,
    });
    return sendJSON(res, result.error ? 502 : 200, result);
  }

  // Import selected NVR/DVR channels as cameras (each routed through the recorder).
  // POST /api/nvr/import  { recorder:{ ip, rtspPort, isapiPort, username, password }, group, channels:[{channel,name}] }
  if (pathname === '/api/nvr/import' && method === 'POST') {
    const body = await readBody(req);
    const rec = body && body.recorder;
    if (!rec || !rec.ip) return sendJSON(res, 400, { error: 'recorder.ip is required' });
    if (!Array.isArray(body.channels) || body.channels.length === 0) {
      return sendJSON(res, 400, { error: 'at least one channel is required' });
    }
    const created = [];
    for (const ch of body.channels) {
      const chNum = parseInt(ch.channel, 10);
      if (!chNum) continue;
      // Each channel is a camera whose host IS the recorder: live via
      // /Streaming/Channels/<ch>01, playback resolves to the recorder channel
      // (deviceType 'nvr' → playback-source 'self' using detection.channelID).
      const cam = cameraManager.add({
        name: ch.name || `Channel ${chNum}`,
        group: body.group || 'NVR',
        ip: rec.ip,
        port: parseInt(rec.rtspPort, 10) || 554,
        isapiPort: rec.isapiPort ? parseInt(rec.isapiPort, 10) : null,
        username: rec.username || 'admin',
        password: rec.password || '',
        rtspPath: `/Streaming/Channels/${chNum}01`,
        deviceType: 'nvr',
        detection: { isapi: true, channelID: String(chNum) },
      });
      created.push({ id: cam.id, name: cam.name, channel: chNum });
    }
    sseBroadcaster.broadcast({ type: 'cameras-imported', count: created.length });
    return sendJSON(res, 201, { added: created.length, cameras: created });
  }

  // ── ONVIF (V-014, Fase 1) ───────────────────────────────────────
  // Auto-discover ONVIF devices on the LAN (WS-Discovery, multicast). No DEVICE
  // creds needed (WS-Discovery is unauthenticated), but the endpoint itself is
  // token-guarded when CCTV_API_TOKEN is set. POST /api/onvif/discover
  if (pathname === '/api/onvif/discover' && method === 'POST') {
    try {
      const devices = await onvifDriver.discover();
      return sendJSON(res, 200, { devices });
    } catch (err) {
      return sendJSON(res, 200, { devices: [], error: err.message });
    }
  }

  // Resolve an ONVIF device's media profiles + RTSP URIs for onboarding.
  // POST /api/onvif/profiles  { ip, port (ONVIF port), username, password, xaddr? }
  if (pathname === '/api/onvif/profiles' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.ip) return sendJSON(res, 400, { error: 'ip is required' });
    const onvifPort = parseInt(body.port, 10) || 80;
    if (onvifPort < 1 || onvifPort > 65535) return sendJSON(res, 400, { error: 'port must be 1-65535' });
    try {
      const result = await onvifDriver.resolveStreamUris({
        ip: body.ip, port: onvifPort,
        username: body.username, password: body.password, xaddr: body.xaddr,
      });
      return sendJSON(res, result.error ? 502 : 200, result);
    } catch (err) {
      return sendJSON(res, 502, { error: err.message });
    }
  }

  // ONVIF Profile-G playback summary. GET /api/onvif/playback/summary?cam=ID
  if (pathname === '/api/onvif/playback/summary' && method === 'GET') {
    const cam = cameraManager.getById(url.searchParams.get('cam') || '');
    if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
    if (String(cam.protocol || '').toLowerCase() !== 'onvif') return sendJSON(res, 400, { error: 'not an ONVIF camera' });
    try {
      const result = await onvifDriver.searchRecordings(cam);
      return sendJSON(res, result.error ? 502 : 200, result);
    } catch (err) {
      return sendJSON(res, 502, { error: err.message });
    }
  }

  // Start ONVIF Profile-G replay for a recording token. POST /api/onvif/playback/start { cam, token }
  if (pathname === '/api/onvif/playback/start' && method === 'POST') {
    const body = await readBody(req) || {};
    const cam = cameraManager.getById(body.cam || '');
    if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
    if (String(cam.protocol || '').toLowerCase() !== 'onvif') return sendJSON(res, 400, { error: 'not an ONVIF camera' });
    if (!body.token) return sendJSON(res, 400, { error: 'recording token required' });
    try {
      const rtspUrl = await onvifDriver.getReplayUri(cam, body.token);
      const result = await playbackStream.startPlaybackFromUrl(cam.id, rtspUrl);
      return sendJSON(res, result.error ? 502 : 200, result);
    } catch (err) {
      return sendJSON(res, 502, { error: err.message });
    }
  }

  // PTZ control for an ONVIF camera. POST /api/onvif/ptz/:id  { action:'move'|'stop', pan,tilt,zoom }
  const ptzMatch = pathname.match(/^\/api\/onvif\/ptz\/([^/]+)$/);
  if (ptzMatch && method === 'POST') {
    const cam = cameraManager.getById(decodeURIComponent(ptzMatch[1]));
    if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
    if (String(cam.protocol || '').toLowerCase() !== 'onvif') return sendJSON(res, 400, { error: 'not an ONVIF camera' });
    const body = await readBody(req) || {};
    try {
      const result = await onvifDriver.ptz(cam, {
        action: body.action || 'move',
        pan: body.pan, tilt: body.tilt, zoom: body.zoom,
      });
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 502, { error: err.message });
    }
  }

  // Check storage/HDD on a device by credentials (used by the Add-camera "Test
  // connection" flow, before the camera exists). POST /api/storage/check
  //   { ip, port (ISAPI/HTTP port), username, password }
  if (pathname === '/api/storage/check' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.ip || !body.port) {
      return sendJSON(res, 400, { error: 'ip and port (the device HTTP/ISAPI port) are required' });
    }
    const result = await storageApi.getStorage({
      ip: body.ip, port: parseInt(body.port, 10),
      username: body.username, password: body.password,
    });
    return sendJSON(res, result.error ? 502 : 200, result);
  }

  // Storage/HDD management for an existing camera: GET /api/cameras/:id/storage
  // Works for IP cameras (microSD) and NVR/DVR channels (queries the recorder's HDDs).
  const storageMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/storage$/);
  if (storageMatch && method === 'GET') {
    const cam = cameraManager.getById(storageMatch[1]);
    if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
    if (!cam.isapiPort) return sendJSON(res, 400, { error: 'camera has no ISAPI/HTTP port configured' });
    const result = await storageApi.getStorage({
      ip: cam.ip, port: cam.isapiPort, username: cam.username, password: cam.password,
    });
    return sendJSON(res, result.error ? 502 : 200, result);
  }

  // Playback readiness diagnostics: GET /api/cameras/:id/playback-readiness[?source=]
  // Explains WHY a camera has no recordings — which settings were missed (no
  // storage, recording not enabled, etc.) — so whoever configures it knows.
  const readyMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/playback-readiness$/);
  if (readyMatch && method === 'GET') {
    const id = readyMatch[1];
    const cam = cameraManager.getById(id);
    if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
    const src = await playbackSource.resolve(id, url.searchParams.get('source') || undefined);
    if (!src || src.error) {
      return sendJSON(res, 200, {
        camera: id, issues: [{ level: 'error',
          msg: 'Tidak ada sumber playback untuk kamera ini.',
          fix: 'Hubungkan kamera ke NVR, atau pasang penyimpanan (SD/NAS) di kamera.' }],
        summary: 'Tidak ada sumber playback',
      });
    }
    const auth = { ip: src.ip, port: src.isapiPort, username: src.username, password: src.password };
    const [storage, tracks] = await Promise.all([
      storageApi.getStorage(auth),
      storageApi.getRecordingTracks(auth),
    ]);
    const issues = [];
    if (storage.error) {
      issues.push({ level: 'warn', msg: `Tidak bisa cek penyimpanan: ${storage.error}`, fix: 'Periksa kredensial/port ISAPI perangkat.' });
    } else if (!storage.hasStorage) {
      issues.push({ level: 'error', msg: 'Perangkat tidak punya penyimpanan (SD/HDD/NAS).', fix: 'Pasang microSD atau konfigurasi NAS di Configuration → Storage → Storage Management.' });
    } else if (!storage.recordable) {
      issues.push({ level: 'warn', msg: 'Penyimpanan terdeteksi tapi belum siap (unformatted/error).', fix: 'Format/perbaiki disk di Configuration → Storage → Storage Management.' });
    }
    let recordingEnabled = null;
    if (tracks.ok) {
      const t = tracks.tracks.find((x) => x.id === src.track) || tracks.tracks[0];
      recordingEnabled = t ? t.enable : false;
      if (!t || !t.enable) {
        issues.push({ level: 'error', msg: 'Perekaman (Record Schedule) belum aktif untuk channel ini.', fix: 'Configuration → Storage → Schedule Settings: centang Enable, set Continuous, lalu Save.' });
      }
    }
    const summary = issues.length
      ? 'Ada pengaturan yang perlu dicek agar playback tersedia'
      : 'Penyimpanan & perekaman OK — kemungkinan belum ada rekaman pada rentang waktu ini';
    return sendJSON(res, 200, {
      camera: id, source: src.sourceKey, device: src.ip,
      hasStorage: !!storage.hasStorage, recordable: !!storage.recordable,
      media: storage.media || [], recordingEnabled, issues, summary,
    });
  }

  // Camera CRUD by ID: /api/cameras/:id
  const cameraMatch = pathname.match(/^\/api\/cameras\/([^/]+)$/);
  if (cameraMatch) {
    const id = cameraMatch[1];

    if (method === 'GET') {
      const cam = cameraManager.getById(id);
      if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
      return sendJSON(res, 200, cam);
    }

    if (method === 'PUT') {
      const body = await readBody(req);
      const cam = cameraManager.update(id, body || {});
      if (!cam) return sendJSON(res, 404, { error: 'Camera not found' });
      sseBroadcaster.broadcast({ type: 'camera-updated', camera: { id: cam.id, name: cam.name } });
      probeCameraCapabilities(cam);
      return sendJSON(res, 200, cam);
    }

    if (method === 'DELETE') {
      const ok = cameraManager.remove(id);
      if (!ok) return sendJSON(res, 404, { error: 'Camera not found' });
      sseBroadcaster.broadcast({ type: 'camera-removed', cameraId: id });
      return sendJSON(res, 200, { ok: true });
    }
  }

  // Camera thumbnail: /api/cameras/:id/thumbnail
  const thumbnailMatch = pathname.match(/^\/api\/cameras\/([^/]+)\/thumbnail$/);
  if (thumbnailMatch && method === 'GET') {
    const id = thumbnailMatch[1];
    mjpegManager.getSnapshot(id, (jpeg) => {
      if (!jpeg) {
        // Return a 1x1 transparent placeholder
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'no-cache',
      });
      res.end(jpeg);
    });
    return;
  }

  // ── MJPEG Stream: /mjpeg/:cameraId ──────────────────────────────

  const mjpegMatch = pathname.match(/^\/mjpeg\/([^/]+)$/);
  if (mjpegMatch && method === 'GET') {
    return mjpegManager.handleStream(mjpegMatch[1], res, url.searchParams.get('quality'));
  }

  // ── WebRTC / go2rtc API proxy: /api/* ───────────────────────────

  if (pathname.startsWith('/api/webrtc') || pathname.startsWith('/api/streams')) {
    return go2rtcProxy.handleProxy(req, res);
  }

  // ── SSE Events ──────────────────────────────────────────────────

  if (pathname === '/api/events' && method === 'GET') {
    return sseBroadcaster.handleConnection(req, res);
  }

  // ── Stats ───────────────────────────────────────────────────────

  if (pathname === '/api/stats' && method === 'GET') {
    return sendJSON(res, 200, {
      mjpeg: mjpegManager.getStats(),
      go2rtc: go2rtcManager.isReady() ? 'ready' : 'unavailable',
      sseClients: sseBroadcaster.getClientCount(),
      cameras: cameraManager.list().length,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
    });
  }

  // ── Detection Status ───────────────────────────────────────────

  if (pathname === '/api/detection/status' && method === 'GET') {
    const alertStreamManager = config.isapiEnabled
      ? require('./isapi/alert-stream-manager')
      : null;
    const status = alertStreamManager ? alertStreamManager.getStatus() : {};
    return sendJSON(res, 200, {
      isapiEnabled: config.isapiEnabled,
      vcaEnabled: config.vcaEnabled,
      cameras: status,
    });
  }

  const reconnectMatch = pathname.match(/^\/api\/detection\/reconnect\/([^/]+)$/);
  if (reconnectMatch && method === 'POST') {
    const id = decodeURIComponent(reconnectMatch[1]);
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    const alertStreamManager = require('./isapi/alert-stream-manager');
    alertStreamManager.reconnectCamera(id);
    return sendJSON(res, 200, { ok: true, message: `Reconnecting ${id}` });
  }

  if (pathname === '/api/detection/probe' && method === 'POST') {
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    const capabilitiesProbe = require('./isapi/capabilities-probe');
    capabilitiesProbe.probeAllCameras(); // async, non-blocking
    const lineCrossingApi = require('./isapi/line-crossing-api');
    lineCrossingApi.invalidateCache(); // clear line config cache so next fetch gets fresh data
    return sendJSON(res, 200, { ok: true, message: 'Capabilities probe started' });
  }

  // ── Sensitivity API ─────────────────────────────────────────────

  const sensMatch = pathname.match(/^\/api\/detection\/sensitivity\/([^/]+)$/);
  if (sensMatch && (method === 'GET' || method === 'PUT')) {
    const cameraId = decodeURIComponent(sensMatch[1]);
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    const sensitivityApi = require('./isapi/sensitivity-api');

    if (method === 'GET') {
      try {
        const result = await sensitivityApi.getAllSensitivities(cameraId);
        return sendJSON(res, result.error ? 400 : 200, result);
      } catch (err) {
        return sendJSON(res, 500, { error: err.message });
      }
    }

    if (method === 'PUT') {
      try {
        const body = await readBody(req);
        if (!body) return sendJSON(res, 400, { error: 'Invalid JSON body' });
        const { detectorId, sensitivity } = body;
        if (!detectorId || sensitivity === undefined) {
          return sendJSON(res, 400, { error: 'Missing detectorId or sensitivity' });
        }
        const result = await sensitivityApi.setSensitivity(cameraId, detectorId, sensitivity);
        return sendJSON(res, result.error ? 400 : 200, result);
      } catch (err) {
        return sendJSON(res, 500, { error: err.message });
      }
    }
  }

  // ── Line Crossing Config API ──────────────────────────────────────

  const lineConfigMatch = pathname.match(/^\/api\/detection\/lines\/([^/]+)$/);
  if (lineConfigMatch && method === 'GET') {
    const cameraId = decodeURIComponent(lineConfigMatch[1]);
    // Line-crossing config is ISAPI-only. ONVIF cameras have no ISAPI endpoint —
    // return a benign empty config (not a 400) so the frontend just draws no
    // overlay instead of logging a Bad Request. (Rule config for ONVIF analytics
    // is a separate, later concern.)
    const camObj = cameraManager.getById(cameraId);
    if (camObj && String(camObj.protocol || '').toLowerCase() === 'onvif') {
      return sendJSON(res, 200, {
        lines: [], regions: [], lineDetectionEnabled: false, fieldDetectionEnabled: false,
        motionEnabled: false, faceEnabled: false, notSupported: 'onvif',
      });
    }
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    const lineCrossingApi = require('./isapi/line-crossing-api');

    try {
      const forceRefresh = url.searchParams.get('refresh') === 'true';
      const result = await lineCrossingApi.getLineConfig(cameraId, forceRefresh);
      return sendJSON(res, result.error ? 400 : 200, result);
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // PUT /api/detection/rule/:cameraId — Enable/disable a detector rule in camera via ISAPI
  const ruleMatch = pathname.match(/^\/api\/detection\/rule\/([^/]+)$/);
  if (ruleMatch && method === 'PUT') {
    const cameraId = decodeURIComponent(ruleMatch[1]);
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    try {
      const body = await readBody(req);
      if (!body) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { detectorId, enabled } = body;
      if (!detectorId || enabled === undefined) {
        return sendJSON(res, 400, { error: 'Missing detectorId or enabled' });
      }
      const lineCrossingApi = require('./isapi/line-crossing-api');
      const result = await lineCrossingApi.setDetectionEnabled(cameraId, detectorId, !!enabled);
      if (result.error) return sendJSON(res, 500, result);
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // PUT /api/detection/line-draw/:cameraId — Draw/update Line 1 coordinates in camera via ISAPI
  const lineDrawMatch = pathname.match(/^\/api\/detection\/line-draw\/([^/]+)$/);
  if (lineDrawMatch && method === 'PUT') {
    const cameraId = decodeURIComponent(lineDrawMatch[1]);
    if (!config.isapiEnabled) {
      return sendJSON(res, 400, { error: 'ISAPI detection not enabled' });
    }
    try {
      const body = await readBody(req);
      if (!body) return sendJSON(res, 400, { error: 'Invalid JSON body' });
      const { x1, y1, x2, y2, direction } = body;
      if ([x1, y1, x2, y2].some(v => v === undefined || v === null || isNaN(Number(v)))) {
        return sendJSON(res, 400, { error: 'Missing or invalid coordinates (x1, y1, x2, y2 required)' });
      }
      const validDirs = ['any', 'left-right', 'right-left'];
      const dir = validDirs.includes(direction) ? direction : 'any';
      const lineCrossingApi = require('./isapi/line-crossing-api');
      const result = await lineCrossingApi.setLineCoordinates(
        cameraId, Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2), dir
      );
      if (result.error) return sendJSON(res, 500, result);
      return sendJSON(res, 200, result);
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // ── Playback (NVR/DVR recorded video) ───────────────────────────

  // GET /api/playback/search?cam=<id>&start=<ISO>&end=<ISO>&max=&pos=
  // Search recorded segments. start/end accept any Date-parseable string
  // (e.g. datetime-local "2026-06-22T07:00"); converted to UTC server-side.
  if (pathname === '/api/playback/search' && method === 'GET') {
    if (!config.isapiEnabled) return sendJSON(res, 400, { error: 'ISAPI not enabled' });
    const cam = url.searchParams.get('cam');
    const start = new Date(url.searchParams.get('start'));
    const end = new Date(url.searchParams.get('end'));
    if (!cam) return sendJSON(res, 400, { error: 'cam is required' });
    try {
      const result = await playbackSearch.searchRecordings(cam, start, end, {
        max: parseInt(url.searchParams.get('max'), 10) || 40,
        pos: parseInt(url.searchParams.get('pos'), 10) || 0,
        source: url.searchParams.get('source') || undefined,
      });
      return sendJSON(res, result.error ? 400 : 200, result);
    } catch (err) {
      return sendJSON(res, 500, { error: err.message });
    }
  }

  // POST /api/playback/stream/start  { cam, start, end }  (start/end compact UTC or ISO)
  // Registers a temporary go2rtc stream; play via /api/webrtc?src=<name>.
  if (pathname === '/api/playback/stream/start' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.cam || !body.start) {
      return sendJSON(res, 400, { error: 'cam and start are required' });
    }
    const startUtc = _toCompactUtc(body.start);
    const endUtc = body.end ? _toCompactUtc(body.end) : null;
    if (!startUtc) return sendJSON(res, 400, { error: 'invalid start' });
    const result = await playbackStream.startPlayback(body.cam, startUtc, endUtc, body.source, body.playbackURI);
    return sendJSON(res, result.error ? 400 : 200, result);
  }

  // POST /api/playback/stream/stop  { name }
  if (pathname === '/api/playback/stream/stop' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.name) return sendJSON(res, 400, { error: 'name is required' });
    const result = await playbackStream.stopPlayback(body.name);
    return sendJSON(res, result.error ? 400 : 200, result);
  }

  // GET /api/playback/download?cam=<id>&start=<ISO>&end=<ISO>[&filename=]
  // Streams recorded video as a downloadable MP4 (ffmpeg copy, no transcode).
  if (pathname === '/api/playback/download' && method === 'GET') {
    const camId = url.searchParams.get('cam');
    const startUtc = _toCompactUtc(url.searchParams.get('start'));
    const endUtc = _toCompactUtc(url.searchParams.get('end'));
    if (!camId) return sendJSON(res, 400, { error: 'cam is required' });
    if (!startUtc || !endUtc) return sendJSON(res, 400, { error: 'valid start and end are required' });
    // Reject zero-length / inverted ranges before spawning ffmpeg, so we always
    // pass a positive -t (an unbounded pull is exactly what leaks NVR sessions).
    const _sMs = _compactUtcToMs(startUtc), _eMs = _compactUtcToMs(endUtc);
    if (!(_eMs > _sMs)) return sendJSON(res, 400, { error: 'end must be after start' });

    // Route through the chosen source (default = NVR channel carrying this cam).
    const src = await playbackSource.resolve(camId, url.searchParams.get('source') || undefined);
    if (!src) return sendJSON(res, 404, { error: 'camera not found' });
    if (src.error) return sendJSON(res, 400, { error: src.message || src.error, code: src.error });

    // Convert the requested LOCAL wall-clock window to the device's search
    // convention (subtract per-device display offset). NVR offset = 0.
    const dlOffMin = await playbackSearch.getDisplayOffsetMin(src);
    const _toDev = (compact) => {
      const ms = _compactUtcToMs(compact);
      if (ms == null) return compact;
      const d = new Date(ms - dlOffMin * 60000), p = (n) => String(n).padStart(2, '0');
      return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
    };

    const playbackUrl = cameraManager.buildTracksRtspUrl({
      host: src.ip, port: src.rtspPort, user: src.username, pass: src.password,
      track: src.track, startUtc: _toDev(startUtc), endUtc: _toDev(endUtc),
    });
    const filename = (url.searchParams.get('filename') || `${camId}_${startUtc}_${endUtc}.mp4`)
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    // CRITICAL: bound the pull with -t <duration>. Hikvision NVRs often DON'T
    // send an RTSP teardown when playback reaches endtime, so ffmpeg would
    // otherwise hang forever holding an NVR playback session (these leak and
    // eventually trigger "453 Not Enough Bandwidth" for new playback). -t makes
    // ffmpeg stop after exactly the requested span and exit cleanly.
    const durSec = Math.max(1, Math.ceil((_eMs - _sMs) / 1000));

    // Fragmented MP4 so it can stream over stdout without a seekable file.
    // Video-only copy: recorder channels often have no audio track, and a bare
    // "-c copy" then makes the mp4 muxer fail ("incorrect codec parameters").
    // -t ALWAYS set (>=1s) so ffmpeg exits cleanly and never leaks an NVR session.
    const ffArgs = [
      '-rtsp_transport', 'tcp',
      '-i', playbackUrl,
      '-t', String(durSec),
      '-map', '0:v:0', '-c:v', 'copy', '-an',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      '-f', 'mp4', 'pipe:1',
    ];
    const ff = spawn(config.ffmpegBin, ffArgs);

    // Hard watchdog: even with -t, kill ffmpeg if it overruns wall-clock
    // (range seconds + generous slack) so a misbehaving NVR can't leak a session.
    const watchdogMs = Math.min(30 * 60 * 1000, (durSec + 60) * 1000 + 30000);
    const watchdog = setTimeout(() => { try { ff.kill('SIGKILL'); } catch (e) {} }, watchdogMs);
    if (watchdog.unref) watchdog.unref();

    // Don't commit the 200 + attachment headers until ffmpeg actually produces
    // data — otherwise a failed pull (no recording / camera rejects playback)
    // yields a broken 0-byte download. Buffer the first chunk, then stream.
    let headersSent = false;
    let ffErr = '';
    ff.stderr.on('data', (d) => { ffErr += d.toString(); if (ffErr.length > 4000) ffErr = ffErr.slice(-4000); });

    ff.stdout.on('data', (chunk) => {
      if (!headersSent) {
        headersSent = true;
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-cache',
        });
      }
      // Honor backpressure: if the client socket is full, pause ffmpeg's stdout
      // until it drains — otherwise a slow client makes Node buffer the whole
      // (potentially multi-GB) segment in memory.
      if (res.write(chunk) === false) ff.stdout.pause();
    });
    res.on('drain', () => { try { ff.stdout.resume(); } catch (e) {} });

    ff.on('error', (err) => {
      clearTimeout(watchdog);
      if (!headersSent) return sendJSON(res, 500, { error: `ffmpeg spawn failed: ${err.message}` });
      try { res.end(); } catch (e) {}
    });
    ff.on('close', (code) => {
      clearTimeout(watchdog);
      if (!headersSent) {
        // Nothing was produced — surface a clear error instead of an empty file.
        const tail = _redact(ffErr.split('\n').filter(Boolean).slice(-2).join(' '));
        console.warn(`[playback] download produced no data (exit ${code}): ${tail}`);
        const busy = /453|not enough bandwidth/i.test(ffErr);
        return sendJSON(res, busy ? 503 : 502, {
          error: busy
            ? 'NVR busy: max simultaneous playback sessions reached — close other playbacks and retry.'
            : 'No video for this range (recording missing or camera rejected playback)',
          detail: tail,
        });
      }
      if (code !== 0) console.warn(`[playback] ffmpeg download exited ${code}: ${_redact(ffErr.split('\n').slice(-3).join(' '))}`);
      try { res.end(); } catch (e) {}
    });
    // Kill ffmpeg when the client disconnects so we never leak an NVR session.
    req.on('close', () => { clearTimeout(watchdog); try { ff.kill('SIGKILL'); } catch (e) {} });
    return;
  }

  // ── Static Files ────────────────────────────────────────────────

  if (pathname === '/' || pathname === '/index.html') {
    return serveStaticFile(res, path.join(config.publicDir, 'index.html'));
  }

  // Serve files from public/ directory — with a hard containment check so a
  // crafted path can never escape publicDir (defense in depth beyond URL parsing).
  // decodeURIComponent can throw URIError on a malformed escape (e.g. "/%E0") —
  // guard it so a bad URL is a clean 400, not an uncaught crash. No sync fs here:
  // serveStaticFile does an async readFile and 404s on missing/dir paths.
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch (e) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'bad request path' }));
    return;
  }
  const root = path.resolve(config.publicDir);
  const resolved = path.resolve(path.join(root, decodedPath));
  if (resolved === root || resolved.startsWith(root + path.sep)) {
    return serveStaticFile(res, resolved);
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
}

module.exports = { handleRequest };
