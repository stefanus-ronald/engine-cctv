/**
 * media.js — ONVIF Device + Media service helpers (V-014, Fase 1).
 *
 * Just enough of the ONVIF Media service to onboard a camera for LIVE view:
 *   - getDeviceInformation : manufacturer/model (label)
 *   - getMediaXAddr        : find the Media service endpoint via GetCapabilities
 *   - getProfiles          : list media profiles (each ≈ a stream: main/sub)
 *   - getStreamUri         : resolve the RTSP URL for a profile token
 *   - resolveStreamUris    : one-call onboarding → main+sub RTSP + profile list
 *
 * The RTSP URL returned by GetStreamUri carries NO credentials; the caller
 * (camera-manager) injects user:pass when building the go2rtc source.
 *
 * Zero dependencies — uses soap-client.js. XML parsed by hand (few fields).
 */

const soap = require('./soap-client');

/** Build a device-service xaddr from an ip/port (the WS-Discovery xaddr is preferred
 *  when known; this is the manual-entry fallback). IPv6 literals must be bracketed
 *  per RFC 3986 or the port colon becomes ambiguous. */
function deviceXAddr(ip, port) {
  const host = (String(ip).includes(':') && !String(ip).startsWith('[')) ? `[${ip}]` : ip;
  return `http://${host}:${port || 80}/onvif/device_service`;
}

function tag(xml, name) {
  const m = new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`, 'i').exec(xml || '');
  return m ? m[1].trim() : '';
}
function attr(openTag, name) {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, 'i').exec(openTag || '');
  return m ? m[1] : '';
}

async function getDeviceInformation(xaddr, auth) {
  const xml = await soap.call(xaddr, `<tds:GetDeviceInformation/>`, auth);
  return {
    manufacturer: tag(xml, 'Manufacturer'),
    model: tag(xml, 'Model'),
    firmware: tag(xml, 'FirmwareVersion'),
    serial: tag(xml, 'SerialNumber'),
  };
}

/** Discover the Media service endpoint. Falls back to the conventional path on the
 *  device host when GetCapabilities doesn't surface a Media XAddr. */
async function getMediaXAddr(deviceServiceXAddr, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr,
      `<tds:GetCapabilities><tds:Category>Media</tds:Category></tds:GetCapabilities>`, auth);
    // <tt:Media>...<tt:XAddr>http://ip/onvif/Media</tt:XAddr>...
    const mediaBlock = (xml.match(/<[^>]*Media>([\s\S]*?)<\/[^>]*Media>/i) || [])[1] || xml;
    const x = tag(mediaBlock, 'XAddr');
    if (x) return x;
  } catch (e) { /* fall through to convention */ }
  try {
    const u = new (require('url').URL)(deviceServiceXAddr);
    return `${u.protocol}//${u.host}/onvif/Media`;
  } catch (e) {
    return deviceServiceXAddr;
  }
}

/** Parse <trt:Profiles> entries into {token,name,encoding,width,height}. */
function parseProfiles(xml) {
  const out = [];
  const re = /<(?:[a-zA-Z0-9]+:)?Profiles\b([^>]*)>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Profiles>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const open = m[1];
    const inner = m[2];
    out.push({
      token: attr(open, 'token'),
      name: tag(inner, 'Name'),
      encoding: tag(inner, 'Encoding'),
      width: Number(tag(inner, 'Width')) || null,
      height: Number(tag(inner, 'Height')) || null,
    });
  }
  return out;
}

async function getProfiles(mediaXAddr, auth) {
  const xml = await soap.call(mediaXAddr, `<trt:GetProfiles/>`, auth);
  return parseProfiles(xml);
}

async function getStreamUri(mediaXAddr, profileToken, auth) {
  const body =
    `<trt:GetStreamUri>` +
      `<trt:StreamSetup>` +
        `<tt:Stream>RTP-Unicast</tt:Stream>` +
        `<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>` +
      `</trt:StreamSetup>` +
      `<trt:ProfileToken>${profileToken}</trt:ProfileToken>` +
    `</trt:GetStreamUri>`;
  const xml = await soap.call(mediaXAddr, body, auth);
  return tag(xml, 'Uri');
}

/**
 * One-call onboarding resolver. Given connection details, returns everything the
 * Add-Camera flow needs: device label, the chosen main/sub RTSP URIs (credential-
 * free), the picked profile token, and the full profile list for the UI.
 *
 * Heuristic for main/sub: profiles are usually ordered high→low res; we take the
 * highest-resolution profile as `main` and the lowest as `sub` (when >1 exists).
 *
 * @param {object} conn - { ip, port, username, password, xaddr? }
 */
async function resolveStreamUris(conn = {}) {
  const auth = { username: conn.username, password: conn.password };
  const devXAddr = conn.xaddr || deviceXAddr(conn.ip, conn.port);

  let deviceInfo = null;
  try { deviceInfo = await getDeviceInformation(devXAddr, auth); } catch (e) {
    // An auth rejection here means EVERY later call fails the same way. Abort
    // NOW: Hikvision locks the account (±30 min) after a handful of wrong
    // attempts, and one full onboarding fires 3+ authed calls (each with a
    // digest-fallback retry) — enough to trigger the lockout on its own.
    if (/\b401\b|not\s*authorized|unauthorized|locked/i.test(e.message)) {
      return { error: `authentication rejected by device: ${e.message}`, deviceInfo: null, profiles: [] };
    }
    /* otherwise non-fatal (some devices gate GetDeviceInformation oddly) */
  }

  const mediaXAddr = await getMediaXAddr(devXAddr, auth);
  const profiles = await getProfiles(mediaXAddr, auth);
  if (!profiles.length) {
    return { error: 'no media profiles found', deviceInfo, profiles: [] };
  }

  const byRes = (p) => (p.width || 0) * (p.height || 0);
  const sorted = [...profiles].sort((a, b) => byRes(b) - byRes(a));
  const mainP = sorted[0];
  const subP = sorted.length > 1 ? sorted[sorted.length - 1] : null;

  const streamUri = await getStreamUri(mediaXAddr, mainP.token, auth);
  let streamUriSub = null;
  if (subP) {
    try { streamUriSub = await getStreamUri(mediaXAddr, subP.token, auth); } catch (e) { /* sub optional */ }
  }

  return {
    deviceInfo,
    mediaXAddr,
    xaddr: devXAddr,
    profileToken: mainP.token,
    profileTokenSub: subP ? subP.token : null,
    streamUri,
    streamUriSub,
    profiles,
  };
}

module.exports = {
  deviceXAddr, getDeviceInformation, getMediaXAddr,
  getProfiles, getStreamUri, resolveStreamUris, parseProfiles,
};
