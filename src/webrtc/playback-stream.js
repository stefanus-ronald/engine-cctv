/**
 * Playback Stream — temporary go2rtc streams for recorded-video playback.
 *
 * Live playback can't reuse the camera's normal go2rtc stream: go2rtc's internal
 * RTSP reader ignores the ?starttime/&endtime query (AlexxIT/go2rtc#1785). The
 * workaround (verified) is to register a TEMPORARY go2rtc stream whose source is
 * `ffmpeg:<playbackURL>` — ffmpeg pulls the timestamped RTSP URL and DOES honor
 * the time range. The browser then plays it via the existing WebRTC path
 * (/api/webrtc?src=<playbackStreamName>).
 *
 * Each playback stream is auto-removed after MAX_LIFETIME_MS (or on stop) to
 * avoid leaking go2rtc streams.
 */

const { config } = require('../config');
const go2rtcManager = require('./go2rtc-manager');
const cameraManager = require('../camera-manager');
const playbackSource = require('../isapi/playback-source');
const playbackSearch = require('../isapi/playback-search');

/** compact "YYYYMMDDTHHmmSSZ" → ms (UTC). */
function _compactToMs(c) {
  const m = String(c || '').match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
}
/** ms (UTC) → compact "YYYYMMDDTHHmmSSZ". */
function _msToCompact(ms) {
  const d = new Date(ms), p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
}
/** Shift a compact-UTC string by deltaMin minutes (returns original on parse fail). */
function _shiftCompact(c, deltaMin) {
  const ms = _compactToMs(c);
  return ms == null ? c : _msToCompact(ms + deltaMin * 60000);
}

const MAX_LIFETIME_MS = 60 * 60 * 1000; // hard cap: 1 hour per playback stream

// name -> { cleanupTimer }
const _active = new Map();

function _apiBase() {
  return `http://localhost:${go2rtcManager.getApiPort()}`;
}

/** Extract ONLY name=/size= from a search playbackURI, strictly sanitized
 *  (name = Hikvision file id [A-Za-z0-9_], size = digits). Ignores everything
 *  else so a client can't inject arbitrary RTSP query params. */
function _extractNameSize(playbackURI) {
  if (!playbackURI || typeof playbackURI !== 'string') return {};
  const name = (playbackURI.match(/[?&]name=([A-Za-z0-9_]+)/) || [])[1] || null;
  const size = (playbackURI.match(/[?&]size=(\d+)/) || [])[1] || null;
  return { name, size };
}

/** Stable-ish unique name without Math.random/Date in a way that collides. */
let _seq = 0;
function _makeName(cameraId) {
  _seq = (_seq + 1) % 100000;
  return `pb-${cameraId}-${process.hrtime.bigint().toString(36)}-${_seq}`;
}

/**
 * Start a playback stream.
 * @param {string} cameraId
 * @param {string} startUtc - compact UTC "YYYYMMDDTHHmmSSZ"
 * @param {string} [endUtc] - compact UTC
 * @returns {Promise<object>} { name, src } or { error }
 */
async function startPlayback(cameraId, startUtc, endUtc, source, playbackURI) {
  if (!go2rtcManager.isReady()) return { error: 'go2rtc not ready' };
  if (!startUtc) return { error: 'startUtc required' };

  // Route through the chosen source (default = NVR channel carrying this camera).
  const src = await playbackSource.resolve(cameraId, source);
  if (!src) return { error: 'camera not found' };
  if (src.error) return { error: src.message || src.error, code: src.error };

  // The frontend sends LOCAL wall-clock times; convert back to the device's
  // search convention (subtract the per-device display offset) so the recorder
  // seeks to the right moment. NVR offset = 0 (unchanged).
  const offsetMin = await playbackSearch.getDisplayOffsetMin(src);
  const devStart = _shiftCompact(startUtc, -offsetMin);
  const devEnd = endUtc ? _shiftCompact(endUtc, -offsetMin) : null;

  let playbackUrl = cameraManager.buildTracksRtspUrl({
    host: src.ip, port: src.rtspPort, user: src.username, pass: src.password,
    track: src.track, startUtc: devStart, endUtc: devEnd,
  });

  // CRITICAL for camera SD/NAS playback: a Hikvision *camera* needs the recording
  // file id (`name=` from the search's playbackURI) to seek to the right segment.
  // Without it the camera ignores starttime and serves its OLDEST footage (wrong
  // day/time). NVRs resolve purely by time, so name= is harmless there. We take
  // ONLY name=/size= from the client-provided URI, strictly sanitized.
  const { name: recName, size: recSize } = _extractNameSize(playbackURI);
  if (recName) {
    playbackUrl += `&name=${recName}`;
    if (recSize) playbackUrl += `&size=${recSize}`;
  }
  // ffmpeg source so the timestamp query IS honored (go2rtc's internal RTSP
  // reader ignores it — AlexxIT/go2rtc#1785). video=copy avoids transcoding the
  // recorded H.264; go2rtc negotiates a WebRTC-compatible audio codec itself.
  //
  // CRITICAL: `#input=rtsp` selects go2rtc's built-in RTSP-over-TCP input
  // template. Without it, ffmpeg defaults to UDP and standalone IP cameras
  // reject playback with "Operation not permitted" (verified). We can't pass a
  // custom "-rtsp_transport tcp" string because go2rtc rejects sources with
  // spaces ("source with spaces may be insecure") — `#input=rtsp` is the
  // space-free equivalent.
  //
  // video=copy ONLY (no audio): recorder channels frequently have NO audio
  // track, and `#audio=copy` then makes ffmpeg fail to write the RTSP header
  // ("Unsupported codec none") which kills the whole stream. Playback audio is
  // non-essential, so we drop it for reliability.
  //
  // `#input=rtsp_re` (defined in go2rtc.yaml) adds `-re` so playback runs at
  // REALTIME. Camera SD/NAS playback otherwise streams faster-than-realtime
  // (NVRs self-throttle; cameras don't), making the video run too fast.
  const ffSrc = `ffmpeg:${playbackUrl}#input=rtsp_re#video=copy`;
  const name = _makeName(cameraId);

  try {
    const res = await fetch(
      `${_apiBase()}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(ffSrc)}`,
      { method: 'PUT' }
    );
    if (!res.ok) return { error: `go2rtc add stream failed: HTTP ${res.status}` };
  } catch (err) {
    return { error: `go2rtc add stream error: ${err.message}` };
  }

  const cleanupTimer = setTimeout(() => { stopPlayback(name); }, MAX_LIFETIME_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
  _active.set(name, { cleanupTimer });

  // Note: do NOT return the raw ffSrc — it embeds rtsp://user:pass@… The client
  // only needs the stream name; redact credentials from any echoed URL.
  const safeSrc = ffSrc.replace(/\/\/[^/@\s]*@/g, '//***@');
  return { name, src: safeSrc, via: src.via, source: src.recorderName, sourceKey: src.sourceKey, sourceLabel: src.sourceLabel };
}

/**
 * Register a playback stream from an ALREADY-RESOLVED RTSP URL (V-014, Fase 4).
 * Used for ONVIF Profile-G replay, whose URL comes from GetReplayUri rather than
 * the Hikvision tracks convention. Same go2rtc ffmpeg source + lifetime/cleanup
 * as startPlayback; the client plays it via /api/webrtc?src=<name> and stops it
 * via /api/playback/stream/stop.
 *
 * @param {string} cameraId
 * @param {string} rtspUrl - full rtsp:// URL WITH credentials
 * @returns {Promise<object>} { name, src } or { error }
 */
async function startPlaybackFromUrl(cameraId, rtspUrl) {
  if (!go2rtcManager.isReady()) return { error: 'go2rtc not ready' };
  if (!rtspUrl || !/^rtsp:\/\//i.test(rtspUrl)) return { error: 'valid rtsp url required' };

  const ffSrc = `ffmpeg:${rtspUrl}#input=rtsp_re#video=copy`;
  const name = _makeName(cameraId);
  try {
    const res = await fetch(
      `${_apiBase()}/api/streams?name=${encodeURIComponent(name)}&src=${encodeURIComponent(ffSrc)}`,
      { method: 'PUT' }
    );
    if (!res.ok) return { error: `go2rtc add stream failed: HTTP ${res.status}` };
  } catch (err) {
    return { error: `go2rtc add stream error: ${err.message}` };
  }
  const cleanupTimer = setTimeout(() => { stopPlayback(name); }, MAX_LIFETIME_MS);
  if (cleanupTimer.unref) cleanupTimer.unref();
  _active.set(name, { cleanupTimer });
  return { name, src: ffSrc.replace(/\/\/[^/@\s]*@/g, '//***@') };
}

/**
 * Stop (remove) a playback stream from go2rtc.
 * @param {string} name
 */
async function stopPlayback(name) {
  if (!name) return { error: 'name required' };
  const entry = _active.get(name);
  if (entry) {
    clearTimeout(entry.cleanupTimer);
    _active.delete(name);
  }
  if (!go2rtcManager.isReady()) return { ok: true };
  try {
    await fetch(`${_apiBase()}/api/streams?src=${encodeURIComponent(name)}`, { method: 'DELETE' });
  } catch (err) {
    return { error: `go2rtc remove stream error: ${err.message}` };
  }
  return { ok: true };
}

/** Remove all active playback streams (e.g. on shutdown). */
function stopAll() {
  for (const name of Array.from(_active.keys())) stopPlayback(name);
}

module.exports = { startPlayback, startPlaybackFromUrl, stopPlayback, stopAll };
