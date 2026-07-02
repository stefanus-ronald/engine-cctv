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

  // 2.8. Start ONVIF PullPoint event loops (V-014, Fase 2). Feeds the same SSE
  // pipeline as ISAPI. Idle when there are no ONVIF cameras; off via ONVIF_EVENTS=false.
  let onvifEventManager = null;
  if (process.env.ONVIF_EVENTS !== 'false') {
    onvifEventManager = require('./onvif/onvif-event-manager');
    onvifEventManager.init();
    console.log('[onvif] Event listeners starting...');
  }

  // 2.9. Probe ONVIF camera capabilities (Fase 5) → sets hwCapabilities so the
  // Analytics panel shows real supported detectors. Async, non-blocking.
  {
    const onvifCams = cameraManager.getAll().filter(c => String(c.protocol || '').toLowerCase() === 'onvif');
    if (onvifCams.length) {
      const onvifDriver = require('./drivers/onvif-driver');
      const sseBroadcaster = require('./events/sse-broadcaster');
      for (const cam of onvifCams) {
        Promise.resolve()
          .then(() => onvifDriver.getCapabilities(cam))
          .then((caps) => {
            cameraManager.setHwCapabilities(cam.id, caps);
            sseBroadcaster.broadcast({ type: 'capabilities-updated', cameraId: cam.id });
          })
          .catch(() => {});
      }
      console.log(`[onvif] Probing capabilities for ${onvifCams.length} ONVIF camera(s)...`);
    }
  }

  // 3. Start HTTP server
  const server = http.createServer(handleRequest);

  // Stop every long-lived manager (child processes, sockets, timers). Shared by
  // graceful shutdown (SIGINT/SIGTERM) and fatal startup errors below.
  const stopAllManagers = () => {
    if (alertStreamManager) alertStreamManager.stop();
    if (onvifEventManager) onvifEventManager.stop();
    if (vcaProxy) vcaProxy.stop();
    mjpegManager.stopAll();
    playbackStream.stopAll();
    go2rtcManager.stop();
  };

  // listen() errors are emitted async on the server object — WITHOUT this handler
  // they fall into the global uncaughtException net, which deliberately does not
  // exit, leaving a half-alive duplicate (ISAPI/ONVIF connected, go2rtc spawned,
  // but no HTTP). A second instance must die loudly and cleanly instead.
  server.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.error(`[server] Port ${config.port} is already in use — is another ENGINE-CCTV instance running? Exiting.`);
    } else {
      console.error('[server] HTTP server error:', (err && err.stack) || err);
    }
    stopAllManagers();
    process.exit(1);
  });

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
  const shutdown = () => {
    console.log('\nShutting down...');
    stopAllManagers();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
