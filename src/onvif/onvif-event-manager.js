/**
 * onvif-event-manager.js — realtime detection for ONVIF cameras (V-014, Fase 2).
 *
 * Mirrors isapi/alert-stream-manager but over ONVIF PullPoint: one long-poll loop
 * per ONVIF camera. Notifications → normalizeOnvifEvent → event-dedup → SSE, the
 * same pipeline the frontend already consumes (no UI change).
 *
 * Resilience patterns borrowed from alert-stream-manager: a per-camera `closing`
 * flag so intentional shutdown isn't resurrected, tracked timers, and capped
 * backoff on error. Nothing here throws to the top level — the loop self-heals.
 */

const cameraManager = require('../camera-manager');
const events = require('./events');
const media = require('./media');
const { normalizeOnvifEvent } = require('../events/event-normalizer');
const { isDuplicate } = require('../events/event-dedup');
const sseBroadcaster = require('../events/sse-broadcaster');

const BASE_RECONNECT_MS = 3000;  // wait after a failure before re-subscribing
const MAX_BACKOFF_MS = 120000;   // cap exponential backoff
const PULL_RETRIES = 2;          // retry pulls on the SAME subscription before re-subscribing
const PULL_RETRY_DELAY_MS = 1000;
const RENEW_INTERVAL_MS = 30000; // best-effort Renew cadence (safety for non-compliant vendors)

const loops = new Map();         // cameraId → loop state

function isOnvif(cam) {
  return String(cam.protocol || '').toLowerCase() === 'onvif';
}

function deviceXAddr(cam) {
  return (cam.onvif && cam.onvif.xaddr) || media.deviceXAddr(cam.ip, (cam.onvif && cam.onvif.port) || 80);
}

async function runLoop(state) {
  const cam = cameraManager.getById(state.cameraId);
  if (!cam || state.closing) return;
  const auth = { username: cam.username, password: cam.password };
  const xaddr = deviceXAddr(cam);

  try {
    const { subAddr } = await events.createPullPoint(xaddr, auth);
    state.subAddr = subAddr;
    state.auth = auth;                  // capture creds AT subscribe time — teardown of
                                        // this subscription must use these, not whatever
                                        // the camera has after a credential update
    state.backoff = BASE_RECONNECT_MS;  // reset backoff on a good subscription
    state.lastRenewAt = Date.now();
    let pullFails = 0;
    console.log(`[onvif-events] subscribed ${state.cameraId} (${cam.ip})`);

    while (!state.closing) {
      let notes;
      try {
        notes = await events.pull(subAddr, auth, {});
        pullFails = 0;
      } catch (pullErr) {
        // A single failed pull (device closed an idle long-poll, transient
        // network blip) does NOT mean the subscription is dead — retry on the
        // same subAddr before tearing everything down. This shrinks the event
        // loss window from ≥15s (full re-subscribe backoff) to ~1s.
        pullFails++;
        if (state.closing || pullFails > PULL_RETRIES) throw pullErr;
        console.warn(`[onvif-events] ${state.cameraId} pull failed (${pullFails}/${PULL_RETRIES}): ${pullErr.message} — retrying same subscription`);
        await new Promise(r => setTimeout(r, PULL_RETRY_DELAY_MS));
        continue;
      }
      for (const note of notes) {
        const event = normalizeOnvifEvent(note, state.cameraId);
        if (!event) continue;
        if (isDuplicate(event)) continue;
        sseBroadcaster.broadcast(event);
      }
      // Best-effort Renew: PullMessages already auto-extends TerminationTime per
      // ONVIF Core Spec; this covers vendors that don't comply. Never fatal.
      if (!state.closing && Date.now() - state.lastRenewAt > RENEW_INTERVAL_MS) {
        state.lastRenewAt = Date.now();
        events.renew(subAddr, auth).catch(() => {});
      }
    }
  } catch (err) {
    if (state.closing) return;
    console.warn(`[onvif-events] ${state.cameraId} loop error: ${err.message} — retry in ${Math.round(state.backoff / 1000)}s`);
    // best-effort release before retry — with the creds this subscription was made with
    if (state.subAddr) events.unsubscribe(state.subAddr, state.auth || { username: cam.username, password: cam.password });
    state.subAddr = null;
    scheduleReconnect(state);
    return;
  }
  // Clean loop exit only happens on close.
}

function scheduleReconnect(state) {
  if (state.closing) return;
  if (state.timer) clearTimeout(state.timer);
  const wait = state.backoff;
  state.backoff = Math.min(state.backoff * 2, MAX_BACKOFF_MS);
  state.timer = setTimeout(() => {
    state.timer = null;
    if (!state.closing) runLoop(state);
  }, wait);
  if (state.timer.unref) state.timer.unref();
}

function startCamera(cameraId) {
  if (loops.has(cameraId)) return;
  const state = { cameraId, closing: false, subAddr: null, auth: null, timer: null, backoff: BASE_RECONNECT_MS, lastRenewAt: 0 };
  loops.set(cameraId, state);
  runLoop(state);
}

function stopCamera(cameraId) {
  const state = loops.get(cameraId);
  if (!state) return;
  state.closing = true;
  if (state.timer) { clearTimeout(state.timer); state.timer = null; }
  if (state.subAddr) {
    const cam = cameraManager.getById(cameraId);
    const auth = state.auth || (cam && { username: cam.username, password: cam.password });
    if (auth) events.unsubscribe(state.subAddr, auth);
  }
  loops.delete(cameraId);
}

/** Start PullPoint loops for every ONVIF camera currently registered. */
function init() {
  const onvifCams = cameraManager.getAll().filter(isOnvif);
  if (!onvifCams.length) {
    console.log('[onvif-events] no ONVIF cameras — idle');
  } else {
    for (const cam of onvifCams) startCamera(cam.id);
  }
  // React to camera add/remove at runtime (mirrors go2rtc-manager's listener).
  cameraManager.onCameraChange((action, cam) => {
    if (action === 'add' && cam && isOnvif(cam)) startCamera(cam.id);
    else if (action === 'remove' && cam) stopCamera(cam.id);
    else if (action === 'update' && cam) {
      stopCamera(cam.id);
      const fresh = cameraManager.getById(cam.id);
      if (fresh && isOnvif(fresh)) startCamera(cam.id);
    }
  });
}

function stop() {
  for (const id of [...loops.keys()]) stopCamera(id);
}

function getStatus() {
  return [...loops.values()].map(s => ({ cameraId: s.cameraId, subscribed: !!s.subAddr, closing: s.closing }));
}

module.exports = { init, stop, startCamera, stopCamera, getStatus };
