const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { config } = require('../config');
const cameraManager = require('../camera-manager');

/**
 * Go2RTCManager — Manages go2rtc binary lifecycle.
 * Reused pattern from rtsp2web-main/src/webrtc/go2rtc_multi.js
 *
 * - Generates go2rtc.yaml dynamically from cameras.json
 * - Starts go2rtc binary as child process
 * - Health check polling until ready
 * - Dynamic camera add/remove via go2rtc REST API
 * - Graceful shutdown
 */

let go2rtcProcess = null;
let go2rtcReady = false;

// ─── YAML Generator ──────────────────────────────────────────────────

/**
 * Quote a YAML value if it contains special characters.
 * Without quoting, characters like ! # : @ ? & break YAML parsing.
 */
function quoteYAMLValue(value) {
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  const s = String(value);
  // Always quote strings that contain YAML-special characters
  if (/[:#!@?&{}\[\],>|*"'`%\\ \t]/.test(s) || s === '' || s === 'true' || s === 'false' || s === 'null') {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function generateYAML(obj, indent = 0) {
  let yaml = '';
  const spaces = ' '.repeat(indent);

  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value)) {
      yaml += `${spaces}${key}:\n`;
      for (const item of value) {
        if (typeof item === 'object' && item !== null) {
          yaml += `${spaces}  - `;
          const objYaml = generateYAML(item, indent + 4);
          const lines = objYaml.trim().split('\n');
          yaml += lines[0] + '\n';
          for (let i = 1; i < lines.length; i++) {
            yaml += `${spaces}    ${lines[i]}\n`;
          }
        } else {
          yaml += `${spaces}  - ${quoteYAMLValue(item)}\n`;
        }
      }
    } else if (typeof value === 'object' && value !== null) {
      yaml += `${spaces}${key}:\n`;
      yaml += generateYAML(value, indent + 2);
    } else {
      yaml += `${spaces}${key}: ${quoteYAMLValue(value)}\n`;
    }
  }

  return yaml;
}

function buildGo2RTCConfig() {
  const cameras = cameraManager.getAll();

  const configObj = {
    api: {
      listen: `:${config.go2rtcApiPort}`,
    },
    webrtc: {
      listen: `:${config.go2rtcWebrtcPort}`,
      mdns: 0, // Safari compatibility
      candidates: [`stun:${config.go2rtcWebrtcPort}`, `:${config.go2rtcWebrtcPort}`],
      jitter_buffer: 50,
      ice_servers: [
        { urls: ['stun:stun.l.google.com:19302'] },
        { urls: ['stun:stun1.l.google.com:19302'] },
      ],
    },
    rtsp: {
      listen: ':8554',
    },
    streams: {},
    ffmpeg: {
      bin: config.ffmpegBin,
      global: '-hide_banner -loglevel error',
      // Custom input template for RECORDED playback: `-re` paces reading to the
      // stream's native frame rate. Without it, a camera's own SD/NAS playback
      // (Streaming/tracks) is delivered as fast as the network allows → video
      // runs faster than realtime. (NVRs self-throttle to realtime, cameras do
      // not.) TCP is required so standalone cameras accept playback. Referenced
      // space-free as `#input=rtsp_re` from playback-stream.js.
      rtsp_re: '-re -rtsp_transport tcp -i {input}',
    },
    log: {
      level: 'info',
      format: 'color',
    },
  };

  // Add each camera as a stream with smart fallback strategy
  for (const cam of cameras) {
    const rtspUrl = cameraManager.buildRtspUrlForQuality(cam, 'main');
    const sources = [rtspUrl]; // Primary: passthrough (zero CPU)

    // Add alternative RTSP paths (e.g., Dahua cameras with multiple path formats)
    if (cam.rtspAlternatives && Array.isArray(cam.rtspAlternatives)) {
      for (const altPath of cam.rtspAlternatives) {
        sources.push(cameraManager.buildRtspUrlWithPath(cam, altPath));
      }
    }

    // FFmpeg fallbacks
    sources.push(`ffmpeg:${cam.id}#video=copy#audio=copy`); // stream copy
    sources.push(`ffmpeg:${cam.id}#video=h264#hardware#audio=opus#input=-rtsp_transport tcp -i {input}`); // transcode

    configObj.streams[cam.id] = sources;

    // SUB-quality stream (low bitrate) under "<id>_sub" so the HQ toggle can
    // switch a tile to the camera's sub channel (x02). Lazy — go2rtc only pulls
    // it when a client actually connects.
    const subUrl = cameraManager.buildRtspUrlForQuality(cam, 'sub');
    if (subUrl !== rtspUrl) {
      configObj.streams[`${cam.id}_sub`] = [
        subUrl,
        `ffmpeg:${cam.id}_sub#video=copy#audio=copy`,
        `ffmpeg:${cam.id}_sub#video=h264#hardware#audio=opus#input=-rtsp_transport tcp -i {input}`,
      ];
    }
  }

  return configObj;
}

function writeConfig() {
  const configObj = buildGo2RTCConfig();
  const yamlContent = generateYAML(configObj);
  fs.writeFileSync(config.go2rtcConfigFile, yamlContent, 'utf8');
  console.log('[go2rtc] Configuration written to', config.go2rtcConfigFile);
}

// ─── Binary Lifecycle ─────────────────────────────────────────────────

function startBinary() {
  console.log('[go2rtc] Starting binary...');

  go2rtcProcess = spawn(config.go2rtcBin, ['-c', config.go2rtcConfigFile], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  go2rtcProcess.stdout.on('data', (data) => {
    console.log('[go2rtc]', data.toString().trim());
  });

  go2rtcProcess.stderr.on('data', (data) => {
    console.log('[go2rtc err]', data.toString().trim());
  });

  go2rtcProcess.on('close', (code) => {
    console.log(`[go2rtc] Process exited (code ${code})`);
    go2rtcReady = false;
    go2rtcProcess = null;
    // Auto-restart after 5 seconds
    setTimeout(() => {
      if (!go2rtcProcess) startBinary();
    }, 5000);
  });

  go2rtcProcess.on('error', (err) => {
    console.error('[go2rtc] Failed to start:', err.message);
    go2rtcProcess = null;
  });
}

// ─── Health Check ──────────────────────────────────────────────────────

async function waitForReady() {
  const maxAttempts = 30;
  console.log('[go2rtc] Waiting for service to be ready...');

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`http://localhost:${config.go2rtcApiPort}/api/streams`);
      if (response.ok) {
        console.log('[go2rtc] Service is ready');
        go2rtcReady = true;
        return true;
      }
    } catch (err) {
      // Not ready yet
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  console.error('[go2rtc] Failed to start within timeout');
  return false;
}

// ─── Dynamic Camera Management via REST API ────────────────────────────

async function addStream(cameraId) {
  if (!go2rtcReady) return false;
  const cam = cameraManager.getById(cameraId);
  if (!cam) return false;

  const rtspUrl = cameraManager.buildRtspUrlForQuality(cam, 'main');
  try {
    const response = await fetch(
      `http://localhost:${config.go2rtcApiPort}/api/streams?src=${encodeURIComponent(cameraId)}&name=${encodeURIComponent(rtspUrl)}`,
      { method: 'PUT' }
    );
    // Also register the sub-quality stream (best-effort) so the HQ toggle works.
    const subUrl = cameraManager.buildRtspUrlForQuality(cam, 'sub');
    if (subUrl !== rtspUrl) {
      fetch(
        `http://localhost:${config.go2rtcApiPort}/api/streams?src=${encodeURIComponent(cameraId + '_sub')}&name=${encodeURIComponent(subUrl)}`,
        { method: 'PUT' }
      ).catch(() => {});
    }
    return response.ok;
  } catch (err) {
    console.error(`[go2rtc] Failed to add stream ${cameraId}:`, err.message);
    return false;
  }
}

async function removeStream(cameraId) {
  if (!go2rtcReady) return false;
  try {
    const response = await fetch(
      `http://localhost:${config.go2rtcApiPort}/api/streams?src=${encodeURIComponent(cameraId)}`,
      { method: 'DELETE' }
    );
    // Best-effort removal of the paired sub stream.
    fetch(
      `http://localhost:${config.go2rtcApiPort}/api/streams?src=${encodeURIComponent(cameraId + '_sub')}`,
      { method: 'DELETE' }
    ).catch(() => {});
    return response.ok;
  } catch (err) {
    console.error(`[go2rtc] Failed to remove stream ${cameraId}:`, err.message);
    return false;
  }
}

// ─── Initialize ──────────────────────────────────────────────────────

async function init() {
  // Check if go2rtc binary exists
  if (!fs.existsSync(config.go2rtcBin)) {
    console.warn('[go2rtc] Binary not found at', config.go2rtcBin);
    console.warn('[go2rtc] WebRTC streaming will be unavailable');
    console.warn('[go2rtc] Download from: https://github.com/AlexxIT/go2rtc/releases');
    return false;
  }

  writeConfig();
  startBinary();
  const ready = await waitForReady();
  return ready;
}

function isReady() {
  return go2rtcReady;
}

function getApiPort() {
  return config.go2rtcApiPort;
}

function stop() {
  if (go2rtcProcess) {
    go2rtcProcess.kill('SIGTERM');
    go2rtcProcess = null;
  }
  // Clean up generated config
  try {
    fs.unlinkSync(config.go2rtcConfigFile);
  } catch (err) {}
}

// Listen for camera changes and update go2rtc dynamically
cameraManager.onCameraChange((action, camera) => {
  if (!go2rtcReady) return;

  if (action === 'add') {
    addStream(camera.id);
  } else if (action === 'remove') {
    removeStream(camera.id);
  } else if (action === 'update') {
    // Remove and re-add to update the RTSP URL
    removeStream(camera.id).then(() => addStream(camera.id));
  }
});

module.exports = { init, isReady, getApiPort, addStream, removeStream, stop };
