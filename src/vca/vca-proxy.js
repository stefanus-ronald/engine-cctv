/**
 * VCA Proxy — Optional Python VCA sidecar integration.
 *
 * Periodically captures JPEG snapshots from cameras and sends them
 * to an external Python VCA service (YOLOv8) for AI-based detection.
 *
 * Only active when VCA_ENABLED=true in .env.
 *
 * Flow:
 *   Timer → Snapshot from MJPEG manager → POST to Python VCA → Normalize → SSE broadcast
 */

const http = require('http');
const { config } = require('../config');
const { normalizeVcaDetection } = require('../events/event-normalizer');
const { isDuplicate } = require('../events/event-dedup');
const sseBroadcaster = require('../events/sse-broadcaster');

let cameraManager = null;
let mjpegManager = null;
const timers = new Map(); // cameraId → timer

/**
 * Initialize VCA proxy — start analysis timers for each camera.
 */
function init() {
  cameraManager = require('../camera-manager');
  mjpegManager = require('../mjpeg/mjpeg-manager');

  const cameras = cameraManager.getAll();
  const intervalMs = Math.round(1000 / (config.vcaFps || 2));

  for (const cam of cameras) {
    startCameraTimer(cam.id, intervalMs);
  }

  // Listen for camera changes
  cameraManager.onCameraChange((action, camera) => {
    if (action === 'add') {
      startCameraTimer(camera.id, intervalMs);
    } else if (action === 'remove') {
      stopCameraTimer(camera.id);
    }
  });

  console.log(`[vca] Started analysis for ${cameras.length} camera(s) at ${config.vcaFps} fps`);
}

/**
 * Start periodic analysis for a camera.
 */
function startCameraTimer(cameraId, intervalMs) {
  if (timers.has(cameraId)) return;

  const timer = setInterval(() => {
    analyzeCamera(cameraId);
  }, intervalMs);

  if (timer.unref) timer.unref();
  timers.set(cameraId, timer);
}

/**
 * Stop analysis for a camera.
 */
function stopCameraTimer(cameraId) {
  const timer = timers.get(cameraId);
  if (timer) {
    clearInterval(timer);
    timers.delete(cameraId);
  }
}

/**
 * Capture snapshot and send to VCA service for analysis.
 */
function analyzeCamera(cameraId) {
  mjpegManager.getSnapshot(cameraId, (jpeg) => {
    if (!jpeg) return; // no snapshot available

    sendToVca(cameraId, jpeg);
  });
}

/**
 * POST JPEG to the Python VCA service.
 */
function sendToVca(cameraId, jpegBuffer) {
  const boundary = '----VCABoundary' + Date.now();
  const bodyParts = [
    `--${boundary}\r\n`,
    `Content-Disposition: form-data; name="image"; filename="frame.jpg"\r\n`,
    `Content-Type: image/jpeg\r\n\r\n`,
  ];
  const bodyEnd = `\r\n--${boundary}--\r\n`;

  const headerBuffer = Buffer.from(bodyParts.join(''));
  const endBuffer = Buffer.from(bodyEnd);
  const body = Buffer.concat([headerBuffer, jpegBuffer, endBuffer]);

  const options = {
    hostname: config.vcaHost,
    port: config.vcaPort,
    path: '/detect',
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
    timeout: 5000,
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
      if (res.statusCode !== 200) return;

      try {
        const result = JSON.parse(data);
        handleVcaResult(cameraId, result);
      } catch (e) {
        // Invalid JSON response
      }
    });
  });

  req.on('error', () => {
    // VCA service unavailable — silently skip
  });

  req.on('timeout', () => {
    req.destroy();
  });

  req.write(body);
  req.end();
}

/**
 * Handle VCA detection results.
 */
function handleVcaResult(cameraId, result) {
  const detections = result.detections || result.results || [];

  for (const det of detections) {
    // Filter by confidence threshold
    if ((det.confidence || 0) < config.vcaConfidence) continue;

    // Filter by allowed classes
    if (config.vcaClasses && config.vcaClasses.length > 0) {
      if (!config.vcaClasses.includes(det.label || det.class)) continue;
    }

    const event = normalizeVcaDetection({
      label: det.label || det.class,
      confidence: det.confidence,
      bbox_normalized: det.bbox || det.bbox_normalized || null,
    }, cameraId);

    if (!event) continue;
    if (isDuplicate(event)) continue;

    sseBroadcaster.broadcast(event);
  }
}

/**
 * Graceful shutdown — stop all timers.
 */
function stop() {
  // Collect keys first to avoid mutating Map during iteration
  const ids = [...timers.keys()];
  for (const cameraId of ids) {
    stopCameraTimer(cameraId);
  }
  timers.clear();
  console.log('[vca] All analysis timers stopped');
}

module.exports = { init, stop };
