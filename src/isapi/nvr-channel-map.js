/**
 * NVR Channel Map — discover which NVR/DVR channel carries which source camera.
 *
 * Hikvision recorders expose their added IP cameras via
 * GET /ISAPI/ContentMgmt/InputProxy/channels, each <InputProxyChannel> giving a
 * channel <id> and the source camera <ipAddress>. This lets us route a
 * standalone camera's playback through the recorder (continuous recording)
 * instead of the camera's own SD card.
 *
 * Map is cached per-recorder with a TTL (the wiring rarely changes).
 */

const http = require('http');
const { parseDigestChallenge, buildDigestHeader } = require('./digest-auth');

const TIMEOUT_MS = 8000;
const URI = '/ISAPI/ContentMgmt/InputProxy/channels';
const DEVICE_INFO_URI = '/ISAPI/System/deviceInfo';
const CACHE_TTL_MS = 5 * 60 * 1000;

// recorderId -> { fetchedAt, ipToChannel: Map<ip, channelId> }
const _cache = new Map();

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

/** Parse InputProxy channels XML → Map<sourceIp, channelId>. */
function parseInputProxy(xml) {
  const map = new Map();
  const re = /<InputProxyChannel[ >]([\s\S]*?)<\/InputProxyChannel>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const id = (block.match(/<id>(\d+)<\/id>/) || [])[1];
    const ip = (block.match(/<ipAddress>([^<]+)<\/ipAddress>/) || [])[1];
    if (id && ip) {
      // If the same source IP appears on multiple channels, keep the LOWEST
      // channel deterministically (instead of last-write-wins → wrong-camera
      // playback).
      const key = ip.trim();
      const ch = parseInt(id, 10);
      if (!map.has(key) || ch < map.get(key)) map.set(key, ch);
    }
  }
  return map;
}

/**
 * Return Map<sourceIp, channelId> for a recorder camera object.
 * recorder: { ip, isapiPort, username, password }
 */
async function getMap(recorder) {
  if (!recorder || !recorder.isapiPort) return new Map();
  const cached = _cache.get(recorder.id);
  if (cached && (Date.now() - cached.fetchedAt) < CACHE_TTL_MS) return cached.ipToChannel;

  const r = await isapiGet(recorder.ip, recorder.isapiPort, URI, recorder.username || 'admin', recorder.password || '');
  if (r.statusCode !== 200 || !r.body) {
    // Cache an empty map briefly so we don't hammer a recorder that lacks the endpoint.
    _cache.set(recorder.id, { fetchedAt: Date.now(), ipToChannel: new Map() });
    return new Map();
  }
  const ipToChannel = parseInputProxy(r.body);
  _cache.set(recorder.id, { fetchedAt: Date.now(), ipToChannel });
  return ipToChannel;
}

/** Channel id on `recorder` that carries source camera `ip`, or null. */
async function getChannelForIp(recorder, ip) {
  const map = await getMap(recorder);
  return map.has(ip) ? map.get(ip) : null;
}

/** Full parse of InputProxy channels → [{ channel, name, ip, online }]. */
function parseInputProxyFull(xml) {
  const list = [];
  const re = /<InputProxyChannel[ >]([\s\S]*?)<\/InputProxyChannel>/g;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const id = (block.match(/<id>(\d+)<\/id>/) || [])[1];
    if (!id) continue;
    const name = (block.match(/<name>([^<]*)<\/name>/) || [])[1] || '';
    const ip = (block.match(/<ipAddress>([^<]+)<\/ipAddress>/) || [])[1];
    const online = /<online>\s*true\s*<\/online>/i.test(block);
    list.push({
      channel: parseInt(id, 10),
      name: name.trim() || `Channel ${id}`,
      ip: ip ? ip.trim() : null,
      online,
    });
  }
  return list.sort((a, b) => a.channel - b.channel);
}

/**
 * Live-scan a recorder for its channel list (names + source IPs). Used by the
 * "Add NVR/DVR" flow to enumerate every channel before importing them.
 * @param {object} opts - { ip, port (ISAPI/HTTP port), username, password }
 * @returns {Promise<object>} { channels:[{channel,name,ip,online}], count } | { error }
 */
async function scanChannels({ ip, port, username, password } = {}) {
  if (!ip || !port) return { error: 'ip and ISAPI/HTTP port are required' };
  const r = await isapiGet(ip, port, URI, username || 'admin', password || '');
  if (r.statusCode === 401) return { error: 'Authentication failed — check username/password' };
  if (r.statusCode !== 200 || !r.body) {
    return { error: `Device did not return a channel list (HTTP ${r.statusCode || 'no response'})` };
  }
  const channels = parseInputProxyFull(r.body);
  if (!channels.length) return { error: 'No channels found (is this an NVR/DVR with IP channels?)' };
  return { channels, count: channels.length };
}

/**
 * Read the recorder's own configured name from /ISAPI/System/deviceInfo
 * (<deviceName>), so the UI can group channels under the NVR's real name
 * instead of a generic "NVR" label. Returns null if unavailable.
 * @param {object} opts - { ip, port (ISAPI/HTTP port), username, password }
 */
async function getDeviceName({ ip, port, username, password } = {}) {
  if (!ip || !port) return null;
  const r = await isapiGet(ip, port, DEVICE_INFO_URI, username || 'admin', password || '');
  if (r.statusCode !== 200 || !r.body) return null;
  const name = (r.body.match(/<deviceName>([^<]*)<\/deviceName>/) || [])[1];
  return name ? name.trim() : null;
}

function invalidate() { _cache.clear(); }

module.exports = { getMap, getChannelForIp, scanChannels, getDeviceName, invalidate };
