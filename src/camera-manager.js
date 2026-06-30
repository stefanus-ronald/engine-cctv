const { loadCameras, saveCameras } = require('./config');

let cameras = [];
let changeListeners = [];

function init() {
  cameras = loadCameras();
}

function onCameraChange(fn) {
  changeListeners.push(fn);
}

function notifyChange(action, camera) {
  changeListeners.forEach(fn => fn(action, camera));
}

/**
 * Normalize a Hikvision RTSP stream path so it always points at a real channel.
 *
 * The Add-Camera form historically defaulted the path to "/Streaming/Channels/"
 * (no channel number). FFmpeg rejects that with "400 Bad Request" / "Invalid
 * data". Hikvision channels are <channel><stream>: 101 = CH1 main, 102 = CH1 sub.
 * So when the path is empty or ends at ".../Channels/" with no digits, default
 * to 101 (channel 1, main stream).
 */
function normalizeRtspPath(rtspPath) {
  let p = (rtspPath || '').trim();
  if (!p) return '/Streaming/Channels/101';
  if (!p.startsWith('/')) p = '/' + p;
  // ".../Streaming/Channels" or ".../Streaming/Channels/" with no channel digits
  if (/\/Streaming\/Channels\/?$/i.test(p)) {
    p = p.replace(/\/+$/, '') + '/101';
  }
  return p;
}

function buildRtspUrl(cam) {
  const user = cam.username || 'admin';
  const pass = cam.password || '';
  const host = cam.ip;
  const port = cam.port || 554;
  const streamPath = normalizeRtspPath(cam.rtspPath);
  return `rtsp://${user}:${pass}@${host}:${port}${streamPath}`;
}

function buildRtspUrlWithPath(cam, rtspPath) {
  const user = cam.username || 'admin';
  const pass = cam.password || '';
  const host = cam.ip;
  const port = cam.port || 554;
  return `rtsp://${user}:${pass}@${host}:${port}${rtspPath}`;
}

/**
 * Build the RTSP URL for a given stream quality: 'main' (high quality) or 'sub'
 * (low bitrate). Hikvision encodes both in the channel id as <channel><stream>:
 * 101 = CH1 main, 102 = CH1 sub; 601 = CH6 main, 602 = CH6 sub.
 *
 * So we take the configured channel, derive its channel number, and force the
 * stream-type digit: 1 for main, 2 for sub. If the path isn't a Hikvision
 * /Streaming/Channels/<n> path we leave it unchanged (only main is available).
 */
function buildRtspUrlForQuality(cam, quality) {
  const path = normalizeRtspPath(cam.rtspPath);
  const streamType = quality === 'sub' ? 2 : 1;
  const remapped = path.replace(/(\/Streaming\/Channels\/)(\d+)/i, (full, prefix, digits) => {
    const num = parseInt(digits, 10);
    const channelNum = Math.floor(num / 100) || num || 1;
    return `${prefix}${channelNum * 100 + streamType}`;
  });
  return buildRtspUrlWithPath(cam, remapped);
}

/**
 * Build a Hikvision RTSP playback URL for recorded video.
 *   rtsp://user:pass@host:RTSP_PORT/Streaming/tracks/<track>?starttime=&endtime=
 *
 * trackID = channelID*100+1 (CH1=101, CH6=601) — same channel convention as live.
 * Uses the configured RTSP `port` (e.g. 5541), NOT the device-internal 554 that
 * appears in the search playbackURI. starttime/endtime must be compact UTC,
 * e.g. "20260622T000000Z" (see RESEARCH/NVR-DVR_Playback/03_RTSP_PLAYBACK_URL.md).
 *
 * @param {object} cam
 * @param {string} startUtc - compact UTC "YYYYMMDDTHHmmSSZ"
 * @param {string} [endUtc] - compact UTC; omit to play until end of recording
 */
function buildPlaybackRtspUrl(cam, startUtc, endUtc) {
  const track = Number((cam.detection && cam.detection.channelID) || 1) * 100 + 1;
  return buildTracksRtspUrl({
    host: cam.ip, port: cam.port, user: cam.username, pass: cam.password,
    track, startUtc, endUtc,
  });
}

/**
 * Generic Hikvision tracks-playback URL builder from explicit connection parts.
 * Used by the playback flow with a resolved source (which may be an NVR rather
 * than the camera itself — see isapi/playback-source.js).
 */
function buildTracksRtspUrl({ host, port, user, pass, track, startUtc, endUtc }) {
  user = user || 'admin';
  pass = pass || '';
  port = port || 554;
  let query = `?starttime=${startUtc}`;
  if (endUtc) query += `&endtime=${endUtc}`;
  return `rtsp://${user}:${pass}@${host}:${port}/Streaming/tracks/${track}${query}`;
}

/**
 * Classify how a camera is registered: 'nvr'/'dvr' (multi-channel recorder
 * channel) vs 'ip' (standalone IP camera). Used to label cameras in the UI so
 * playback behavior (which differs between the two) is easy to reason about.
 *
 * Priority: explicit cam.deviceType → group name hint ('nvr'/'dvr') → default 'ip'.
 */
function getDeviceType(cam) {
  if (cam.deviceType) return String(cam.deviceType).toLowerCase();
  const group = String(cam.group || '').toLowerCase();
  if (/\bdvr\b/.test(group)) return 'dvr';
  if (/\bnvr\b/.test(group)) return 'nvr';
  // NOTE: do NOT infer 'nvr' from channelID>1 — a multi-sensor/fisheye IP camera
  // can legitimately use a sub-channel and would be mis-bucketed as a recorder
  // (hiding its real NVR/SD playback sources). deviceType is persisted explicitly.
  return 'ip';
}

function list() {
  return cameras.map(c => ({
    id: c.id,
    name: c.name,
    group: c.group || 'Default',
    ip: c.ip,
    port: c.port,
    username: c.username,
    rtspPath: c.rtspPath,
    isapiPort: c.isapiPort || null,
    deviceType: getDeviceType(c),
    // Recorder linkage (set for channels discovered via NVR auto-sync) so the
    // UI can group channels under their recorder and label the source camera.
    recorderId: c.recorderId || null,
    recorderName: c.recorderName || null,
    sourceIp: c.sourceIp || null,
    detection: c.detection || null,
    hwCapabilities: c.hwCapabilities || null,
    status: c.status || 'unknown',
  }));
}

function getById(id) {
  return cameras.find(c => c.id === id) || null;
}

function add(data) {
  const id = 'cam-' + Date.now().toString(36);
  const camera = {
    id,
    name: data.name || 'Camera',
    group: data.group || 'Default',
    ip: data.ip,
    port: parseInt(data.port) || 554,
    isapiPort: data.isapiPort ? parseInt(data.isapiPort) : null,
    username: data.username || 'admin',
    password: data.password || '',
    rtspPath: normalizeRtspPath(data.rtspPath),
    deviceType: data.deviceType || undefined,   // 'nvr'/'dvr' for recorder channels
    detection: data.detection || null,
    status: 'unknown',
  };
  cameras.push(camera);
  saveCameras(cameras);
  notifyChange('add', camera);
  return camera;
}

function update(id, data) {
  const idx = cameras.findIndex(c => c.id === id);
  if (idx === -1) return null;
  const cam = cameras[idx];
  if (data.name !== undefined) cam.name = data.name;
  if (data.group !== undefined) cam.group = data.group;
  if (data.ip !== undefined) cam.ip = data.ip;
  if (data.port !== undefined) cam.port = parseInt(data.port) || 554;
  if (data.username !== undefined) cam.username = data.username;
  if (data.password !== undefined) cam.password = data.password;
  if (data.rtspPath !== undefined) cam.rtspPath = normalizeRtspPath(data.rtspPath);
  if (data.isapiPort !== undefined) cam.isapiPort = data.isapiPort ? parseInt(data.isapiPort) : null;
  if (data.detection !== undefined) cam.detection = data.detection;
  if (data.deviceType !== undefined) cam.deviceType = data.deviceType || undefined;
  cameras[idx] = cam;
  saveCameras(cameras);
  notifyChange('update', cam);
  return cam;
}

function remove(id) {
  const idx = cameras.findIndex(c => c.id === id);
  if (idx === -1) return false;
  const cam = cameras.splice(idx, 1)[0];
  saveCameras(cameras);
  notifyChange('remove', cam);
  return true;
}

function setStatus(id, status) {
  const cam = cameras.find(c => c.id === id);
  if (cam) {
    cam.status = status;
    // Don't save on every status change to avoid excessive disk I/O
  }
}

function getAll() {
  return cameras;
}

function setHwCapabilities(cameraId, caps) {
  const cam = cameras.find(c => c.id === cameraId);
  if (cam) {
    cam.hwCapabilities = caps;
  }
}

/**
 * Replace the full set of channel-cameras that belong to one recorder with a
 * freshly-scanned set. Used by NVR auto-sync: standalone IP cameras are left
 * untouched; only this recorder's channels are rebuilt so renamed/added/removed
 * channels stay in sync with the device.
 *
 * Matching of the OLD set is by recorderId, plus a legacy fallback for
 * hand-authored recorder channels that predate auto-sync (deviceType nvr/dvr +
 * ip === host + no recorderId).
 *
 * @param {string} recorderId
 * @param {string} host - the recorder's host (to catch legacy entries)
 * @param {object[]} channelCams - fully-formed camera objects (must carry recorderId)
 * @returns {object[]} the cameras now registered for this recorder
 */
function replaceRecorderCameras(recorderId, host, channelCams) {
  const isOldForThisRecorder = (c) => {
    if (c.recorderId) return c.recorderId === recorderId;
    const dt = getDeviceType(c);
    return (dt === 'nvr' || dt === 'dvr') && c.ip === host;
  };
  // Carry over runtime-probed hardware capabilities so a re-sync doesn't wipe
  // them (they're re-probed async, but keep what we have meanwhile).
  const prevCaps = new Map();
  cameras.forEach(c => { if (isOldForThisRecorder(c) && c.hwCapabilities) prevCaps.set(c.id, c.hwCapabilities); });

  cameras = cameras.filter(c => !isOldForThisRecorder(c));
  for (const cam of channelCams) {
    if (prevCaps.has(cam.id) && !cam.hwCapabilities) cam.hwCapabilities = prevCaps.get(cam.id);
    cameras.push(cam);
  }
  saveCameras(cameras);
  notifyChange('recorder-sync', { recorderId });
  return cameras.filter(c => c.recorderId === recorderId);
}

function findByIpAndChannel(ip, channelID) {
  return cameras.find(c =>
    c.ip === ip &&
    c.detection &&
    String(c.detection.channelID) === String(channelID)
  ) || null;
}

module.exports = {
  init,
  list,
  getAll,
  getById,
  add,
  update,
  remove,
  setStatus,
  buildRtspUrl,
  normalizeRtspPath,
  buildRtspUrlWithPath,
  buildRtspUrlForQuality,
  buildPlaybackRtspUrl,
  buildTracksRtspUrl,
  getDeviceType,
  onCameraChange,
  setHwCapabilities,
  findByIpAndChannel,
  replaceRecorderCameras,
};
