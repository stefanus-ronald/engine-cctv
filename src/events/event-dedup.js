/**
 * Event Deduplication — server-side throttling to prevent SSE flooding.
 *
 * Uses a sliding window per detector+camera pair. Each event type has a
 * configurable cooldown period — events arriving within the cooldown
 * are suppressed (not broadcast).
 *
 * VMD (motion) is especially noisy on Hikvision cameras — fires every
 * 500ms during active motion. A 30s cooldown keeps the frontend useful
 * without flooding.
 */

const CLEANUP_INTERVAL_MS = 30000; // cleanup every 30s

// Per-detector cooldown periods (ms).
// Events within the cooldown window after the last broadcast are suppressed.
const THROTTLE_MS = {
  'motion':   30000,  // VMD fires constantly — 1 event per 30s max
  'line':     10000,  // line crossing — 1 per 10s
  'loitering': 15000, // field/intrusion — 1 per 15s
  'face':     10000,  // face detection — 1 per 10s
  'vehicle':  10000,  // vehicle detection — 1 per 10s
  'person':   10000,  // person detection (VCA) — 1 per 10s
  'lpr':       5000,  // license plate — 1 per 5s (less noisy)
};

const DEFAULT_THROTTLE_MS = 10000; // 10s default for unknown types

// Map: key → last broadcast timestamp (ms)
// key = `${detectorId}:${cameraId}`
const lastBroadcast = new Map();

/**
 * Check if an event is a duplicate (should be suppressed).
 *
 * Key format: `${detectorId}:${cameraId}` (no timestamp in key).
 * Compares against the last broadcast time for this detector+camera pair.
 *
 * @param {object} event - Normalized detection event
 * @returns {boolean} true if duplicate (suppress), false if fresh (broadcast)
 */
function isDuplicate(event) {
  const key = `${event.detectorId}:${event.cameraId}`;
  const now = Date.now();
  const cooldown = THROTTLE_MS[event.detectorId] || DEFAULT_THROTTLE_MS;

  const lastTs = lastBroadcast.get(key);
  if (lastTs && (now - lastTs) < cooldown) {
    return true; // within cooldown — suppress
  }

  lastBroadcast.set(key, now);
  return false;
}

/**
 * Reset dedup state (useful for testing or reconnection).
 */
function reset() {
  lastBroadcast.clear();
}

/**
 * Get current dedup cache size (for stats/debugging).
 */
function getSize() {
  return lastBroadcast.size;
}

// Self-cleaning: prune expired entries periodically
const _cleanupTimer = setInterval(() => {
  const now = Date.now();
  const maxCooldown = Math.max(...Object.values(THROTTLE_MS));
  for (const [key, ts] of lastBroadcast) {
    if (now - ts > maxCooldown * 2) lastBroadcast.delete(key);
  }
}, CLEANUP_INTERVAL_MS);

// Don't let the cleanup timer keep the process alive
if (_cleanupTimer.unref) _cleanupTimer.unref();

module.exports = { isDuplicate, reset, getSize };
