/**
 * onvif-driver.js — the ONVIF implementation of the device-driver contract
 * (see device-driver.js). V-014, Fase 1 (live-only).
 *
 * Fase 1 scope = LIVE view for generic ONVIF cameras:
 *   - discover()          : WS-Discovery LAN scan (ISAPI never had this)
 *   - resolveStreamUris() : onboarding — GetProfiles + GetStreamUri (main/sub)
 *   - getStreamUri()      : returns the stored RTSP URL (creds injected by
 *                           camera-manager), feeding go2rtc exactly like ISAPI
 *
 * Events (PullPoint), PTZ, analytics config and Profile-G playback are later
 * phases — kept null here so callers can feature-detect uniformly.
 */

const NAME = 'onvif';
const wsDiscovery = require('../onvif/ws-discovery');
const media = require('../onvif/media');
const ptzSvc = require('../onvif/ptz');
const replaySvc = require('../onvif/replay');
const capsSvc = require('../onvif/capabilities');

/** LAN auto-discovery → [{ip,port,name,model,protocol}] for the Add-Camera list. */
async function discover() {
  const devices = await wsDiscovery.discover({});
  return devices.map(d => {
    let port = 80;
    try { port = Number(new (require('url').URL)(d.xaddr).port) || 80; } catch (e) {}
    return { ip: d.ip, port, name: d.name, model: d.hardware || '', xaddr: d.xaddr, protocol: 'onvif' };
  });
}

/**
 * Onboarding resolver — given connection details, return device label + main/sub
 * RTSP URIs + profile list. Stored on cam.onvif so live just works afterwards.
 * @param {object} conn - { ip, port, username, password, xaddr? }
 */
async function resolveStreamUris(conn) {
  const r = await media.resolveStreamUris(conn || {});
  if (r && !r.error) {
    // Detect PTZ + Profile G in ONE GetServices call (Fase 5). Far cheaper and
    // more reliable than per-category GetCapabilities probes, which are slow on
    // multi-channel DVRs and were a source of onboarding timeouts.
    const auth = { username: (conn || {}).username, password: (conn || {}).password };
    const devXAddr = r.xaddr || media.deviceXAddr((conn || {}).ip, (conn || {}).port);
    try {
      const svc = await capsSvc.getServices(devXAddr, auth);
      r.ptz = !!svc.ptz;
      r.profileG = !!svc.profileG;
      r.services = svc.namespaces;
    } catch (e) { r.ptz = false; r.profileG = false; }
  }
  return r;
}

function _devXAddr(cam) {
  return (cam.onvif && cam.onvif.xaddr) || media.deviceXAddr(cam.ip, (cam.onvif && cam.onvif.port) || 80);
}

/** Profile-G recording summary + tokens for a camera. */
async function searchRecordings(cam) {
  const auth = { username: cam.username, password: cam.password };
  const dev = _devXAddr(cam);
  const searchXAddr = await replaySvc.getSearchXAddr(dev, auth);
  if (!searchXAddr) return { error: 'no ONVIF Search service (Profile G unsupported)' };
  const summary = await replaySvc.getRecordingSummary(searchXAddr, auth);
  let recordings = [];
  try { recordings = await replaySvc.findRecordings(searchXAddr, auth); } catch (e) { /* summary still useful */ }
  return { ...summary, recordings };
}

/** Resolve a Profile-G replay RTSP URL for a recording token (credentials injected). */
async function getReplayUri(cam, recordingToken) {
  const cameraManager = require('../camera-manager');
  const auth = { username: cam.username, password: cam.password };
  const dev = _devXAddr(cam);
  const replayXAddr = await replaySvc.getReplayXAddr(dev, auth);
  if (!replayXAddr) throw new Error('no ONVIF Replay service (Profile G unsupported)');
  const uri = await replaySvc.getReplayUri(replayXAddr, recordingToken, auth);
  if (!uri) throw new Error('device returned no replay URI');
  return cameraManager.injectRtspCredentials(uri, cam.username, cam.password);
}

/**
 * PTZ control. cmd = { action:'move'|'stop', pan, tilt, zoom }. Uses the device
 * PTZ service + the camera's stored profile token.
 */
async function ptz(cam, cmd) {
  if (!cam || !cam.onvif || !cam.onvif.profileToken) throw new Error('camera has no ONVIF profile token');
  const auth = { username: cam.username, password: cam.password };
  const devXAddr = cam.onvif.xaddr || media.deviceXAddr(cam.ip, cam.onvif.port || 80);
  const ptzXAddr = await ptzSvc.getPtzXAddr(devXAddr, auth)
    || `${new (require('url').URL)(devXAddr).origin}/onvif/PTZ`;
  if ((cmd && cmd.action) === 'stop') {
    return ptzSvc.stop(ptzXAddr, cam.onvif.profileToken, auth);
  }
  return ptzSvc.continuousMove(ptzXAddr, cam.onvif.profileToken, {
    pan: cmd && cmd.pan, tilt: cmd && cmd.tilt, zoom: cmd && cmd.zoom,
  }, auth);
}

/**
 * Live RTSP URL. For ONVIF the URL was resolved at onboarding and stored on the
 * camera; camera-manager.buildRtspUrlForQuality reads cam.onvif.streamUri[Sub]
 * and injects credentials. Delegate to it so there's a single source of truth.
 */
function getStreamUri(cam, quality) {
  const cameraManager = require('../camera-manager');
  return cameraManager.buildRtspUrlForQuality(cam, quality === 'sub' ? 'sub' : 'main');
}

/** ONVIF has no NVR-style channel scan in Fase 1 — profiles are the unit. Return
 *  the profile list shaped like channels so the UI can reuse its picker later. */
async function listChannels(conn) {
  const r = await media.resolveStreamUris(conn || {});
  if (r.error) return { error: r.error };
  return (r.profiles || []).map((p, i) => ({
    channelID: i + 1, name: p.name || `Profile ${i + 1}`, token: p.token,
    resolution: p.width && p.height ? `${p.width}x${p.height}` : '', encoding: p.encoding,
  }));
}

/**
 * Real ONVIF capabilities (Fase 5): GetServices + GetEventProperties → the
 * detector flags the Analytics panel understands (motion/line/loitering/face +
 * ptz/playback). Returns motion-only fallback if the probe fails.
 */
async function getCapabilities(cam) {
  try {
    return await capsSvc.probeCapabilities(cam);
  } catch (e) {
    return { motion: true, line: false, loitering: false, field: false, face: false, ptz: false, playback: false, _onvif: true };
  }
}

module.exports = {
  name: NAME,
  discover,
  resolveStreamUris,
  getStreamUri,
  listChannels,
  getCapabilities,
  ptz,                              // Fase 3
  searchRecordings,                 // Fase 4 (Profile G)
  getReplayUri,                     // Fase 4 (Profile G)
  // Events are managed globally by onvif-event-manager (one PullPoint loop per
  // camera), not per-call through the driver — null per the feature-detect
  // contract so callers don't mistake this for a usable per-camera subscribe.
  subscribeEvents: null,
  getDetectionConfig: null,
};
