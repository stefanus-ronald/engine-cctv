/**
 * events.js — ONVIF Events service via PullPoint (V-014, Fase 2).
 *
 * Flow per camera:
 *   CreatePullPointSubscription  → subscription address
 *   PullMessages (long-poll loop) → NotificationMessages (topic + state)
 *   Unsubscribe                   → release on shutdown
 *
 * Notifications are parsed into { topic, active, utcTime } and handed to the
 * event-normalizer (normalizeOnvifEvent) → event-dedup → sse-broadcaster, i.e.
 * they ride the SAME realtime pipeline as ISAPI events — the frontend needs no
 * change (toast/flash/overlay already consume that shape).
 *
 * ⚠️ Real-device validation pending. WS-Addressing action strings and the exact
 * notification schema vary by vendor; parsing here is deliberately tolerant.
 */

const soap = require('./soap-client');

const NS_EVENTS = 'http://www.onvif.org/ver10/events/wsdl';
const ACT_PULL = `${NS_EVENTS}/PullPointSubscription/PullMessages`;
const ACT_UNSUB = 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/UnsubscribeRequest';
const ACT_RENEW = 'http://docs.oasis-open.org/wsn/bw-2/SubscriptionManager/RenewRequest';

/** Discover the Events service endpoint; fall back to the conventional path. */
async function getEventsXAddr(deviceServiceXAddr, auth) {
  try {
    const xml = await soap.call(deviceServiceXAddr,
      `<tds:GetCapabilities><tds:Category>Events</tds:Category></tds:GetCapabilities>`, auth);
    const block = (xml.match(/<[^>]*Events>([\s\S]*?)<\/[^>]*Events>/i) || [])[1] || xml;
    const x = (block.match(/<(?:[a-zA-Z0-9]+:)?XAddr>([^<]*)</i) || [])[1];
    if (x) return x.trim();
  } catch (e) { /* fall through */ }
  try {
    const u = new (require('url').URL)(deviceServiceXAddr);
    return `${u.protocol}//${u.host}/onvif/Events`;
  } catch (e) { return deviceServiceXAddr; }
}

/** Create a PullPoint subscription; returns the subscription-manager address. */
async function createPullPoint(deviceServiceXAddr, auth, { initialTermination = 'PT60S' } = {}) {
  const eventsXAddr = await getEventsXAddr(deviceServiceXAddr, auth);
  const body =
    `<tev:CreatePullPointSubscription>` +
      `<tev:InitialTerminationTime>${initialTermination}</tev:InitialTerminationTime>` +
    `</tev:CreatePullPointSubscription>`;
  const xml = await soap.call(eventsXAddr, body, auth);
  const addr = extractSubscriptionAddress(xml);
  if (!addr) throw new Error('no SubscriptionReference address in CreatePullPointSubscription response');
  return { subAddr: addr, eventsXAddr };
}

/** Pull queued notifications (long-poll). Returns [{topic,active,utcTime}]. */
async function pull(subAddr, auth, { timeout = 'PT10S', limit = 20, timeoutMs = 15000 } = {}) {
  const body =
    `<tev:PullMessages>` +
      `<tev:Timeout>${timeout}</tev:Timeout>` +
      `<tev:MessageLimit>${limit}</tev:MessageLimit>` +
    `</tev:PullMessages>`;
  const xml = await soap.call(subAddr, body, {
    ...auth, timeoutMs,
    headerXml: soap.wsaHeaders(ACT_PULL, subAddr),
  });
  return parseNotifications(xml);
}

/** Pure builder for the Renew body (exposed for unit tests). */
function buildRenewBody(termination = 'PT60S') {
  return `<wsnt:Renew><wsnt:TerminationTime>${termination}</wsnt:TerminationTime></wsnt:Renew>`;
}

/**
 * Extend the subscription's TerminationTime. Per ONVIF Core Spec PullMessages
 * already auto-extends it, so this is a best-effort SAFETY for vendors that
 * don't comply — callers should swallow failures.
 */
async function renew(subAddr, auth, { termination = 'PT60S' } = {}) {
  await soap.call(subAddr, buildRenewBody(termination), {
    ...auth, timeoutMs: 5000,
    headerXml: soap.wsaHeaders(ACT_RENEW, subAddr),
  });
}

/** Best-effort unsubscribe. */
async function unsubscribe(subAddr, auth) {
  try {
    await soap.call(subAddr, `<wsnt:Unsubscribe/>`, {
      ...auth, timeoutMs: 4000,
      headerXml: soap.wsaHeaders(ACT_UNSUB, subAddr),
    });
  } catch (e) { /* device may have already expired the subscription */ }
}

/** Pull the subscription address out of a CreatePullPointSubscription response. */
function extractSubscriptionAddress(xml) {
  // <tev:SubscriptionReference><wsa:Address>...</wsa:Address></tev:SubscriptionReference>
  const ref = (xml.match(/SubscriptionReference>([\s\S]*?)<\/[^>]*SubscriptionReference>/i) || [])[1] || xml;
  const addr = (ref.match(/<(?:[a-zA-Z0-9]+:)?Address[^>]*>([^<]*)</i) || [])[1];
  return addr ? addr.trim() : '';
}

/**
 * Parse a PullMessagesResponse into notifications. Tolerant of prefix variations
 * (wsnt:/tt:/none). For each NotificationMessage we extract the Topic text and an
 * "active" flag derived from the message SimpleItem values / PropertyOperation.
 */
function parseNotifications(xml) {
  const out = [];
  if (!xml) return out;
  const re = /<(?:[a-zA-Z0-9]+:)?NotificationMessage\b[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?NotificationMessage>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const topic = ((block.match(/<(?:[a-zA-Z0-9]+:)?Topic[^>]*>([\s\S]*?)<\/(?:[a-zA-Z0-9]+:)?Topic>/i) || [])[1] || '').trim();
    const utcTime = (block.match(/UtcTime="([^"]*)"/i) || [])[1] || '';
    out.push({ topic, active: isActive(block, topic), utcTime });
  }
  return out;
}

// Topics we already warned about (once per process) when their notification
// schema didn't match any known active/inactive pattern.
const unknownSchemaWarned = new Set();

/** Decide whether a notification block represents an ACTIVE (started) event. */
function isActive(block, topic) {
  // Most ONVIF data uses a SimpleItem whose Value is "true"/"false".
  const val = (block.match(/<(?:[a-zA-Z0-9]+:)?SimpleItem[^>]*Value="([^"]*)"/i) || [])[1];
  if (val != null && /^(true|false)$/i.test(val)) return /^true$/i.test(val);
  // PropertyOperation Changed/Initialized with no explicit false → treat as active.
  if (/PropertyOperation="Deleted"/i.test(block)) return false;
  // Unrecognized schema → default ACTIVE, but say so once per topic so odd
  // vendors are visible during onboarding instead of silently misclassified.
  if (!/PropertyOperation=/i.test(block)) {
    const key = topic || '(no topic)';
    if (!unknownSchemaWarned.has(key)) {
      unknownSchemaWarned.add(key);
      console.warn(`[onvif-events] unrecognized notification schema for topic "${key}" — assuming active`);
    }
  }
  return true;
}

module.exports = {
  getEventsXAddr, createPullPoint, pull, unsubscribe, renew, buildRenewBody,
  parseNotifications, extractSubscriptionAddress, isActive,
};
