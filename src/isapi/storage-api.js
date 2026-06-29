/**
 * Storage / HDD management — read a Hikvision device's storage media status.
 *
 * GET /ISAPI/ContentMgmt/Storage returns the device's storage:
 *   - <hddList><hdd> … </hdd></hddList>  — local disks. On an IP camera the
 *     microSD card appears here (hddType often "SATA"/"sd"); on an NVR/DVR the
 *     physical HDDs appear.
 *   - <nasList><nas> … </nas></nasList>  — network storage (NAS), if any.
 *
 * Per-disk fields: id, hddName, hddType, status, capacity, freeSpace, property.
 * capacity / freeSpace are in MEGABYTES. status is typically one of:
 *   ok | unformatted | formatting | idle | error | sleeping | offline | mismatch
 *
 * A camera WITHOUT storage (no SD) usually answers 404/403 here, or 200 with an
 * empty hddList — both mean "no playback from on-device storage".
 *
 * Verified shape against Hikvision ISAPI (ver20 XMLSchema). See
 * RESEARCH/NVR-DVR_Playback/10_STORAGE_HDD_MANAGEMENT.md.
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');

const TIMEOUT_MS = 8000;
const STORAGE_URI = '/ISAPI/ContentMgmt/Storage';
const TRACKS_URI = '/ISAPI/ContentMgmt/record/tracks';

function httpGet(host, port, uri, authHeader) {
  return new Promise((resolve) => {
    const headers = {};
    if (authHeader) headers['Authorization'] = authHeader;
    const req = http.request({ hostname: host, port, path: uri, method: 'GET', headers, timeout: TIMEOUT_MS }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
      res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('timeout', () => { req.destroy(); resolve({ statusCode: 0, headers: {}, body: '' }); });
    req.on('error', () => resolve({ statusCode: 0, headers: {}, body: '' }));
    req.end();
  });
}

async function isapiGet(ip, port, uri, user, pass) {
  const first = await httpGet(ip, port, uri, null);
  if (first.statusCode === 200) return first;
  if (first.statusCode !== 401) return first;
  const challenge = parseDigestChallenge(first.headers['www-authenticate']);
  if (!challenge) return { statusCode: 401, body: '' };
  return httpGet(ip, port, uri, buildDigestHeader('GET', uri, user, pass, challenge));
}

/** Case-insensitive single-tag grab from an XML block. */
function grab(block, tag) {
  const m = block.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : null;
}

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

/** Parse one <hdd>/<nas> block → normalized media descriptor. */
function parseMediaBlock(block, kind) {
  const capacity = toInt(grab(block, 'capacity'));
  // ver20 uses freeSpace; some firmware uses freespace.
  const freeSpace = toInt(grab(block, 'freeSpace') ?? grab(block, 'freespace'));
  const used = (capacity != null && freeSpace != null) ? Math.max(0, capacity - freeSpace) : null;
  return {
    kind,                                  // 'hdd' | 'nas'
    id: grab(block, 'id'),
    name: grab(block, 'hddName') || grab(block, 'nasName') || (kind === 'nas' ? 'NAS' : 'Disk'),
    type: grab(block, 'hddType') || grab(block, 'nasType') || null,   // SATA/SD | NFS/SMB
    status: (grab(block, 'status') || 'unknown').toLowerCase(),
    capacityMB: capacity,
    freeSpaceMB: freeSpace,
    usedMB: used,
    usedPct: (capacity && capacity > 0 && used != null) ? Math.round((used / capacity) * 100) : null,
    property: grab(block, 'property') || null,   // RW / R
    // NAS-only: where it lives, so the UI can show "NAS @192.168.1.12 /path".
    address: kind === 'nas' ? (grab(block, 'ipAddress') || null) : null,
    path: kind === 'nas' ? (grab(block, 'path') || null) : null,
  };
}

function parseStorage(xml) {
  const media = [];
  let m;
  const hddRe = /<hdd\b[\s\S]*?<\/hdd>/gi;
  while ((m = hddRe.exec(xml))) media.push(parseMediaBlock(m[0], 'hdd'));
  const nasRe = /<nas\b[\s\S]*?<\/nas>/gi;
  while ((m = nasRe.exec(xml))) media.push(parseMediaBlock(m[0], 'nas'));
  return media;
}

/**
 * Read storage status from a device.
 * @param {object} opts - { ip, port (ISAPI/HTTP port), username, password }
 * @returns {Promise<object>} {
 *   ok, hasStorage, recordable, media:[{kind,id,name,type,status,capacityMB,freeSpaceMB,usedPct,property}]
 * } | { error, code }
 */
async function getStorage({ ip, port, username, password } = {}) {
  if (!ip || !port) return { error: 'ip and ISAPI/HTTP port are required' };

  const r = await isapiGet(ip, port, STORAGE_URI, username || 'admin', password || '');

  if (r.statusCode === 401) return { error: 'Authentication failed — check username/password', code: 401 };
  // No storage subsystem on this device (typical for a standalone IP cam without SD).
  if (r.statusCode === 404 || r.statusCode === 403) {
    return { ok: true, hasStorage: false, recordable: false, media: [], note: `device reports no storage (HTTP ${r.statusCode})` };
  }
  if (r.statusCode !== 200 || !r.body) {
    return { error: `storage query failed (HTTP ${r.statusCode || 'no response'})`, code: r.statusCode || 0 };
  }

  const media = parseStorage(r.body);
  // A disk is "recordable" when present and healthy (ok/idle/sleeping with RW).
  const recordable = media.some((d) =>
    ['ok', 'idle', 'sleeping'].includes(d.status) && (d.property == null || /w/i.test(d.property))
  );
  return { ok: true, hasStorage: media.length > 0, recordable, media };
}

/**
 * Read recording-track config via GET /ISAPI/ContentMgmt/record/tracks.
 * Each <Track> has <id> (101=CH1, 601=CH6...) and <Enable>true/false</Enable>
 * — the camera/NVR-side "is recording configured/scheduled" signal. (The
 * /record/schedule endpoint is often 403 on cameras, so we use this.)
 * @param {object} opts - { ip, port, username, password }
 * @returns {Promise<object>} { ok, tracks:[{id,enable,mode}] } | { error }
 */
async function getRecordingTracks({ ip, port, username, password } = {}) {
  if (!ip || !port) return { error: 'ip and port are required' };
  const r = await isapiGet(ip, port, TRACKS_URI, username || 'admin', password || '');
  if (r.statusCode === 401) return { error: 'auth failed', code: 401 };
  if (r.statusCode !== 200 || !r.body) return { error: `tracks query failed (HTTP ${r.statusCode || 'no response'})`, code: r.statusCode || 0 };
  const tracks = [];
  let m;
  const re = /<Track\b[\s\S]*?<\/Track>/gi;
  while ((m = re.exec(r.body))) {
    const block = m[0];
    const id = grab(block, 'id');
    if (!id) continue;
    tracks.push({
      id: toInt(id),
      enable: /true/i.test(grab(block, 'Enable') || ''),
      mode: grab(block, 'DefaultRecordingMode') || null,   // CMR (continuous) / MMR (motion) ...
    });
  }
  return { ok: true, tracks };
}

module.exports = { getStorage, getRecordingTracks };
