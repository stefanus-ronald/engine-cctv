const http = require('http');
const { config } = require('./config');
const cameraManager = require('./camera-manager');
const go2rtcManager = require('./webrtc/go2rtc-manager');
const playbackStream = require('./webrtc/playback-stream');
const mjpegManager = require('./mjpeg/mjpeg-manager');
const { handleRequest } = require('./router');

/**
 * ENGINE-CCTV — Unified CCTV streaming server.
 *
 * Single HTTP server combining:
 * - Static file serving (UI)
 * - Camera management API
 * - MJPEG streaming (FFmpeg)
 * - WebRTC signaling proxy (go2rtc)
 * - SSE real-time events
 */

// Last-resort safety net: a stray rejection/throw from a background task (an
// ISAPI socket, an FFmpeg event, a timer) must NOT take the whole server down.
// Log loudly and keep serving; real bugs still surface in the logs.
process.on('unhandledRejection', (reason) => {
  console.error('[process] Unhandled promise rejection:', (reason && reason.stack) || reason);
});
process.on('uncaughtException', (err) => {
  console.error('[process] Uncaught exception:', (err && err.stack) || err);
});

async function main() {
  console.log('ENGINE-CCTV starting...');

  // 1. Load cameras (standalone IP cameras from cameras.json)
  cameraManager.init();
  console.log(`[cameras] Loaded ${cameraManager.getAll().length} camera(s)`);

  // 1.5. Auto-sync recorders: build channel cameras FROM each NVR/DVR in
  // nvrs.json (grouped under the recorder's real name). Runs before go2rtc /
  // alert init so those see the full camera set. Unreachable recorders keep
  // their last-known channels. Disable with NVR_AUTOSYNC=false.
  if (config.nvrAutoSync) {
    const nvrSync = require('./nvr-sync');
    try {
      await nvrSync.syncAll();
    } catch (err) {
      console.warn('[nvr-sync] failed:', err.message);
    }
  }
  console.log(`[cameras] Total after NVR sync: ${cameraManager.getAll().length} camera(s)`);

  // 2. Start go2rtc (WebRTC)
  const go2rtcReady = await go2rtcManager.init();
  if (go2rtcReady) {
    console.log('[go2rtc] WebRTC streaming ready');
  } else {
    console.log('[go2rtc] WebRTC unavailable — MJPEG-only mode');
  }

  // 2.5. Start ISAPI alert stream listeners (real detection)
  let alertStreamManager = null;
  if (config.isapiEnabled) {
    alertStreamManager = require('./isapi/alert-stream-manager');
    alertStreamManager.init();
    console.log('[isapi] Alert stream listeners starting...');

    // 2.7. Probe camera hardware capabilities via ISAPI
    const capabilitiesProbe = require('./isapi/capabilities-probe');
    capabilitiesProbe.probeAllCameras(); // async, non-blocking
  }

  // 2.6. Start VCA proxy (optional AI detection)
  let vcaProxy = null;
  if (config.vcaEnabled) {
    vcaProxy = require('./vca/vca-proxy');
    vcaProxy.init();
    console.log('[vca] Python VCA proxy starting...');
  }

  // 3. Start HTTP server
  const server = http.createServer(handleRequest);

  server.listen(config.port, () => {
    console.log('');
    console.log(`ENGINE-CCTV running on http://localhost:${config.port}`);
    console.log('');
    console.log('Endpoints:');
    console.log(`  UI:        http://localhost:${config.port}/`);
    console.log(`  API:       http://localhost:${config.port}/api/cameras`);
    console.log(`  Health:    http://localhost:${config.port}/health`);
    console.log(`  Stats:     http://localhost:${config.port}/api/stats`);
    console.log(`  Events:    http://localhost:${config.port}/api/events`);
    console.log(`  MJPEG:     http://localhost:${config.port}/mjpeg/<camera-id>`);
    console.log(`  WebRTC:    POST http://localhost:${config.port}/api/webrtc?src=<camera-id>`);
    console.log('');
  });

  // 4. Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    if (alertStreamManager) alertStreamManager.stop();
    if (vcaProxy) vcaProxy.stop();
    mjpegManager.stopAll();
    playbackStream.stopAll();
    go2rtcManager.stop();
    server.close();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    if (alertStreamManager) alertStreamManager.stop();
    if (vcaProxy) vcaProxy.stop();
    mjpegManager.stopAll();
    playbackStream.stopAll();
    go2rtcManager.stop();
    server.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
