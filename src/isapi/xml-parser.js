/**
 * ISAPI XML Event Parser — regex-based extraction.
 *
 * Hikvision ISAPI alert stream sends XML payloads with event data.
 * We use regex instead of xml2js to avoid adding dependencies.
 * The XML structure is predictable across Hikvision models.
 *
 * Works with both XML namespaces:
 *   - http://www.hikvision.com/ver20/XMLSchema
 *   - http://www.isapi.org/ver20/XMLSchema
 */

// Precompiled per-tag regexes. Alert events arrive at high rate on a busy NVR;
// compiling a fresh RegExp per tag per event (the old `new RegExp(...)` in the
// hot path) was needless GC churn. Compile each tag pattern once.
const _TAGS = [
  'eventType', 'dateTime', 'channelID', 'dynChannelID', 'activePostCount',
  'eventState', 'eventDescription', 'channelName', 'ipAddress',
];
const _TAG_RE = Object.create(null);
for (const t of _TAGS) _TAG_RE[t] = new RegExp(`<${t}>([^<]*)</${t}>`);

function _getTag(xml, tag) {
  const re = _TAG_RE[tag];
  const m = re ? xml.match(re) : null;
  return m ? m[1].trim() : null;
}

/**
 * Extract structured event data from an ISAPI XML payload.
 *
 * @param {string} xml - Raw XML string from alert stream
 * @returns {object|null} Parsed event or null if not a valid event
 */
function extractEventFromXml(xml) {
  if (!xml || typeof xml !== 'string') return null;

  const eventType = _getTag(xml, 'eventType');
  if (!eventType) return null;

  return {
    eventType,
    dateTime: _getTag(xml, 'dateTime'),
    channelID: _getTag(xml, 'channelID') || _getTag(xml, 'dynChannelID'),
    activePostCount: parseInt(_getTag(xml, 'activePostCount') || '0', 10),
    eventState: _getTag(xml, 'eventState'),
    eventDescription: _getTag(xml, 'eventDescription'),
    channelName: _getTag(xml, 'channelName'),
    ipAddress: _getTag(xml, 'ipAddress'),
  };
}

/**
 * Check if the 401 response body indicates an account lock.
 *
 * @param {string} body - Response body from 401
 * @returns {{ locked: boolean, unlockTime: number }}
 */
function parseAccountLockStatus(body) {
  if (!body || typeof body !== 'string') return { locked: false, unlockTime: 0 };

  const lockMatch = body.match(/<lockStatus>(\w+)<\/lockStatus>/);
  const timeMatch = body.match(/<unlockTime>(\d+)<\/unlockTime>/);

  return {
    locked: lockMatch ? lockMatch[1] === 'lock' : false,
    unlockTime: timeMatch ? parseInt(timeMatch[1], 10) : 0,
  };
}

module.exports = { extractEventFromXml, parseAccountLockStatus };
