/**
 * Digest Authentication — RFC 2617 implementation for Hikvision ISAPI.
 *
 * Uses only native Node.js `crypto` module (zero dependencies).
 * Computes MD5-based response hash for HTTP Digest auth.
 */

const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');

/**
 * Parse WWW-Authenticate header from a 401 response.
 * Hikvision cameras return: Digest realm="...", nonce="...", qop="auth"
 *
 * Note: realm can be empty string ("") on some models,
 * so regex uses [^"]* not [^"]+.
 */
function parseDigestChallenge(header) {
  if (!header) return null;
  const realm = (header.match(/realm="([^"]*)"/) || [])[1];
  const nonce = (header.match(/nonce="([^"]*)"/) || [])[1];
  const qop = (header.match(/qop="([^"]*)"/) || [])[1] || '';
  const opaque = (header.match(/opaque="([^"]*)"/) || [])[1] || '';

  if (realm === undefined || nonce === undefined) return null;

  return { realm, nonce, qop, opaque };
}

/**
 * Build the Authorization: Digest ... header value.
 *
 * @param {string} method  - HTTP method (GET, POST)
 * @param {string} uri     - Request URI path
 * @param {string} user    - Username
 * @param {string} pass    - Password
 * @param {object} challenge - Parsed challenge from parseDigestChallenge()
 * @returns {string} Full Authorization header value
 */
function buildDigestHeader(method, uri, user, pass, challenge) {
  const { realm, nonce, qop, opaque } = challenge;
  const cnonce = crypto.randomBytes(8).toString('hex');
  const nc = '00000001';

  const ha1 = md5(`${user}:${realm}:${pass}`);
  const ha2 = md5(`${method}:${uri}`);

  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  let header = `Digest username="${user}", realm="${realm}", nonce="${nonce}", ` +
    `uri="${uri}", response="${response}"`;

  if (qop) {
    header += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  }
  if (opaque) {
    header += `, opaque="${opaque}"`;
  }

  return header;
}

module.exports = { parseDigestChallenge, buildDigestHeader };
