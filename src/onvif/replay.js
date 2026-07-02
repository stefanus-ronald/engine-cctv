/**
 * replay.js — ONVIF Recording Search + Replay (Profile G) (V-014, Fase 4).
 *
 * Profile G lets a device play back its own recordings. Support is UNEVEN across
 * vendors (many Hikvision NVRs advertise it only partially), so everything here
 * is best-effort and gated by a capability probe — the UI shows "not supported"
 * when a device lacks it, and Hikvision devices keep using the mature ISAPI path.
 *
 * Flow:
 *   GetServices/GetCapabilities → Search + Replay service XAddrs
 *   GetRecordingSummary         → { dataFrom, dataUntil } (is there anything?)
 *   FindRecordings + results    → recording tokens
 *   GetReplayUri(token)         → RTSP URL (played via go2rtc, like ISAPI tracks)
 *
 * ⚠️ Real-device validation pending. Time-seek within a recording uses the RTSP
 * Range on PLAY, which go2rtc's ffmpeg source does not set — Fase 4 plays a
 * recording from its start; precise scrubbing is a follow-up needing hardware.
 */

const soap = require('./soap-client');

const NS_SEARCH = 'http://www.onvif.org/ver10/search/wsdl';
const NS_REPLAY = 'http://www.onvif.org/ver10/replay/wsdl';

function tag(xml, name) {
  const m = new RegExp(`<(?:[a-zA-Z0-9]+:)?${name}[^>]*>([\\s\\S]*?)</(?:[a-zA-Z0-9]+:)?${name}>`, 'i').exec(xml || '');
  return m ? m[1].trim() : '';
}

async function getServiceXAddr(deviceServiceXAddr, category, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr,
      `<tds:GetCapabilities><tds:Category>${category}</tds:Category></tds:GetCapabilities>`, auth);
    const block = (xml.match(new RegExp(`<[^>]*${category}>([\\s\\S]*?)<\\/[^>]*${category}>`, 'i')) || [])[1] || '';
    const x = (block.match(/<(?:[a-zA-Z0-9]+:)?XAddr>([^<]*)</i) || [])[1];
    if (x) return x.trim();
  } catch (e) { /* fall through */ }
  // Fallback to conventional paths.
  try {
    const u = new (require('url').URL)(deviceServiceXAddr);
    return `${u.protocol}//${u.host}/onvif/${category}`;
  } catch (e) { return null; }
}

const getSearchXAddr = (dev, auth) => getServiceXAddr(dev, 'Search', auth);
const getReplayXAddr = (dev, auth) => getServiceXAddr(dev, 'Replay', auth);

/** True when the device advertises a Replay service (Profile G). */
async function hasProfileG(deviceServiceXAddr, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr, `<tds:GetCapabilities><tds:Category>All</tds:Category></tds:GetCapabilities>`, auth);
    if (/Replay>/i.test(xml) || /RecordingSearch|Recording>/i.test(xml)) return true;
  } catch (e) { /* fall through */ }
  return false;
}

/** GetRecordingSummary → { dataFrom, dataUntil, count } (empty strings if none). */
async function getRecordingSummary(searchXAddr, auth) {
  const xml = await soap.call(searchXAddr, `<tse:GetRecordingSummary xmlns:tse="${NS_SEARCH}"/>`, auth);
  return {
    dataFrom: tag(xml, 'DataFrom'),
    dataUntil: tag(xml, 'DataUntil'),
    count: Number(tag(xml, 'NumberRecordings')) || null,
  };
}

/** Parse recording tokens from a FindRecordings/GetRecordingSearchResults response. */
function parseRecordingTokens(xml) {
  const out = [];
  const re = /<(?:[a-zA-Z0-9]+:)?RecordingToken>([^<]*)<\/(?:[a-zA-Z0-9]+:)?RecordingToken>/gi;
  let m;
  while ((m = re.exec(xml))) { if (!out.includes(m[1].trim())) out.push(m[1].trim()); }
  return out;
}

/** List recording tokens on the device (best-effort). */
async function findRecordings(searchXAddr, auth) {
  // Many devices accept an empty-scope FindRecordings; then results are fetched by
  // the returned SearchToken. We try the direct GetRecordingSearchResults path and
  // also parse any tokens present in the FindRecordings response itself.
  const findXml = await soap.call(searchXAddr,
    `<tse:FindRecordings xmlns:tse="${NS_SEARCH}"><tse:Scope/><tse:KeepAliveTime>PT30S</tse:KeepAliveTime></tse:FindRecordings>`, auth);
  let tokens = parseRecordingTokens(findXml);
  const searchToken = tag(findXml, 'SearchToken');
  if (!tokens.length && searchToken) {
    try {
      const resXml = await soap.call(searchXAddr,
        `<tse:GetRecordingSearchResults xmlns:tse="${NS_SEARCH}"><tse:SearchToken>${searchToken}</tse:SearchToken></tse:GetRecordingSearchResults>`, auth);
      tokens = parseRecordingTokens(resXml);
    } catch (e) { /* keep whatever we have */ }
  }
  return tokens;
}

/** GetReplayUri(recordingToken) → RTSP URL (credential-free). */
async function getReplayUri(replayXAddr, recordingToken, auth) {
  const body =
    `<trp:GetReplayUri xmlns:trp="${NS_REPLAY}">` +
      `<trp:StreamSetup>` +
        `<tt:Stream>RTP-Unicast</tt:Stream>` +
        `<tt:Transport><tt:Protocol>RTSP</tt:Protocol></tt:Transport>` +
      `</trp:StreamSetup>` +
      `<trp:RecordingToken>${recordingToken}</trp:RecordingToken>` +
    `</trp:GetReplayUri>`;
  const xml = await soap.call(replayXAddr, body, auth);
  return tag(xml, 'Uri');
}

module.exports = {
  getSearchXAddr, getReplayXAddr, hasProfileG,
  getRecordingSummary, findRecordings, getReplayUri,
  parseRecordingTokens,
};
