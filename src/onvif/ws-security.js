/**
 * ws-security.js — ONVIF WS-Security UsernameToken (V-014, Fase 1).
 *
 * ONVIF authenticates SOAP calls with a WS-Security UsernameToken carrying a
 * PasswordDigest (NOT HTTP Digest like ISAPI). The digest is:
 *
 *     PasswordDigest = Base64( SHA1( nonceBytes + createdUtf8 + passwordUtf8 ) )
 *
 * where nonceBytes are the RAW (pre-Base64) random bytes, `created` is an ISO-8601
 * UTC timestamp, and both `created` and `password` are appended as UTF-8 bytes.
 * The token then ships nonce and created in their Base64 / text forms.
 *
 * Zero dependencies — native `crypto` only (same ethos as isapi/digest-auth.js).
 *
 * ⚠️ Real-device validation pending (no ONVIF hardware in dev). Logic is pinned by
 * unit tests in scripts/test-onvif.js against a self-recomputed vector.
 */

const crypto = require('crypto');

// WS-Security namespaces (OASIS WSS 1.0).
const NS_WSSE = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd';
const NS_WSU = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd';
const TYPE_DIGEST = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest';
const ENC_B64 = 'http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary';

/**
 * Compute the PasswordDigest from raw nonce bytes, created timestamp and password.
 * Exposed for testing.
 * @param {Buffer} nonceBytes
 * @param {string} created  ISO-8601 UTC, e.g. "2026-06-30T10:00:00Z"
 * @param {string} password
 * @returns {string} Base64 PasswordDigest
 */
function passwordDigest(nonceBytes, created, password) {
  const sha1 = crypto.createHash('sha1');
  sha1.update(Buffer.concat([
    Buffer.from(nonceBytes),
    Buffer.from(created, 'utf8'),
    Buffer.from(password == null ? '' : password, 'utf8'),
  ]));
  return sha1.digest('base64');
}

/**
 * Build the <wsse:Security> SOAP header block for a UsernameToken.
 * @param {string} username
 * @param {string} password
 * @param {object} [opts] - { nonceBytes?:Buffer, created?:string } for deterministic tests;
 *                          { clockOffsetMs?:number } stamps Created in the DEVICE's clock
 *                          (deviceEpoch - localEpoch, learned via GetSystemDateAndTime) so
 *                          drifted devices don't reject the token as stale/future.
 * @returns {string} XML string (the Security header, namespaces inline)
 */
function buildSecurityHeader(username, password, opts = {}) {
  const nonceBytes = opts.nonceBytes || crypto.randomBytes(16);
  const created = opts.created ||
    new Date(Date.now() + (opts.clockOffsetMs || 0)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const digest = passwordDigest(nonceBytes, created, password || '');
  const nonceB64 = Buffer.from(nonceBytes).toString('base64');
  return (
    `<wsse:Security xmlns:wsse="${NS_WSSE}" xmlns:wsu="${NS_WSU}" env:mustUnderstand="1">` +
      `<wsse:UsernameToken>` +
        `<wsse:Username>${escapeXml(username || '')}</wsse:Username>` +
        `<wsse:Password Type="${TYPE_DIGEST}">${digest}</wsse:Password>` +
        `<wsse:Nonce EncodingType="${ENC_B64}">${nonceB64}</wsse:Nonce>` +
        `<wsu:Created>${created}</wsu:Created>` +
      `</wsse:UsernameToken>` +
    `</wsse:Security>`
  );
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

module.exports = { passwordDigest, buildSecurityHeader, escapeXml, NS_WSSE, NS_WSU };
