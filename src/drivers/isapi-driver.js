/**
 * isapi-driver.js — the ISAPI (Hikvision) implementation of the device-driver
 * contract (see device-driver.js). V-014 Fase 0.
 *
 * This is a THIN WRAPPER over the existing, battle-tested `isapi/*` modules and
 * `camera-manager`. It introduces NO new behavior — it only exposes today's
 * Hikvision logic behind the common driver interface so an ONVIF driver can sit
 * beside it (Fase 1+). Every method delegates to code that already ships.
 *
 * Note: requires are done lazily inside methods to keep module load order simple
 * and avoid any circular-require surprises with camera-manager.
 */

const NAME = 'isapi';

/** Live RTSP URL for a quality ('main' | 'sub'). Delegates to camera-manager's
 *  Hikvision channel-convention builder (101/102, 601/602, …). */
function getStreamUri(cam, quality) {
  const cameraManager = require('../camera-manager');
  return cameraManager.buildRtspUrlForQuality(cam, quality === 'sub' ? 'sub' : 'main');
}

/** ISAPI has no LAN auto-discovery (IPs are entered manually). ONVIF will. */
async function discover() {
  return [];
}

/** Scan an NVR/DVR's channels for onboarding. Delegates to nvr-channel-map. */
async function listChannels(conn) {
  const nvrChannelMap = require('../isapi/nvr-channel-map');
  return nvrChannelMap.scanChannels(conn || {});
}

/** Probe hardware capabilities (motion/line/field/face/…). Delegates to the
 *  capabilities probe. Returns null when the camera has no ISAPI port. */
async function getCapabilities(cam) {
  if (!cam || !cam.isapiPort) return null;
  const capabilitiesProbe = require('../isapi/capabilities-probe');
  return capabilitiesProbe.probeCamera(cam);
}

/**
 * Realtime detection events. The ISAPI alert stream is managed globally as a
 * singleton (one listener serving all cameras → sse-broadcaster), not per-camera,
 * so there is nothing to subscribe per call here. Returned handle is a no-op to
 * satisfy the contract uniformly. (The ONVIF driver, by contrast, subscribes
 * per-camera via PullPoint.)
 */
function subscribeEvents(/* cam, onEvent */) {
  return { close() {} };
}

/** Read current analytics/detection config (lines, regions, enabled flags). */
async function getDetectionConfig(cam, opts) {
  const lineApi = require('../isapi/line-crossing-api');
  return lineApi.getLineConfig(cam, opts);
}

// ── Capabilities ISAPI does NOT expose through this driver (handled elsewhere or
//    unsupported). Kept as null so callers can feature-detect uniformly. ─────────
const ptz = null;                 // Hikvision PTZ not wired through the driver yet
const searchRecordings = null;    // playback uses isapi/playback-search directly
const getReplayUri = null;

module.exports = {
  name: NAME,
  getStreamUri,
  discover,
  listChannels,
  getCapabilities,
  subscribeEvents,
  getDetectionConfig,
  ptz,
  searchRecordings,
  getReplayUri,
};
