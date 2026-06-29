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

/**
 * Extract structured event data from an ISAPI XML payload.
 *
 * @param {string} xml - Raw XML string from alert stream
 * @returns {object|null} Parsed event or null if not a valid event
 */
function extractEventFromXml(xml) {
  if (!xml || typeof xml !== 'string') return null;

  const get = (tag) => {
    const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
    return m ? m[1].trim() : null;
  };

  const eventType = get('eventType');
  if (!eventType) return null;

  return {
    eventType,
    dateTime: get('dateTime'),
    channelID: get('channelID') || get('dynChannelID'),
    activePostCount: parseInt(get('activePostCount') || '0', 10),
    eventState: get('eventState'),
    eventDescription: get('eventDescription'),
    channelName: get('channelName'),
    ipAddress: get('ipAddress'),
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
