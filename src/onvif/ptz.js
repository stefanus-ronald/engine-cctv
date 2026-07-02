/**
 * ptz.js — ONVIF PTZ service (V-014, Fase 3).
 *
 * The one area where ONVIF is more mature than our ISAPI path (which had no PTZ
 * panel at all). Just enough to drive a live pan/tilt/zoom control:
 *   - getPtzXAddr / hasPtz  : locate the PTZ service (via GetCapabilities)
 *   - continuousMove        : start moving at a velocity (pan/tilt/zoom in -1..1)
 *   - stop                  : stop pan/tilt and zoom
 *
 * Velocities are normalized (-1.0..1.0). continuousMove keeps moving until stop()
 * is called — the UI sends move on press and stop on release.
 *
 * ⚠️ Real-device validation pending. Some devices need the PTZ node's actual speed
 * space; the normalized generic space used here works on most but not all models.
 */

const soap = require('./soap-client');

/** Discover the PTZ service endpoint; fall back to the conventional path. */
async function getPtzXAddr(deviceServiceXAddr, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr,
      `<tds:GetCapabilities><tds:Category>PTZ</tds:Category></tds:GetCapabilities>`, auth);
    const block = (xml.match(/<[^>]*PTZ>([\s\S]*?)<\/[^>]*PTZ>/i) || [])[1] || '';
    const x = (block.match(/<(?:[a-zA-Z0-9]+:)?XAddr>([^<]*)</i) || [])[1];
    if (x) return x.trim();
  } catch (e) { /* fall through */ }
  return null;
}

/** True when the device advertises a PTZ service. */
async function hasPtz(deviceServiceXAddr, auth) {
  const x = await getPtzXAddr(deviceServiceXAddr, auth);
  if (x) return true;
  // Fallback attempt on the conventional endpoint (GetConfigurations returns a
  // non-fault only when PTZ exists).
  try {
    const u = new (require('url').URL)(deviceServiceXAddr);
    const guess = `${u.protocol}//${u.host}/onvif/PTZ`;
    await soap.call(guess, `<tptz:GetConfigurations/>`, auth);
    return true;
  } catch (e) { return false; }
}

const clamp = (n) => Math.max(-1, Math.min(1, Number(n) || 0));

/** Build the ContinuousMove SOAP body (pure, testable). */
function buildMoveBody(profileToken, vel) {
  const pan = clamp(vel && vel.pan);
  const tilt = clamp(vel && vel.tilt);
  const zoom = clamp(vel && vel.zoom);
  return `<tptz:ContinuousMove>` +
    `<tptz:ProfileToken>${profileToken}</tptz:ProfileToken>` +
    `<tptz:Velocity>` +
      `<tt:PanTilt x="${pan}" y="${tilt}"/>` +
      `<tt:Zoom x="${zoom}"/>` +
    `</tptz:Velocity>` +
  `</tptz:ContinuousMove>`;
}

/** Build the Stop SOAP body (pure, testable). */
function buildStopBody(profileToken) {
  return `<tptz:Stop>` +
    `<tptz:ProfileToken>${profileToken}</tptz:ProfileToken>` +
    `<tptz:PanTilt>true</tptz:PanTilt>` +
    `<tptz:Zoom>true</tptz:Zoom>` +
  `</tptz:Stop>`;
}

/**
 * Start a continuous move. pan/tilt/zoom are normalized velocities in -1..1.
 * @param {string} ptzXAddr
 * @param {string} profileToken
 * @param {{pan?:number,tilt?:number,zoom?:number}} vel
 */
async function continuousMove(ptzXAddr, profileToken, vel, auth) {
  await soap.call(ptzXAddr, buildMoveBody(profileToken, vel), auth);
  return { ok: true };
}

/** Stop pan/tilt and zoom. */
async function stop(ptzXAddr, profileToken, auth) {
  await soap.call(ptzXAddr, buildStopBody(profileToken), auth);
  return { ok: true };
}

module.exports = { getPtzXAddr, hasPtz, continuousMove, stop, buildMoveBody, buildStopBody, _clamp: clamp };
