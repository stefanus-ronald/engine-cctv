/**
 * capabilities.js — ONVIF capability detection (V-014, Fase 5).
 *
 * Two cheap, universal probes replace the per-category GetCapabilities calls
 * (which are slow/heavy on multi-channel DVRs and were a source of onboarding
 * timeouts):
 *
 *   GetServices        → which services exist (PTZ / Replay=Profile G / Analytics
 *                        / Events / Media2). ONE call, works on every ONVIF device.
 *   GetEventProperties → the TopicSet the device actually emits → derive which
 *                        detectors it really supports (motion/line/loitering/face).
 *
 * Output is shaped like the ISAPI hwCapabilities object so the SAME frontend
 * Analytics panel (which reads cam.hwCapabilities) shows real ONVIF support
 * instead of the motion-only fallback.
 */

const soap = require('./soap-client');

/** GetServices → { ptz, profileG, analytics, events, media2, namespaces[] }. */
async function getServices(deviceServiceXAddr, auth) {
  const xml = await soap.call(deviceServiceXAddr,
    `<tds:GetServices><tds:IncludeCapability>false</tds:IncludeCapability></tds:GetServices>`, auth);
  const namespaces = [...xml.matchAll(/<(?:[a-zA-Z0-9]+:)?Namespace>([^<]+)</gi)].map(m => m[1]);
  const has = (re) => namespaces.some(n => re.test(n));
  return {
    namespaces,
    ptz: has(/\/ptz\//i),
    profileG: has(/\/(replay|recording|search)\//i),
    analytics: has(/\/analytics\//i),
    events: has(/\/events\//i),
    media2: has(/ver20\/media\//i),
  };
}

/** Discover the Events service endpoint (fallback to convention). */
async function getEventsXAddr(deviceServiceXAddr, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr,
      `<tds:GetCapabilities><tds:Category>Events</tds:Category></tds:GetCapabilities>`, auth);
    const x = (xml.match(/<(?:[a-zA-Z0-9]+:)?XAddr>([^<]*Events[^<]*)</i) || [])[1]
      || (xml.match(/<(?:[a-zA-Z0-9]+:)?XAddr>([^<]*)</i) || [])[1];
    if (x) return x.trim();
  } catch (e) { /* fall through */ }
  try {
    const u = new (require('url').URL)(deviceServiceXAddr);
    return `${u.protocol}//${u.host}/onvif/Events`;
  } catch (e) { return deviceServiceXAddr; }
}

/** Map an ONVIF TopicSet blob to the detector flags the UI understands. Uses the
 *  same keyword dialect as event-normalizer so detection & display agree. */
function detectorsFromTopics(xml) {
  const t = String(xml || '').toLowerCase();
  return {
    motion: /motion|cellmotion|motionalarm/.test(t),
    line: /linedetector|linecross/.test(t),
    loitering: /fielddetector|objectsinside|intrusion|loiter/.test(t),
    face: /facedetect|facerecognition/.test(t),
  };
}

/** GetEventProperties → detector flags (empty object on failure). */
async function getSupportedDetectors(deviceServiceXAddr, auth) {
  const eventsXAddr = await getEventsXAddr(deviceServiceXAddr, auth);
  try {
    const xml = await soap.call(eventsXAddr, `<tev:GetEventProperties/>`, auth);
    return detectorsFromTopics(xml);
  } catch (e) {
    return {};
  }
}

/**
 * Probe a camera's ONVIF capabilities → hwCapabilities-shaped object.
 * @param {object} cam - must carry cam.onvif (xaddr/port) + credentials
 */
async function probeCapabilities(cam) {
  const media = require('./media');
  const auth = { username: cam.username, password: cam.password };
  const devXAddr = (cam.onvif && cam.onvif.xaddr) || media.deviceXAddr(cam.ip, (cam.onvif && cam.onvif.port) || 80);

  let svc = {};
  try { svc = await getServices(devXAddr, auth); } catch (e) { /* leave empty */ }

  let det = {};
  if (svc.events) det = await getSupportedDetectors(devXAddr, auth);

  // Shape to the frontend hwCapabilities contract (unknown → false). person/
  // vehicle/lpr aren't standard ONVIF event topics → false unless analytics
  // metadata later proves otherwise.
  return {
    motion: !!det.motion || svc.analytics === true,  // analytics implies at least motion-class detection
    line: !!det.line,
    loitering: !!det.loitering,
    field: !!det.loitering,
    face: !!det.face,
    person: false,
    vehicle: false,
    lpr: false,
    ptz: !!svc.ptz,
    playback: !!svc.profileG,
    _onvif: true,
  };
}

module.exports = { getServices, getSupportedDetectors, detectorsFromTopics, getEventsXAddr, probeCapabilities };
