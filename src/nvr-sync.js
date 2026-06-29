/**
 * NVR auto-sync — build the camera list FROM the recorder, not from per-camera IPs.
 *
 * On startup (and on demand) this scans every recorder declared in nvrs.json via
 * its ISAPI InputProxy channel list, then registers one camera per channel,
 * grouped under the recorder's real device name. Standalone IP cameras in
 * cameras.json are left untouched — they remain the fallback for sites that have
 * no NVR (viewed directly over the network).
 *
 * Reachability is host-agnostic: a recorder's `host` may be a LAN IP, a public
 * IP, or a DDNS hostname (port-forward the ISAPI + RTSP ports for WAN access).
 * If a recorder can't be reached, its previously-synced channels (persisted in
 * cameras.json) are kept as-is so the UI still shows the last-known list.
 */

const { loadNvrs } = require('./config');
const cameraManager = require('./camera-manager');
const nvrMap = require('./isapi/nvr-channel-map');

/** Build the camera object for one recorder channel. */
function channelToCamera(nvr, displayName, ch) {
  const chNum = parseInt(ch.channel, 10);
  return {
    id: `nvr-${nvr.id}-ch${chNum}`,
    name: ch.name || `Channel ${chNum}`,
    group: nvr.group || displayName,
    ip: nvr.host,
    port: parseInt(nvr.rtspPort, 10) || 554,
    isapiPort: nvr.isapiPort ? parseInt(nvr.isapiPort, 10) : null,
    username: nvr.username || 'admin',
    password: nvr.password || '',
    rtspPath: `/Streaming/Channels/${chNum}01`,
    deviceType: 'nvr',
    recorderId: nvr.id,
    recorderName: displayName,
    sourceIp: ch.ip || null,        // the underlying IP camera behind this channel
    detection: { isapi: true, channelID: String(chNum) },
    status: ch.online ? 'unknown' : 'offline',
  };
}

/** Sync a single recorder. Returns a result summary (never throws). */
async function syncOne(nvr) {
  if (!nvr || !nvr.host || !nvr.isapiPort) {
    return { id: nvr && nvr.id, ok: false, error: 'host and isapiPort are required' };
  }
  const auth = { ip: nvr.host, port: parseInt(nvr.isapiPort, 10), username: nvr.username, password: nvr.password };

  // Device name first (best-effort) → drives the sidebar group label.
  const deviceName = await nvrMap.getDeviceName(auth);
  const displayName = (nvr.name && nvr.name.trim()) || deviceName || nvr.group || `NVR ${nvr.host}`;

  const scan = await nvrMap.scanChannels(auth);
  if (scan.error) {
    // Unreachable / not a recorder — keep last-known channels untouched.
    return { id: nvr.id, ok: false, name: displayName, error: scan.error };
  }

  const cams = scan.channels.map(ch => channelToCamera(nvr, displayName, ch));
  cameraManager.replaceRecorderCameras(nvr.id, nvr.host, cams);
  return { id: nvr.id, ok: true, name: displayName, channels: cams.length };
}

/** Sync every recorder in nvrs.json. */
async function syncAll() {
  const nvrs = loadNvrs();
  if (!nvrs.length) {
    console.log('[nvr-sync] No recorders in nvrs.json — skipping (IP cameras only)');
    return [];
  }
  console.log(`[nvr-sync] Scanning ${nvrs.length} recorder(s)...`);
  const results = [];
  for (const nvr of nvrs) {
    const r = await syncOne(nvr);
    results.push(r);
    if (r.ok) {
      console.log(`[nvr-sync] ${r.name}: ${r.channels} channel(s) synced`);
    } else {
      console.warn(`[nvr-sync] ${r.name || r.id}: ${r.error} — keeping last-known channels`);
    }
  }
  return results;
}

module.exports = { syncAll, syncOne };
