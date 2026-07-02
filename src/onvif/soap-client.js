/**
 * soap-client.js — minimal SOAP 1.2 client for ONVIF (V-014, Fase 1).
 *
 * Sends an ONVIF SOAP request to a service endpoint (xaddr) with a WS-Security
 * UsernameToken header. If the device instead demands HTTP Digest (some models
 * return 401 WWW-Authenticate: Digest), we transparently retry with a digest
 * Authorization header — reusing the existing isapi/digest-auth.js helpers.
 *
 * Zero dependencies — native `http`/`url` + crypto. XML is built/parsed by hand
 * (consistent with isapi/xml-parser.js); we only need a handful of fields.
 */

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const { buildSecurityHeader } = require('./ws-security');
const { parseDigestChallenge, buildDigestHeader } = require('../isapi/digest-auth');

// Device clock offsets (host:port → deviceEpochMs - localEpochMs), learned lazily
// on auth failure via unauthenticated GetSystemDateAndTime. Devices with a drifted
// clock reject WS-Security UsernameTokens whose Created is computed from OUR clock
// (design doc §7); the offset lets us stamp Created in the DEVICE's time.
const clockOffsets = new Map();

const SOAP_ENV = 'http://www.w3.org/2003/05/soap-envelope';

/**
 * Wrap an ONVIF body in a full SOAP 1.2 envelope.
 * @param {string} bodyXml - inner XML (e.g. "<tds:GetDeviceInformation/>")
 * @param {string} [securityHeader] - optional <wsse:Security> block
 */
function buildEnvelope(bodyXml, headerXml) {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<env:Envelope xmlns:env="${SOAP_ENV}" ` +
      `xmlns:tds="http://www.onvif.org/ver10/device/wsdl" ` +
      `xmlns:trt="http://www.onvif.org/ver10/media/wsdl" ` +
      `xmlns:tev="http://www.onvif.org/ver10/events/wsdl" ` +
      `xmlns:tptz="http://www.onvif.org/ver20/ptz/wsdl" ` +
      `xmlns:wsnt="http://docs.oasis-open.org/wsn/b-2" ` +
      `xmlns:wsa="http://www.w3.org/2005/08/addressing" ` +
      `xmlns:tt="http://www.onvif.org/ver10/schema">` +
      `<env:Header>${headerXml || ''}</env:Header>` +
      `<env:Body>${bodyXml}</env:Body>` +
    `</env:Envelope>`
  );
}

/** Build WS-Addressing header block (Action + To + MessageID + ReplyTo) required
 *  by PullPoint calls. MessageID/ReplyTo are mandated by the WS-Addressing profile;
 *  lenient devices ignore them but strict ones reject requests without them. */
function wsaHeaders(action, to) {
  let h = '';
  if (action) h += `<wsa:Action env:mustUnderstand="1">${action}</wsa:Action>`;
  if (to) h += `<wsa:To env:mustUnderstand="1">${to}</wsa:To>`;
  h += `<wsa:MessageID>urn:uuid:${crypto.randomUUID()}</wsa:MessageID>`;
  h += `<wsa:ReplyTo><wsa:Address>http://www.w3.org/2005/08/addressing/anonymous</wsa:Address></wsa:ReplyTo>`;
  return h;
}

function httpPost(xaddr, payload, { authHeader, timeoutMs = 6000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(xaddr); } catch (e) { return reject(new Error(`bad xaddr: ${xaddr}`)); }
    const headers = {
      'Content-Type': 'application/soap+xml; charset=utf-8',
      'Content-Length': Buffer.byteLength(payload),
    };
    if (authHeader) headers['Authorization'] = authHeader;
    // Protocol-aware: some devices (modern Axis/Bosch, hardened Hikvision)
    // advertise https:// XAddrs. CCTV cameras virtually always use self-signed
    // certs, so TLS verification is disabled — LAN trust model, same as RTSP.
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? require('https') : http;
    const req = mod.request({
      hostname: u.hostname,
      port: u.port || (isHttps ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers,
      timeout: timeoutMs,
      ...(isHttps ? { rejectUnauthorized: false } : {}),
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        // cap 2 MB — guard nakal devices. destroy() MUST carry an Error, otherwise
        // neither 'error' nor 'end' fires and this promise never settles.
        if (size > 2 * 1024 * 1024) { req.destroy(new Error('ONVIF response too large (>2MB)')); return; }
        chunks.push(c);
      });
      res.on('end', () => resolve({
        statusCode: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('ONVIF request timeout')));
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

/**
 * Parse a GetSystemDateAndTimeResponse's <tt:UTCDateTime> into epoch ms, or null.
 * Tolerant of namespace prefixes; reads the Date/Time child fields.
 */
function parseSystemDateAndTime(xml) {
  if (!xml) return null;
  const utc = (xml.match(/<(?:[a-zA-Z0-9]+:)?UTCDateTime>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?UTCDateTime>/i) || [])[1];
  if (!utc) return null;
  const num = (name) => {
    const m = new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}>\\s*(\\d+)\\s*</(?:[a-zA-Z0-9]+:)?${name}>`, 'i').exec(utc);
    return m ? Number(m[1]) : null;
  };
  const y = num('Year'), mo = num('Month'), d = num('Day');
  const h = num('Hour'), mi = num('Minute'), s = num('Second');
  if (y == null || mo == null || d == null || h == null || mi == null || s == null) return null;
  return Date.UTC(y, mo - 1, d, h, mi, s);
}

/** host:port key for the clock-offset cache. */
function offsetKey(xaddr) {
  try { const u = new URL(xaddr); return `${u.hostname}:${u.port || 80}`; } catch (e) { return xaddr; }
}

/**
 * Learn the device's clock offset via unauthenticated GetSystemDateAndTime
 * (the one ONVIF call that never requires auth). Returns offsetMs or null.
 * Implemented here (not media.js) to avoid a circular require.
 */
async function fetchClockOffset(xaddr, timeoutMs) {
  let origin;
  try { origin = new URL(xaddr).origin; } catch (e) { return null; }
  const payload = buildEnvelope(`<tds:GetSystemDateAndTime/>`, '');
  try {
    const res = await httpPost(`${origin}/onvif/device_service`, payload, { timeoutMs });
    if (res.statusCode !== 200) return null;
    const deviceEpoch = parseSystemDateAndTime(res.body);
    if (deviceEpoch == null) return null;
    return deviceEpoch - Date.now();
  } catch (e) { return null; }
}

/**
 * True when a failed response smells like an auth rejection (worth a clock-skew
 * retry). Deliberately narrow: `env:Sender` is the generic SOAP 1.2 code for ANY
 * client error, so matching bare "sender"/"auth" would fire spurious
 * GetSystemDateAndTime fetches + retries on non-auth faults.
 */
function looksLikeAuthFailure(res) {
  if (res.statusCode === 401) return true;
  const fault = extractFault(res.body) || '';
  return /not\s*authorized|unauthorized/i.test(fault);
}

/**
 * Perform an ONVIF SOAP call.
 * @param {string} xaddr   - service endpoint URL
 * @param {string} bodyXml - inner SOAP body XML
 * @param {object} opts    - { username, password, timeoutMs }
 * @returns {Promise<string>} the SOAP response body XML (throws on fault/HTTP error)
 */
async function call(xaddr, bodyXml, opts = {}) {
  const { username, password, timeoutMs, headerXml } = opts;

  const attempt = async (clockOffsetMs) => {
    const security = username ? buildSecurityHeader(username, password, { clockOffsetMs }) : '';
    const payload = buildEnvelope(bodyXml, security + (headerXml || ''));
    let res = await httpPost(xaddr, payload, { timeoutMs });
    // Some devices want HTTP Digest on top of (or instead of) WS-Security.
    if (res.statusCode === 401 && res.headers['www-authenticate']) {
      const challenge = parseDigestChallenge(res.headers['www-authenticate']);
      if (challenge && username) {
        const u = new URL(xaddr);
        const authHeader = buildDigestHeader('POST', u.pathname + (u.search || ''), username, password || '', challenge);
        res = await httpPost(xaddr, payload, { authHeader, timeoutMs });
      }
    }
    return res;
  };

  const key = offsetKey(xaddr);
  const usedOffset = clockOffsets.get(key) || 0;
  let res = await attempt(usedOffset);

  // Auth failed → the device clock may be drifted (or a previously learned
  // offset went stale after the device NTP-corrected itself). RE-learn on every
  // auth failure — never trust the cache here, a stale offset would otherwise
  // lock us out permanently — and retry ONCE if the fresh offset actually
  // differs from what this attempt used.
  if (username && looksLikeAuthFailure(res)) {
    const off = await fetchClockOffset(xaddr, timeoutMs);
    if (off != null) {
      clockOffsets.set(key, off);
      if (Math.abs(off - usedOffset) > 5000) {
        console.warn(`[onvif] ${key} clock offset ${Math.round(off / 1000)}s (was using ${Math.round(usedOffset / 1000)}s) — retrying with corrected Created`);
        res = await attempt(off);
      }
    }
  }

  if (res.statusCode !== 200) {
    const fault = extractFault(res.body);
    throw new Error(`ONVIF ${res.statusCode}${fault ? ': ' + fault : ''}`);
  }
  const fault = extractFault(res.body);
  if (fault) throw new Error(`ONVIF fault: ${fault}`);
  return res.body;
}

/** Pull a human-readable reason out of a SOAP 1.2 Fault, or null if none.
 *  Prefers Reason Text, then the Subcode Value (e.g. ter:NotAuthorized — the
 *  ONVIF-specific code), then the generic Code Value (env:Sender/Receiver). */
function extractFault(xml) {
  if (!xml || !/Fault>/.test(xml)) return null;
  const reason = (xml.match(/<(?:env:|soap:|s:)?Text[^>]*>([^<]*)</i) || [])[1];
  const sub = (xml.match(/<(?:env:|soap:|s:)?Subcode>[\s\S]*?<(?:env:|soap:|s:)?Value>([^<]*)</i) || [])[1];
  const code = (xml.match(/<(?:env:|soap:|s:)?Code>[\s\S]*?<(?:env:|soap:|s:)?Value>([^<]*)</i) || [])[1];
  return reason || sub || code || 'unknown fault';
}

module.exports = {
  call, buildEnvelope, wsaHeaders, extractFault, parseSystemDateAndTime,
  _httpPost: httpPost, _clockOffsets: clockOffsets, _looksLikeAuthFailure: looksLikeAuthFailure,
};
