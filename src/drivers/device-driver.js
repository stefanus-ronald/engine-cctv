/**
 * device-driver.js — multi-protocol device-control abstraction (V-014, Fase 0).
 *
 * The engine was historically "full ISAPI" (Hikvision-only). The VIDEO path
 * (go2rtc + FFmpeg + WebRTC/MJPEG + playback streaming) is already vendor-neutral
 * — it only needs an RTSP URL. Only DEVICE CONTROL is Hikvision-specific:
 * discovering the RTSP URL, scanning channels, probing capabilities, receiving
 * events, configuring analytics, searching recordings, PTZ.
 *
 * This module introduces a driver/adapter seam so a second protocol (ONVIF) can
 * be added beside ISAPI without touching the video backbone. Each camera carries
 * `cam.protocol` ('isapi' | 'onvif' | 'rtsp'); getDriver(cam) returns the right
 * implementation. Default is 'isapi' so every existing camera behaves exactly as
 * before — Fase 0 is a pure refactor with NO behavior change.
 *
 * ── Driver contract (a driver implements as many as it can; the rest stay null)
 *   name                                 : string id of the protocol
 *   getStreamUri(cam, quality)           : string RTSP url for live ('main'|'sub')
 *   discover()                           : Promise<[{ip,port,name,model,protocol}]>  (LAN scan; [] if none)
 *   listChannels(conn)                   : Promise<[{channelID,name,sourceIp}]>      (onboarding)
 *   getCapabilities(cam)                 : Promise<{motion,line,field,face,ptz,playback,...}>
 *   subscribeEvents(cam, onEvent)        : { close() }                               (feeds sse-broadcaster)
 *   getDetectionConfig(cam)/setDetection : analytics rules (null when unsupported)
 *   ptz(cam, cmd)                        : Promise<void>                             (null when no PTZ)
 *   searchRecordings/getReplayUri        : playback (null when no Profile G)
 *
 * Fase 0 ships only the ISAPI driver (wrapping today's modules). The ONVIF driver
 * is added in Fase 1+. Until then getDriver() always resolves to isapi-driver.
 */

const PROTOCOLS = ['isapi', 'onvif', 'rtsp'];

/**
 * Resolve a camera's control protocol. Defaults to 'isapi' for backward
 * compatibility (every camera authored before V-014 has no `protocol` field).
 */
function getProtocol(cam) {
  const p = String((cam && cam.protocol) || 'isapi').toLowerCase();
  return PROTOCOLS.includes(p) ? p : 'isapi';
}

// Lazy require to avoid a circular dependency (isapi-driver → camera-manager →
// (future) drivers). Drivers are cached after first load.
const _cache = {};
function _load(name) {
  if (_cache[name]) return _cache[name];
  let mod;
  switch (name) {
    case 'isapi':
      mod = require('./isapi-driver');
      break;
    case 'onvif':
      mod = require('./onvif-driver');
      break;
    default:
      // 'rtsp' and any unknown protocol fall back to the ISAPI driver's
      // generic RTSP URL building (it leaves non-Hikvision paths untouched).
      mod = require('./isapi-driver');
  }
  _cache[name] = mod;
  return mod;
}

/**
 * Return the driver implementation for a given camera.
 * @param {object} cam
 * @returns {object} a driver implementing (part of) the contract above
 */
function getDriver(cam) {
  return _load(getProtocol(cam));
}

module.exports = { getDriver, getProtocol, PROTOCOLS };
