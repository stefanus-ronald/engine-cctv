/**
 * Playback Source resolver — decides WHERE a camera's playback comes from.
 *
 * DESIGN (revised): playback should come from the NVR/DVR by default, because a
 * recorder's storage is continuous & reliable. The camera's own on-camera SD
 * card is NOT a silent fallback — it is an EXPLICIT alternative the caller (UI)
 * can choose. This module therefore:
 *
 *   - enumerates the available sources for a camera (`describeSources`), and
 *   - resolves a single chosen source (`resolve`), honoring a caller preference.
 *
 * Source kinds (`via` / option `key`):
 *   - 'self' : the camera entry IS a recorder → its own configured channel.
 *   - 'nvr'  : a recorder in the registry carries this camera's IP as a channel
 *              (discovered from the recorder via nvr-channel-map.js).
 *   - 'sd'   : the camera's own ISAPI/RTSP storage (on-camera SD card).
 *
 * Resolution rules:
 *   - A recorder entry always resolves to 'self'.
 *   - Otherwise the DEFAULT is 'nvr' when a recorder mapping exists, else 'sd'.
 *   - A caller may force 'nvr' or 'sd'. Forcing 'nvr' when no mapping exists
 *     returns an error descriptor (we do NOT silently stream the SD card).
 */

const cameraManager = require('../camera-manager');
const nvrMap = require('./nvr-channel-map');

const RECORDER_TYPES = ['nvr', 'dvr'];

function _isRecorder(cam) {
  return RECORDER_TYPES.includes(cameraManager.getDeviceType(cam));
}

function _ownChannel(cam) {
  return Number((cam.detection && cam.detection.channelID) || 1);
}

// Display name of the recorder a camera belongs to. After NVR auto-sync every
// channel is its own deviceType:'nvr' camera carrying `recorderName` (the NVR's
// real device name, e.g. "Kantor JMP-NVR"). Fall back to the entry's own name
// for hand-authored recorder entries that predate auto-sync.
function _recorderName(cam) {
  return (cam.recorderName && cam.recorderName.trim()) || cam.name;
}

function _target(srcCam, channel, via) {
  return {
    via,                                   // 'self' | 'nvr' | 'sd'
    recorderId: srcCam.recorderId || srcCam.id,
    recorderName: _recorderName(srcCam),
    ip: srcCam.ip,
    isapiPort: srcCam.isapiPort || null,
    rtspPort: srcCam.port || 554,
    username: srcCam.username || 'admin',
    password: srcCam.password || '',
    channel,
    track: Number(channel) * 100 + 1,
  };
}

/**
 * Describe every playback source available for a camera.
 * @returns {Promise<object|null>} {
 *   cameraId, isRecorder,
 *   options: [{ key, via, label, target }],   // ordered; preferred first
 *   default: key, nvrAvailable: bool
 * } or null if the camera is unknown.
 */
async function describeSources(cameraId) {
  const cam = cameraManager.getById(cameraId);
  if (!cam) return null;

  // A recorder entry: only one meaningful source — its own channel. Label by
  // the NVR's real name (not the channel name) so the source dropdown reads
  // e.g. "Kantor JMP-NVR · CH3".
  if (_isRecorder(cam)) {
    const ch = _ownChannel(cam);
    const opt = { key: 'self', via: 'self', label: `${_recorderName(cam)} · CH${ch}`, target: _target(cam, ch, 'self') };
    return { cameraId, isRecorder: true, options: [opt], default: 'self', nvrAvailable: false };
  }

  // Look for a recorder that carries this camera's IP. After auto-sync there are
  // many channel-cameras per NVR sharing one endpoint — dedupe to one
  // representative per recorder so we don't scan the same NVR repeatedly nor
  // pick an arbitrary channel's name as the recorder name.
  let nvrOpt = null;
  const seenRec = new Set();
  const recorders = cameraManager.getAll().filter(_isRecorder).filter((r) => {
    const key = r.recorderId || `${r.ip}:${r.isapiPort}`;
    if (seenRec.has(key)) return false;
    seenRec.add(key);
    return true;
  });
  for (const rec of recorders) {
    try {
      const ch = await nvrMap.getChannelForIp(rec, cam.ip);
      if (ch) {
        nvrOpt = { key: 'nvr', via: 'nvr', label: `${_recorderName(rec)} · CH${ch}`, target: _target(rec, ch, 'nvr') };
        break;
      }
    } catch (_) { /* try next recorder */ }
  }

  // The camera's own storage (microSD / HDD / NAS) is always offered as an
  // explicit alternative. The frontend enriches this label with the detected
  // media type+size (from /api/cameras/:id/storage) so it reads e.g.
  // "Penyimpanan kamera · NAS 9.9 GB · Parkiran".
  const sdCh = _ownChannel(cam);
  const sdOpt = { key: 'sd', via: 'sd', label: `Penyimpanan kamera · ${cam.name}`, target: _target(cam, sdCh, 'sd') };

  const options = nvrOpt ? [nvrOpt, sdOpt] : [sdOpt];
  return {
    cameraId,
    isRecorder: false,
    options,
    default: nvrOpt ? 'nvr' : 'sd',
    nvrAvailable: !!nvrOpt,
  };
}

/**
 * Resolve a single playback source for a camera.
 * @param {string} cameraId
 * @param {string} [preferred] - 'nvr' | 'sd' | 'self' | 'auto'/undefined
 * @returns {Promise<object|null>} target descriptor (see _target) augmented with
 *   { sourceKey, sourceLabel, nvrAvailable, options:[{key,via,label}] }, or
 *   { error, ... } when a forced source is unavailable, or null if unknown cam.
 */
async function resolve(cameraId, preferred) {
  const desc = await describeSources(cameraId);
  if (!desc) return null;

  const want = (preferred && preferred !== 'auto') ? preferred : desc.default;

  // Forcing the NVR when none exists must NOT silently use the SD card.
  if (want === 'nvr' && !desc.nvrAvailable && !desc.isRecorder) {
    return {
      error: 'no_nvr_source',
      message: 'This camera is not mapped to any recorder channel; choose SD card or check the NVR.',
      nvrAvailable: false,
      options: desc.options.map((o) => ({ key: o.key, via: o.via, label: o.label })),
    };
  }

  const chosen = desc.options.find((o) => o.key === want) || desc.options.find((o) => o.key === desc.default);
  return {
    ...chosen.target,
    sourceKey: chosen.key,
    sourceLabel: chosen.label,
    nvrAvailable: desc.nvrAvailable,
    options: desc.options.map((o) => ({ key: o.key, via: o.via, label: o.label })),
  };
}

module.exports = { resolve, describeSources };
