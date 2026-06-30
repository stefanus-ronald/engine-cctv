/* ══════════════════════════════════════════
   Helpers
   ══════════════════════════════════════════ */
function esc(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function highlightMatch(text, query) {
  if (!query) return esc(text);
  const idx = text.toLowerCase().indexOf(query);
  if (idx === -1) return esc(text);
  return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + query.length)) + '</mark>' + esc(text.slice(idx + query.length));
}

function showToast(msg, warn) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = warn ? 'show warn' : 'show';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.className = '', 2500);
}

function downloadJSON(filename, str) {
  const blob = new Blob([str], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}

/* ══════════════════════════════════════════
   Activity Log — data layer
   ══════════════════════════════════════════ */
const ACTIVITY_LOG_KEY = 'go2rtc-activity-log';
const ACTIVITY_LOG_CAP = 500;
const CATEGORY_LABELS = { camera: 'Camera', stream: 'Stream', config: 'Config', layout: 'Layout', system: 'System', analytics: 'Analytics' };

let activityLog = [];          // { id, ts, severity, category, message, cameraId, cameraName, actor, read }
let activityDrawerOpen = false;
let activityIdCounter = 1;

function loadActivityLog() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(ACTIVITY_LOG_KEY)); } catch(e) {}
  if (Array.isArray(stored)) {
    activityLog = stored;
  } else {
    activityLog = seedActivityLog();   // first run only — absent key, not an empty array
    saveActivityLog();
  }
  activityIdCounter = activityLog.reduce((m, e) => Math.max(m, e.id || 0), 0) + 1;
  updateActivityBadge();
}

function saveActivityLog() {
  try { localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(activityLog)); } catch(e) {}
}

function logEvent(opts) {
  const evt = {
    id: activityIdCounter++,
    ts: Date.now(),
    severity: opts.severity || 'info',
    category: opts.category || 'system',
    message: opts.message || '',
    cameraId: opts.cameraId || null,
    cameraName: opts.cameraName || null,
    actor: opts.actor || null,
    // ── Analytics-specific metadata (chunk 5). Default undefined so seed
    // events and non-analytics callers stay unchanged.
    subType: opts.subType,            // e.g. 'detection' | 'config'
    detectorId: opts.detectorId,
    confidence: opts.confidence,
    source: opts.source,
    zone: opts.zone,
    dedupedFromKey: opts.dedupedFromKey, // marks a row as suppressed for toast/flash
    read: activityDrawerOpen   // seen immediately if the drawer is already open
  };
  activityLog.unshift(evt);
  if (activityLog.length > ACTIVITY_LOG_CAP) activityLog.length = ACTIVITY_LOG_CAP;
  saveActivityLog();
  updateActivityBadge();
  if (activityDrawerOpen) renderActivityFeed();
  return evt;
}

// Fires a toast AND records a log entry — the toast is a transient projection of the log.
function notify(message, opts) {
  opts = opts || {};
  if (opts.toast !== false) {
    showToast(message, opts.warn || opts.severity === 'warning' || opts.severity === 'critical');
  }
  return logEvent({
    severity: opts.severity || 'info',
    category: opts.category || 'system',
    message: message,
    cameraId: opts.cameraId,
    cameraName: opts.cameraName,
    actor: opts.actor,
    subType: opts.subType,
    detectorId: opts.detectorId,
    confidence: opts.confidence,
    source: opts.source,
    zone: opts.zone
  });
}

// Simulated history — only generated on first run (consistent with the mockup philosophy).
function seedActivityLog() {
  const names = [];
  for (const arr of Object.values(CAMERA_GROUPS)) names.push(...arr);
  const pick = () => names[Math.floor(Math.random() * names.length)];
  const M = 60000, H = 3600000, D = 86400000;
  const specs = [
    { off: 3*M,   sev:'critical', cat:'camera', msg: c => `Camera "${c}" went offline`,        cam:true },
    { off: 11*M,  sev:'info',     cat:'camera', msg: c => `Snapshot captured — ${c}`,            cam:true },
    { off: 24*M,  sev:'warning',  cat:'stream', msg: c => `Reconnect attempt — ${c}`,            cam:true },
    { off: 47*M,  sev:'info',     cat:'layout', msg: () => `Layout "Night Shift" loaded` },
    { off: 1.4*H, sev:'warning',  cat:'stream', msg: () => `Stream budget at 80% (29 / 36)` },
    { off: 2.6*H, sev:'info',     cat:'config', msg: () => `Streaming protocol changed to WebRTC` },
    { off: 5*H,   sev:'critical', cat:'camera', msg: c => `Signal lost — ${c}`,                  cam:true },
    { off: 7.5*H, sev:'info',     cat:'camera', msg: c => `Camera "${c}" added`,                 cam:true },
    { off: 26*H,  sev:'info',     cat:'camera', msg: c => `Connection test passed — ${c}`,       cam:true },
    { off: 30*H,  sev:'warning',  cat:'config', msg: () => `Group "Loading Docks" deleted` },
    { off: 34*H,  sev:'info',     cat:'layout', msg: () => `Layout "Day Shift" saved` },
    { off: 2*D,   sev:'info',     cat:'stream', msg: () => `All streams muted` },
    { off: 2.4*D, sev:'warning',  cat:'camera', msg: c => `Camera "${c}" went offline`,          cam:true },
    { off: 3*D,   sev:'info',     cat:'camera', msg: c => `Camera "${c}" updated`,               cam:true },
    { off: 3.6*D, sev:'info',     cat:'config', msg: () => `12 cameras imported` },
    { off: 4.2*D, sev:'info',     cat:'layout', msg: () => `Layout "Perimeter Watch" loaded` },
    { off: 5*D,   sev:'info',     cat:'stream', msg: () => `Reconnect interval changed to 5s` },
    { off: 6*D,   sev:'critical', cat:'camera', msg: c => `NVR scan failed — ${c}`,              cam:true },
    { off: 6.7*D, sev:'info',     cat:'system', msg: () => `Session started` },
  ];
  const now = Date.now();
  let id = 1;
  return specs.map((s, i) => {
    const cam = s.cam ? pick() : null;
    return {
      id: id++,
      ts: now - s.off,
      severity: s.sev,
      category: s.cat,
      message: s.msg(cam),
      cameraId: null,
      cameraName: cam,
      actor: null,
      read: i >= 3   // the 3 most recent stay unread so the badge shows a believable count
    };
  });
}

/* ══════════════════════════════════════════
   Camera Data
   ══════════════════════════════════════════ */
const CAMERA_GROUPS = {
  Perimeter: ['Front Gate','Back Gate','North Fence','South Fence','East Wall','West Wall','Main Entry','Service Entry'],
  Interior: ['Lobby','Reception','Hallway A','Hallway B','Stairwell 1','Stairwell 2','Server Room','Break Room','Conference A','Conference B'],
  Parking: ['Lot A','Lot B','Lot C','Lot D','Garage L1','Garage L2','Garage Entry','Garage Exit'],
  Warehouse: ['Bay 1','Bay 2','Bay 3','Bay 4','Loading Dock A','Loading Dock B','Aisle 1','Aisle 2','Office','Roof']
};

const GROUP_COLORS = {
  Perimeter: '#ef4444',
  Interior:  '#22c55e',
  Parking:   '#eab308',
  Warehouse: '#a3e635'
};

const BUILTIN_GROUPS = ['Perimeter', 'Interior', 'Parking', 'Warehouse'];

const GROUP_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#a3e635',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#6b7280'
];

let customGroups = []; // { name, color }

/* ══════════════════════════════════════════
   Analytics — detectors, capabilities, config
   ══════════════════════════════════════════ */
// Order is meaningful: matrix columns render in this order.
const DETECTORS = [
  { id: 'motion',    label: 'Motion',         shortLabel: 'Motion',  requiresGallery: false },
  { id: 'person',    label: 'Person',         shortLabel: 'Person',  requiresGallery: false },
  { id: 'vehicle',   label: 'Vehicle',        shortLabel: 'Vehicle', requiresGallery: false },
  { id: 'face',      label: 'Face',           shortLabel: 'Face',    requiresGallery: false },
  { id: 'lpr',       label: 'LPR',            shortLabel: 'LPR',     requiresGallery: false },
  { id: 'line',      label: 'Line Crossing',  shortLabel: 'Line',    requiresGallery: false },
  { id: 'loitering', label: 'Loitering',      shortLabel: 'Loiter',  requiresGallery: false }
];

const DETECTOR_BY_ID = Object.fromEntries(DETECTORS.map(d => [d.id, d]));

// Per-camera simulated edge capabilities { cameraId: { motion, person, ... } }.
// Not persisted — rebuilt each page load by buildCameraCapabilities().
let cameraCapabilities = {};

// Global server detector enablement. Hydrated from localStorage; defaults below.
let serverDetectors = {
  person: true, vehicle: true, face: false, lpr: false,
  motion: true, line: false, loitering: false
};

// Sparse per-cell config. analyticsConfig[cameraId][detectorId] = { enabled, source, state }
//   source: 'auto' | 'edge' | 'server'  (intent, not result — never store the resolved value)
//   state:  'off' | 'pending' | 'armed' | 'errored'
let analyticsConfig = {};

const ANALYTICS_KEY = 'go2rtc-analytics';

function loadAnalytics() {
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem(ANALYTICS_KEY)); } catch(e) { return; }
  if (!stored || typeof stored !== 'object') return;
  if (stored.serverDetectors && typeof stored.serverDetectors === 'object') {
    // Merge over defaults so newly added detectors get their default value.
    serverDetectors = { ...serverDetectors, ...stored.serverDetectors };
  }
  if (stored.analyticsConfig && typeof stored.analyticsConfig === 'object') {
    analyticsConfig = stored.analyticsConfig;
    // Phase 2: custom schedule grids are stored as plain arrays in JSON;
    // rehydrate to Uint8Array(336) so bitmap reads work uniformly.
    for (const camId in analyticsConfig) {
      const camCfg = analyticsConfig[camId];
      if (!camCfg) continue;
      for (const detId in camCfg) {
        if (detId.startsWith('_')) continue;
        const cell = camCfg[detId];
        if (cell && cell.schedule && cell.schedule.kind === 'custom'
            && Array.isArray(cell.schedule.grid)) {
          cell.schedule.grid = Uint8Array.from(cell.schedule.grid);
        }
      }
    }
  }
}

function saveAnalytics() {
  try {
    // Uint8Array survives JSON.stringify as a plain array; loadAnalytics
    // rehydrates back to a typed array on read.
    const replacer = (k, v) => (v instanceof Uint8Array ? Array.from(v) : v);
    localStorage.setItem(ANALYTICS_KEY,
      JSON.stringify({ serverDetectors, analyticsConfig }, replacer));
  } catch(e) {}
}

/* ── Phase 2: Schedules ─────────────────────────────────────────────────
   Each per-cell `schedule` is one of:
     { kind: '24/7' }
     { kind: 'after-hours' }     // 18:00–07:00 local, every day
     { kind: 'business' }        // Mon–Fri 09:00–17:00 local
     { kind: 'custom', grid: Uint8Array(336) }   // 7 days × 48 half-hours

   Absence of a schedule is equivalent to 24/7 (the implicit default).
*/
const SCHEDULE_LABELS = {
  '24/7':         '24/7',
  'after-hours':  'After hours',
  'business':     'Business hours',
  'custom':       'Custom'
};

function getSchedule(cameraId, detectorId) {
  const cell = analyticsConfig[cameraId] && analyticsConfig[cameraId][detectorId];
  if (!cell || !cell.schedule || !cell.schedule.kind) return { kind: '24/7' };
  return cell.schedule;
}

// Returns true if `now` falls inside the schedule's armed window.
// 24/7 is always true; an empty custom grid is always false.
function isWithinSchedule(schedule, now) {
  if (!schedule || !schedule.kind || schedule.kind === '24/7') return true;
  const d = new Date(now || Date.now());
  const day = d.getDay();               // 0 = Sun ... 6 = Sat
  const half = d.getHours() * 2 + (d.getMinutes() >= 30 ? 1 : 0);

  if (schedule.kind === 'after-hours') {
    // Armed 18:00–24:00 + 00:00–07:00. half index 36..47 OR 0..13.
    return half >= 36 || half < 14;
  }
  if (schedule.kind === 'business') {
    if (day === 0 || day === 6) return false;
    return half >= 18 && half < 34;     // 09:00 → 17:00 (exclusive of 17:00 cell)
  }
  if (schedule.kind === 'custom') {
    const grid = schedule.grid;
    if (!grid) return false;
    const idx = day * 48 + half;
    return !!grid[idx];
  }
  return true; // unknown kind → treat as armed
}

// Effective windows summary for a custom grid. Returns
// [{ day: 'Mon', ranges: [{ from: 'HH:MM', to: 'HH:MM' }] }, ...] in Mon–Sun
// order (skipping days with no armed cells).
function summarizeCustomGrid(grid) {
  const DAYS_LABEL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const ORDER = [1, 2, 3, 4, 5, 6, 0];
  const out = [];
  const fmt = h => `${String(Math.floor(h / 2)).padStart(2, '0')}:${(h % 2) ? '30' : '00'}`;
  for (const day of ORDER) {
    const ranges = [];
    let runStart = -1;
    for (let h = 0; h < 48; h++) {
      const armed = !!grid[day * 48 + h];
      if (armed && runStart < 0) runStart = h;
      if (!armed && runStart >= 0) {
        ranges.push({ from: fmt(runStart), to: fmt(h) });
        runStart = -1;
      }
    }
    if (runStart >= 0) ranges.push({ from: fmt(runStart), to: '24:00' });
    if (ranges.length) out.push({ day: DAYS_LABEL[day], ranges });
  }
  return out;
}

/* ── Phase 2: per-camera ephemeral state ─────────────────────────────────
   These are not persisted — they are recomputed each session.

   _camRecentEventAt:    cameraId → ts of most recent event (drives sidebar ●!)
   _suppressedByMask:    cameraId|detectorId → count (deep dive read-out)
   _suppressedByZone:    cameraId|detectorId → count (deep dive read-out)
   tileBboxOverlay:      tile index → boolean (session-only — UC-VA2-12)
*/
const _camRecentEventAt = new Map();
const _camRecentDecayTimers = new Map();   // per-camera 60s revert timer
const _suppressedByMask = new Map();
const _suppressedByZone = new Map();
const tileBboxOverlay = {};
const tileLineOverlay = {};       // per-tile line overlay toggle (default: true)
const _lineConfigCache = {};      // cameraId → { lines, regions } from ISAPI
const _tileDrawMode = {};         // per-tile draw mode state: null | { camId, points: [] }

// Schedule scheduler: 15 s tick that flips Armed ↔ Sleeping. Initialized
// lazily by startAnalyticsScheduler() (called from init alongside the
// existing simulator).
let _analyticsSchedulerTimer = null;
// Snapshot of per-cell schedule outcomes from the previous tick. Drives the
// "did anything change?" check so we only re-render when needed.
const _scheduleStateByCell = new Map();   // key: cameraId|detectorId → 'armed' | 'sleeping'

// Build camera capabilities from real ISAPI probe data (hwCapabilities from backend).
// Falls back to motion-only if no probe data is available for a camera.
function buildCameraCapabilities() {
  cameraCapabilities = {};
  for (const cam of cameras) {
    if (cam.hwCapabilities) {
      // Real ISAPI probe data from backend
      cameraCapabilities[cam.id] = { ...cam.hwCapabilities };
    } else {
      // Fallback: no probe data — assume only motion (most cameras support it)
      const caps = {};
      for (const d of DETECTORS) caps[d.id] = (d.id === 'motion');
      cameraCapabilities[cam.id] = caps;
    }
  }
}

// ── Line Crossing Overlay — fetch config from backend, render SVG on tiles ──

/**
 * Fetch line/region config from backend for a camera. Caches result.
 */
async function fetchLineConfig(cameraId) {
  if (_lineConfigCache[cameraId]) return _lineConfigCache[cameraId];
  try {
    const res = await fetch(`/api/detection/lines/${encodeURIComponent(cameraId)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.error) return null;
    _lineConfigCache[cameraId] = data;
    return data;
  } catch (err) {
    console.warn('[line-overlay] fetch failed for', cameraId, err);
    return null;
  }
}

/** Invalidate frontend line config cache (called on capabilities-updated SSE). */
function invalidateLineConfigCache() {
  Object.keys(_lineConfigCache).forEach(k => delete _lineConfigCache[k]);
}

// Debounce guard for the focus/visibility-triggered line refresh below.
let _lastLineOverlayRefresh = 0;

/**
 * Re-fetch line/region config from the cameras and re-render overlays for the
 * currently displayed line-capable tiles.
 *
 * Why: when a user enables/draws a line on the camera's OWN web UI, our engine
 * has no push notification about it. Instead of polling in the background
 * (which would load the engine + cameras continuously), we refresh lazily —
 * only when the engine tab regains focus/visibility. That's exactly the moment
 * the user switches back from the camera UI, so the overlay updates without a
 * full page reload, at near-zero idle cost.
 */
async function refreshLineOverlaysFromCamera() {
  const now = Date.now();
  if (now - _lastLineOverlayRefresh < 4000) return; // debounce rapid focus events
  _lastLineOverlayRefresh = now;

  const tiles = Array.from(document.querySelectorAll('.tile[data-camera-id]'));
  for (const tile of tiles) {
    const camId = tile.dataset.cameraId;
    const index = parseInt(tile.dataset.index, 10);
    const cam = cameras.find(c => c.id === camId);
    if (!cam || !cam.hwCapabilities) continue;
    if (!(cam.hwCapabilities.line || cam.hwCapabilities.loitering)) continue;
    if (_tileDrawMode[index] != null) continue; // don't disrupt active drawing

    try {
      // refresh=true bypasses the backend's 5-min cache so we get fresh config.
      const r = await fetch(`/api/detection/lines/${encodeURIComponent(camId)}?refresh=true`);
      if (!r.ok) continue;
      const data = await r.json();
      if (data.error) continue;
      _lineConfigCache[camId] = data;

      // Only re-render if the video is up and the overlay isn't toggled off.
      if (tile.getAttribute('data-stream-status') === 'connected'
          && tileLineOverlay[index] !== false) {
        renderLineOverlay(tile, camId);
      }
    } catch (_) { /* ignore per-camera errors */ }
  }
}

/**
 * Sync a detector's enabled state to the camera via ISAPI PUT.
 * Only fires for syncable detectors (line, loitering, motion) that have HW support.
 * Errors are silently suppressed — UI state is already saved in localStorage.
 */
async function syncDetectorToCamera(cameraId, detectorId, enabled) {
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam || !cam.hwCapabilities) return;
  const syncable = ['line', 'loitering', 'motion'];
  if (!syncable.includes(detectorId)) return;
  if (!cam.hwCapabilities[detectorId]) return; // no HW support — skip

  try {
    await fetch(`/api/detection/rule/${encodeURIComponent(cameraId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ detectorId, enabled }),
    });
  } catch (e) {
    console.warn('[sync] Failed to sync detector to camera:', e);
  }
}

/**
 * Read-back sync: fetch line config from camera and update analytics checkboxes.
 * Runs on initial page load and after probe (capabilities-updated SSE).
 * Only updates cells that haven't been explicitly set to a non-auto source.
 */
async function _syncCheckboxesFromCamera() {
  const syncCams = cameras.filter(c => c.hwCapabilities);
  for (const cam of syncCams) {
    const caps = cam.hwCapabilities;
    if (!(caps.line || caps.loitering || caps.motion || caps.face)) continue;

    // ONE call returns the real master-enabled state for line, loitering, motion
    // and face. We mirror exactly what the camera reports — never force a detector
    // "on" just because the hardware supports it (that made disables revert on
    // refresh). If a state can't be read it's left untouched (keeps last value).
    let cfg = null;
    try {
      const r = await fetch(`/api/detection/lines/${encodeURIComponent(cam.id)}?refresh=true`);
      if (r.ok) cfg = await r.json();
    } catch (_) { /* ignore individual camera errors */ }
    if (!cfg || cfg.error) continue;

    const apply = (detId, active) => {
      if (active === undefined || active === null) return; // couldn't read → keep
      const cell = _ensureCellCfg(cam.id, detId);
      cell.enabled = !!active;
      if (active && cell.source === 'auto') cell.source = 'edge';
    };
    if (caps.motion)    apply('motion', cfg.motionEnabled);
    if (caps.face)      apply('face', cfg.faceEnabled);
    if (caps.line)      apply('line', cfg.lineDetectionEnabled);
    if (caps.loitering) apply('loitering', cfg.fieldDetectionEnabled);
  }
  saveAnalytics();
  renderAnalyticsTab();
}

/**
 * Render line crossing + intrusion region SVG overlay onto a tile.
 * Hikvision coords: 0-1000 with Y=0 at BOTTOM.
 * SVG viewBox 0 0 1000 1000 has Y=0 at TOP.
 * Conversion: svgY = 1000 - hikY.
 */
function renderLineOverlay(tile, cameraId) {
  // Remove any existing overlay
  const existing = tile.querySelector('.tile-line-overlay');
  if (existing) existing.remove();

  const cfg = _lineConfigCache[cameraId];
  if (!cfg) return;

  // Show all configured rules (coordinates exist), not just enabled ones.
  // Disabled rules render faded + dashed so user can still verify position.
  const enabledLines = (cfg.lines || []).filter(l => l.coordinates && l.coordinates.length >= 2);
  const enabledRegions = (cfg.regions || []).filter(r => r.coordinates && r.coordinates.length >= 3);
  if (enabledLines.length === 0 && enabledRegions.length === 0) return;

  // Use a safe ID suffix to avoid SVG marker collisions across tiles
  const mid = cameraId.replace(/[^a-zA-Z0-9_-]/g, '');

  let svgContent = `<defs>
    <marker id="lc-arr-${mid}" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="8" markerHeight="8" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="rgba(0,230,255,1)"/>
    </marker>
    <filter id="lc-glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

  // Render line crossing rules
  for (const line of enabledLines) {
    const [a, b] = line.coordinates;
    const x1 = a.x, y1 = 1000 - a.y;
    const x2 = b.x, y2 = 1000 - b.y;
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;

    // Perpendicular unit vectors for direction arrows
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const prX = dy / len, prY = -dx / len;   // right side of A→B
    const plX = -dy / len, plY = dx / len;   // left side of A→B

    const dir = line.direction || 'any';
    const lineOpacity = line.enabled ? '1' : '0.4';
    const lineDash = line.enabled ? '' : ' stroke-dasharray="10,5"';
    const glowFilter = line.enabled ? ' filter="url(#lc-glow)"' : '';

    // Main line — no endpoint markers, arrows are drawn perpendicular separately
    svgContent += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
      stroke="rgba(0,230,255,${lineOpacity})" stroke-width="5" stroke-linecap="round"${lineDash}${glowFilter}/>`;

    // Perpendicular crossing-direction arrows at midpoint. Drawn for BOTH enabled
    // and disabled rules (faded when off) so the direction (A→B / B→A / A↔B) is
    // always visible. 'any'/'both' → both sides; 'left-right' → A→B side only;
    // 'right-left' → B→A side only.
    const aLen = 110; // arrow length in SVG units
    const arrOpacity = line.enabled ? '0.95' : '0.45';
    const arrGlow = line.enabled ? ' filter="url(#lc-glow)"' : '';
    const drawDirArrow = (pX, pY) => {
      // Arrow starts at midpoint, extends outward — no overlap for "both" direction
      const ax2 = (mx + pX * aLen).toFixed(1), ay2 = (my + pY * aLen).toFixed(1);
      svgContent += `<line x1="${mx.toFixed(1)}" y1="${my.toFixed(1)}" x2="${ax2}" y2="${ay2}"
        stroke="rgba(0,230,255,${arrOpacity})" stroke-width="4" stroke-linecap="round"
        marker-end="url(#lc-arr-${mid})"${arrGlow}/>`;
    };
    // A→B (left-right) → LEFT perpendicular side; B→A (right-left) → right.
    // Kept identical to draw mode so the saved overlay matches what was drawn.
    if (dir === 'left-right' || dir === 'both' || dir === 'any') drawDirArrow(plX, plY);
    if (dir === 'right-left' || dir === 'both' || dir === 'any') drawDirArrow(prX, prY);

    // Label at midpoint — append "(off)" if rule is disabled
    const lineLabel = line.enabled ? `L${line.id}` : `L${line.id} (off)`;
    svgContent += `<text x="${mx}" y="${my - 15}" text-anchor="middle"
      fill="rgba(0,230,255,${line.enabled ? '1' : '0.5'})" stroke="rgba(0,0,0,0.85)" stroke-width="4"
      paint-order="stroke" font-size="30" font-weight="700">${lineLabel}</text>`;
  }

  // Render intrusion/loitering regions as polygons
  for (const region of enabledRegions) {
    const pts = region.coordinates.map(c => `${c.x},${1000 - c.y}`).join(' ');
    const regionOpacity = region.enabled ? '0.6' : '0.25';
    const regionFillOpacity = region.enabled ? '0.08' : '0.03';
    svgContent += `<polygon points="${pts}"
      fill="rgba(255,180,0,${regionFillOpacity})" stroke="rgba(255,180,0,${regionOpacity})" stroke-width="2"
      stroke-dasharray="8,4"/>`;

    // Label at centroid — append "(off)" if rule is disabled
    const cx = region.coordinates.reduce((s, c) => s + c.x, 0) / region.coordinates.length;
    const cy = region.coordinates.reduce((s, c) => s + (1000 - c.y), 0) / region.coordinates.length;
    const regionLabel = region.enabled ? `R${region.id}` : `R${region.id} (off)`;
    svgContent += `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central"
      fill="rgba(255,180,0,${region.enabled ? '0.9' : '0.45'})" stroke="rgba(0,0,0,0.7)" stroke-width="3"
      paint-order="stroke" font-size="26" font-weight="700">${regionLabel}</text>`;
  }

  const wrapper = document.createElement('div');
  wrapper.className = 'tile-line-overlay';
  wrapper.innerHTML = `<svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${svgContent}</svg>`;
  tile.appendChild(wrapper);
}

// ── Draw Mode Helpers ─────────────────────────────────────────────────────────

/**
 * Convert a mouse event to SVG coordinate space (0-1000 viewBox).
 */
function _svgCoordFromEvent(svgEl, evt) {
  const pt = svgEl.createSVGPoint();
  pt.x = evt.clientX;
  pt.y = evt.clientY;
  const ctm = svgEl.getScreenCTM();
  if (!ctm) return null;
  const sp = pt.matrixTransform(ctm.inverse());
  return { x: Math.round(Math.max(0, Math.min(1000, sp.x))), y: Math.round(Math.max(0, Math.min(1000, sp.y))) };
}

/**
 * Update the draw SVG with current points and a hint text.
 */
function _updateDrawSvg(svgEl, state, hint) {
  const hasTwoPoints = !!(state.points[0] && state.points[1]);
  let defs = '';
  let html = '';

  if (hasTwoPoints) {
    defs = `<defs>
      <marker id="draw-arr" viewBox="0 0 10 10" refX="9" refY="5"
        markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 z" fill="rgba(255,230,0,1)"/>
      </marker>
    </defs>`;
  }

  if (hint) {
    html += `<text x="500" y="55" text-anchor="middle"
      fill="rgba(255,255,0,0.95)" stroke="rgba(0,0,0,0.8)" stroke-width="4" paint-order="stroke"
      font-size="34" font-weight="700">${hint}</text>`;
  }
  if (state.points[0]) {
    const p = state.points[0];
    html += `<circle cx="${p.x}" cy="${p.y}" r="14" fill="rgba(255,230,0,0.95)" stroke="rgba(0,0,0,0.7)" stroke-width="3"/>`;
  }
  if (hasTwoPoints) {
    const a = state.points[0], b = state.points[1];
    const ddx = b.x - a.x, ddy = b.y - a.y;
    const dlen = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
    const pmx = (a.x + b.x) / 2, pmy = (a.y + b.y) / 2;
    const prX = ddy / dlen, prY = -ddx / dlen;  // perpendicular right of A→B
    const plX = -ddy / dlen, plY = ddx / dlen;  // perpendicular left
    const aLen = 100;
    const dir = state.direction || 'any';

    html += `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}"
      stroke="rgba(255,230,0,0.9)" stroke-width="4" stroke-dasharray="14,5" stroke-linecap="round"/>`;

    // Direction arrows — each starts at midpoint, goes outward to its side
    const drawArrow = (pX, pY) => {
      html += `<line x1="${pmx.toFixed(1)}" y1="${pmy.toFixed(1)}"
        x2="${(pmx + pX * aLen).toFixed(1)}" y2="${(pmy + pY * aLen).toFixed(1)}"
        stroke="rgba(255,230,0,0.95)" stroke-width="3" stroke-linecap="round"
        marker-end="url(#draw-arr)"/>`;
    };
    // A→B (left-right) → LEFT perpendicular side; B→A (right-left) → right.
    // (Was swapped — the arrow pointed opposite to the selected direction.)
    if (dir === 'any' || dir === 'both' || dir === 'left-right') drawArrow(plX, plY);
    if (dir === 'any' || dir === 'both' || dir === 'right-left') drawArrow(prX, prY);

    html += `<circle cx="${b.x}" cy="${b.y}" r="14" fill="rgba(255,230,0,0.95)" stroke="rgba(0,0,0,0.7)" stroke-width="3"/>`;
  }
  svgEl.innerHTML = defs + html;
}

/**
 * Enter line draw mode on a tile.
 */
function _enterDrawMode(tile, index, camId) {
  _tileDrawMode[index] = { camId, points: [], direction: 'any' };

  const drawOverlay = document.createElement('div');
  drawOverlay.className = 'tile-draw-overlay';
  drawOverlay.innerHTML = `
    <svg class="draw-svg" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
    <div class="draw-toolbar">
      <div class="draw-dir-group">
        <button class="draw-dir-btn active" data-dir="any" title="Trigger on both directions">&#8596; Both</button>
        <button class="draw-dir-btn" data-dir="left-right" title="Trigger A to B only">A&#8594;B</button>
        <button class="draw-dir-btn" data-dir="right-left" title="Trigger B to A only">B&#8594;A</button>
      </div>
      <button class="draw-cancel-btn">Cancel</button>
    </div>`;
  tile.appendChild(drawOverlay);

  // Direction button logic
  drawOverlay.querySelectorAll('.draw-dir-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const state = _tileDrawMode[index];
      if (!state) return;
      state.direction = btn.dataset.dir;
      drawOverlay.querySelectorAll('.draw-dir-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      // Redraw preview arrows when direction changes (only if line is already drawn)
      if (state.points.length >= 2) {
        _updateDrawSvg(drawOverlay.querySelector('.draw-svg'), state, null);
      }
    });
  });

  const svgEl = drawOverlay.querySelector('.draw-svg');
  _updateDrawSvg(svgEl, _tileDrawMode[index], 'Click point 1');

  svgEl.addEventListener('click', (evt) => {
    const state = _tileDrawMode[index];
    if (!state) return;
    const coord = _svgCoordFromEvent(svgEl, evt);
    if (!coord) return;
    state.points.push(coord);
    if (state.points.length === 1) {
      _updateDrawSvg(svgEl, state, 'Click point 2');
    } else if (state.points.length >= 2) {
      _updateDrawSvg(svgEl, state, null);
      // Show Save button (once only)
      const toolbar = drawOverlay.querySelector('.draw-toolbar');
      if (!toolbar.querySelector('.draw-save-btn')) {
        const saveBtn = document.createElement('button');
        saveBtn.className = 'draw-save-btn';
        saveBtn.textContent = 'Save';
        saveBtn.addEventListener('click', () => {
          const [p1, p2] = state.points;
          // Convert SVG Y → Hikvision Y (Y-flip: hikY = 1000 - svgY)
          _saveDrawnLine(state.camId, p1.x, 1000 - p1.y, p2.x, 1000 - p2.y, state.direction, tile, index);
        });
        toolbar.insertBefore(saveBtn, toolbar.querySelector('.draw-cancel-btn'));
      }
    }
  });

  drawOverlay.querySelector('.draw-cancel-btn').addEventListener('click', () => _exitDrawMode(tile, index));

  const drawBtn = tile.querySelector('[data-action="draw-line"]');
  if (drawBtn) drawBtn.classList.add('active');
}

/**
 * Exit draw mode and clean up.
 */
function _exitDrawMode(tile, index) {
  delete _tileDrawMode[index];
  const overlay = tile.querySelector('.tile-draw-overlay');
  if (overlay) overlay.remove();
  const drawBtn = tile.querySelector('[data-action="draw-line"]');
  if (drawBtn) drawBtn.classList.remove('active');
}

/**
 * Send drawn line coordinates to camera via ISAPI and refresh overlay.
 * Coordinates are already in Hikvision space (Y-flipped from SVG).
 */
async function _saveDrawnLine(camId, x1, y1, x2, y2, direction, tile, index) {
  try {
    const res = await fetch(`/api/detection/line-draw/${encodeURIComponent(camId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x1, y1, x2, y2, direction }),
    });
    const data = await res.json();
    if (data.error) { console.warn('[draw] Save failed:', data.error); return; }
    _exitDrawMode(tile, index);
    // Refresh line overlay with new coordinates
    delete _lineConfigCache[camId];
    fetchLineConfig(camId).then(cfg => {
      if (cfg && tile.isConnected && tileLineOverlay[index] !== false) {
        renderLineOverlay(tile, camId);
      }
    });
    // Also sync checkbox to enabled
    const cam = cameras.find(c => c.id === camId);
    if (cam) {
      const cell = _ensureCellCfg(camId, 'line');
      cell.enabled = true;
      if (cell.source === 'auto') cell.source = 'edge';
      saveAnalytics();
      renderAnalyticsTab();
    }
  } catch (e) {
    console.warn('[draw] Save error:', e);
  }
}

// resolveSource(cameraId, detectorId) -> { boundTo, pinned, reason, sleeping }
// boundTo:  'edge' | 'server' | 'pending' | 'off'
// pinned:   true when the user explicitly picked edge/server (source !== 'auto')
// reason:   human-readable explanation (drives the popover's "Why this" line)
// sleeping: true when the cell is enabled and has a valid source but is
//           currently outside its schedule window. Note that boundTo still
//           reflects the would-be source ('edge' / 'server') — sleeping is
//           an orthogonal axis so the matrix/popover can present source
//           binding and schedule state independently. The simulator skips
//           any cell where sleeping === true.
function resolveSource(cameraId, detectorId) {
  const camCfg = analyticsConfig[cameraId];
  const cfg = camCfg ? camCfg[detectorId] : null;
  if (!cfg || !cfg.enabled) {
    return { boundTo: 'off', pinned: false, reason: '', sleeping: false };
  }
  const source = cfg.source || 'auto';
  const pinned = source !== 'auto';
  const caps = cameraCapabilities[cameraId] || {};
  const det = DETECTOR_BY_ID[detectorId];
  const label = det ? det.label : detectorId;
  const labelLower = label.toLowerCase();
  const edgeOk = !!caps[detectorId];
  const serverOk = !!serverDetectors[detectorId];

  // Phase 2: schedule decoration. We compute it once and attach to the
  // returned object so consumers (matrix render, sidebar dot, simulator)
  // can short-circuit on .sleeping without re-evaluating the schedule.
  const schedule = getSchedule(cameraId, detectorId);
  const sleeping = !isWithinSchedule(schedule);

  // Phase 2: per-camera default source. When the cell's intent is 'auto'
  // and the camera carries a non-auto default, treat that as the effective
  // intent. Per-cell pins (source !== 'auto') still win.
  const camDefault = camCfg && camCfg._cameraDefault
    ? (camCfg._cameraDefault.source || 'auto')
    : 'auto';
  const reasonScope = source === 'auto' && camDefault !== 'auto'
    ? `Camera default is ${camDefault === 'edge' ? 'Edge' : 'Server'}.`
    : null;
  const effective = source === 'auto' ? camDefault : source;

  const decorate = (out) => ({ ...out, sleeping });

  if (effective === 'edge') {
    if (edgeOk) {
      const reason = reasonScope || (source === 'edge'
        ? `Pinned to Edge (Hardware) by user.`
        : `Hardware supports ${labelLower}; Auto → Edge (Hardware).`);
      return decorate({ boundTo: 'edge', pinned: source === 'edge', reason });
    }
    if (source === 'edge') {
      return decorate({ boundTo: 'pending', pinned: true,
        reason: `Hardware does not support ${labelLower} — Edge not available on this device.` });
    }
    // Camera-default-edge with no edge support → fall through to server/pending.
  }
  if (effective === 'server') {
    if (serverOk) {
      const reason = reasonScope || (source === 'server'
        ? `Pinned to Server (Software) by user.`
        : `Hardware lacks ${labelLower}; falling back to Server (Software).`);
      return decorate({ boundTo: 'server', pinned: source === 'server', reason });
    }
    if (source === 'server') {
      return decorate({ boundTo: 'pending', pinned: true,
        reason: `Server (Software) ${labelLower} detection is not enabled globally.` });
    }
  }
  // source === 'auto' and either camera-default = auto, or its preferred source
  // is unavailable — fall back to the original Auto rule:
  //   Auto = check hardware (Edge) support → if supported use Edge, otherwise fallback to Server (Software).
  if (edgeOk) {
    return decorate({ boundTo: 'edge', pinned: false,
      reason: `Hardware supports ${labelLower}; Auto → Edge (Hardware).` });
  }
  if (serverOk) {
    return decorate({ boundTo: 'server', pinned: false,
      reason: `Hardware does not support ${labelLower}; Auto → Server (Software).` });
  }
  return decorate({
    boundTo: 'pending',
    pinned: false,
    reason: `No source available — hardware does not support ${labelLower} and server ${labelLower} is disabled globally.`
  });
}

function loadCustomGroups() {
  try {
    const data = JSON.parse(localStorage.getItem('go2rtc-custom-groups'));
    if (Array.isArray(data)) customGroups = data;
  } catch(e) {}
}

function saveCustomGroups() {
  localStorage.setItem('go2rtc-custom-groups', JSON.stringify(customGroups));
}

// Drop leftover custom groups that have no cameras — these accumulate from old
// sessions / deleted cameras and show up as empty "dummy" groups. A group is
// kept only while at least one camera references it.
function pruneEmptyCustomGroups() {
  const used = new Set(cameras.map(c => c.group));
  const before = customGroups.length;
  customGroups = customGroups.filter(g => used.has(g.name));
  if (customGroups.length !== before) saveCustomGroups();
}

function getGroupColor(name) {
  if (GROUP_COLORS[name]) return GROUP_COLORS[name];
  const cg = customGroups.find(g => g.name === name);
  return cg ? cg.color : '#6b7280';
}

function getAllGroupNames() {
  return [...BUILTIN_GROUPS, ...customGroups.map(g => g.name)];
}

const FOCUS_LAYOUTS = [
  { id:'focus-1-5',  label:'1+5',  cols:3, rows:3, total:6,
    spans:[{index:0, colSpan:2, rowSpan:2}] },
  { id:'focus-1-12', label:'1+12', cols:4, rows:4, total:13,
    spans:[{index:0, colSpan:2, rowSpan:2}] },
  { id:'focus-2-4',  label:'2+4',  cols:4, rows:3, total:6,
    spans:[{index:0, colSpan:2, rowSpan:2},{index:1, colSpan:2, rowSpan:2}] },
  { id:'focus-2-12', label:'2+12', cols:4, rows:5, total:14,
    spans:[{index:0, colSpan:2, rowSpan:2},{index:1, colSpan:2, rowSpan:2}] },
];

const collapsedGroups = new Set();

let cameras = [];
let camIdCounter = 0;

// Fetch cameras from backend API
async function loadCamerasFromAPI() {
  try {
    const res = await fetch('/api/cameras');
    if (res.ok) {
      const apiCameras = await res.json();
      if (apiCameras.length > 0) {
        cameras = apiCameras.map(c => ({
          id: c.id,
          name: c.name || 'Camera',
          group: c.group || 'Default',
          // Honor the backend's classification ('nvr'/'dvr' = recorder channel,
          // 'ip' = standalone). Keep the frontend's own 'ipcamera' label for the
          // standalone case so the Add/Edit form's device toggle stays consistent.
          deviceType: (c.deviceType === 'nvr' || c.deviceType === 'dvr') ? c.deviceType : 'ipcamera',
          recorderId: c.recorderId || null,        // which NVR/DVR this channel belongs to
          recorderName: c.recorderName || null,    // the recorder's display name
          sourceIp: c.sourceIp || null,            // the underlying camera IP behind the NVR
          brand: 'hikvision',
          ip: c.ip || '',
          isapiPort: c.isapiPort || null,
          username: c.username || 'admin',
          password: '',
          rtspPort: c.port || 554,
          webPort: c.isapiPort || 80,
          streamPath: c.rtspPath || '/Streaming/Channels/',
          thumbnailUrl: '',
          status: c.status || 'unknown',
          hwCapabilities: c.hwCapabilities || null
        }));
        camIdCounter = cameras.length;
        // Auto-create groups from API cameras
        const knownGroups = new Set([...BUILTIN_GROUPS, ...customGroups.map(g => g.name)]);
        let colorIdx = 0;
        cameras.forEach(c => {
          if (c.group && !knownGroups.has(c.group)) {
            customGroups.push({ name: c.group, color: GROUP_COLOR_PALETTE[colorIdx % GROUP_COLOR_PALETTE.length] });
            knownGroups.add(c.group);
            colorIdx++;
          }
        });
        if (colorIdx > 0) saveCustomGroups();
        buildCameraCapabilities();
        return true;
      }
    }
  } catch (e) {
    console.warn('Failed to load cameras from API:', e.message);
  }
  return false;
}

// Start empty — the real camera list is loaded from the backend API in the async
// init below. No simulated/dummy cameras: an empty backend means an empty grid.
cameras = [];
camIdCounter = 0;
buildCameraCapabilities();

/* ── RTSP URL assembly & helpers ── */
// Hikvision channels are <channel><stream>: 101 = CH1 main, 102 = CH1 sub.
// The form's default path "/Streaming/Channels/" has no channel number and makes
// FFmpeg fail with "400 Bad Request". Auto-complete it to channel 1 main (101).
function normalizeStreamPath(rawPath) {
  let p = (rawPath || '').trim();
  if (!p) return '/Streaming/Channels/101';
  if (!p.startsWith('/')) p = '/' + p;
  if (/\/Streaming\/Channels\/?$/i.test(p)) {
    p = p.replace(/\/+$/, '') + '/101';
  }
  return p;
}

// Derive the Hikvision channel number from a stream path so detection/playback
// target the right channel: 101 → "1", 602 → "6". Defaults to "1".
function channelIdFromPath(rtspPath) {
  const m = (rtspPath || '').match(/\/Streaming\/Channels\/(\d+)/i);
  if (!m) return '1';
  const num = parseInt(m[1], 10);
  return String(Math.floor(num / 100) || num || 1);
}

function assembleRtspUrl(cam) {
  const user = cam.username || '';
  const pass = cam.password || '';
  const ip = cam.ip || '0.0.0.0';
  const port = cam.rtspPort || 554;
  const path = cam.streamPath || '/Streaming/Channels/';
  const auth = (user || pass) ? `${user}:${pass}@` : '';
  return `rtsp://${auth}${ip}:${port}${path}`;
}

function maskPassword(pass) {
  if (!pass) return '';
  return '\u2022'.repeat(Math.min(pass.length, 8));
}

function assembleRtspUrlMasked(cam) {
  const user = cam.username || '';
  const pass = cam.password || '';
  const ip = cam.ip || '0.0.0.0';
  const port = cam.rtspPort || 554;
  const path = cam.streamPath || '/Streaming/Channels/';
  const masked = pass ? maskPassword(pass) : '';
  const auth = (user || masked) ? `${user}:${masked}@` : '';
  return `rtsp://${auth}${ip}:${port}${path}`;
}

function updateRtspPreview() {
  const preview = document.getElementById('rtsp-preview');
  if (!preview) return;
  const cam = readFormFields();
  preview.textContent = assembleRtspUrlMasked(cam);
}

function readFormFields() {
  const deviceBtns = document.querySelectorAll('#cam-form-view .seg-btn[data-device]');
  let deviceType = 'ipcamera';
  deviceBtns.forEach(b => { if (b.classList.contains('active')) deviceType = b.dataset.device; });
  return {
    deviceType,
    brand: document.getElementById('cam-add-brand').value,
    ip: document.getElementById('cam-add-ip').value.trim(),
    username: document.getElementById('cam-add-user').value.trim(),
    password: document.getElementById('cam-add-pass').value,
    rtspPort: parseInt(document.getElementById('cam-add-rtsp-port').value, 10) || 554,
    webPort: parseInt(document.getElementById('cam-add-web-port').value, 10) || 80,
    streamPath: normalizeStreamPath(document.getElementById('cam-add-stream-path').value),
    name: document.getElementById('cam-add-name').value.trim(),
    group: document.getElementById('cam-add-group').value,
    thumbnailUrl: document.getElementById('cam-add-thumb').value.trim()
  };
}

function parseRtspUrl(url) {
  const m = url.match(/^rtsp:\/\/(?:([^:@]+):([^@]+)@)?([^:\/]+)(?::(\d+))?(\/.*)?$/);
  if (!m) return { ip: '', username: '', password: '', rtspPort: 554, streamPath: '/Streaming/Channels/' };
  return {
    username: m[1] || '',
    password: m[2] || '',
    ip: m[3] || '',
    rtspPort: parseInt(m[4], 10) || 554,
    streamPath: m[5] || '/Streaming/Channels/'
  };
}

// Backward compat: convert old camera format (url field) to new structured fields
function migrateCameraData(cam) {
  if (cam.ip) return cam; // already new format
  if (cam.url) {
    const parsed = parseRtspUrl(cam.url);
    cam.deviceType = cam.deviceType || 'ipcamera';
    cam.brand = cam.brand || 'hikvision';
    cam.ip = parsed.ip;
    cam.username = parsed.username;
    cam.password = parsed.password;
    cam.rtspPort = parsed.rtspPort;
    cam.webPort = cam.webPort || 80;
    cam.streamPath = parsed.streamPath;
    cam.thumbnailUrl = cam.thumbnailUrl || '';
    delete cam.url;
  }
  return cam;
}

function camImage(id) {
  return `/api/cameras/${encodeURIComponent(id)}/thumbnail`;
}

/* ══════════════════════════════════════════
   State
   ══════════════════════════════════════════ */
let gridSize = 3;
let activeLayout = { type: 'uniform', size: gridSize };
let tileAssignments = {};   // tileIndex -> cameraId
let tileHqState = {};       // tileIndex -> boolean (persistent HQ toggle)
let tileAudioState = {};    // tileIndex -> boolean
let tileAutoHq = {};        // tileIndex -> boolean (auto-promoted HQ on focus)
let focusedTile = null;
let focusAutoHqIndex = null;  // tile that was auto-promoted to HQ on expand

// Effective HQ (MAIN vs SUB) for a tile: an explicit per-tile toggle wins;
// otherwise a freshly-placed tile follows the global "Default Stream Quality"
// setting (Settings → Streams). main = HQ, sub = not HQ.
function tileIsHq(index) {
  if (index in tileHqState) return !!tileHqState[index];
  return settings.defaultQuality === 'main';
}

// Swap two keys in a plain index→value map. Missing keys stay missing (so a tile
// that follows the global default isn't pinned to an explicit value after a swap).
function _swapKey(map, a, b) {
  const hasA = a in map, hasB = b in map;
  const va = map[a], vb = map[b];
  if (hasB) map[a] = vb; else delete map[a];
  if (hasA) map[b] = va; else delete map[b];
}
let selectedTileIndex = null; // keyboard-selected tile
let allMuted = false;
let maxStreams = 36;

/* Settings state */
let settings = {
  defaultQuality: 'sub',
  maxStreams: 36,
  reconnectInterval: 5,
  audioDefault: false,
  gridGap: 4,
  showNames: true,
  showLive: true,
  aspectRatio: '16/9',
  animSpeed: '0.25s',
  streamProtocol: 'webrtc',
  sidebarCollapsed: false,
  // Phase 2: set to true once the user picks "Manual Matrix" or dismisses
  // the wizard. The wizard re-opens only when explicitly re-launched.
  analyticsWizardDismissed: false
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('go2rtc-settings'));
    if (s) Object.assign(settings, s);
  } catch(e) {}
  applySettings();
}

function saveSettings() {
  localStorage.setItem('go2rtc-settings', JSON.stringify(settings));
  applySettings();
}

/* ── Dashboard auto-persistence ──────────────────────────────────
   The current grid arrangement (size, layout, which camera sits in which tile,
   per-tile HQ/audio) is saved to the backend (dashboard.json) so it auto-loads
   on page reload AND when the engine is restarted. */
let _dashboardReady = false;   // gate: don't persist until the saved layout is applied
let _dashboardSaveTimer = null;

function persistDashboard() {
  if (!_dashboardReady) return; // avoid clobbering saved data during initial load
  clearTimeout(_dashboardSaveTimer);
  _dashboardSaveTimer = setTimeout(() => {
    const payload = {
      gridSize,
      activeLayout: { ...activeLayout },
      tileAssignments: { ...tileAssignments },
      tileHqState: { ...tileHqState },
      tileAudioState: { ...tileAudioState },
      savedAt: new Date().toISOString(),
    };
    fetch('/api/dashboard', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(e => console.warn('Dashboard save failed:', e.message));
  }, 400);
}

// Fetch + apply the saved dashboard. Tile assignments are filtered to cameras
// that still exist (a camera may have been deleted since the layout was saved).
async function loadDashboardFromAPI() {
  try {
    const res = await fetch('/api/dashboard');
    if (!res.ok) return;
    const data = await res.json();
    if (!data || !data.activeLayout) return;

    if (data.activeLayout.type === 'focus') {
      activeLayout = { ...data.activeLayout };
    } else {
      gridSize = data.gridSize || data.activeLayout.size || gridSize;
      activeLayout = { type: 'uniform', size: gridSize };
    }

    const validIds = new Set(cameras.map(c => c.id));
    tileAssignments = {};
    tileHqState = {};
    tileAudioState = {};
    for (const [idx, camId] of Object.entries(data.tileAssignments || {})) {
      if (!validIds.has(camId)) continue;       // skip cameras that no longer exist
      tileAssignments[idx] = camId;
      if (data.tileHqState && data.tileHqState[idx]) tileHqState[idx] = true;
      if (data.tileAudioState && data.tileAudioState[idx]) tileAudioState[idx] = true;
    }

    // Reflect the restored layout on the preset buttons, if present.
    const presets = document.getElementById('grid-presets');
    if (presets) {
      presets.querySelectorAll('button[data-size]').forEach(b =>
        b.classList.toggle('active', activeLayout.type === 'uniform' && +b.dataset.size === activeLayout.size));
      presets.querySelectorAll('button.focus-preset').forEach(b =>
        b.classList.toggle('active', activeLayout.type === 'focus' && b.dataset.focusId === activeLayout.id));
    }
  } catch (e) {
    console.warn('Failed to load dashboard from API:', e.message);
  }
}

function applySettings() {
  maxStreams = settings.maxStreams;
  document.documentElement.style.setProperty('--grid-gap', settings.gridGap + 'px');
  document.documentElement.style.setProperty('--anim-speed', settings.animSpeed);
  updateBudget();
  updateProtocolBadge();
  document.querySelectorAll('.tile').forEach(t => {
    const nameEl = t.querySelector('.tile-name');
    if (nameEl) nameEl.style.display = settings.showNames ? '' : 'none';
    const liveEl = t.querySelector('.live-badge');
    if (liveEl) liveEl.style.display = settings.showLive ? '' : 'none';
  });
  document.getElementById('app').classList.toggle('sidebar-collapsed', settings.sidebarCollapsed);
  const collapseBtn = document.getElementById('sidebar-collapse-btn');
  if (collapseBtn) {
    const label = settings.sidebarCollapsed ? 'Expand sidebar (B)' : 'Collapse sidebar (B)';
    collapseBtn.setAttribute('aria-expanded', String(!settings.sidebarCollapsed));
    collapseBtn.setAttribute('aria-label', label);
    collapseBtn.title = label;
  }
}

/* ── Protocol Badge (top bar) ── */
function updateProtocolBadge() {
  const badgeEl = document.getElementById('protocol-badge');
  const protoEl = document.getElementById('protocol-badge-proto');
  const qualityEl = document.getElementById('protocol-badge-quality');
  if (!badgeEl || !protoEl || !qualityEl) return;

  const requested = settings.streamProtocol || 'webrtc';
  const quality = settings.defaultQuality || 'sub';
  // Show the EFFECTIVE protocol: if WebRTC is selected but go2rtc is unavailable,
  // streams actually run on MJPEG — reflect that instead of lying with "WEBRTC".
  const effective = (typeof StreamAdapter !== 'undefined' && StreamAdapter.getEffectiveProtocol)
    ? StreamAdapter.getEffectiveProtocol(requested) : requested;
  const fellBack = effective !== requested;

  protoEl.textContent = fellBack
    ? `${requested.toUpperCase()}→${effective.toUpperCase()}`
    : effective.toUpperCase();
  protoEl.title = fellBack ? 'go2rtc unavailable — using MJPEG fallback' : '';
  qualityEl.textContent = quality.toUpperCase();

  // Style variants — color by the protocol actually in use.
  badgeEl.classList.toggle('protocol-mjpeg', effective === 'mjpeg');
  badgeEl.classList.toggle('protocol-fallback', fellBack);
  qualityEl.classList.toggle('quality-main', quality === 'main');
}

// go2rtc availability resolved/changed asynchronously → refresh the badge.
document.addEventListener('streamprotocolchange', updateProtocolBadge);

/* ══════════════════════════════════════════
   Sidebar
   ══════════════════════════════════════════ */
const cameraListEl = document.getElementById('camera-list');
const searchInput = document.getElementById('search-input');
const searchClear = document.getElementById('search-clear');

/* ── Phase 2: per-camera analytics dot for the sidebar ───────────────────
   Returns { state, glyph, title } describing the camera's analytics state.
   Precedence (highest first):
     errored      ●⚠   any cell explicitly Errored
     pending      ●⚠   any enabled cell currently Pending
     recent       ●!   any event fired in the last 60 s
     sleeping     ●💤  at least one cell is Sleeping (no armed-idle cells)
     armed        ●    at least one cell Armed
     none         ○    no cells enabled
*/
const _SIDEBAR_RECENT_WINDOW_MS = 60000;

function _computeCameraAnalyticsDot(cameraId) {
  const camCfg = analyticsConfig[cameraId];
  if (!camCfg) return { state: 'none', glyph: '○', title: 'No analytics configured.' };

  let hasArmed = false, hasSleeping = false, hasPending = false, hasErrored = false;
  const armedLabels = [];
  const sleepingLabels = [];
  for (const det of DETECTORS) {
    if (det.id.startsWith('_')) continue;
    const cfg = camCfg[det.id];
    if (!cfg || !cfg.enabled) continue;
    if (cfg.state === 'errored') { hasErrored = true; continue; }
    const info = resolveSource(cameraId, det.id);
    if (info.boundTo === 'pending') { hasPending = true; continue; }
    if (info.boundTo === 'errored') { hasErrored = true; continue; }
    if (info.boundTo === 'off') continue;
    if (info.sleeping) { hasSleeping = true; sleepingLabels.push(det.label); continue; }
    hasArmed = true;
    armedLabels.push(det.label);
  }

  if (!hasArmed && !hasSleeping && !hasPending && !hasErrored) {
    return { state: 'none', glyph: '○', title: 'No analytics configured.' };
  }
  if (hasErrored) {
    return { state: 'errored', glyph: '●⚠', title: 'Errored detector — needs attention.' };
  }
  if (hasPending) {
    return { state: 'pending', glyph: '●⚠', title: 'Pending detector — source unavailable.' };
  }

  const recentTs = _camRecentEventAt.get(cameraId);
  if (recentTs && (Date.now() - recentTs) < _SIDEBAR_RECENT_WINDOW_MS) {
    return {
      state: 'recent',
      glyph: '●!',
      title: armedLabels.length ? `Recent event. Armed: ${armedLabels.join(', ')}` : 'Recent event.'
    };
  }
  if (hasArmed) {
    return { state: 'armed', glyph: '●', title: `Armed: ${armedLabels.join(', ')}` };
  }
  return {
    state: 'sleep',
    glyph: '●💤',
    title: sleepingLabels.length
      ? `Sleeping (schedule): ${sleepingLabels.join(', ')}`
      : 'Sleeping — outside schedule window.'
  };
}

function renderSidebar() {
  cameraListEl.innerHTML = '';
  const q = searchInput.value.toLowerCase();
  searchClear.style.display = q ? 'flex' : 'none';

  const grouped = {};
  cameras.forEach((c, globalIdx) => {
    if (q && !c.name.toLowerCase().includes(q) && !c.group.toLowerCase().includes(q)) return;
    if (!grouped[c.group]) grouped[c.group] = [];
    grouped[c.group].push({ cam: c, idx: globalIdx });
  });

  let hasItems = false;
  for (const [group, entries] of Object.entries(grouped)) {
    const dotColor = getGroupColor(group);
    const isCollapsed = collapsedGroups.has(group) && !q;

    // Group header
    const label = document.createElement('div');
    label.className = 'cam-group-label' + (isCollapsed ? ' collapsed' : '');
    label.setAttribute('role', 'button');
    label.setAttribute('aria-expanded', String(!isCollapsed));
    label.innerHTML = `<span class="grp-dot" style="background:${dotColor}"></span>${esc(group)}<span class="grp-chevron">&#9660;</span>`;

    // Group body wrapper
    const body = document.createElement('div');
    body.className = 'cam-group-body' + (isCollapsed ? ' collapsed' : '');
    body.style.maxHeight = isCollapsed ? '0' : (entries.length * 40) + 'px';

    label.addEventListener('click', () => {
      if (q) return; // don't collapse when searching
      if (collapsedGroups.has(group)) {
        collapsedGroups.delete(group);
        label.classList.remove('collapsed');
        label.setAttribute('aria-expanded', 'true');
        body.style.maxHeight = (entries.length * 40) + 'px';
        body.classList.remove('collapsed');
      } else {
        collapsedGroups.add(group);
        label.classList.add('collapsed');
        label.setAttribute('aria-expanded', 'false');
        body.style.maxHeight = '0';
        body.classList.add('collapsed');
      }
    });

    cameraListEl.appendChild(label);

    for (const { cam, idx } of entries) {
      hasItems = true;
      const item = document.createElement('div');
      item.className = 'cam-item';
      item.draggable = true;
      item.tabIndex = 0;
      item.setAttribute('role', 'listitem');
      item.setAttribute('aria-label', `${cam.name}, ${cam.group}. Drag or press Enter to assign.`);
      item.dataset.camId = cam.id;
      // Phase 2: per-camera analytics dot.
      const ana = _computeCameraAnalyticsDot(cam.id);
      const anaTitle = esc(ana.title);
      const anaHtml = `<span class="cam-analytics-dot ana-state-${ana.state}" data-analytics-dot="${esc(cam.id)}" title="${anaTitle}" aria-label="${anaTitle}">${ana.glyph}</span>`;
      const dt = (cam.deviceType || 'ip').toLowerCase();
      const dtLabel = dt === 'nvr' ? 'NVR' : dt === 'dvr' ? 'DVR' : 'IP';
      const dtTitle = (dt === 'nvr' || dt === 'dvr')
        ? `${dtLabel} channel — playback from recorder storage`
        : 'Standalone IP camera — playback from on-camera SD (if any)';
      const dtHtml = `<span class="cam-type cam-type-${dt}" title="${esc(dtTitle)}">${dtLabel}</span>`;
      item.innerHTML = `<span class="cam-dot status-${cam.status}"></span>${anaHtml}<span class="cam-name">${highlightMatch(cam.name, q)}</span>${dtHtml}<span class="cam-num">#${idx + 1}</span><span class="cam-drag-hint">&#8942;&#8942;</span>`;

      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('text/plain', cam.id);
        e.dataTransfer.effectAllowed = 'copy';
        item.classList.add('dragging');
        setTimeout(() => item.classList.remove('dragging'), 200);
      });

      // Clicking the analytics dot opens the per-tile analytics popover
      // even if the camera isn't currently on the grid (anchored to the
      // dot in the sidebar). Stop propagation so it doesn't also trigger
      // the camera-item's drag/keyboard wiring.
      const anaDot = item.querySelector('[data-analytics-dot]');
      if (anaDot) {
        anaDot.addEventListener('click', e => {
          e.stopPropagation();
          e.preventDefault();
          openTileAnalyticsPopover(cam.id, anaDot);
        });
      }

      // Keyboard: Enter to assign to first empty tile
      item.addEventListener('keydown', e => {
        if (e.key === 'Enter') assignCamToFirstEmpty(cam);
      });

      // Touch/mobile: drag-and-drop is impractical, so a tap assigns the camera
      // to the first empty tile and closes the off-canvas sidebar.
      item.addEventListener('click', e => {
        if (e.defaultPrevented) return;                 // analytics dot handled it
        if (!window.matchMedia('(max-width:768px)').matches) return;  // desktop keeps drag
        assignCamToFirstEmpty(cam);
        closeMobileSidebarIfNarrow();
      });

      body.appendChild(item);
    }

    cameraListEl.appendChild(body);
  }

  if (!hasItems && q) {
    const noRes = document.createElement('div');
    noRes.className = 'no-results';
    noRes.textContent = `No cameras matching "${searchInput.value}"`;
    cameraListEl.appendChild(noRes);
  }
}

// Debounce the per-keystroke sidebar rebuild (renderSidebar walks every group +
// camera + analytics dot) so fast typing doesn't thrash layout.
let _sidebarSearchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(_sidebarSearchTimer);
  _sidebarSearchTimer = setTimeout(renderSidebar, 120);
});
searchClear.addEventListener('click', () => { searchInput.value = ''; renderSidebar(); searchInput.focus(); });

// Sidebar toggle for mobile (off-canvas) + tap-to-close backdrop
function setMobileSidebar(open) {
  const sb = document.getElementById('sidebar');
  const bd = document.getElementById('sidebar-backdrop');
  sb.classList.toggle('open', open);
  if (bd) bd.classList.toggle('show', open);
}
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  const sb = document.getElementById('sidebar');
  setMobileSidebar(!sb.classList.contains('open'));
});
(function () {
  const bd = document.getElementById('sidebar-backdrop');
  if (bd) bd.addEventListener('click', () => setMobileSidebar(false));
})();
// On a phone/tablet, close the off-canvas sidebar after a camera is picked.
function closeMobileSidebarIfNarrow() {
  if (window.matchMedia('(max-width:768px)').matches) setMobileSidebar(false);
}
// Assign a camera to the first empty tile (shared by Enter key + mobile tap).
function assignCamToFirstEmpty(cam) {
  if (Object.values(tileAssignments).includes(cam.id)) {
    showToast('Camera already on grid', true);
    return;
  }
  const total = getLayoutTotal();
  for (let i = 0; i < total; i++) {
    if (!tileAssignments[i]) {
      if (checkBudget()) return;
      tileAssignments[i] = cam.id;
      renderGrid();
      showToast(`${cam.name} assigned to tile ${i + 1}`);
      return;
    }
  }
  showToast('No empty tile — increase the grid size', true);
}

// Sidebar collapse for desktop
function toggleSidebarCollapsed() {
  settings.sidebarCollapsed = !settings.sidebarCollapsed;
  saveSettings();
}
document.getElementById('sidebar-collapse-btn').addEventListener('click', toggleSidebarCollapsed);

renderSidebar();

/* ══════════════════════════════════════════
   Grid Presets
   ══════════════════════════════════════════ */
const presetsEl = document.getElementById('grid-presets');
for (let i = 1; i <= 6; i++) {
  const btn = document.createElement('button');
  btn.textContent = `${i}\u00D7${i}`;
  btn.dataset.size = i;
  if (i === gridSize) btn.classList.add('active');
  btn.addEventListener('click', () => setGridSize(i));
  presetsEl.appendChild(btn);
}
const sep = document.createElement('span');
sep.className = 'preset-sep';
sep.textContent = '|';
presetsEl.appendChild(sep);
FOCUS_LAYOUTS.forEach(layout => {
  const btn = document.createElement('button');
  btn.textContent = layout.label;
  btn.className = 'focus-preset';
  btn.dataset.focusId = layout.id;
  btn.addEventListener('click', () => setFocusLayout(layout.id));
  presetsEl.appendChild(btn);
});

// Compact-mode grid menu (the preset row collapses into this dropdown when the
// topbar is narrow). Keep its label in sync with the active layout.
const gridMenuBtn = document.getElementById('grid-menu-btn');
const gridMenuLabel = document.getElementById('grid-menu-label');
function _setGridMenuLabel(text) { if (gridMenuLabel) gridMenuLabel.textContent = text; }
function _closeGridMenu() {
  presetsEl.classList.remove('open');
  if (gridMenuBtn) gridMenuBtn.setAttribute('aria-expanded', 'false');
}
if (gridMenuBtn) {
  gridMenuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = presetsEl.classList.toggle('open');
    gridMenuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });
  // Close the dropdown after picking a preset (in compact mode) or clicking away.
  presetsEl.addEventListener('click', (e) => { if (e.target.closest('button')) _closeGridMenu(); });
  document.addEventListener('click', (e) => {
    if (!presetsEl.classList.contains('open')) return;
    if (e.target.closest('#grid-presets-wrap')) return;
    _closeGridMenu();
  });
}
// Initial label from the current layout.
(function () {
  if (activeLayout && activeLayout.type === 'focus') {
    const l = FOCUS_LAYOUTS.find(x => x.id === activeLayout.id);
    _setGridMenuLabel(l ? l.label : 'Grid');
  } else {
    _setGridMenuLabel(`${gridSize}×${gridSize}`);
  }
})();

function setGridSize(n) {
  gridSize = n;
  activeLayout = { type: 'uniform', size: n };
  focusedTile = null;
  presetsEl.querySelectorAll('button[data-size]').forEach(b => b.classList.toggle('active', +b.dataset.size === n));
  presetsEl.querySelectorAll('button.focus-preset').forEach(b => b.classList.remove('active'));
  _setGridMenuLabel(`${n}×${n}`);
  renderGrid();
}

function setFocusLayout(id) {
  const layout = FOCUS_LAYOUTS.find(l => l.id === id);
  if (!layout) return;
  activeLayout = { type: 'focus', id };
  focusedTile = null;
  presetsEl.querySelectorAll('button[data-size]').forEach(b => b.classList.remove('active'));
  presetsEl.querySelectorAll('button.focus-preset').forEach(b => b.classList.toggle('active', b.dataset.focusId === id));
  _setGridMenuLabel(layout.label);
  renderGrid();
}

function getLayoutTotal() {
  if (activeLayout.type === 'uniform') return activeLayout.size * activeLayout.size;
  const layout = FOCUS_LAYOUTS.find(l => l.id === activeLayout.id);
  return layout ? layout.total : 0;
}

/* ══════════════════════════════════════════
   Budget Check
   ══════════════════════════════════════════ */
function checkBudget() {
  const active = Object.keys(tileAssignments).length;
  if (active >= maxStreams) {
    notify(`Stream limit reached (${maxStreams})`, { severity: 'warning', category: 'stream' });
    const b = document.getElementById('stream-budget');
    b.style.animation = 'shake 0.3s';
    setTimeout(() => b.style.animation = '', 300);
    return true;
  }
  return false;
}

/* ══════════════════════════════════════════
   Grid Rendering
   ══════════════════════════════════════════ */
const gridContainer = document.getElementById('grid-container');
const emptyState = document.getElementById('grid-empty-state');

function renderGrid() {
  let cols, rows, total, spanMap = {};

  if (activeLayout.type === 'uniform') {
    cols = rows = activeLayout.size;
    total = cols * rows;
  } else {
    const layout = FOCUS_LAYOUTS.find(l => l.id === activeLayout.id);
    cols = layout.cols; rows = layout.rows; total = layout.total;
    layout.spans.forEach(s => { spanMap[s.index] = s; });
  }

  gridContainer.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  gridContainer.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
  // Keep live streams alive across the rebuild: park their media elements before
  // wiping the grid, so connect() can re-adopt them instead of reconnecting.
  StreamAdapter.parkMedia();
  gridContainer.innerHTML = '';

  const hasAssignments = Object.keys(tileAssignments).length > 0;
  emptyState.classList.toggle('hidden', hasAssignments);

  for (let i = 0; i < total; i++) {
    const tile = createTile(i);
    if (spanMap[i]) {
      tile.style.gridColumn = `span ${spanMap[i].colSpan}`;
      tile.style.gridRow = `span ${spanMap[i].rowSpan}`;
    }
    if (focusedTile === i) {
      tile.classList.add('focused');
    } else if (focusedTile !== null) {
      tile.style.display = 'none';
    }
    gridContainer.appendChild(tile);
  }
  // Reused tiles have re-adopted their media synchronously above; drop streams for
  // tiles that no longer exist and clear any leftover parked media.
  StreamAdapter.sweep(total);
  updateBudget();
  updateTileSelection();
  persistDashboard();   // auto-save the arrangement so it survives reload/restart
}

function updateTileSelection() {
  gridContainer.querySelectorAll('.tile').forEach(t => t.classList.remove('kb-selected'));
  if (selectedTileIndex !== null) {
    const sel = gridContainer.querySelector(`.tile[data-index="${selectedTileIndex}"]`);
    if (sel) sel.classList.add('kb-selected');
  }
}

function createTile(index) {
  const tile = document.createElement('div');
  tile.className = 'tile';
  tile.dataset.index = index;
  if (settings.aspectRatio !== 'auto') tile.style.aspectRatio = settings.aspectRatio;
  const camId = tileAssignments[index];
  const cam = camId ? cameras.find(c => c.id === camId) : null;
  const isHq = tileIsHq(index);
  const isAutoHq = tileAutoHq[index] || false;
  const audioOn = tileAudioState[index] || false;

  if (!cam) {
    tile.classList.add('empty');
    tile.innerHTML = `<div class="empty-label">Drop camera here</div>`;
  } else {
    if (isHq) tile.classList.add('hq');
    tile.dataset.cameraId = cam.id;

    // Analytics eye badge — only rendered when this camera has ≥1 armed detector.
    // Sits between the snapshot and audio controls in the controls-bar.
    // Armed = analyticsConfig[cam.id][detId].enabled && resolveSource(...).boundTo !== 'pending'.
    const armed = getArmedDetectorsForCamera(cam.id);
    let eyeBadgeHtml = '';
    if (armed.length > 0) {
      const eyeState = _tileEyeStateByCam.get(cam.id) || 'idle';
      const titleLines = ['Active detectors:'].concat(
        armed.map(a => `• ${a.label} (${a.boundTo})`)
      ).join('\n');
      eyeBadgeHtml = `<button class="ctrl-btn tile-eye" data-action="analytics-badge" data-eye-state="${esc(eyeState)}" title="${esc(titleLines)}" aria-label="Active analytics — ${esc(String(armed.length))} detector${armed.length === 1 ? '' : 's'}">\u{1F441}<sup class="tile-eye-count">${esc(String(armed.length))}</sup></button>`;
    }

    // Use <img> as placeholder; StreamAdapter will replace with <video> for WebRTC
    const mediaTag = settings.streamProtocol === 'webrtc'
      ? `<video class="tile-media tile-video" autoplay muted playsinline></video>`
      : `<img class="tile-media tile-img" src="" alt="${esc(cam.name)}">`;

    tile.innerHTML = `
      ${mediaTag}
      <div class="tile-name" style="${settings.showNames ? '' : 'display:none'}">
        ${esc(cam.name)}
        <span class="audio-indicator">${audioOn ? '&#128266;' : '&#128263;'}</span>
        <span class="live-badge" style="${settings.showLive ? '' : 'display:none'}">LIVE</span>
      </div>
      <span class="quality-badge ${isHq ? (isAutoHq ? 'auto-main' : 'main') : 'sub'}">${isHq ? (isAutoHq ? 'AUTO' : 'MAIN') : 'SUB'}</span>
      <div class="drag-handle" title="Drag to reorder">&#8942;&#8942;</div>
      <div class="controls-bar">
        <button class="ctrl-btn${isHq ? ' active' : ''}" data-action="hq" title="Toggle HQ" aria-label="Toggle high quality">HQ</button>
        <button class="ctrl-btn" data-action="focus" title="Focus view" aria-label="Focus this camera">&#8862;</button>
        <button class="ctrl-btn" data-action="fullscreen" title="Fullscreen" aria-label="Enter fullscreen">&#9974;</button>
        <button class="ctrl-btn" data-action="snapshot" title="Snapshot" aria-label="Take snapshot">&#128248;</button>
        ${cam.isapiPort ? '<button class="ctrl-btn" data-action="playback" title="Playback recording" aria-label="Play recorded video">&#9201;</button>' : ''}
        ${eyeBadgeHtml}
        ${(cam.hwCapabilities && cam.hwCapabilities.line) ? '<button class="ctrl-btn" data-action="draw-line" title="Draw line crossing" aria-label="Draw line crossing rule">&#9998;</button>' : ''}
        <button class="ctrl-btn${audioOn ? ' active' : ''}" data-action="audio" title="Toggle Audio" aria-label="Toggle audio">${audioOn ? '&#128266;' : '&#128263;'}</button>
        <button class="ctrl-btn" data-action="reconnect" title="Reconnect" aria-label="Reconnect stream">&#128260;</button>
        <button class="ctrl-btn" data-action="remove" title="Remove" aria-label="Remove camera">&#10005;</button>
      </div>
      <div class="flash"></div>
      <div class="reconnect-overlay"><div class="spinner"></div><div class="tile-loading-label">Connecting…</div><div class="tile-prog"><div class="tile-prog-fill"></div></div><div class="tile-prog-pct">0%</div></div>
      <div class="volume-bar${audioOn ? ' active' : ''}"><div class="volume-level" style="height:${Math.floor(Math.random()*60+30)}%"></div></div>
      <button class="back-btn">&larr; Back to Grid</button>
    `;

    // Connect real stream via StreamAdapter. A live stream for this tile (parked
    // during re-render) is adopted synchronously — no reconnect. Only a genuinely
    // fresh connection is staggered (to avoid overwhelming go2rtc).
    // HQ on → MAIN channel (high quality), HQ off → SUB channel (low bitrate).
    const quality = isHq ? 'main' : 'sub';
    StreamAdapter.connect(tile, cam.id, settings.streamProtocol, index, quality, index * 300);

    // Line crossing / intrusion overlay — fetch config now, but only RENDER
    // once the stream is actually showing video (status 'connected'). Showing
    // the overlay before the image is up looks wrong, so we gate on the tile's
    // stream status (driven by StreamAdapter via the 'tilestreamstatus' event).
    const caps = cam.hwCapabilities || {};
    if (caps.line || caps.loitering) {
      if (tileLineOverlay[index] === undefined) tileLineOverlay[index] = true;

      const renderOverlayIfReady = () => {
        if (!tile.isConnected) return;
        if (tileLineOverlay[index] === false) return;
        if (_tileDrawMode[index] != null) return; // don't fight draw mode
        if (tile.getAttribute('data-stream-status') !== 'connected') return;
        fetchLineConfig(cam.id).then(cfg => {
          if (cfg && tile.isConnected
              && tile.getAttribute('data-stream-status') === 'connected'
              && tileLineOverlay[index] !== false
              && _tileDrawMode[index] == null) {
            renderLineOverlay(tile, cam.id);
          }
        });
      };

      // Re-evaluate whenever the stream status changes: render on 'connected',
      // and drop the overlay while reconnecting/erroring so it tracks the video.
      tile.addEventListener('tilestreamstatus', (e) => {
        const st = e.detail && e.detail.status;
        if (st === 'connected') {
          renderOverlayIfReady();
        } else {
          const ov = tile.querySelector('.tile-line-overlay');
          if (ov) ov.remove();
        }
      });

      // Pre-warm the config cache so the first render is instant.
      fetchLineConfig(cam.id);

      // If the stream was already connected (e.g. reused WebRTC connection that
      // set status synchronously before this listener attached), render now.
      if (tile.getAttribute('data-stream-status') === 'connected') {
        renderOverlayIfReady();
      }
    }
  }

  // Drop zone
  tile.addEventListener('dragover', e => {
    e.preventDefault();
    // dropEffect MUST match the drag's effectAllowed or the browser rejects the
    // drop: tile→tile reordering uses 'move', sidebar→tile placement uses 'copy'.
    const isTileDrag = e.dataTransfer.types.includes('application/tile-index');
    e.dataTransfer.dropEffect = isTileDrag ? 'move' : 'copy';
    tile.classList.add('dragover');
  });
  tile.addEventListener('dragleave', () => tile.classList.remove('dragover'));
  tile.addEventListener('drop', e => {
    e.preventDefault();
    tile.classList.remove('dragover');
    const droppedCamId = e.dataTransfer.getData('text/plain');
    if (!droppedCamId) return;

    const srcIndex = e.dataTransfer.getData('application/tile-index');
    if (srcIndex !== '' && srcIndex !== undefined) {
      // Tile swap / move — swap each per-tile map between the two indices, then
      // re-key the live stream connections so the streams MOVE with the tiles
      // (adopted at their new index, no reconnect).
      const si = parseInt(srcIndex);
      if (si === index) return; // self-drop guard
      _swapKey(tileAssignments, si, index);
      _swapKey(tileHqState, si, index);
      _swapKey(tileAudioState, si, index);
      StreamAdapter.swapTiles(si, index);
    } else {
      // Sidebar drop — check duplicate and budget
      if (Object.values(tileAssignments).includes(droppedCamId)) {
        showToast('Camera already on grid', true);
        return;
      }
      if (!tileAssignments[index] && checkBudget()) return;
      tileAssignments[index] = droppedCamId;
    }
    renderGrid();
  });

  // Double-click → focus
  tile.addEventListener('dblclick', () => {
    if (!cam) return;
    if (focusedTile === index) { exitFocus(); } else { enterFocus(index); }
  });

  // Back button
  const backBtn = tile.querySelector('.back-btn');
  if (backBtn) backBtn.addEventListener('click', e => { e.stopPropagation(); exitFocus(); });

  // Tile drag (for reordering) — whole tile is draggable except control buttons
  if (cam) {
    tile.draggable = true;
    tile.addEventListener('dragstart', e => {
      if (e.target.closest('.controls-bar')) { e.preventDefault(); return; }
      e.dataTransfer.setData('text/plain', camId);
      e.dataTransfer.setData('application/tile-index', String(index));
      e.dataTransfer.effectAllowed = 'move';
      tile.style.opacity = '0.4';
      setTimeout(() => tile.style.opacity = '', 300);
    });
  }

  // Control actions
  tile.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    handleTileAction(btn.dataset.action, tile, index, btn);
  });

  return tile;
}

function handleTileAction(action, tile, index, srcBtn) {
  switch (action) {
    case 'analytics-badge': {
      const camId = tileAssignments[index];
      if (!camId) break;
      const anchor = srcBtn || tile.querySelector('.tile-eye');
      openTileAnalyticsPopover(camId, anchor);
      break;
    }
    case 'hq': {
      const badge = tile.querySelector('.quality-badge');
      const btn = tile.querySelector('[data-action="hq"]');
      const isHq = tile.classList.toggle('hq');
      tileHqState[index] = isHq;
      delete tileAutoHq[index]; // manual toggle clears auto flag
      badge.className = `quality-badge ${isHq ? 'main' : 'sub'}`;
      badge.textContent = isHq ? 'MAIN' : 'SUB';
      btn.classList.toggle('active', isHq);
      // Actually switch the stream channel: MAIN (x01) when HQ on, SUB (x02) when off.
      const hqCam = cameras.find(c => c.id === tileAssignments[index]);
      if (hqCam) StreamAdapter.reconnect(tile, hqCam.id, settings.streamProtocol, index, isHq ? 'main' : 'sub');
      persistDashboard();
      break;
    }
    case 'focus': {
      enterFocus(index);
      break;
    }
    case 'fullscreen': {
      if (tile.requestFullscreen) tile.requestFullscreen();
      break;
    }
    case 'snapshot': {
      const flash = tile.querySelector('.flash');
      flash.classList.remove('animate');
      void flash.offsetWidth;
      flash.classList.add('animate');
      const snapCam = cameras.find(c => c.id === tileAssignments[index]);
      notify(snapCam ? `Snapshot captured — ${snapCam.name}` : 'Snapshot captured',
        { category: 'camera', cameraId: snapCam && snapCam.id, cameraName: snapCam && snapCam.name });
      break;
    }
    case 'audio': {
      const btn = tile.querySelector('[data-action="audio"]');
      const audioOn = btn.classList.toggle('active');
      tileAudioState[index] = audioOn;
      btn.innerHTML = audioOn ? '&#128266;' : '&#128263;';
      const indicator = tile.querySelector('.audio-indicator');
      if (indicator) indicator.innerHTML = audioOn ? '&#128266;' : '&#128263;';
      // Toggle audio on real stream
      StreamAdapter.setMuted(tile, !audioOn);
      persistDashboard();
      break;
    }
    case 'reconnect': {
      const rcCam = cameras.find(c => c.id === tileAssignments[index]);
      logEvent({ severity: 'info', category: 'stream',
        message: rcCam ? `Stream reconnect — ${rcCam.name}` : 'Stream reconnect requested',
        cameraId: rcCam && rcCam.id, cameraName: rcCam && rcCam.name });
      // Reconnect the real stream at the tile's current quality
      if (rcCam) {
        StreamAdapter.reconnect(tile, rcCam.id, settings.streamProtocol, index, tileIsHq(index) ? 'main' : 'sub');
      }
      break;
    }
    case 'remove': {
      StreamAdapter.disconnect(index);
      delete tileAssignments[index];
      delete tileHqState[index];
      delete tileAudioState[index];
      renderGrid();
      break;
    }
    case 'draw-line': {
      const camId = tileAssignments[index];
      if (!camId) break;
      if (_tileDrawMode[index]) {
        // Already in draw mode — cancel
        _exitDrawMode(tile, index);
      } else {
        _enterDrawMode(tile, index, camId);
      }
      break;
    }
    case 'playback': {
      const camId = tileAssignments[index];
      if (camId) openPlaybackModal(camId);
      break;
    }
  }
}

// ── Playback Modal (NVR/DVR recorded video) ─────────────────────────────
// Uses backend /api/playback/* (see RESEARCH/NVR-DVR_Playback). Search lists
// recorded segments; Play streams a segment via a temporary go2rtc stream over
// WebRTC; Download pulls an MP4. State is single-instance (one modal at a time).

// Timeline-scrubber playback (Frigate/Shinobi-style). The selected day is a 24h
// axis; recording blocks are positioned by % of day; clicking/dragging the
// timeline seeks the NVR stream to that wall-clock time (any timestamp, not just
// file boundaries — the backend streams from an arbitrary start). A playhead
// follows real-time playback. See RESEARCH/NVR-DVR_Playback.
const PB_DAY_MS = 86400000;
const _pbState = {
  cameraId: null, pc: null, streamName: null,
  gen: 0,                 // bumped on open/close — guards against late stream/start races
  dayStart: 0,            // local-midnight ms of the selected day
  segments: [],           // [{ ...seg, startMs, endMs }] sorted ascending
  playStartMs: null,      // wall-clock ms that maps to video.currentTime = 0
  lastCursorMs: null,     // time under playhead/cursor (drives the Save button)
  zoom: 1,                // 1 = whole day fits; >1 = horizontally scrollable
  dragging: false,
  raf: null,
};

/** Format a date input value (YYYY-MM-DD) from a local Date (used for "today"). */
function _pbDateInputValue(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

// This NVR returns recording timestamps as DEVICE wall-clock numerals but tags
// them "Z" (UTC). To make the timeline read the same as the camera's burned-in
// OSD clock, we run the whole axis in UTC space: the selected day starts at UTC
// midnight, Z strings are parsed as UTC, and all labels format in UTC (no
// browser-local +offset). Streaming still round-trips correctly because the NVR
// interprets the times we send in that same space.

/** "YYYY-MM-DD" → device-day start (UTC midnight) ms. */
function _pbDayStart(dateStr) {
  const [y, m, d] = (dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}

/** ms → "YYYY-MM-DD" in UTC (device-day) space. */
function _pbUtcDateValue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/** ms → "HH:MM:SS" in device wall-clock (UTC-labeled) space. */
function _pbFmtClock(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'UTC' });
}

/** Recording block containing this ms, or null (gap with no footage). */
function _pbSegmentAt(ms) {
  return _pbState.segments.find((s) => ms >= s.startMs && ms < s.endMs) || null;
}

/** Nearest recording block to this ms (for snapping a click that lands in a
 *  gap). Returns null only when there are no segments at all. Recordings are
 *  often short motion-only clips, so clicking exactly on one is hard — snapping
 *  to the closest block makes the timeline usable. */
function _pbNearestSegment(ms) {
  let best = null, bestDist = Infinity;
  for (const s of _pbState.segments) {
    const dist = ms < s.startMs ? s.startMs - ms : (ms >= s.endMs ? ms - s.endMs : 0);
    if (dist < bestDist) { bestDist = dist; best = s; }
  }
  return best;
}

function _pbStatus(msg, state) {
  const el = document.getElementById('pb-status');
  if (!el) return;
  el.textContent = msg || '';
  // state: '' | 'ok' | 'warn' | 'error' → colored so "no playback" is obvious.
  el.classList.remove('pb-status-ok', 'pb-status-warn', 'pb-status-error');
  if (state) el.classList.add(`pb-status-${state}`);
}

/** MB → human size ("932 GB", "9.6 GB", "512 MB"). */
function _fmtSize(mb) {
  if (mb == null || isNaN(mb)) return '?';
  if (mb >= 1024 * 1024) return (mb / 1024 / 1024).toFixed(1) + ' TB';
  if (mb >= 1024) return (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB';
  return mb + ' MB';
}

// Short storage summary (e.g. "NAS 9.9 GB") used to enrich the device-storage
// playback option label. Set by _pbLoadStorage, applied by _pbDecorateSdOption.
let _pbStorageSummary = null;

/** Friendly storage TYPE name: "NAS (NFS)" / "microSD" / "HDD". */
function _storageTypeName(d) {
  if (d.kind === 'nas') return `NAS (${d.type || 'NFS'})`;
  if (/sd/i.test(d.type || '')) return 'microSD';
  return 'HDD';                       // SATA etc. on NVR/DVR
}

/** One short label per media: "NAS (NFS) 9.9 GB" / "HDD 932 GB". */
function _storageMediaLabel(d) {
  return `${_storageTypeName(d)} ${_fmtSize(d.capacityMB)}`;
}

/** Dedupe identical media (same kind/type/capacity/free/status) for display. */
function _dedupeMedia(media) {
  const seen = new Set();
  return media.filter(d => {
    const k = `${d.kind}|${d.type}|${d.capacityMB}|${d.freeSpaceMB}|${d.status}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/** Enrich the "Penyimpanan kamera" (key 'sd') option with the detected media. */
function _pbDecorateSdOption() {
  const sel = document.getElementById('pb-source');
  if (!sel || !_pbStorageSummary) return;
  const opt = [...sel.options].find(o => o.value === 'sd');
  if (!opt) return;
  const cam = cameras.find(c => c.id === _pbState.cameraId);
  const camName = (cam && cam.name) || 'kamera';
  opt.textContent = `Penyimpanan kamera · ${_pbStorageSummary} · ${camName}`;
}

/** Fetch + render the device storage (HDD/SD/NAS management) for the playback camera. */
async function _pbLoadStorage(cameraId) {
  const el = document.getElementById('pb-storage');
  if (!el) return;
  el.textContent = '💾 cek penyimpanan…';
  el.className = 'pb-storage';
  _pbStorageSummary = null;
  try {
    const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/storage`);
    const data = await res.json();
    if (data.error) { el.textContent = `💾 ${data.error}`; el.classList.add('pb-status-warn'); return; }
    if (!data.hasStorage) {
      el.textContent = '💾 Tanpa penyimpanan di perangkat';
      el.classList.add('pb-status-warn');
      el.title = 'Perangkat tidak punya SD/HDD/NAS — playback dari perangkat tidak tersedia';
      return;
    }
    const media = _dedupeMedia(data.media);
    // Summarize each disk: "NAS (NFS) 9.9 GB, 2 GB kosong, ok".
    const parts = media.map(d => {
      const free = d.freeSpaceMB != null ? `, ${_fmtSize(d.freeSpaceMB)} kosong` : '';
      return `${_storageMediaLabel(d)}${free}, ${d.status}`;
    });
    el.textContent = `💾 ${parts.join(' · ')}`;
    el.classList.add(data.recordable ? 'pb-status-ok' : 'pb-status-warn');
    // Tooltip: full per-media detail incl. NAS address/path so it's unambiguous.
    el.title = `Storage / HDD management — ${media.length} media\n` +
      media.map(d => {
        const where = d.kind === 'nas' ? ` @${d.address || '?'}${d.path ? ' ' + d.path : ''}` : '';
        return `${_storageTypeName(d)}${where}: ${d.status}, ${_fmtSize(d.capacityMB)} total, ${_fmtSize(d.freeSpaceMB)} free, ${d.property || ''}`;
      }).join('\n');
    // Enrich the device-storage playback option so the source is unambiguous in
    // the dropdown (clearly NAS vs microSD vs HDD).
    _pbStorageSummary = [...new Set(media.map(_storageTypeName))].join(' + ');
    _pbDecorateSdOption();
  } catch (e) {
    el.textContent = '💾 gagal cek penyimpanan';
    el.classList.add('pb-status-warn');
  }
}

/** Random float in [min,max) — jitter so loading numbers differ each time. */
function _pbRand(min, max) { return min + Math.random() * (max - min); }

function _pbRenderProg() {
  const fill = document.getElementById('pb-prog-fill');
  const txt = document.getElementById('pb-prog-pct');
  const wrap = document.querySelector('#pb-loading .pb-prog');
  const v = Math.round(_pbState.prog || 0);
  if (wrap) wrap.style.display = '';
  if (txt) { txt.style.display = ''; txt.textContent = v + '%'; }
  if (fill) fill.style.width = v + '%';
}

function _pbStopProgTrickle() {
  if (_pbState.progTrickle) { clearTimeout(_pbState.progTrickle); _pbState.progTrickle = null; }
}

// Highly varied random step (mostly small, sometimes a burst, sometimes a
// near-pause) and interval (usually quick, occasionally a long hesitation) —
// so the bar looks alive and never shows the same sequence twice.
function _pbRandStep() {
  const r = Math.random();
  if (r < 0.18) return Math.random() * 0.25;
  if (r < 0.82) return 0.3 + Math.random() * 1.9;
  return 2.2 + Math.random() * 3.8;
}
function _pbRandInterval() {
  return Math.random() < 0.22 ? 650 + Math.random() * 1250 : 110 + Math.random() * 470;
}
function _pbStartProgTrickle() {
  if (_pbState.progTrickle) return;
  const tick = () => {
    const ceil = _pbState.progCeil || 0;
    if ((_pbState.prog || 0) < ceil) {
      _pbState.prog = Math.min(ceil, (_pbState.prog || 0) + _pbRandStep());
      _pbRenderProg();
    }
    _pbState.progTrickle = setTimeout(tick, _pbRandInterval());
  };
  _pbState.progTrickle = setTimeout(tick, _pbRandInterval());
}

/**
 * Set the loading bar. Two modes:
 *  - `_pbSetProgress(value, ceil)` → jump to REAL milestone `value`, then a
 *    randomized trickle creeps toward `ceil` until the next milestone.
 *  - `_pbSetProgress(value)` → set exactly (used by the byte-driven download).
 *  - `_pbSetProgress(null)` → hide the bar.
 */
function _pbSetProgress(value, ceil) {
  if (value == null) {
    _pbStopProgTrickle();
    const wrap = document.querySelector('#pb-loading .pb-prog');
    const txt = document.getElementById('pb-prog-pct');
    if (wrap) wrap.style.display = 'none';
    if (txt) txt.style.display = 'none';
    return;
  }
  value = Math.max(0, Math.min(100, value));
  if (ceil != null) {
    _pbState.prog = Math.max(_pbState.prog || 0, value);
    _pbState.progCeil = Math.max(_pbState.progCeil || 0, Math.min(100, ceil));
    _pbStartProgTrickle();
  } else {
    _pbStopProgTrickle();
    _pbState.prog = value;
    _pbState.progCeil = value;
  }
  _pbRenderProg();
}

/**
 * Show/hide the playback loading overlay over the video.
 * opts: { manual } seed a randomized milestone trickle (caller advances it);
 *       { abort } shows the Cancel button; { persist } skips the safety auto-hide.
 */
function _pbShowLoading(show, label, opts) {
  opts = opts || {};
  const el = document.getElementById('pb-loading');
  if (!el) return;
  if (label) { const l = el.querySelector('.pb-loading-label'); if (l) l.textContent = label; }
  el.classList.toggle('show', !!show);
  const abortBtn = document.getElementById('pb-dl-abort');
  if (abortBtn) abortBtn.style.display = (show && opts.abort) ? '' : 'none';

  if (_pbState.loadTimer) { clearTimeout(_pbState.loadTimer); _pbState.loadTimer = null; }
  _pbStopProgTrickle();

  if (!show) { _pbSetProgress(null); return; }

  _pbState.prog = 0; _pbState.progCeil = 0;
  if (opts.manual) {
    _pbSetProgress(_pbRand(2, 6), _pbRand(28, 38)); // seed + trickle to first milestone
  } else {
    _pbSetProgress(0); // bar at 0 — caller drives it (byte-real download)
  }
  // Safety: never let a non-download spinner hang forever.
  if (!opts.persist) _pbState.loadTimer = setTimeout(() => _pbShowLoading(false), 20000);
}

/** Mark loading complete: snap to 100%, then hide. */
function _pbFinishLoading() {
  _pbStopProgTrickle();
  _pbSetProgress(100);
  setTimeout(() => _pbShowLoading(false), 250);
}

function _ensurePlaybackModal() {
  let backdrop = document.getElementById('pb-backdrop');
  if (backdrop) return backdrop;

  backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.id = 'pb-backdrop';
  backdrop.innerHTML = `
    <div class="modal pb-modal" role="dialog" aria-modal="true" aria-labelledby="pb-title">
      <div class="modal-body">
        <div class="modal-header">
          <h2 id="pb-title">Playback</h2>
          <button class="modal-close" id="pb-close" aria-label="Close">&times;</button>
        </div>
        <div class="modal-content">
          <div class="pb-toolbar">
            <button class="btn btn-secondary pb-nav" id="pb-prev" title="Previous day">&#8249;</button>
            <input type="date" id="pb-date" class="pb-date">
            <button class="btn btn-secondary pb-nav" id="pb-next" title="Next day">&#8250;</button>
            <button class="btn btn-secondary" id="pb-today">Today</button>
            <select id="pb-source" class="pb-source" title="Playback source"></select>
            <span class="pb-clock" id="pb-clock">--:--:--</span>
            <span class="pb-status" id="pb-status"></span>
            <span class="pb-storage" id="pb-storage" title="Storage / HDD management"></span>
          </div>
          <div class="pb-dl-panel" id="pb-dl-panel">
            <span class="pb-dl-title">Save clip</span>
            <label class="pb-field">From<input type="datetime-local" id="pb-dl-from" step="1"></label>
            <label class="pb-field">Length (min)<input type="number" id="pb-dl-len" min="1" max="60" value="10"></label>
            <button class="btn btn-primary" id="pb-dl-go" disabled>&#11015; Download clip</button>
            <span class="pb-dl-hint" id="pb-dl-hint">Click the timeline to set From · 1–60 min</span>
          </div>
          <div class="pb-stage">
            <video class="pb-video" id="pb-video" autoplay muted playsinline></video>
            <div class="pb-loading" id="pb-loading">
              <div class="spinner"></div>
              <div class="pb-loading-label">Buffering…</div>
              <div class="pb-prog"><div class="pb-prog-fill" id="pb-prog-fill"></div></div>
              <div class="pb-prog-pct" id="pb-prog-pct">0%</div>
              <button class="btn btn-secondary pb-abort-btn" id="pb-dl-abort" style="display:none">Cancel download</button>
            </div>
          </div>
          <div class="pb-tlbar">
            <span class="pb-legend"><i class="lg-rec"></i> Recording</span>
            <span class="pb-legend"><i class="lg-gap"></i> No footage</span>
            <span class="pb-hint">Click or drag the timeline to scrub</span>
            <span class="pb-spacer"></span>
            <button class="btn btn-secondary pb-nav" id="pb-zoom-out" title="Zoom out" disabled>&minus;</button>
            <span class="pb-zoom-lbl" id="pb-zoom-lbl">1&times;</span>
            <button class="btn btn-secondary pb-nav" id="pb-zoom-in" title="Zoom in">+</button>
          </div>
          <div class="pb-timeline" id="pb-timeline">
            <div class="pb-tl-inner" id="pb-tl-inner">
              <div class="pb-ticks" id="pb-ticks"></div>
              <div class="pb-track" id="pb-track"></div>
              <div class="pb-cursor-time" id="pb-cursor-time"></div>
              <div class="pb-playhead" id="pb-playhead"><div class="pb-playhead-knob"></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(backdrop);

  // Close handlers
  const close = () => closePlaybackModal();
  backdrop.querySelector('#pb-close').addEventListener('click', close);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && backdrop.classList.contains('open')) close();
  });

  // Day navigation
  backdrop.querySelector('#pb-prev').addEventListener('click', () => _pbShiftDay(-1));
  backdrop.querySelector('#pb-next').addEventListener('click', () => _pbShiftDay(1));
  backdrop.querySelector('#pb-today').addEventListener('click', () => {
    document.getElementById('pb-date').value = _pbDateInputValue(new Date());
    _pbStopActiveStream(); _pbLoadDay();
  });
  backdrop.querySelector('#pb-date').addEventListener('change', () => { _pbStopActiveStream(); _pbLoadDay(); });

  // Zoom
  backdrop.querySelector('#pb-zoom-in').addEventListener('click', () => _pbSetZoom(_pbState.zoom * 2));
  backdrop.querySelector('#pb-zoom-out').addEventListener('click', () => _pbSetZoom(_pbState.zoom / 2));

  // Playback source (NVR vs on-camera SD)
  backdrop.querySelector('#pb-source').addEventListener('change', (e) => {
    _pbState.source = e.target.value || undefined;
    _pbStopActiveStream();
    _pbLoadDay();
  });

  // Download a clip (range = From + Length). One always-visible control.
  backdrop.querySelector('#pb-dl-go').addEventListener('click', _pbDoDownload);
  backdrop.querySelector('#pb-dl-abort').addEventListener('click', () => {
    if (_pbState.dlAbort) { try { _pbState.dlAbort.abort(); } catch (e) {} }
  });

  // Timeline scrub interactions (click = jump, drag = scrub, release = seek)
  const inner = backdrop.querySelector('#pb-tl-inner');
  inner.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    _pbState.dragging = true;
    try { inner.setPointerCapture(e.pointerId); } catch (_) {}
    const t = _pbEventToTime(e);
    _pbSetPlayhead(t); _pbShowCursor(t);
  });
  inner.addEventListener('pointermove', (e) => {
    const t = _pbEventToTime(e);
    _pbShowCursor(t);
    if (_pbState.dragging) _pbSetPlayhead(t);
    else { _pbState.lastCursorMs = t; _pbUpdateDownloadBtn(t); }
  });
  const endDrag = (e) => {
    if (!_pbState.dragging) return;
    _pbState.dragging = false;
    try { inner.releasePointerCapture(e.pointerId); } catch (_) {}
    _pbSeekTo(_pbEventToTime(e));
  };
  inner.addEventListener('pointerup', endDrag);
  inner.addEventListener('pointercancel', endDrag);
  inner.addEventListener('pointerleave', () => { if (!_pbState.dragging) _pbHideCursor(); });

  return backdrop;
}

function openPlaybackModal(cameraId) {
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam) return;
  _pbState.gen++;                // invalidate any in-flight stream start
  _pbState.cameraId = cameraId;
  _pbState.zoom = 1;
  _pbState.playStartMs = null;
  _pbState.lastCursorMs = null;
  _pbState.source = undefined;          // let the server pick the default (NVR)
  _pbLastNoPlaybackKey = null;          // allow the "no playback" toast to fire fresh
  _pbStorageSummary = null;             // reset device-storage label enrichment
  const _srcSel = document.getElementById('pb-source');
  if (_srcSel) { _srcSel.innerHTML = ''; _srcSel.style.display = 'none'; }

  const backdrop = _ensurePlaybackModal();
  const dt = (cam.deviceType || 'ip').toLowerCase();
  const dtLabel = dt === 'nvr' ? 'NVR' : dt === 'dvr' ? 'DVR' : 'IP Camera';
  backdrop.querySelector('#pb-title').innerHTML =
    `Playback — ${esc(cam.name)} <span class="cam-type cam-type-${dt}">${dtLabel}</span>`;

  document.getElementById('pb-date').value = _pbDateInputValue(new Date());
  document.getElementById('pb-tl-inner').style.width = '100%';
  document.getElementById('pb-zoom-lbl').textContent = '1×';
  document.getElementById('pb-zoom-out').disabled = true;
  document.getElementById('pb-clock').textContent = '--:--:--';
  document.getElementById('pb-playhead').style.display = 'none';
  document.getElementById('pb-cursor-time').style.display = 'none';
  document.getElementById('pb-video').srcObject = null;
  // Reset download UI state.
  _pbState.downloading = false; _pbState.dlAbort = null;
  const _dlBtn = document.getElementById('pb-dl-go');
  if (_dlBtn) _dlBtn.disabled = true;
  document.getElementById('pb-dl-len').value = '10';
  document.getElementById('pb-dl-hint').textContent = 'Click the timeline to set From · 1–60 min';
  _pbShowLoading(false);

  backdrop.classList.add('open');
  _pbLoadDay(true);           // auto-play the first recording on open
  _pbLoadStorage(cameraId);   // HDD/SD/NAS management status for this device
  if (!_pbState.raf) _pbState.raf = requestAnimationFrame(_pbTick);
}

async function closePlaybackModal() {
  _pbState.gen++;   // invalidate any in-flight stream start so it gets torn down
  const backdrop = document.getElementById('pb-backdrop');
  if (backdrop) backdrop.classList.remove('open');
  if (_pbState.raf) { cancelAnimationFrame(_pbState.raf); _pbState.raf = null; }
  // Abort an in-flight download so it doesn't keep holding an NVR session.
  if (_pbState.dlAbort) { try { _pbState.dlAbort.abort(); } catch (e) {} _pbState.dlAbort = null; }
  _pbState.downloading = false;
  _pbShowLoading(false);
  // Stop the WebRTC peer + remove the temporary go2rtc stream (kills its ffmpeg
  // process and frees the NVR/camera playback session). Awaited so the stream is
  // gone before we consider the modal closed.
  await _pbStopActiveStream();
  _pbState.cameraId = null;
  _pbState.segments = [];
}

// ── Timeline rendering ──────────────────────────────────────────────────

/** ms → percent across the 24h axis (0–100). */
function _pbPct(ms) { return Math.max(0, Math.min(100, (ms - _pbState.dayStart) / PB_DAY_MS * 100)); }

function _pbRenderTicks() {
  const ticks = document.getElementById('pb-ticks');
  if (!ticks) return;
  ticks.innerHTML = '';
  const labelEvery = _pbState.zoom >= 4 ? 1 : 2;   // hours between labels
  for (let h = 0; h <= 24; h++) {
    const isMajor = h % labelEvery === 0;
    const t = document.createElement('div');
    t.className = 'pb-tick' + (isMajor ? ' major' : '');
    t.style.left = (h / 24 * 100) + '%';
    if (isMajor && h < 24) t.dataset.label = String(h).padStart(2, '0');
    ticks.appendChild(t);
  }
}

function _pbRenderSegments() {
  const track = document.getElementById('pb-track');
  if (!track) return;
  track.innerHTML = '';
  if (_pbState.segments.length === 0) {
    const e = document.createElement('div');
    e.className = 'pb-noseg';
    e.textContent = 'No recordings for this day';
    track.appendChild(e);
    return;
  }
  for (const s of _pbState.segments) {
    const left = _pbPct(s.startMs);
    const width = Math.max(0.15, _pbPct(s.endMs) - left);
    const el = document.createElement('div');
    el.className = 'pb-seg-block';
    el.style.left = left + '%';
    el.style.width = width + '%';
    el.title = `${_pbFmtClock(s.startMs)} – ${_pbFmtClock(s.endMs)}  (${s.codecType || ''})`;
    track.appendChild(el);
  }
}

function _pbSetZoom(z) {
  z = Math.max(1, Math.min(8, z));
  _pbState.zoom = z;
  document.getElementById('pb-tl-inner').style.width = (z * 100) + '%';
  document.getElementById('pb-zoom-lbl').textContent = z + '×';
  document.getElementById('pb-zoom-out').disabled = z <= 1;
  document.getElementById('pb-zoom-in').disabled = z >= 8;
  _pbRenderTicks();
  if (_pbState.playStartMs != null) _pbScrollToPlayhead();
}

// ── Playhead & cursor ───────────────────────────────────────────────────

/** Move only the playhead element (used by the realtime follow loop). */
function _pbPlayheadLeft(ms) {
  const ph = document.getElementById('pb-playhead');
  ph.style.left = _pbPct(ms) + '%';
  ph.style.display = 'block';
}

/** User-driven playhead move: updates clock, cursor time and Save button. */
function _pbSetPlayhead(ms) {
  _pbPlayheadLeft(ms);
  document.getElementById('pb-clock').textContent = _pbFmtClock(ms);
  _pbState.lastCursorMs = ms;
  // The clip "From" follows the playhead — clicking the timeline picks the start.
  const from = document.getElementById('pb-dl-from');
  if (from) from.value = _pbToDLValue(ms);
  _pbUpdateDownloadBtn();
}

function _pbShowCursor(ms) {
  const c = document.getElementById('pb-cursor-time');
  c.style.left = _pbPct(ms) + '%';
  c.textContent = _pbFmtClock(ms);
  c.style.display = 'block';
}

function _pbHideCursor() {
  const c = document.getElementById('pb-cursor-time');
  if (c) c.style.display = 'none';
}

function _pbUpdateDownloadBtn() {
  const btn = document.getElementById('pb-dl-go');
  if (btn) btn.disabled = _pbState.downloading || _pbState.segments.length === 0;
}

/** Pointer event → wall-clock ms on the 24h axis (clamped to the day). */
function _pbEventToTime(e) {
  const inner = document.getElementById('pb-tl-inner');
  const r = inner.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  return _pbState.dayStart + frac * PB_DAY_MS;
}

/** Keep the playhead visible when zoomed in. */
function _pbScrollToPlayhead() {
  const tl = document.getElementById('pb-timeline');
  const inner = document.getElementById('pb-tl-inner');
  if (!tl || inner.offsetWidth <= tl.clientWidth) return;
  const x = _pbPct(_pbState.playStartMs == null ? _pbState.dayStart : _pbLastPlayheadMs()) / 100 * inner.offsetWidth;
  if (x < tl.scrollLeft + 40 || x > tl.scrollLeft + tl.clientWidth - 40) {
    tl.scrollLeft = x - tl.clientWidth / 2;
  }
}

function _pbLastPlayheadMs() {
  const v = document.getElementById('pb-video');
  if (_pbState.playStartMs != null && v) return _pbState.playStartMs + v.currentTime * 1000;
  return _pbState.lastCursorMs != null ? _pbState.lastCursorMs : _pbState.dayStart;
}

// ── Realtime playhead follow ────────────────────────────────────────────

function _pbTick() {
  _pbState.raf = requestAnimationFrame(_pbTick);
  if (_pbState.dragging || _pbState.playStartMs == null) return;
  const v = document.getElementById('pb-video');
  if (!v || v.readyState < 2 || v.paused) return;
  const cur = _pbState.playStartMs + v.currentTime * 1000;
  _pbPlayheadLeft(cur);
  document.getElementById('pb-clock').textContent = _pbFmtClock(cur);
  _pbScrollToPlayhead();
}

// ── Day load (search the whole 24h) ─────────────────────────────────────

function _pbShiftDay(delta) {
  const cur = _pbDayStart(document.getElementById('pb-date').value);
  if (isNaN(cur)) return;
  document.getElementById('pb-date').value = _pbUtcDateValue(cur + delta * PB_DAY_MS);
  _pbStopActiveStream();
  _pbLoadDay();
}

async function _pbLoadDay(autoplay = false) {
  const cam = _pbState.cameraId;
  const dateStr = document.getElementById('pb-date').value;
  if (!cam || !dateStr) return;

  _pbState.dayStart = _pbDayStart(dateStr);
  if (isNaN(_pbState.dayStart)) { _pbStatus('Invalid date.'); return; }
  _pbState.segments = [];
  _pbState.playStartMs = null;
  document.getElementById('pb-playhead').style.display = 'none';
  document.getElementById('pb-clock').textContent = '--:--:--';
  _pbUpdateDownloadBtn();
  _pbRenderTicks();
  _pbRenderSegments();
  _pbStatus('Searching…');

  const start = new Date(_pbState.dayStart).toISOString();
  const end = new Date(_pbState.dayStart + PB_DAY_MS).toISOString();
  try {
    const srcQ = _pbState.source ? `&source=${encodeURIComponent(_pbState.source)}` : '';
    const url = `/api/playback/search?cam=${encodeURIComponent(cam)}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&max=200${srcQ}`;
    const res = await fetch(url);
    const data = await res.json();

    const camName = (cameras.find(c => c.id === cam) || {}).name || 'Kamera';

    // Populate the source selector (NVR / on-camera SD) from the response.
    if (data.sources) _pbPopulateSources(data.sources, data.sourceKey || _pbState.source);

    // No usable playback source at all (e.g. IP camera with no NVR mapping and
    // no SD) → make it loud, not just a quiet status line.
    if (data.error) {
      _pbStatus(`Tidak ada sumber playback: ${data.message || data.error}`, 'error');
      _pbNotifyNoPlayback(cam, camName, data.message || `kamera ini tidak mendukung playback`);
      return;
    }

    const segs = (data.segments || [])
      .filter(s => s.startTime && s.endTime)
      .map(s => ({ ...s, startMs: Date.parse(s.startTime), endMs: Date.parse(s.endTime) }))
      .filter(s => !isNaN(s.startMs) && !isNaN(s.endMs))
      .sort((a, b) => a.startMs - b.startMs);
    _pbState.segments = segs;
    _pbRenderSegments();
    // Default the clip "From" to the first recording of the day; enable Download.
    if (segs.length) {
      _pbState.lastCursorMs = segs[0].startMs;
      const fromEl = document.getElementById('pb-dl-from');
      if (fromEl) fromEl.value = _pbToDLValue(segs[0].startMs);
    }
    _pbUpdateDownloadBtn();

    const viaTxt = data.sourceLabel
      || (data.via === 'nvr' ? `via NVR (${data.source})` : data.via === 'self' ? 'from recorder' : 'on-camera SD');
    if (segs.length) {
      // Has playback → the timeline + source dropdown ARE the "options". Just a
      // green confirmation line, no nagging toast.
      _pbStatus(`${segs.length} recording block(s) · ${viaTxt}${data.more ? ' · more exist (zoom/day-narrow)' : ''}`, 'ok');
      _pbLastNoPlaybackKey = null;
      // On first open, start the first recording so video shows immediately
      // (otherwise the user faces a black frame until they click a green block).
      if (autoplay && !_pbState.streamName) _pbSeekTo(segs[0].startMs);
    } else {
      // No recordings for the chosen day/source → diagnose WHY (storage missing?
      // recording schedule off?) so the operator knows what setting was missed.
      _pbStatus(`Tidak ada rekaman pada tanggal ini · ${viaTxt}`, 'warn');
      _pbDiagnoseNoPlayback(cam, camName);
    }
  } catch (err) {
    _pbStatus(`Search failed: ${err.message}`, 'error');
  }
}

// Fire a single visible toast when a camera has no playback/recordings, deduped
// per (camera + reason) so navigating days doesn't spam the same message.
let _pbLastNoPlaybackKey = null;
function _pbNotifyNoPlayback(cameraId, camName, reason) {
  const key = `${cameraId}|${reason}`;
  if (_pbLastNoPlaybackKey === key) return;
  _pbLastNoPlaybackKey = key;
  notify(`Playback ${camName}: ${reason}`, {
    severity: 'warning',
    category: 'camera',
    cameraId,
    cameraName: camName,
  });
}

/** Diagnose why a camera has no recordings and surface the missed settings.
 *  Calls the backend readiness check (storage + record schedule) and shows a
 *  clear, actionable notification + in-modal hint. */
async function _pbDiagnoseNoPlayback(cameraId, camName) {
  try {
    const srcQ = _pbState.source ? `?source=${encodeURIComponent(_pbState.source)}` : '';
    const res = await fetch(`/api/cameras/${encodeURIComponent(cameraId)}/playback-readiness${srcQ}`);
    const d = await res.json();
    const issues = Array.isArray(d.issues) ? d.issues : [];
    if (issues.length) {
      // In-modal: show the primary issue. Toast/log: full checklist with fixes.
      _pbStatus(`⚠ ${issues[0].msg}`, issues.some((i) => i.level === 'error') ? 'error' : 'warn');
      const detail = issues.map((i) => `• ${i.msg}${i.fix ? ` — ${i.fix}` : ''}`).join('\n');
      _pbNotifyNoPlayback(cameraId, camName, `${d.summary || 'pengaturan perlu dicek'}\n${detail}`);
    } else {
      _pbStatus(`Tidak ada rekaman pada tanggal ini · ${d.summary || ''}`, 'warn');
      _pbNotifyNoPlayback(cameraId, camName, d.summary || 'tidak ada rekaman pada tanggal ini (coba tanggal lain)');
    }
  } catch (e) {
    _pbNotifyNoPlayback(cameraId, camName, 'tidak ada rekaman pada tanggal ini');
  }
}

/** Fill the source <select> with [{key,label}]; show only when >1 choice. */
function _pbPopulateSources(sources, selectedKey) {
  const sel = document.getElementById('pb-source');
  if (!sel) return;
  const cur = sel.value;
  sel.innerHTML = '';
  for (const s of sources) {
    const opt = document.createElement('option');
    opt.value = s.key;
    opt.textContent = s.label;
    sel.appendChild(opt);
  }
  // Prefer the explicit state, then the user's previous pick if still available,
  // then the server's chosen key, then the first option.
  const keys = sources.map((s) => s.key);
  sel.value = (_pbState.source && keys.includes(_pbState.source)) ? _pbState.source
    : (cur && keys.includes(cur)) ? cur
    : (selectedKey && keys.includes(selectedKey)) ? selectedKey
    : (sources[0] && sources[0].key) || '';
  // Only worth showing when there's an actual choice to make.
  sel.style.display = sources.length > 1 ? '' : 'none';
  // Re-apply the storage enrichment (label may have been rebuilt just now).
  _pbDecorateSdOption();
}

// ── Seek & stream ───────────────────────────────────────────────────────

/** Seek playback to a wall-clock time: stream from there to the end of the
 *  containing recording block (continuous play across the rest of the block). */
let _pbSeekToken = 0;                          // bumped per seek; newest wins
function _pbDelay(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function _pbSeekTo(ms) {
  const token = ++_pbSeekToken;               // supersede any in-flight seek
  ms = Math.max(_pbState.dayStart, Math.min(ms, _pbState.dayStart + PB_DAY_MS - 1000));
  _pbSetPlayhead(ms);
  let seg = _pbSegmentAt(ms);
  if (!seg) {
    // Clicked in a gap → snap to the nearest recording instead of doing nothing
    // (footage is often short motion clips that are hard to hit exactly).
    seg = _pbNearestSegment(ms);
    if (!seg) { _pbStatus('Tidak ada rekaman pada hari ini.', 'warn'); return; }
    ms = seg.startMs;            // play from the start of the nearest block
    _pbSetPlayhead(ms);
    _pbStatus(`Lompat ke rekaman terdekat ${_pbFmtClock(ms)}…`);
  }

  // Tear down the current stream first. Hikvision cameras allow only ONE
  // playback session, so opening a new pull before the old one is released
  // makes the device answer "RTSP SETUP 500". After stopping, give it a moment.
  const hadStream = !!_pbState.streamName;
  await _pbStopActiveStream();
  if (token !== _pbSeekToken) return;          // a newer seek superseded us
  if (hadStream) { await _pbDelay(700); if (token !== _pbSeekToken) return; }

  _pbStatus('Buffering…');
  // REAL progress: bar advanced from actual milestones. 20s safety auto-hide applies.
  _pbShowLoading(true, 'Buffering…', { manual: true });
  const startIso = new Date(ms).toISOString();
  const endIso = new Date(seg.endMs).toISOString();
  await _pbStartAndConnect(ms, startIso, endIso, seg, token, 0);
}

/** Start a go2rtc playback stream and connect WebRTC. Retries ONCE if the device
 *  rejects the pull (camera busy → SETUP 500 → go2rtc error/404), after freeing
 *  the session. Guarded by the seek token + modal gen so stale calls bail. */
async function _pbStartAndConnect(ms, startIso, endIso, seg, token, attempt) {
  const myGen = _pbState.gen;
  let data;
  try {
    const res = await fetch('/api/playback/stream/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Pass the segment's playbackURI so the backend keeps the recording-file id
      // (name=) — required for correct seeking on camera SD/NAS playback.
      body: JSON.stringify({ cam: _pbState.cameraId, start: startIso, end: endIso, source: _pbState.source, playbackURI: seg && seg.playbackURI }),
    });
    data = await res.json();
  } catch (err) {
    if (token === _pbSeekToken) { _pbShowLoading(false); _pbStatus(`Playback gagal: ${err.message}`, 'error'); }
    return;
  }
  // Superseded (newer seek) or modal closed → drop the stream we just made.
  if (token !== _pbSeekToken || _pbState.gen !== myGen) {
    if (data && data.name) _pbStopStreamByName(data.name);
    return;
  }
  if (data.error || !data.name) { _pbShowLoading(false); _pbStatus(`Playback error: ${data.error || 'no stream'}`, 'error'); return; }

  _pbSetProgress(_pbRand(38, 45), _pbRand(50, 58));
  _pbState.streamName = data.name;
  _pbState.playStartMs = ms;
  const video = document.getElementById('pb-video');
  const hide = () => _pbFinishLoading();
  video.addEventListener('loadeddata', hide, { once: true });
  video.addEventListener('playing', hide, { once: true });

  try {
    await _pbConnectWebRTC(video, data.name);
  } catch (err) {
    // Producer failed (most often the camera's single playback session was still
    // busy). Free it and retry once before giving up.
    await _pbStopActiveStream();
    if (token !== _pbSeekToken) return;
    if (attempt < 1) {
      _pbStatus('Sesi kamera sibuk — mencoba ulang…', 'warn');
      await _pbDelay(1000);
      if (token !== _pbSeekToken) return;
      return _pbStartAndConnect(ms, startIso, endIso, seg, token, attempt + 1);
    }
    _pbShowLoading(false);
    _pbStatus(`Playback gagal: ${err.message} (kamera hanya izinkan 1 sesi playback)`, 'error');
    return;
  }
  if (token === _pbSeekToken) _pbStatus(`Playing from ${_pbFmtClock(ms)}.`, 'ok');
}

const PB_DL_MIN_MIN = 1;   // minimum clip length (minutes)
const PB_DL_MAX_MIN = 60;  // maximum clip length (minutes)

/** ms → "YYYY-MM-DDTHH:MM:SS" in device wall-clock (UTC) space for the input. */
function _pbToDLValue(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
}

/** Download a clip for the picked range (clamped to 1–60 min). */
async function _pbDoDownload() {
  // Guard against concurrent downloads — the NVR plays back at REALTIME and
  // allows only one playback session per channel, so a second download while
  // one is running fails with "453 NVR busy".
  if (_pbState.downloading) { _pbStatus('A download is already running — please wait for it to finish.'); return; }

  const cam = _pbState.cameraId;
  const fromStr = document.getElementById('pb-dl-from').value;
  if (!fromStr) { document.getElementById('pb-dl-hint').textContent = 'Pick a start time.'; return; }
  // The picker shows device wall-clock numerals → interpret as UTC (Z).
  const startMs = Date.parse(fromStr.length === 16 ? fromStr + ':00Z' : fromStr + 'Z');
  if (isNaN(startMs)) { document.getElementById('pb-dl-hint').textContent = 'Invalid start time.'; return; }

  let len = parseInt(document.getElementById('pb-dl-len').value, 10);
  if (isNaN(len)) len = PB_DL_MIN_MIN;
  len = Math.max(PB_DL_MIN_MIN, Math.min(PB_DL_MAX_MIN, len));
  document.getElementById('pb-dl-len').value = String(len);
  const endMs = startMs + len * 60000;

  // The "From" must land on actual footage.
  if (!_pbSegmentAt(startMs)) { document.getElementById('pb-dl-hint').textContent = 'No recording at "From" — click a green block.'; return; }

  const dlBtn = document.getElementById('pb-dl-go');
  if (dlBtn) dlBtn.disabled = true;

  // Free any active scrubber stream first (NVR caps simultaneous playback/channel).
  await _pbStopActiveStream();

  _pbState.downloading = true;
  _pbState.dlAbort = new AbortController();
  const srcQ = _pbState.source ? `&source=${encodeURIComponent(_pbState.source)}` : '';
  const url = `/api/playback/download?cam=${encodeURIComponent(cam)}&start=${encodeURIComponent(new Date(startMs).toISOString())}&end=${encodeURIComponent(new Date(endMs).toISOString())}${srcQ}`;
  _pbStatus(`Downloading ${len} min…`);
  // No timer here — the bar is driven by REAL bytes received from the stream.
  _pbShowLoading(true, `Downloading ${len} min…`, { persist: true, abort: true });
  _pbSetProgress(0);
  try {
    const res = await fetch(url, { signal: _pbState.dlAbort.signal });
    const ct = res.headers.get('Content-Type') || '';
    if (!res.ok || !ct.includes('video')) {
      let msg = `Download failed (HTTP ${res.status})`;
      try { const j = await res.json(); if (j && j.error) msg = `Download failed: ${j.error}`; } catch (_) {}
      _pbShowLoading(false);
      _pbStatus(msg);
      return;
    }

    // Stream the body so progress reflects ACTUAL bytes received (it stalls if
    // the data stalls). The NVR delivers at realtime, so % tracks the share of
    // the clip received; we also show the real MB downloaded.
    const cd = res.headers.get('Content-Disposition') || '';
    const fnMatch = cd.match(/filename="([^"]+)"/);
    const fname = (fnMatch && fnMatch[1]) || `playback_${cam}.mp4`;
    const totalSec = len * 60;
    let blob;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const chunks = [];
      let received = 0;
      const t0 = Date.now();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        const elapsedSec = (Date.now() - t0) / 1000;
        const pct = totalSec > 0 ? Math.min(99, (elapsedSec / totalSec) * 100) : 0;
        _pbSetProgress(pct);
        _pbStatus(`Downloading ${len} min… ${(received / 1048576).toFixed(1)} MB`);
      }
      blob = new Blob(chunks, { type: 'video/mp4' });
    } else {
      blob = await res.blob();
    }

    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 15000);
    _pbFinishLoading();
    _pbStatus(`Downloaded ${fname} (${(blob.size / 1048576).toFixed(1)} MB).`);
  } catch (err) {
    _pbShowLoading(false);
    _pbStatus(err && err.name === 'AbortError' ? 'Download cancelled.' : `Download failed: ${err.message}`);
  } finally {
    _pbState.downloading = false;
    _pbState.dlAbort = null;
    _pbUpdateDownloadBtn();
  }
}

/** Minimal WebRTC connect to a named go2rtc stream (mirrors StreamAdapter). */
async function _pbConnectWebRTC(videoEl, srcName) {
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
    bundlePolicy: 'max-bundle',
    rtcpMuxPolicy: 'require',
  });
  _pbState.pc = pc;

  pc.ontrack = (e) => { videoEl.srcObject = e.streams[0]; _pbSetProgress(_pbRand(91, 95), _pbRand(96, 99)); };
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  _pbSetProgress(_pbRand(52, 60), _pbRand(63, 70)); // offer created

  // Wait for ICE gathering (5s timeout, Safari-friendly).
  await new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 5000);
    pc.addEventListener('icecandidate', (ev) => {
      if (!ev.candidate) { clearTimeout(t); resolve(); }
    });
  });
  _pbSetProgress(_pbRand(65, 73), _pbRand(80, 86)); // ICE gathering done

  const resp = await fetch(`/api/webrtc?src=${encodeURIComponent(srcName)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/sdp' },
    body: pc.localDescription.sdp,
  });
  if (!resp.ok) throw new Error(`WebRTC HTTP ${resp.status}`);
  const answer = await resp.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  _pbSetProgress(_pbRand(83, 89), _pbRand(90, 94)); // negotiated — awaiting media
}

/** Remove a go2rtc playback stream by name (frees the ffmpeg process + NVR session). */
async function _pbStopStreamByName(name) {
  if (!name) return;
  try {
    await fetch('/api/playback/stream/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  } catch (e) { /* ignore */ }
}

async function _pbStopActiveStream() {
  if (_pbState.pc) { try { _pbState.pc.close(); } catch (e) {} _pbState.pc = null; }
  _pbState.playStartMs = null;
  _pbShowLoading(false);
  const v = document.getElementById('pb-video');
  if (v) { try { v.pause(); } catch (e) {} v.srcObject = null; v.removeAttribute('src'); }
  if (_pbState.streamName) {
    const name = _pbState.streamName;
    _pbState.streamName = null;
    await _pbStopStreamByName(name);
  }
}

// Last-resort stop if the page is closed/hidden with playback running — uses
// sendBeacon so the request survives unload and the NVR/ffmpeg session is freed.
window.addEventListener('pagehide', () => {
  if (_pbState.streamName && navigator.sendBeacon) {
    try {
      const blob = new Blob([JSON.stringify({ name: _pbState.streamName })], { type: 'application/json' });
      navigator.sendBeacon('/api/playback/stream/stop', blob);
    } catch (e) { /* ignore */ }
  }
});

function enterFocus(index) {
  focusedTile = index;
  // No auto-HQ on focus/fullscreen — keep whatever quality the tile already uses
  // (user controls MAIN/SUB explicitly via the HQ button).
  focusAutoHqIndex = null;
  renderGrid();
}

function exitFocus() {
  // Revert auto-promoted HQ back to SUB
  if (focusAutoHqIndex !== null) {
    tileHqState[focusAutoHqIndex] = false;
    delete tileAutoHq[focusAutoHqIndex];
    focusAutoHqIndex = null;
  }
  focusedTile = null;
  renderGrid();
}

/* ══════════════════════════════════════════
   Stream Budget
   ══════════════════════════════════════════ */
const budgetEl = document.getElementById('stream-budget');

function updateBudget() {
  const active = Object.keys(tileAssignments).length;
  budgetEl.textContent = `Active: ${active} / ${maxStreams}`;
  budgetEl.classList.remove('warning', 'critical');
  if (active >= maxStreams) budgetEl.classList.add('critical');
  else if (active >= maxStreams * 0.8) budgetEl.classList.add('warning');
}

/* ══════════════════════════════════════════
   Layout Save / Load
   ══════════════════════════════════════════ */
const savePopover = document.getElementById('save-popover');
const saveNameInput = document.getElementById('save-name-input');
const loadDropdown = document.getElementById('saved-layouts-dropdown');

document.getElementById('btn-save-layout').addEventListener('click', e => {
  e.stopPropagation();
  savePopover.classList.toggle('open');
  loadDropdown.classList.remove('open');
  if (savePopover.classList.contains('open')) saveNameInput.focus();
});
document.getElementById('save-cancel').addEventListener('click', () => savePopover.classList.remove('open'));
document.getElementById('save-confirm').addEventListener('click', () => {
  const name = saveNameInput.value.trim() || `Layout ${new Date().toLocaleTimeString()}`;
  const layouts = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
  layouts[name] = { gridSize, activeLayout: { ...activeLayout }, assignments: { ...tileAssignments }, hqState: { ...tileHqState } };
  localStorage.setItem('go2rtc-layouts', JSON.stringify(layouts));
  saveNameInput.value = '';
  savePopover.classList.remove('open');
  notify(`Layout "${name}" saved`, { category: 'layout' });
  renderSettingsLayouts();
});

document.getElementById('btn-load-layout').addEventListener('click', e => {
  e.stopPropagation();
  loadDropdown.classList.toggle('open');
  savePopover.classList.remove('open');
  renderLoadDropdown();
});

function renderLoadDropdown() {
  const layouts = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
  const names = Object.keys(layouts);
  if (!names.length) {
    loadDropdown.innerHTML = '<div style="padding:8px;color:var(--text-300);font-size:12px">No saved layouts</div>';
    return;
  }
  loadDropdown.innerHTML = names.map(n => {
    const lay = layouts[n];
    let lbl;
    if (lay.activeLayout && lay.activeLayout.type === 'focus') {
      const fl = FOCUS_LAYOUTS.find(l => l.id === lay.activeLayout.id);
      lbl = fl ? fl.label : lay.activeLayout.id;
    } else {
      const sz = lay.gridSize || (lay.activeLayout && lay.activeLayout.size) || '?';
      lbl = `${sz}\u00D7${sz}`;
    }
    return `<div class="saved-layout-item" data-name="${esc(n)}">${esc(n)} (${lbl})</div>`;
  }).join('');
  loadDropdown.querySelectorAll('.saved-layout-item').forEach(item => {
    item.addEventListener('click', () => {
      const name = item.dataset.name;
      const layout = layouts[name];
      if (layout.activeLayout) {
        activeLayout = { ...layout.activeLayout };
        if (activeLayout.type === 'uniform') gridSize = activeLayout.size;
      } else {
        gridSize = layout.gridSize;
        activeLayout = { type: 'uniform', size: gridSize };
      }
      tileAssignments = { ...layout.assignments };
      tileHqState = layout.hqState ? { ...layout.hqState } : {};
      presetsEl.querySelectorAll('button[data-size]').forEach(b => b.classList.toggle('active', activeLayout.type === 'uniform' && +b.dataset.size === activeLayout.size));
      presetsEl.querySelectorAll('button.focus-preset').forEach(b => b.classList.toggle('active', activeLayout.type === 'focus' && b.dataset.focusId === activeLayout.id));
      renderGrid();
      loadDropdown.classList.remove('open');
      notify(`Layout "${name}" loaded`, { category: 'layout' });
    });
  });
}

// Close popovers on outside click
document.addEventListener('click', e => {
  if (!e.target.closest('.popover-anchor')) {
    savePopover.classList.remove('open');
    loadDropdown.classList.remove('open');
  }
});

/* ══════════════════════════════════════════
   Settings Modal
   ══════════════════════════════════════════ */
const settingsModal = document.getElementById('settings-modal');
const modalTitle = document.getElementById('modal-title');
const TAB_TITLES = { cameras: 'Cameras', streams: 'Stream Settings', display: 'Display', layouts: 'Layouts', analytics: 'Analytics', about: 'Shortcuts' };

document.getElementById('btn-settings').addEventListener('click', () => openSettings());
document.getElementById('modal-close-btn').addEventListener('click', () => closeSettings());
settingsModal.addEventListener('click', e => { if (e.target === settingsModal) closeSettings(); });

document.querySelectorAll('.modal-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab').forEach(t => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');
    document.getElementById(`pane-${tab.dataset.tab}`).classList.add('active');
    modalTitle.textContent = TAB_TITLES[tab.dataset.tab];
    if (tab.dataset.tab === 'analytics') renderAnalyticsTab();
  });
});

/* ══════════════════════════════════════════
   Analytics Tab — render (Phase 1 chunk 2: Global panel + Capability Matrix)
   ══════════════════════════════════════════ */
// Session-only filter state for the Analytics tab. Resets on page reload — matches
// the project's session-only filter convention (see Activity Log filters).
let analyticsGroupFilter = 'All';

// Phase 2: Analytics tab view state. The tab can show one of:
//   'matrix'    — the capability matrix (default)
//   'deep-dive' — single-camera deep dive panel (set by openCameraDeepDive)
//   'wizard'    — first-time setup landing (only shown if no cells are
//                 enabled AND wizard hasn't been dismissed)
// Stored at module scope so re-renders don't bounce back to the matrix.
let _analyticsView = 'matrix';
let _analyticsDeepDiveCameraId = null;
let _wizardForceShow = false;        // user explicitly re-opened the wizard

function analyticsHasAnyEnabledCell() {
  for (const camId in analyticsConfig) {
    const camCfg = analyticsConfig[camId];
    if (!camCfg) continue;
    for (const detId in camCfg) {
      if (detId.startsWith('_')) continue;
      const cell = camCfg[detId];
      if (cell && cell.enabled) return true;
    }
  }
  return false;
}

function openCameraDeepDive(cameraId) {
  _analyticsView = 'deep-dive';
  _analyticsDeepDiveCameraId = cameraId;
  renderAnalyticsTab();
}

function exitCameraDeepDive() {
  _analyticsView = 'matrix';
  _analyticsDeepDiveCameraId = null;
  renderAnalyticsTab();
}

function _gpuPercent() {
  // Simulated GPU budget. Counts cells across analyticsConfig that resolve to
  // 'server'; each contributes a flat 6% (placeholder cost). Cap at 100.
  let count = 0;
  for (const camId in analyticsConfig) {
    const camCfg = analyticsConfig[camId];
    if (!camCfg) continue;
    for (const detId in camCfg) {
      const r = resolveSource(camId, detId);
      if (r.boundTo === 'server') count++;
    }
  }
  return Math.min(100, count * 6);
}

function _cellGlyph(state) {
  switch (state) {
    case 'edge':    return '\u{1F7E2}'; // 🟢
    case 'server':  return '\u{1F535}'; // 🔵
    case 'off':     return '⚪';    // ⚪
    case 'pending': return '⚠';    // ⚠
    case 'offline': return '✗';    // ✗
  }
  return '';
}

function _cellTooltip(camera, detector, state, info) {
  if (state === 'offline') {
    return `${detector.label}: camera ${camera.name} is offline — detector cannot run.`;
  }
  if (state === 'off') {
    return `${detector.label}: Off. Click to configure.`;
  }
  const sourceLabel = info.boundTo === 'edge' ? 'Edge' : info.boundTo === 'server' ? 'Server' : 'Pending';
  // Phase 2: sleeping decoration in tooltip.
  const sleepNote = info && info.sleeping ? '\nSleeping — outside schedule window.' : '';
  if (info.pinned && (state === 'edge' || state === 'server')) {
    return `Pinned to ${sourceLabel}. Click to edit.\n${info.reason}${sleepNote}`;
  }
  if (state === 'pending') {
    return `Pending: ${info.reason || 'no source available'}. Click to edit.`;
  }
  // Auto-bound edge / server
  return `Auto → ${sourceLabel}. ${info.reason}${sleepNote} Click to edit.`;
}

function renderAnalyticsTab() {
  const host = document.getElementById('analytics-content');
  if (!host) return;

  // Phase 2: branch on view. Deep dive replaces the matrix in-place.
  if (_analyticsView === 'deep-dive') {
    renderCameraDeepDive(host, _analyticsDeepDiveCameraId);
    return;
  }

  // Wizard landing — only when no cells exist AND it hasn't been dismissed,
  // OR the user explicitly re-opened the wizard.
  const shouldShowWizard = _wizardForceShow ||
    (!analyticsHasAnyEnabledCell() && !settings.analyticsWizardDismissed);
  if (shouldShowWizard) {
    renderAnalyticsWizardLanding(host);
    return;
  }

  // ── Filter the visible cameras by group (session-only) ──
  const allGroupNames = getAllGroupNames();
  if (analyticsGroupFilter !== 'All' && !allGroupNames.includes(analyticsGroupFilter)) {
    analyticsGroupFilter = 'All'; // group disappeared (deleted) — reset
  }
  const visibleCameras = analyticsGroupFilter === 'All'
    ? cameras.slice()
    : cameras.filter(c => c.group === analyticsGroupFilter);

  const gpu = _gpuPercent();

  // ── Global panel ──
  const serverChecksHtml = DETECTORS.map(d => {
    const on = !!serverDetectors[d.id];
    return `
      <label class="srv-det${on ? ' on' : ' off'}" title="${esc(d.label)}">
        <input type="checkbox" data-srv-det="${esc(d.id)}" ${on ? 'checked' : ''}>
        <span class="srv-det-glyph">${on ? '✓' : '✗'}</span>
        <span class="srv-det-label">${esc(d.shortLabel)}</span>
      </label>
    `;
  }).join('');

  const globalHtml = `
    <section class="analytics-global">
      <header class="analytics-global-head">
        <span class="analytics-global-caret">▼</span>
        <h3>Global</h3>
      </header>
      <div class="analytics-global-body">
        <div class="srv-det-row">
          <span class="srv-det-row-label">Server detectors:</span>
          <div class="srv-det-list">${serverChecksHtml}</div>
        </div>
        <div class="srv-meter-row">
          <span class="srv-meter-label">GPU:</span>
          <div class="gpu-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${gpu}">
            <div class="gpu-meter-bar" style="width:${gpu}%"></div>
          </div>
          <span class="gpu-meter-pct">${gpu}%</span>
          <span class="srv-meter-sep">·</span>
          <span class="srv-meter-retention">Events stored: 14d <span class="srv-meter-info" title="Static placeholder in this prototype">ⓘ</span></span>
        </div>
      </div>
    </section>
  `;

  // ── Filter row ──
  const groupOptions = ['All', ...allGroupNames].map(g =>
    `<option value="${esc(g)}"${g === analyticsGroupFilter ? ' selected' : ''}>${esc(g)}</option>`
  ).join('');
  // Phase 2: matrix toolbar — wizard re-open, import preset, bulk selection
  // counter and overflow menu.
  const selectionCount = _bulkSelectionSize();
  const filterHtml = `
    <div class="analytics-filter-row">
      <label class="cap-filter-label" for="cap-group-filter">Group:</label>
      <select id="cap-group-filter" class="form-select cap-filter-select">${groupOptions}</select>
      <span class="cap-count">Showing ${visibleCameras.length} of ${cameras.length} cameras</span>
      <span class="cap-toolbar-spacer"></span>
      ${selectionCount ? `<button type="button" class="btn btn-secondary btn-sm" data-cap-act="bulk-clear">Clear selection (${selectionCount})</button>` : ''}
      <button type="button" class="btn btn-secondary btn-sm" data-cap-act="open-wizard">+ Setup wizard</button>
      <button type="button" class="btn btn-secondary btn-sm" data-cap-act="import-preset">Import preset…</button>
      <button type="button" class="btn btn-secondary btn-sm cap-overflow-btn" data-cap-act="overflow" aria-label="More actions">⋯</button>
    </div>
    ${_renderBulkActionBar()}
  `;

  // ── Capability Matrix table ──
  const headerCellsHtml = DETECTORS.map(d =>
    `<th class="cap-col" title="${esc(d.label)}">${esc(d.shortLabel)}</th>`
  ).join('');

  let bodyHtml = '';
  if (!visibleCameras.length) {
    bodyHtml = `<tr><td class="cap-empty" colspan="${DETECTORS.length + 1}">No cameras in this group.</td></tr>`;
  } else {
    for (const cam of visibleCameras) {
      const dotColor = getGroupColor(cam.group);
      const offline = cam.status === 'offline';
      const rowClass = offline ? ' cap-row-offline' : '';
      const rowCells = DETECTORS.map(d => {
        const info = offline ? null : resolveSource(cam.id, d.id);
        // 'off' here covers either disabled config OR no config at all.
        const state = offline ? 'offline' : info.boundTo; // edge | server | pending | off
        const glyph = _cellGlyph(state);
        const pin = (!offline && info && info.pinned && (state === 'edge' || state === 'server'))
          ? '<sup class="cap-pin">\u{1F4CC}</sup>' : '';
        // Phase 2: schedule clock indicator. Shown whenever the cell has a
        // non-24/7 schedule, regardless of whether it's currently armed or
        // sleeping — it signals "this detector has a schedule attached".
        let scheduleGlyph = '';
        let sleepingClass = '';
        let maskGlyph = '';
        let zoneGlyph = '';
        if (!offline && state !== 'off') {
          const sch = getSchedule(cam.id, d.id);
          if (sch.kind !== '24/7') {
            scheduleGlyph = '<sup class="cap-sched" title="Has a schedule">\u{1F552}</sup>';
          }
          if (info && info.sleeping) sleepingClass = ' cap-cell-sleeping';
          // Phase 2 — Batch B: mask + zone-binding indicators.
          const camGeom = analyticsConfig[cam.id] && analyticsConfig[cam.id]._geometry;
          if (camGeom && camGeom.masks && camGeom.masks.length) {
            maskGlyph = '<sup class="cap-mask" title="A mask is active on this camera">\u{25A0}</sup>';
          }
          const cellCfg = analyticsConfig[cam.id] && analyticsConfig[cam.id][d.id];
          if (cellCfg && Array.isArray(cellCfg.zones) && cellCfg.zones.length
              && !cellCfg.zones.includes('whole-frame')) {
            zoneGlyph = '<sup class="cap-zone" title="Bound to a specific zone">\u{25CE}</sup>';
          }
        }
        const tip = _cellTooltip(cam, d, state, info || {});
        const disabledAttr = offline ? ' disabled aria-disabled="true"' : '';
        const selectedClass = _bulkSelection.has(`${cam.id}|${d.id}`) ? ' selected' : '';
        return `
          <td class="cap-td">
            <button type="button"
                    class="cap-cell cell-${state}${sleepingClass}${selectedClass}"
                    data-camera-id="${esc(cam.id)}"
                    data-detector-id="${esc(d.id)}"
                    title="${esc(tip)}"
                    ${disabledAttr}>
              <span class="cap-cell-glyph">${glyph}</span>${pin}${scheduleGlyph}${zoneGlyph}${maskGlyph}
            </button>
          </td>
        `;
      }).join('');

      bodyHtml += `
        <tr class="cap-row${rowClass}" data-camera-id="${esc(cam.id)}">
          <th scope="row" class="cap-row-head">
            <span class="grp-dot" style="background:${dotColor}" title="${esc(cam.group)}"></span>
            <button type="button" class="cap-cam-name cap-cam-name-btn" data-cam-deep-dive="${esc(cam.id)}" title="Open per-camera analytics">${esc(cam.name)}</button>
            ${offline ? '<span class="cap-cam-offline">offline</span>' : ''}
          </th>
          ${rowCells}
        </tr>
      `;
    }
  }

  const matrixHtml = `
    <div class="cap-matrix-wrap">
      <table class="cap-matrix">
        <thead>
          <tr>
            <th class="cap-corner" scope="col">Camera</th>
            ${headerCellsHtml}
          </tr>
        </thead>
        <tbody>${bodyHtml}</tbody>
      </table>
    </div>
    <div class="cap-legend">
      <span><span class="cap-lg cell-edge">${_cellGlyph('edge')}</span> Edge</span>
      <span><span class="cap-lg cell-server">${_cellGlyph('server')}</span> Server</span>
      <span><span class="cap-lg cell-off">${_cellGlyph('off')}</span> Off</span>
      <span><span class="cap-lg cell-pending">${_cellGlyph('pending')}</span> Unsupported / Pending</span>
      <span><span class="cap-lg cell-offline">${_cellGlyph('offline')}</span> Camera offline</span>
      <span><span class="cap-lg">\u{1F4CC}</span> Pinned (manual override)</span>
    </div>
  `;

  host.innerHTML = globalHtml + filterHtml + matrixHtml;

  // ── Wire up handlers ──
  // Server-detector checkboxes (Global panel).
  host.querySelectorAll('input[data-srv-det]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-srv-det');
      const nextEnabled = cb.checked;
      // Enabling never strands cells — apply directly.
      if (nextEnabled) {
        serverDetectors[id] = true;
        saveAnalytics();
        renderAnalyticsTab();
        return;
      }
      // Disabling: run the cascade analyzer. Maybe open the confirm dialog.
      const cascade = _analyzeServerDetectorDisable(id);
      if (!cascade.willPend.length && !cascade.willError.length && !cascade.willFallback.length) {
        // No dependents — apply silently.
        serverDetectors[id] = false;
        saveAnalytics();
        renderAnalyticsTab();
        return;
      }
      // Show confirm dialog. Cancel reverts the checkbox; confirm applies + cascades.
      openServerDetectorCascadeDialog(id, cascade, {
        onCancel: () => {
          cb.checked = true;
        },
        onConfirm: () => {
          _applyServerDetectorDisable(id, cascade);
        }
      });
    });
  });

  // Group filter dropdown.
  const groupSel = host.querySelector('#cap-group-filter');
  if (groupSel) {
    groupSel.addEventListener('change', () => {
      analyticsGroupFilter = groupSel.value || 'All';
      renderAnalyticsTab();
    });
  }

  // Delegated cell click → opens the popover. Camera-name click → deep dive.
  // Shift-click on a cell → bulk-select range. Plain click on a selected
  // cell with bulk mode active → toggle off selection.
  const tableEl = host.querySelector('.cap-matrix');
  if (tableEl) {
    tableEl.addEventListener('click', e => {
      const deepBtn = e.target.closest('button[data-cam-deep-dive]');
      if (deepBtn) {
        const camId = deepBtn.getAttribute('data-cam-deep-dive');
        openCameraDeepDive(camId);
        return;
      }
      const btn = e.target.closest('button.cap-cell');
      if (!btn || btn.disabled) return;
      const camId = btn.getAttribute('data-camera-id');
      const detId = btn.getAttribute('data-detector-id');
      // Shift-click → bulk select range from anchor.
      if (e.shiftKey || _bulkSelectionSize() > 0) {
        if (e.shiftKey && _bulkSelectAnchor) {
          _bulkSelectRange(_bulkSelectAnchor, { camId, detId });
        } else {
          _bulkToggleCell(camId, detId);
          _bulkSelectAnchor = { camId, detId };
        }
        renderAnalyticsTab();
        return;
      }
      _bulkSelectAnchor = { camId, detId };
      openAnalyticsCellPopover(camId, detId);
    });
  }

  // Toolbar button actions.
  host.querySelectorAll('[data-cap-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-cap-act');
      if (act === 'open-wizard') { _wizardForceShow = true; renderAnalyticsTab(); }
      else if (act === 'import-preset') triggerImportPreset();
      else if (act === 'overflow') openMatrixOverflowMenu(btn);
      else if (act === 'bulk-clear') { _bulkClearSelection(); renderAnalyticsTab(); }
    });
  });

  // Bulk action bar handlers (rendered above the matrix when ≥1 cell is selected).
  const bar = host.querySelector('.bulk-action-bar');
  if (bar) _bindBulkActionBar(bar);
}

/* ══════════════════════════════════════════
   Phase 2 — Batch C: Wizard, import preset, bulk operations
   ══════════════════════════════════════════ */

// ── Wizard state ──────────────────────────────────────────────────────
// `wizardDraft` lives only while the wizard modal is open. It's not
// persisted between sessions — closing mid-flow discards.
let _wizardDraft = null;
let _wizardModalState = null;

function renderAnalyticsWizardLanding(host) {
  host.innerHTML = `
    <section class="wizard-landing">
      <header class="wizard-landing-head">
        <h2>Detect what matters. Skip the noise.</h2>
        <p>Set up video analytics on your cameras. You can configure everything by hand, or run a 5-step wizard.</p>
      </header>
      <div class="wizard-landing-cards">
        <button type="button" class="wizard-card" data-wiz-act="quick">
          <div class="wizard-card-icon">⚡</div>
          <div class="wizard-card-title">Quick Setup</div>
          <div class="wizard-card-sub">5 steps · recommended</div>
        </button>
        <button type="button" class="wizard-card" data-wiz-act="manual">
          <div class="wizard-card-icon">▦</div>
          <div class="wizard-card-title">Manual Matrix</div>
          <div class="wizard-card-sub">Skip wizard, configure cells one-by-one</div>
        </button>
        <button type="button" class="wizard-card" data-wiz-act="import">
          <div class="wizard-card-icon">⤓</div>
          <div class="wizard-card-title">Import .json</div>
          <div class="wizard-card-sub">Replicate config from another site</div>
        </button>
      </div>
    </section>
  `;
  host.querySelectorAll('[data-wiz-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-wiz-act');
      if (act === 'quick') openWizardModal();
      else if (act === 'manual') {
        settings.analyticsWizardDismissed = true;
        saveSettings();
        _wizardForceShow = false;
        renderAnalyticsTab();
      } else if (act === 'import') {
        triggerImportPreset();
      }
    });
  });
}

function openWizardModal() {
  closeWizardModal();
  _wizardDraft = {
    step: 1,
    detectors: { person: true, vehicle: true, face: false, lpr: false, motion: false, line: false, loitering: false },
    cameraScope: 'all',          // 'all' | 'groups' | 'individual'
    selectedGroups: new Set(),   // group names if 'groups'
    selectedCameras: new Set(),  // camera ids if 'individual'
    scheduleKind: '24/7',
    notify: { toast: true, log: true, flash: false, sound: false, email: false }
  };
  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-wizard-modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3>Analytics Setup Wizard</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body" id="wizard-body"></div>
    <footer class="analytics-popover-footer wizard-footer" id="wizard-footer"></footer>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  _wizardModalState = { backdropEl: backdrop, keydownHandler: null };

  const close = () => closeWizardModal();
  panel.querySelector('.analytics-popover-close').addEventListener('click', close);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  const keydownHandler = e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', keydownHandler, true);
  _wizardModalState.keydownHandler = keydownHandler;

  _renderWizardBody();
}

function closeWizardModal() {
  if (!_wizardModalState) { _wizardDraft = null; return; }
  const { backdropEl, keydownHandler } = _wizardModalState;
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
  if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
  _wizardModalState = null;
  _wizardDraft = null;
}

function _renderWizardBody() {
  if (!_wizardDraft || !_wizardModalState) return;
  const body = _wizardModalState.backdropEl.querySelector('#wizard-body');
  const footer = _wizardModalState.backdropEl.querySelector('#wizard-footer');
  if (!body || !footer) return;
  const draft = _wizardDraft;

  // Step bar.
  const stepBarHtml = `
    <div class="wizard-steps">
      ${[1, 2, 3, 4, 5].map(n => `
        <div class="wizard-step${draft.step === n ? ' active' : ''}${draft.step > n ? ' done' : ''}">
          <span class="wizard-step-num">${n}</span>
          <span class="wizard-step-label">${['Detect what','Cameras','Schedule','Notify','Review'][n-1]}</span>
        </div>
      `).join('')}
    </div>
  `;

  let stepHtml = '';
  if (draft.step === 1) {
    stepHtml = `
      <h4 class="wizard-step-title">Step 1 — What do you want to detect?</h4>
      <div class="wizard-detector-grid">
        ${DETECTORS.map(d => `
          <label class="wizard-check">
            <input type="checkbox" data-wiz-det="${esc(d.id)}" ${draft.detectors[d.id] ? 'checked' : ''}>
            <span class="wizard-check-label">${esc(d.label)}</span>
          </label>
        `).join('')}
      </div>
    `;
  } else if (draft.step === 2) {
    const groupOptions = getAllGroupNames();
    stepHtml = `
      <h4 class="wizard-step-title">Step 2 — Which cameras?</h4>
      <div class="wizard-radio-list">
        <label class="wizard-radio${draft.cameraScope === 'all' ? ' selected' : ''}">
          <input type="radio" name="wiz-scope" value="all" ${draft.cameraScope === 'all' ? 'checked' : ''}>
          <span><strong>All cameras</strong> (${cameras.length})</span>
        </label>
        <label class="wizard-radio${draft.cameraScope === 'groups' ? ' selected' : ''}">
          <input type="radio" name="wiz-scope" value="groups" ${draft.cameraScope === 'groups' ? 'checked' : ''}>
          <span><strong>By group</strong></span>
        </label>
        ${draft.cameraScope === 'groups' ? `
          <div class="wizard-sub-list">
            ${groupOptions.map(g => {
              const count = cameras.filter(c => c.group === g).length;
              return `
                <label class="wizard-check">
                  <input type="checkbox" data-wiz-group="${esc(g)}" ${draft.selectedGroups.has(g) ? 'checked' : ''}>
                  <span class="wizard-check-label">${esc(g)} (${count})</span>
                </label>
              `;
            }).join('')}
          </div>
        ` : ''}
        <label class="wizard-radio${draft.cameraScope === 'individual' ? ' selected' : ''}">
          <input type="radio" name="wiz-scope" value="individual" ${draft.cameraScope === 'individual' ? 'checked' : ''}>
          <span><strong>Pick individually…</strong></span>
        </label>
        ${draft.cameraScope === 'individual' ? `
          <div class="wizard-sub-list wizard-camera-list">
            ${cameras.map(c => {
              const camCfg = analyticsConfig[c.id] || {};
              const alreadyConfigured = Object.keys(camCfg).some(k => !k.startsWith('_') && camCfg[k] && camCfg[k].enabled);
              return `
                <label class="wizard-check">
                  <input type="checkbox" data-wiz-cam="${esc(c.id)}" ${draft.selectedCameras.has(c.id) ? 'checked' : ''}>
                  <span class="wizard-check-label">${esc(c.name)}${alreadyConfigured ? ' <span class="wizard-tag">already configured</span>' : ' <span class="wizard-tag wizard-tag-new">new</span>'}</span>
                </label>
              `;
            }).join('')}
          </div>
        ` : ''}
      </div>
    `;
  } else if (draft.step === 3) {
    stepHtml = `
      <h4 class="wizard-step-title">Step 3 — When should detection be armed?</h4>
      <div class="wizard-radio-list">
        ${['24/7','after-hours','business','custom'].map(k => `
          <label class="wizard-radio${draft.scheduleKind === k ? ' selected' : ''}">
            <input type="radio" name="wiz-sch" value="${esc(k)}" ${draft.scheduleKind === k ? 'checked' : ''}>
            <span>${k === '24/7' ? 'Always' : k === 'after-hours' ? 'After hours (18:00 – 07:00)' : k === 'business' ? 'Business hours only (Mon–Fri 09:00 – 17:00)' : 'Custom (edit per-cell after setup)'}</span>
          </label>
        `).join('')}
      </div>
      <p class="wizard-step-hint">Schedule applies to every detector created by this wizard. You can change schedules per detector later.</p>
    `;
  } else if (draft.step === 4) {
    stepHtml = `
      <h4 class="wizard-step-title">Step 4 — How should we notify you?</h4>
      <div class="wizard-radio-list">
        <label class="wizard-check"><input type="checkbox" data-wiz-notif="toast" ${draft.notify.toast ? 'checked' : ''}> Toast on screen</label>
        <label class="wizard-check"><input type="checkbox" data-wiz-notif="log" ${draft.notify.log ? 'checked' : ''}> Log to Activity feed</label>
        <label class="wizard-check"><input type="checkbox" data-wiz-notif="flash" ${draft.notify.flash ? 'checked' : ''}> Tile border flash</label>
        <label class="wizard-check"><input type="checkbox" data-wiz-notif="sound" ${draft.notify.sound ? 'checked' : ''} disabled> Sound alert <span class="wizard-tag">coming soon</span></label>
        <label class="wizard-check"><input type="checkbox" data-wiz-notif="email" ${draft.notify.email ? 'checked' : ''} disabled> Email digest (daily) <span class="wizard-tag">coming soon</span></label>
      </div>
    `;
  } else if (draft.step === 5) {
    const review = _wizardComputePlan();
    const detLabels = DETECTORS.filter(d => draft.detectors[d.id]).map(d => d.label);
    const scheduleLabel = SCHEDULE_LABELS[draft.scheduleKind] || draft.scheduleKind;
    stepHtml = `
      <h4 class="wizard-step-title">Step 5 — Review</h4>
      <div class="wizard-review">
        <div class="wizard-review-row"><strong>Detecting:</strong> ${detLabels.length ? detLabels.map(esc).join(', ') : '<em>(none)</em>'}</div>
        <div class="wizard-review-row"><strong>Cameras:</strong> ${review.cameras.length} (${review.cameras.length ? esc(review.cameras.slice(0, 4).map(c => c.name).join(', ')) + (review.cameras.length > 4 ? ` …+${review.cameras.length - 4}` : '') : '<em>none</em>'})</div>
        <div class="wizard-review-row"><strong>Sources:</strong> ${review.edgeCount} edge · ${review.serverCount} server${review.pendingCount ? ` · <span class="wizard-warn">${review.pendingCount} pending</span>` : ''}</div>
        <div class="wizard-review-row"><strong>Schedule:</strong> ${esc(scheduleLabel)}</div>
        <div class="wizard-review-row"><strong>Est. GPU budget:</strong> ${review.gpu}%</div>
        ${review.serverDetectorsToEnable.length ? `
          <div class="wizard-warn-block">
            ⚠ ${review.serverDetectorsToEnable.length} server detector${review.serverDetectorsToEnable.length === 1 ? '' : 's'} (${esc(review.serverDetectorsToEnable.map(d => DETECTOR_BY_ID[d].label).join(', '))}) will be enabled globally to cover cameras lacking edge AI.
          </div>
        ` : ''}
      </div>
    `;
  }

  body.innerHTML = stepBarHtml + stepHtml;
  footer.innerHTML = `
    ${draft.step > 1 ? '<button type="button" class="btn btn-secondary" data-wiz-nav="back">Back</button>' : '<span></span>'}
    <span class="wizard-footer-spacer"></span>
    <button type="button" class="btn btn-secondary" data-wiz-nav="cancel">Cancel</button>
    ${draft.step < 5
      ? '<button type="button" class="btn btn-primary" data-wiz-nav="next">Next →</button>'
      : '<button type="button" class="btn btn-primary" data-wiz-nav="apply">Apply</button>'}
  `;

  // Wire up handlers.
  body.querySelectorAll('input[data-wiz-det]').forEach(cb => {
    cb.addEventListener('change', () => {
      _wizardDraft.detectors[cb.getAttribute('data-wiz-det')] = cb.checked;
    });
  });
  body.querySelectorAll('input[name="wiz-scope"]').forEach(r => {
    r.addEventListener('change', () => {
      _wizardDraft.cameraScope = r.value;
      _renderWizardBody();
    });
  });
  body.querySelectorAll('input[data-wiz-group]').forEach(cb => {
    cb.addEventListener('change', () => {
      const g = cb.getAttribute('data-wiz-group');
      if (cb.checked) _wizardDraft.selectedGroups.add(g);
      else _wizardDraft.selectedGroups.delete(g);
    });
  });
  body.querySelectorAll('input[data-wiz-cam]').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-wiz-cam');
      if (cb.checked) _wizardDraft.selectedCameras.add(id);
      else _wizardDraft.selectedCameras.delete(id);
    });
  });
  body.querySelectorAll('input[name="wiz-sch"]').forEach(r => {
    r.addEventListener('change', () => { _wizardDraft.scheduleKind = r.value; });
  });
  body.querySelectorAll('input[data-wiz-notif]').forEach(cb => {
    cb.addEventListener('change', () => {
      _wizardDraft.notify[cb.getAttribute('data-wiz-notif')] = cb.checked;
    });
  });

  footer.querySelectorAll('[data-wiz-nav]').forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.getAttribute('data-wiz-nav');
      if (nav === 'back') { _wizardDraft.step = Math.max(1, _wizardDraft.step - 1); _renderWizardBody(); }
      else if (nav === 'next') { _wizardDraft.step = Math.min(5, _wizardDraft.step + 1); _renderWizardBody(); }
      else if (nav === 'cancel') closeWizardModal();
      else if (nav === 'apply') _applyWizard();
    });
  });
}

function _wizardComputePlan() {
  if (!_wizardDraft) return { cameras: [], edgeCount: 0, serverCount: 0, pendingCount: 0, gpu: 0, serverDetectorsToEnable: [] };
  const draft = _wizardDraft;
  const detIds = Object.keys(draft.detectors).filter(d => draft.detectors[d]);
  let targetCams;
  if (draft.cameraScope === 'all') targetCams = cameras.slice();
  else if (draft.cameraScope === 'groups') targetCams = cameras.filter(c => draft.selectedGroups.has(c.group));
  else targetCams = cameras.filter(c => draft.selectedCameras.has(c.id));

  // Identify which server detectors we'd need to enable to cover cameras
  // lacking edge support. We assume Auto source.
  const serverNeeded = new Set();
  for (const d of detIds) {
    if (serverDetectors[d]) continue;
    for (const cam of targetCams) {
      const caps = cameraCapabilities[cam.id] || {};
      if (!caps[d]) { serverNeeded.add(d); break; }
    }
  }
  const serverDetectorsAfter = { ...serverDetectors };
  for (const d of serverNeeded) serverDetectorsAfter[d] = true;

  // Per-cell resolution preview using the simulated Auto rule.
  let edgeCount = 0, serverCount = 0, pendingCount = 0;
  for (const cam of targetCams) {
    const caps = cameraCapabilities[cam.id] || {};
    for (const d of detIds) {
      if (caps[d]) edgeCount++;
      else if (serverDetectorsAfter[d]) serverCount++;
      else pendingCount++;
    }
  }
  return {
    cameras: targetCams,
    edgeCount, serverCount, pendingCount,
    gpu: Math.min(100, serverCount * 2.5),
    serverDetectorsToEnable: Array.from(serverNeeded)
  };
}

function _applyWizard() {
  if (!_wizardDraft) return;
  const draft = _wizardDraft;
  const plan = _wizardComputePlan();
  const detIds = Object.keys(draft.detectors).filter(d => draft.detectors[d]);
  if (!detIds.length || !plan.cameras.length) {
    showToast('Select at least one detector and one camera.', true);
    return;
  }

  // Enable server detectors that need to be on.
  for (const d of plan.serverDetectorsToEnable) {
    serverDetectors[d] = true;
  }
  // Write cells (merge — never overwrite existing enabled cells).
  let createdCells = 0;
  for (const cam of plan.cameras) {
    if (!analyticsConfig[cam.id]) analyticsConfig[cam.id] = {};
    for (const detId of detIds) {
      const existing = analyticsConfig[cam.id][detId];
      if (existing && existing.enabled) continue;   // preserve user's prior choice
      const cell = {
        enabled: true,
        source: 'auto'
      };
      if (draft.scheduleKind !== '24/7' && draft.scheduleKind !== 'custom') {
        cell.schedule = { kind: draft.scheduleKind };
      }
      analyticsConfig[cam.id][detId] = cell;
      createdCells++;
    }
  }

  settings.analyticsWizardDismissed = true;
  saveSettings();
  saveAnalytics();
  _wizardForceShow = false;
  closeWizardModal();
  analyticsSchedulerTick();
  renderAnalyticsTab();
  renderGrid();
  renderSidebar();

  notify(`Analytics setup complete: ${detIds.length} detector${detIds.length === 1 ? '' : 's'} armed on ${plan.cameras.length} camera${plan.cameras.length === 1 ? '' : 's'} (${createdCells} cells)`, {
    severity: plan.pendingCount ? 'warning' : 'info',
    category: 'analytics',
    subType: 'config'
  });
}

// ── Import preset (UC-VA2-03) ──────────────────────────────────────────
function triggerImportPreset() {
  let fi = document.getElementById('analytics-preset-file');
  if (!fi) {
    fi = document.createElement('input');
    fi.type = 'file';
    fi.accept = '.json,application/json';
    fi.id = 'analytics-preset-file';
    fi.style.display = 'none';
    document.body.appendChild(fi);
    fi.addEventListener('change', _handlePresetFileSelected);
  }
  fi.value = '';
  fi.click();
}

function _handlePresetFileSelected(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    let parsed;
    try { parsed = JSON.parse(ev.target.result); }
    catch (err) { _showPresetError(['File is not valid JSON: ' + err.message]); return; }
    const errors = _validatePreset(parsed);
    if (errors.length) { _showPresetError(errors); return; }
    _showPresetPreview(parsed);
  };
  reader.readAsText(file);
}

function _validatePreset(p) {
  const errs = [];
  if (!p || typeof p !== 'object') { errs.push('Top-level value must be an object.'); return errs; }
  if (!p.serverDetectors || typeof p.serverDetectors !== 'object') errs.push('Missing or invalid "serverDetectors".');
  if (!p.analyticsConfig || typeof p.analyticsConfig !== 'object') errs.push('Missing or invalid "analyticsConfig".');
  return errs;
}

function _showPresetError(errors) {
  alert('Preset file is not a valid Analytics export.\n\n' + errors.join('\n'));
}

function _showPresetPreview(preset) {
  // Resolve cameras: match by id. If no match by id, try matching by name.
  const camById = Object.fromEntries(cameras.map(c => [c.id, c]));
  const camByName = Object.fromEntries(cameras.map(c => [c.name, c]));
  const matched = [];
  const skipped = [];
  for (const camId in preset.analyticsConfig) {
    const camCfg = preset.analyticsConfig[camId];
    if (!camCfg || typeof camCfg !== 'object') continue;
    let target = camById[camId];
    if (!target && camCfg._name) target = camByName[camCfg._name];
    if (target) matched.push({ id: target.id, name: target.name, presetKey: camId, cfg: camCfg });
    else skipped.push(camId);
  }

  // Server toggles to flip.
  const toggleChanges = [];
  for (const d in preset.serverDetectors) {
    const next = !!preset.serverDetectors[d];
    if (!!serverDetectors[d] !== next) toggleChanges.push({ id: d, from: !!serverDetectors[d], to: next });
  }

  let cellCount = 0;
  for (const m of matched) {
    for (const det in m.cfg) {
      if (det.startsWith('_')) continue;
      const c = m.cfg[det];
      if (c && c.enabled) cellCount++;
    }
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-import-preview';
  panel.setAttribute('role', 'dialog');
  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3>Import analytics preset</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body">
      <p>Will enable <strong>${cellCount}</strong> cell${cellCount === 1 ? '' : 's'} across <strong>${matched.length}</strong> camera${matched.length === 1 ? '' : 's'}.</p>
      ${toggleChanges.length ? `
        <div class="import-section">
          <h4>Server detector toggles</h4>
          <ul>
            ${toggleChanges.map(t => `<li>${esc((DETECTOR_BY_ID[t.id] && DETECTOR_BY_ID[t.id].label) || t.id)}: <em>${t.from ? 'on' : 'off'}</em> → <strong>${t.to ? 'on' : 'off'}</strong></li>`).join('')}
          </ul>
        </div>
      ` : ''}
      ${skipped.length ? `
        <div class="import-section import-section-warn">
          <h4>⚠ ${skipped.length} preset camera${skipped.length === 1 ? '' : 's'} not found locally</h4>
          <ul>${skipped.slice(0, 8).map(k => `<li>${esc(k)} — skipped</li>`).join('')}${skipped.length > 8 ? `<li>…+${skipped.length - 8} more</li>` : ''}</ul>
        </div>
      ` : ''}
      ${preset.gallerySyncRules ? `<p class="import-note">Note: gallerySyncRules in this preset will be ignored (Phase 3).</p>` : ''}
    </div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary" data-imp-cancel>Cancel</button>
      <button type="button" class="btn btn-primary" data-imp-apply>Import</button>
    </footer>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener('keydown', kd, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', kd, true);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  panel.querySelector('.analytics-popover-close').addEventListener('click', close);
  panel.querySelector('[data-imp-cancel]').addEventListener('click', close);
  panel.querySelector('[data-imp-apply]').addEventListener('click', () => {
    // Merge: replace per matched cell; preserve any field shape (including
    // schedule / zones / _geometry).
    for (const t of toggleChanges) serverDetectors[t.id] = t.to;
    for (const m of matched) {
      if (!analyticsConfig[m.id]) analyticsConfig[m.id] = {};
      for (const det in m.cfg) {
        if (det.startsWith('_')) {
          // Carry over per-camera fields (e.g., _cameraDefault, _geometry).
          analyticsConfig[m.id][det] = m.cfg[det];
          continue;
        }
        analyticsConfig[m.id][det] = m.cfg[det];
      }
    }
    saveAnalytics();
    settings.analyticsWizardDismissed = true;
    saveSettings();
    _wizardForceShow = false;
    close();
    analyticsSchedulerTick();
    renderAnalyticsTab();
    renderGrid();
    renderSidebar();
    notify(`Preset imported: ${cellCount} cell${cellCount === 1 ? '' : 's'} configured`, {
      category: 'analytics', subType: 'config', severity: 'info'
    });
  });
}

// ── Bulk operations on the matrix (UC-VA2-13/14/15) ────────────────────
// Selection is a Set of "cameraId|detectorId" keys.
const _bulkSelection = new Set();
let _bulkSelectAnchor = null;

function _bulkSelectionSize() { return _bulkSelection.size; }
function _bulkSelectionKeys() { return Array.from(_bulkSelection); }
function _bulkClearSelection() { _bulkSelection.clear(); _bulkSelectAnchor = null; }
function _bulkToggleCell(camId, detId) {
  const key = `${camId}|${detId}`;
  if (_bulkSelection.has(key)) _bulkSelection.delete(key);
  else _bulkSelection.add(key);
}
function _bulkSelectRange(anchor, target) {
  // Build a rectangle between the two cells in matrix coords.
  const visibleCams = analyticsGroupFilter === 'All' ? cameras.slice() : cameras.filter(c => c.group === analyticsGroupFilter);
  const aRow = visibleCams.findIndex(c => c.id === anchor.camId);
  const bRow = visibleCams.findIndex(c => c.id === target.camId);
  const aCol = DETECTORS.findIndex(d => d.id === anchor.detId);
  const bCol = DETECTORS.findIndex(d => d.id === target.detId);
  if (aRow < 0 || bRow < 0 || aCol < 0 || bCol < 0) return;
  const [r1, r2] = [Math.min(aRow, bRow), Math.max(aRow, bRow)];
  const [c1, c2] = [Math.min(aCol, bCol), Math.max(aCol, bCol)];
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      _bulkSelection.add(`${visibleCams[r].id}|${DETECTORS[c].id}`);
    }
  }
}

function _renderBulkActionBar() {
  if (!_bulkSelectionSize()) return '';
  const n = _bulkSelectionSize();
  return `
    <div class="bulk-action-bar">
      <span class="bulk-count"><strong>${n}</strong> cell${n === 1 ? '' : 's'} selected</span>
      <span class="bulk-bar-spacer"></span>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="enable-auto">Enable (Auto)</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="enable-edge">Enable (Edge)</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="enable-server">Enable (Server)</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="disable">Disable</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="pin-edge">Pin → Edge</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="pin-server">Pin → Server</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="clear-pin">Clear pin (Auto)</button>
      <button type="button" class="btn btn-secondary btn-sm" data-bulk-act="clear-selection">Clear selection</button>
    </div>
  `;
}

function _bindBulkActionBar(bar) {
  bar.querySelectorAll('[data-bulk-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-bulk-act');
      if (act === 'clear-selection') { _bulkClearSelection(); renderAnalyticsTab(); return; }
      _previewBulkAction(act);
    });
  });
}

function _previewBulkAction(act) {
  const keys = _bulkSelectionKeys();
  if (!keys.length) return;
  const cells = keys.map(k => {
    const [camId, detId] = k.split('|');
    return { camId, detId };
  });

  // Compute previews.
  const previews = [];
  const serverDetectorsAfter = { ...serverDetectors };
  const pendingByDet = new Set();
  for (const { camId, detId } of cells) {
    const cam = cameras.find(c => c.id === camId);
    const det = DETECTOR_BY_ID[detId];
    if (!cam || !det) continue;
    const before = resolveSource(camId, detId);
    const cfg = (analyticsConfig[camId] || {})[detId];
    const wasEnabled = !!(cfg && cfg.enabled);

    let nextEnabled = wasEnabled;
    let nextSource = cfg ? (cfg.source || 'auto') : 'auto';
    let skip = false;
    if (act === 'enable-auto')   { nextEnabled = true; nextSource = 'auto'; }
    if (act === 'enable-edge')   { nextEnabled = true; nextSource = 'edge'; }
    if (act === 'enable-server') { nextEnabled = true; nextSource = 'server'; }
    if (act === 'disable')       { if (!wasEnabled) skip = true; nextEnabled = false; }
    if (act === 'pin-edge')      { if (!wasEnabled) skip = true; nextSource = 'edge'; }
    if (act === 'pin-server')    { if (!wasEnabled) skip = true; nextSource = 'server'; }
    if (act === 'clear-pin')     { if (!wasEnabled) skip = true; nextSource = 'auto'; }

    // Simulate the resolution after.
    const caps = cameraCapabilities[camId] || {};
    let afterBound = 'off', afterReason = '';
    if (nextEnabled) {
      if (nextSource === 'edge') afterBound = caps[detId] ? 'edge' : 'pending';
      else if (nextSource === 'server') afterBound = serverDetectorsAfter[detId] ? 'server' : 'pending';
      else afterBound = caps[detId] ? 'edge' : (serverDetectorsAfter[detId] ? 'server' : 'pending');
    }
    if (afterBound === 'pending' && !serverDetectorsAfter[detId]) pendingByDet.add(detId);
    previews.push({
      camId, detId, camName: cam.name, detLabel: det.label,
      beforeBound: wasEnabled ? before.boundTo : 'off',
      afterBound,
      wasEnabled, nextEnabled, nextSource, skip
    });
  }

  // Build dialog.
  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-bulk-preview';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  const rowsHtml = previews.map(p => {
    if (p.skip) {
      return `<tr class="bulk-row-skip"><td>${esc(p.camName)} / ${esc(p.detLabel)}</td><td colspan="2"><em>skipped (${p.wasEnabled ? 'no change' : 'detector is off'})</em></td></tr>`;
    }
    const beforeGlyph = _cellGlyph(p.beforeBound);
    const afterGlyph = _cellGlyph(p.afterBound);
    const warn = p.afterBound === 'pending' ? '<span class="bulk-row-warn">⚠ Pending</span>' : '';
    return `<tr><td>${esc(p.camName)} / ${esc(p.detLabel)}</td><td class="bulk-row-arrow"><span class="cell-${p.beforeBound}">${beforeGlyph}</span> → <span class="cell-${p.afterBound}">${afterGlyph}</span></td><td>${warn}</td></tr>`;
  }).join('');

  const enableServerOptions = Array.from(pendingByDet).filter(d => !serverDetectorsAfter[d]).map(d => `
    <label class="bulk-fixup">
      <input type="checkbox" data-bulk-enable-server="${esc(d)}" checked>
      Also enable server ${esc((DETECTOR_BY_ID[d] && DETECTOR_BY_ID[d].label) || d)} globally
    </label>
  `).join('');

  const applicable = previews.filter(p => !p.skip).length;
  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3>Bulk action — ${esc(act)} (${applicable} cell${applicable === 1 ? '' : 's'})</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body">
      <table class="bulk-preview-table"><tbody>${rowsHtml}</tbody></table>
      ${enableServerOptions ? `<div class="bulk-fixup-block">${enableServerOptions}</div>` : ''}
    </div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary" data-bulk-cancel>Cancel</button>
      <button type="button" class="btn btn-primary" data-bulk-apply>Apply ${applicable} change${applicable === 1 ? '' : 's'}</button>
    </footer>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener('keydown', kd, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  const kd = e => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
  document.addEventListener('keydown', kd, true);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  panel.querySelector('.analytics-popover-close').addEventListener('click', close);
  panel.querySelector('[data-bulk-cancel]').addEventListener('click', close);
  panel.querySelector('[data-bulk-apply]').addEventListener('click', () => {
    // Enable server detectors picked in fixups first.
    panel.querySelectorAll('input[data-bulk-enable-server]').forEach(cb => {
      if (cb.checked) serverDetectors[cb.getAttribute('data-bulk-enable-server')] = true;
    });
    // Apply each cell change atomically.
    let appliedEdge = 0, appliedServer = 0, appliedPending = 0, applied = 0;
    for (const p of previews) {
      if (p.skip) continue;
      const cfg = _ensureCellCfg(p.camId, p.detId);
      cfg.enabled = p.nextEnabled;
      cfg.source = p.nextSource;
      // Re-evaluate after global server changes for pending count.
      const info = resolveSource(p.camId, p.detId);
      if (cfg.enabled) {
        if (info.boundTo === 'edge') appliedEdge++;
        else if (info.boundTo === 'server') appliedServer++;
        else if (info.boundTo === 'pending') appliedPending++;
      }
      applied++;
    }
    saveAnalytics();
    _bulkClearSelection();
    close();
    renderAnalyticsTab();
    renderGrid();
    renderSidebar();
    const summary = `Bulk: ${esc(act)} applied to ${applied} cell${applied === 1 ? '' : 's'} (${appliedEdge} edge, ${appliedServer} server${appliedPending ? ', ' + appliedPending + ' pending' : ''})`;
    notify(summary, {
      severity: appliedPending ? 'warning' : 'info',
      category: 'analytics',
      subType: 'config'
    });
  });
}

function openMatrixOverflowMenu(anchor) {
  // Remove any prior menu.
  document.querySelectorAll('.cap-overflow-menu').forEach(m => m.remove());
  const menu = document.createElement('div');
  menu.className = 'cap-overflow-menu';
  menu.innerHTML = `
    <button type="button" data-of-act="select-pinned">Select all pinned cells</button>
    <button type="button" data-of-act="reset-all">Reset all analytics…</button>
  `;
  document.body.appendChild(menu);
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = (rect.bottom + 4) + 'px';
  menu.style.right = (window.innerWidth - rect.right) + 'px';
  const close = () => { menu.remove(); document.removeEventListener('click', closeHandler); };
  const closeHandler = e => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);

  menu.querySelector('[data-of-act="select-pinned"]').addEventListener('click', () => {
    _bulkClearSelection();
    for (const cam of cameras) {
      const camCfg = analyticsConfig[cam.id];
      if (!camCfg) continue;
      for (const det of DETECTORS) {
        if (det.id.startsWith('_')) continue;
        const cell = camCfg[det.id];
        if (!cell || !cell.enabled) continue;
        if ((cell.source || 'auto') !== 'auto') _bulkSelection.add(`${cam.id}|${det.id}`);
      }
    }
    close();
    renderAnalyticsTab();
    if (!_bulkSelectionSize()) showToast('No pinned cells found.', true);
  });
  menu.querySelector('[data-of-act="reset-all"]').addEventListener('click', () => {
    if (!confirm('Reset ALL analytics configuration (cells, schedules, zones, masks, camera defaults)? This cannot be undone.')) return;
    analyticsConfig = {};
    serverDetectors = { person: true, vehicle: true, face: false, lpr: false, motion: true, line: false, loitering: false };
    saveAnalytics();
    settings.analyticsWizardDismissed = false;
    saveSettings();
    _bulkClearSelection();
    close();
    renderAnalyticsTab();
    renderGrid();
    renderSidebar();
    notify('Analytics configuration reset', { category: 'analytics', subType: 'config', severity: 'warning' });
  });
}

/* ══════════════════════════════════════════
   Per-camera deep dive panel (Phase 2 — UC-VA2-04, UC-VA2-19)
   ══════════════════════════════════════════ */
function renderCameraDeepDive(host, cameraId) {
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam) {
    // Camera vanished — bounce back to matrix.
    _analyticsView = 'matrix';
    _analyticsDeepDiveCameraId = null;
    renderAnalyticsTab();
    return;
  }
  const camCfg = analyticsConfig[cameraId] || {};
  const caps = cameraCapabilities[cameraId] || {};
  const camDefault = (camCfg._cameraDefault && camCfg._cameraDefault.source) || 'auto';
  const geom = camCfg._geometry || {};
  const zones = geom.zones || [];
  const lines = geom.lines || [];
  const masks = geom.masks || [];

  // Capabilities summary.
  const capEdgeOn = DETECTORS.filter(d => caps[d.id]).map(d => d.label);
  const capEdgeOff = DETECTORS.filter(d => !caps[d.id]).map(d => d.label);

  // Hardware support check: does this camera support ANY edge detector?
  const hasAnyEdge = DETECTORS.some(d => caps[d.id]);
  const hwBannerHtml = hasAnyEdge
    ? `<div class="dd-hw-support-banner hw-supported"><span class="hw-icon">✓</span> Hardware (Edge AI) supported — ${capEdgeOn.length} detector${capEdgeOn.length === 1 ? '' : 's'} available on device</div>`
    : `<div class="dd-hw-support-banner hw-unsupported"><span class="hw-icon">✗</span> Hardware (Edge AI) not supported — all detectors will use Server (Software)</div>`;

  // Detector table.
  const detectorRowsHtml = DETECTORS.map(d => {
    const cfg = camCfg[d.id];
    const enabled = !!(cfg && cfg.enabled);
    const info = resolveSource(cameraId, d.id);
    const state = enabled ? info.boundTo : 'off';
    const glyph = _cellGlyph(state);
    const source = (cfg && cfg.source) || 'auto';
    const edgeOk = !!caps[d.id];
    const sourceLabel = source === 'auto' ? 'Auto' : source === 'edge' ? 'Edge' : 'Server';
    const schedule = getSchedule(cameraId, d.id);
    const scheduleLabel = SCHEDULE_LABELS[schedule.kind] || schedule.kind;
    const cellZoneIds = (cfg && Array.isArray(cfg.zones)) ? cfg.zones : null;
    let zonesText;
    if (!zones.length) zonesText = '—';
    else if (!cellZoneIds || !cellZoneIds.length || cellZoneIds.includes('whole-frame')) zonesText = 'whole frame';
    else {
      const names = cellZoneIds.map(zid => (zones.find(z => z.id === zid) || {}).name).filter(Boolean);
      zonesText = names.length ? names.join(', ') : 'whole frame';
    }
    const sleepBadge = info.sleeping ? ' <span class="dd-sleep-badge" title="Sleeping — outside schedule">💤</span>' : '';
    const armed = enabled && info.boundTo !== 'pending' && info.boundTo !== 'errored';
    const supMask = _suppressedByMask.get(`${cameraId}|${d.id}`) || 0;
    const supZone = _suppressedByZone.get(`${cameraId}|${d.id}`) || 0;
    const supText = (supMask || supZone)
      ? `<div class="dd-sup">${supMask ? `Mask suppressed ${supMask}` : ''}${supMask && supZone ? ' · ' : ''}${supZone ? `Zone suppressed ${supZone}` : ''}</div>`
      : '';

    // Hardware support label per detector
    let hwLabel = '';
    if (edgeOk) {
      hwLabel = `<span class="dd-det-hw-label hw-edge" title="Hardware (Edge) supported">HW ✓</span>`;
    } else {
      hwLabel = `<span class="dd-det-hw-label hw-server" title="Hardware not supported — will use Server (Software)">SW only</span>`;
    }

    // Source chip: disable Edge option display if hardware doesn't support it
    const sourceChipDisabled = (!enabled) ? 'disabled' : '';
    const sourceChipClass = (source === 'edge' && !edgeOk) ? 'dd-source-chip disabled-source' : 'dd-source-chip';

    return `
      <tr class="dd-det-row${enabled ? '' : ' dd-det-row-off'}" data-detector-id="${esc(d.id)}">
        <td class="dd-det-name">
          <input type="checkbox" data-dd-toggle="${esc(d.id)}" ${enabled ? 'checked' : ''} aria-label="${esc(enabled ? 'Disable' : 'Enable')} ${esc(d.label)}">
          <span class="dd-det-label">${esc(d.label)}</span>${hwLabel}
        </td>
        <td class="dd-det-source">
          <span class="dd-source-glyph cell-${state}">${glyph}</span>
          <button type="button" class="${sourceChipClass}" data-dd-source="${esc(d.id)}" ${sourceChipDisabled}>${esc(sourceLabel)}</button>
        </td>
        <td class="dd-det-schedule">
          <button type="button" class="dd-chip" data-dd-schedule="${esc(d.id)}" ${enabled ? '' : 'disabled'} title="Edit schedule">${esc(scheduleLabel)}${sleepBadge}</button>
        </td>
        <td class="dd-det-zones">
          <button type="button" class="dd-chip" data-dd-zones="${esc(d.id)}" ${(!enabled || !zones.length) ? 'disabled' : ''} title="${zones.length ? 'Edit zone binding' : 'Define zones first via the editor below'}">${esc(zonesText)}</button>
          ${supText}
        </td>
        <td class="dd-det-test">
          <button type="button" class="btn btn-secondary btn-sm" data-dd-test="${esc(d.id)}" ${armed ? '' : 'disabled'} title="${armed ? 'Test fire' : 'Enable and bind a source first'}">🧪</button>
        </td>
      </tr>
    `;
  }).join('');

  const ana = _computeCameraAnalyticsDot(cameraId);

  host.innerHTML = `
    <div class="dd-toolbar">
      <button type="button" class="btn btn-secondary dd-back" data-dd-back>◀ Back to matrix</button>
      <h3 class="dd-title">${esc(cam.name)} · Analytics</h3>
      <span class="cam-analytics-dot ana-state-${ana.state}" title="${esc(ana.title)}">${ana.glyph}</span>
    </div>

    ${hwBannerHtml}

    <section class="analytics-global dd-section">
      <header class="analytics-global-head"><h3>Reported capabilities (read-only)</h3></header>
      <div class="analytics-global-body">
        <div class="dd-caps-row"><strong>Edge supports:</strong> ${capEdgeOn.length ? capEdgeOn.map(esc).join(', ') : 'none'}</div>
        <div class="dd-caps-row dd-caps-row-off"><strong>Edge unsupported:</strong> ${capEdgeOff.length ? capEdgeOff.map(esc).join(', ') : 'none'}</div>
        <div class="dd-caps-row"><strong>Server availability:</strong> depends on the Global panel.</div>
      </div>
    </section>

    <section class="analytics-global dd-section">
      <header class="analytics-global-head"><h3>Camera defaults</h3></header>
      <div class="analytics-global-body dd-cam-default-row">
        <label class="dd-cam-default-label" for="dd-cam-default-sel">Default source for this camera:</label>
        <select class="form-select dd-cam-default-sel" id="dd-cam-default-sel">
          <option value="auto"${camDefault === 'auto' ? ' selected' : ''}>Auto (inherit Global)</option>
          <option value="edge"${camDefault === 'edge' ? ' selected' : ''}${!hasAnyEdge ? ' disabled' : ''}>Edge${!hasAnyEdge ? ' (not supported)' : ''}</option>
          <option value="server"${camDefault === 'server' ? ' selected' : ''}>Server</option>
        </select>
        <span class="dd-cam-default-hint">${hasAnyEdge ? 'Overrides Global. Overridden by per-cell pins.' : 'Edge disabled — hardware does not support Edge AI. Use Server (Software).'}</span>
      </div>
    </section>

    <section class="analytics-global dd-section" id="dd-sensitivity-section">
      <header class="analytics-global-head"><h3>Hardware Sensitivity</h3></header>
      <div class="analytics-global-body dd-sensitivity-body">
        <div class="dd-sensitivity-loading">Loading sensitivity from camera...</div>
      </div>
    </section>

    <section class="analytics-global dd-section">
      <header class="analytics-global-head"><h3>Detectors</h3></header>
      <div class="analytics-global-body">
        <table class="dd-det-table">
          <thead>
            <tr>
              <th class="dd-th-name">Detector</th>
              <th class="dd-th-source">Source</th>
              <th class="dd-th-schedule">Schedule</th>
              <th class="dd-th-zones">Zones</th>
              <th class="dd-th-test"></th>
            </tr>
          </thead>
          <tbody>${detectorRowsHtml}</tbody>
        </table>
      </div>
    </section>

    <section class="analytics-global dd-section">
      <header class="analytics-global-head"><h3>Zones &amp; lines on this camera</h3></header>
      <div class="analytics-global-body">
        <div class="dd-geom-summary">
          ${zones.length} zone${zones.length === 1 ? '' : 's'} · ${lines.length} line${lines.length === 1 ? '' : 's'} · ${masks.length} mask${masks.length === 1 ? '' : 's'}
        </div>
        <button type="button" class="btn btn-primary" data-dd-edit-geom>Edit zones / lines / masks →</button>
      </div>
    </section>

    <section class="analytics-global dd-section">
      <header class="analytics-global-head"><h3>Quick actions</h3></header>
      <div class="analytics-global-body dd-quick-actions">
        <button type="button" class="btn btn-secondary" data-dd-test-all>🧪 Test fire all armed detectors</button>
      </div>
    </section>
  `;

  // ── Wire handlers ──
  const backBtn = host.querySelector('[data-dd-back]');
  if (backBtn) backBtn.addEventListener('click', () => exitCameraDeepDive());

  host.querySelectorAll('input[data-dd-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      const detId = cb.getAttribute('data-dd-toggle');
      const det = DETECTOR_BY_ID[detId];
      if (!det) return;
      const cfg = _ensureCellCfg(cameraId, detId);
      cfg.enabled = cb.checked;
      saveAnalytics();
      syncDetectorToCamera(cameraId, detId, cb.checked);
      renderAnalyticsTab();
      renderGrid();
      renderSidebar();
      notify(`${det.label} detection ${cb.checked ? 'enabled' : 'disabled'} on ${cam.name}`, {
        category: 'analytics', subType: 'config', severity: 'info',
        cameraId: cam.id, cameraName: cam.name, detectorId: detId
      });
    });
  });

  host.querySelectorAll('button[data-dd-source]').forEach(btn => {
    btn.addEventListener('click', () => {
      const detId = btn.getAttribute('data-dd-source');
      openAnalyticsCellPopover(cameraId, detId);
    });
  });

  host.querySelectorAll('button[data-dd-schedule]').forEach(btn => {
    btn.addEventListener('click', () => {
      const detId = btn.getAttribute('data-dd-schedule');
      openScheduleModal(cameraId, detId);
    });
  });

  host.querySelectorAll('button[data-dd-zones]').forEach(btn => {
    btn.addEventListener('click', () => {
      const detId = btn.getAttribute('data-dd-zones');
      openZoneBindingModal(cameraId, detId);
    });
  });

  host.querySelectorAll('button[data-dd-test]').forEach(btn => {
    btn.addEventListener('click', () => {
      const detId = btn.getAttribute('data-dd-test');
      testFireDetector(cameraId, detId);
    });
  });

  const editGeomBtn = host.querySelector('[data-dd-edit-geom]');
  if (editGeomBtn) editGeomBtn.addEventListener('click', () => openZoneEditor(cameraId));

  const testAllBtn = host.querySelector('[data-dd-test-all]');
  if (testAllBtn) testAllBtn.addEventListener('click', () => {
    const armed = getArmedDetectorsForCamera(cameraId);
    if (!armed.length) {
      showToast('No armed detectors on this camera', true);
      return;
    }
    armed.forEach((a, i) => setTimeout(() => testFireDetector(cameraId, a.detectorId), i * 400));
  });

  const defaultSel = host.querySelector('#dd-cam-default-sel');
  if (defaultSel) defaultSel.addEventListener('change', () => {
    _applyCameraDefaultSource(cameraId, defaultSel.value);
  });

  // ── Hardware Sensitivity: async fetch + render sliders ──
  const sensBody = host.querySelector('.dd-sensitivity-body');
  const camObj = cameras.find(c => c.id === cameraId);
  if (sensBody && camObj && camObj.isapiPort) {
    fetch(`/api/detection/sensitivity/${encodeURIComponent(cameraId)}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          sensBody.innerHTML = `<div class="dd-sensitivity-error">${data.error}</div>`;
          return;
        }
        const LABELS = { motion: 'Motion (VMD)', line: 'Line Crossing', loitering: 'Loitering / Intrusion' };
        const rows = Object.entries(LABELS)
          .filter(([id]) => data[id] && data[id].supported && data[id].sensitivity !== null)
          .map(([id, label]) => {
            const val = data[id].sensitivity;
            return `
              <div class="dd-sensitivity-row">
                <label class="dd-sensitivity-label">${label}</label>
                <input type="range" class="dd-sensitivity-slider" data-sens-det="${id}"
                  min="0" max="100" value="${val}">
                <span class="dd-sensitivity-value" data-sens-val="${id}">${val}</span>
              </div>`;
          }).join('');

        if (!rows) {
          sensBody.innerHTML = '<div class="dd-sensitivity-hint">No hardware sensitivity controls available for this camera.</div>';
          return;
        }
        sensBody.innerHTML = rows +
          '<div class="dd-sensitivity-hint">Lower = fewer false alerts. Higher = more sensitive. Changes are applied directly to the camera.</div>';

        // Wire slider events
        sensBody.querySelectorAll('.dd-sensitivity-slider').forEach(slider => {
          const detId = slider.getAttribute('data-sens-det');
          const valEl = sensBody.querySelector(`[data-sens-val="${detId}"]`);

          slider.addEventListener('input', () => {
            if (valEl) valEl.textContent = slider.value;
          });

          slider.addEventListener('change', () => {
            const newVal = parseInt(slider.value, 10);
            slider.disabled = true;
            fetch(`/api/detection/sensitivity/${encodeURIComponent(cameraId)}`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ detectorId: detId, sensitivity: newVal }),
            })
              .then(r => r.json())
              .then(result => {
                slider.disabled = false;
                if (result.error) {
                  showToast(`Failed: ${result.error}`, true);
                } else {
                  showToast(`${detId} sensitivity → ${newVal}`);
                }
              })
              .catch(() => {
                slider.disabled = false;
                showToast('Failed to update sensitivity', true);
              });
          });
        });
      })
      .catch(() => {
        sensBody.innerHTML = '<div class="dd-sensitivity-error">Failed to load sensitivity data.</div>';
      });
  } else if (sensBody) {
    sensBody.innerHTML = '<div class="dd-sensitivity-hint">No ISAPI port configured — sensitivity controls unavailable.</div>';
  }
}

function _applyCameraDefaultSource(cameraId, nextSource) {
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam) return;

  // Compute which Auto cells will silently switch — for confirmation prompt.
  const camCfg = analyticsConfig[cameraId];
  const changes = [];
  if (camCfg) {
    for (const det of DETECTORS) {
      if (det.id.startsWith('_')) continue;
      const cfg = camCfg[det.id];
      if (!cfg || !cfg.enabled) continue;
      if ((cfg.source || 'auto') !== 'auto') continue;
      const beforeCamDefault = (camCfg._cameraDefault && camCfg._cameraDefault.source) || 'auto';
      if (beforeCamDefault === nextSource) continue;
      // Compute before & after binding.
      const before = resolveSource(cameraId, det.id);
      // Temporarily swap.
      const original = camCfg._cameraDefault;
      camCfg._cameraDefault = { source: nextSource };
      const after = resolveSource(cameraId, det.id);
      camCfg._cameraDefault = original;
      if (before.boundTo !== after.boundTo) {
        changes.push({ label: det.label, from: before.boundTo, to: after.boundTo });
      }
    }
  }

  let proceed = true;
  if (changes.length) {
    const summary = changes.map(c => `  • ${c.label}: ${c.from} → ${c.to}`).join('\n');
    proceed = confirm(
      `Set "${cam.name}" default source to ${nextSource}?\n\n` +
      `This will affect ${changes.length} Auto cell${changes.length === 1 ? '' : 's'}:\n` +
      `${summary}\n\nPinned cells are unaffected.`
    );
  }
  if (!proceed) {
    // Revert dropdown if user cancelled.
    renderAnalyticsTab();
    return;
  }

  if (!analyticsConfig[cameraId]) analyticsConfig[cameraId] = {};
  if (nextSource === 'auto') {
    delete analyticsConfig[cameraId]._cameraDefault;
  } else {
    analyticsConfig[cameraId]._cameraDefault = { source: nextSource };
  }
  saveAnalytics();
  renderAnalyticsTab();
  renderGrid();
  renderSidebar();
  notify(`${cam.name}: default source set to ${nextSource}`, {
    category: 'analytics', subType: 'config', severity: 'info',
    cameraId: cam.id, cameraName: cam.name
  });
}

/* ──────────────────────────────────────────────────────────────────────────
   Cell Drill-Down Popover  (chunk 3)
   ──────────────────────────────────────────────────────────────────────────
   Modal-overlay popover invoked from a matrix cell. State is persisted on
   each change (segmented control switch, Enable, Turn off) — the popover
   re-renders its own body in place after every change, AND the underlying
   matrix is re-rendered so the cell behind it reflects new state when the
   popover closes. Re-rendering the matrix does NOT close the popover
   because the popover element is attached to document.body, outside the
   matrix host that renderAnalyticsTab() rewrites via innerHTML.
   ────────────────────────────────────────────────────────────────────────── */

// Lifetime-of-one-open-session UI state.
let _popoverState = null;     // { cameraId, detectorId, compareOpen, backdropEl, bodyEl, keydownHandler }

function openAnalyticsCellPopover(cameraId, detectorId) {
  // Defensive: close any prior popover.
  closeAnalyticsCellPopover();

  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;

  // Offline cameras get a read-only message popover (per UC-VA-05 alt).
  const isOffline = cam.status === 'offline';

  // Build the backdrop + panel skeleton.
  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = 'analytics-popover';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'analytics-popover-title');

  const closeLabel = isOffline
    ? `${cam.name} · ${det.label}`
    : `${cam.name} · ${det.label}`;

  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3 id="analytics-popover-title">${esc(closeLabel)}</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body" id="analytics-popover-body"></div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-primary analytics-popover-done">Done</button>
    </footer>
  `;

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const bodyEl = panel.querySelector('#analytics-popover-body');

  _popoverState = {
    cameraId, detectorId,
    compareOpen: false,
    backdropEl: backdrop,
    bodyEl,
    keydownHandler: null,
    isOffline
  };

  // Render body (stub for offline vs full).
  if (isOffline) {
    bodyEl.innerHTML = `
      <div class="popover-warning popover-warning-offline">
        <strong>Camera is offline.</strong>
        <p>Detector cannot be configured while ${esc(cam.name)} is offline.
        Restore the camera and try again.</p>
      </div>
    `;
  } else {
    _renderAnalyticsPopoverBody();
  }

  // Wire up close affordances.
  panel.querySelector('.analytics-popover-close').addEventListener('click', closeAnalyticsCellPopover);
  panel.querySelector('.analytics-popover-done').addEventListener('click', closeAnalyticsCellPopover);

  // Backdrop click (but not panel click) closes.
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) closeAnalyticsCellPopover();
  });

  // Escape closes. Capture phase + stopPropagation so the page-level Escape
  // handler (which would otherwise close the Settings modal underneath) does
  // not also fire.
  const keydownHandler = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeAnalyticsCellPopover();
    }
  };
  document.addEventListener('keydown', keydownHandler, true);
  _popoverState.keydownHandler = keydownHandler;

  // Focus management.
  setTimeout(() => {
    const firstFocusable = panel.querySelector('button:not([disabled])');
    if (firstFocusable) firstFocusable.focus();
  }, 0);
}

function closeAnalyticsCellPopover() {
  if (!_popoverState) return;
  const { backdropEl, keydownHandler } = _popoverState;
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
  if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
  _popoverState = null;
}

// Ensure the cell config object exists, returns the cfg (mutable).
function _ensureCellCfg(cameraId, detectorId) {
  if (!analyticsConfig[cameraId]) analyticsConfig[cameraId] = {};
  if (!analyticsConfig[cameraId][detectorId]) {
    analyticsConfig[cameraId][detectorId] = { enabled: false, source: 'auto' };
  }
  return analyticsConfig[cameraId][detectorId];
}

// Render (and re-render in place) the popover body for the current cell.
function _renderAnalyticsPopoverBody() {
  if (!_popoverState) return;
  const { cameraId, detectorId, bodyEl, compareOpen } = _popoverState;
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det || !bodyEl) return;

  const cfg = analyticsConfig[cameraId] ? analyticsConfig[cameraId][detectorId] : null;
  const enabled = !!(cfg && cfg.enabled);
  const source = (cfg && cfg.source) || 'auto';
  const info = resolveSource(cameraId, detectorId);
  const caps = cameraCapabilities[cameraId] || {};
  const edgeSupported = !!caps[detectorId];
  const serverSupported = !!serverDetectors[detectorId];
  const labelLower = det.label.toLowerCase();

  // ── Status pill ──
  let pillClass = 'status-off';
  let pillText  = '● Off';
  if (enabled) {
    if (info.boundTo === 'pending') { pillClass = 'status-pending'; pillText = '⚠ Pending'; }
    else if (info.boundTo === 'errored') { pillClass = 'status-errored'; pillText = '⚠ Errored'; }
    else { pillClass = 'status-active'; pillText = '● Active'; }
  }

  const primaryActionBtn = enabled
    ? `<button type="button" class="btn btn-secondary popover-toggle-btn" data-action="turn-off">Turn off</button>`
    : `<button type="button" class="btn btn-primary popover-toggle-btn" data-action="enable">Enable</button>`;

  // ── Segmented control (Auto / Edge / Server) ──
  // Each button labels itself with a warn glyph when that option is unsupported.
  // Edge button is fully disabled (unclickable) when hardware doesn't support it.
  const seg = (key, label) => {
    let warn = '';
    let disabledClass = '';
    let disabledAttr = '';
    if (key === 'edge' && !edgeSupported) {
      warn = ' ⚠';
      disabledClass = ' disabled-source';
      disabledAttr = ' disabled aria-disabled="true"';
    }
    if (key === 'server' && !serverSupported) warn = ' ⚠';
    const sel = source === key ? ' selected' : '';
    const dim = !enabled ? ' dimmed' : '';
    return `<button type="button" class="seg-source${sel}${dim}${disabledClass}" data-source="${esc(key)}" aria-pressed="${source === key ? 'true' : 'false'}"${disabledAttr}>${esc(label)}${warn}</button>`;
  };

  // ── "Now bound to" line ──
  let boundGlyph = '';
  let boundLabel = '';
  if (!enabled) {
    boundGlyph = _cellGlyph('off');
    boundLabel = 'Off';
  } else if (info.boundTo === 'edge')    { boundGlyph = _cellGlyph('edge');    boundLabel = 'Edge'; }
  else if (info.boundTo === 'server')    { boundGlyph = _cellGlyph('server');  boundLabel = 'Server'; }
  else if (info.boundTo === 'pending')   { boundGlyph = _cellGlyph('pending'); boundLabel = 'Pending'; }
  else if (info.boundTo === 'errored')   { boundGlyph = '⚠';              boundLabel = 'Errored'; }

  const reason = enabled
    ? (info.reason || '—')
    : `Detector is currently off. Click Enable to arm it.`;

  // ── Unsupported-option warning block (visible only when current source is unsupported) ──
  let warnBlockHtml = '';
  if (enabled && source === 'edge' && !edgeSupported) {
    const switchServerBtn = serverSupported
      ? `<button type="button" class="btn btn-secondary btn-sm popover-remediation" data-remedy="switch-server">Switch to Server</button>`
      : `<button type="button" class="btn btn-secondary btn-sm popover-remediation" data-remedy="enable-server-global">Enable server ${esc(det.label)} in Global</button>`;
    warnBlockHtml = `
      <div class="popover-warning">
        <strong>⚠ This camera doesn't report edge ${esc(labelLower)} detection.</strong>
        <p>Detector will stay <em>Pending</em> until you change the source or a future firmware adds support.</p>
        <div class="popover-warning-actions">
          ${switchServerBtn}
          <button type="button" class="btn btn-secondary btn-sm popover-remediation" data-remedy="use-auto">Use Auto</button>
        </div>
      </div>
    `;
  } else if (enabled && source === 'server' && !serverSupported) {
    warnBlockHtml = `
      <div class="popover-warning">
        <strong>⚠ Server ${esc(labelLower)} detection is not enabled globally.</strong>
        <p>Detector will stay <em>Pending</em> until you enable it in the Global panel or pick a different source.</p>
        <div class="popover-warning-actions">
          <button type="button" class="btn btn-primary btn-sm popover-remediation" data-remedy="enable-server-global">Enable server ${esc(det.label)} in Global</button>
          ${edgeSupported ? `<button type="button" class="btn btn-secondary btn-sm popover-remediation" data-remedy="switch-edge">Switch to Edge</button>` : ''}
          <button type="button" class="btn btn-secondary btn-sm popover-remediation" data-remedy="use-auto">Use Auto</button>
        </div>
      </div>
    `;
  } else if (enabled && source === 'auto' && info.boundTo === 'pending') {
    // Auto resolved to pending because neither edge nor server is available.
    warnBlockHtml = `
      <div class="popover-warning">
        <strong>⚠ No source available for ${esc(labelLower)} on this camera.</strong>
        <p>This camera lacks edge ${esc(labelLower)} support and server ${esc(labelLower)} is disabled globally.</p>
        <div class="popover-warning-actions">
          <button type="button" class="btn btn-primary btn-sm popover-remediation" data-remedy="enable-server-global">Enable server ${esc(det.label)} in Global</button>
        </div>
      </div>
    `;
  }

  // ── Compare-sources disclosure ──
  // Use a controlled <details>-style block so we can persist open/closed state
  // across in-place re-renders for the same popover session.
  const compareOpenAttr = compareOpen ? ' open' : '';
  const chevron = compareOpen ? '▾' : '▸';
  const compareHtml = `
    <div class="compare-sources">
      <button type="button" class="compare-toggle" aria-expanded="${compareOpen ? 'true' : 'false'}">
        <span class="compare-chevron">${chevron}</span> Compare sources
      </button>
      <div class="compare-body"${compareOpenAttr ? '' : ' hidden'}>
        <table class="compare-table">
          <tbody>
            <tr>
              <th scope="row" class="compare-label compare-label-edge">EDGE</th>
              <td>
                ~80&nbsp;ms latency · runs on camera<br>
                privacy: video never leaves camera<br>
                model: vendor-fixed<br>
                cost: free
              </td>
            </tr>
            <tr>
              <th scope="row" class="compare-label compare-label-server">SERVER</th>
              <td>
                ~600&nbsp;ms latency · on VMS GPU<br>
                privacy: frames decoded server-side<br>
                model: ${esc(det.label)}Net v4 (updatable)<br>
                cost: ~6% GPU
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;

  // ── Phase 2: Schedule / Zones / Test-fire rows ──
  const schedule = getSchedule(cameraId, detectorId);
  const scheduleLabel = SCHEDULE_LABELS[schedule.kind] || schedule.kind;
  const geom = (analyticsConfig[cameraId] && analyticsConfig[cameraId]._geometry) || null;
  const cellZoneIds = (cfg && Array.isArray(cfg.zones)) ? cfg.zones : null;
  let zonesLabel;
  if (!geom || !geom.zones || !geom.zones.length) {
    zonesLabel = 'Whole frame (no zones defined yet)';
  } else if (!cellZoneIds || !cellZoneIds.length || cellZoneIds.includes('whole-frame')) {
    zonesLabel = 'Whole frame';
  } else {
    const names = cellZoneIds
      .map(zid => geom.zones.find(z => z.id === zid))
      .filter(Boolean)
      .map(z => z.name);
    zonesLabel = names.length ? `${names.length} (${names.join(', ')})` : 'Whole frame';
  }
  const lineCount = geom && Array.isArray(geom.lines) ? geom.lines.length : 0;
  const maskCount = geom && Array.isArray(geom.masks) ? geom.masks.length : 0;

  // Test-fire disabled when no bound source (Pending/Errored) or off.
  const canTestFire = enabled && info.boundTo !== 'pending' && info.boundTo !== 'errored';
  const testFireTitle = !enabled
    ? 'Enable the detector first.'
    : info.boundTo === 'pending'
      ? 'No bound source. Resolve the source warning first.'
      : info.boundTo === 'errored'
        ? 'Detector is errored. Resolve the source first.'
        : 'Inject a synthetic event to validate config.';

  // Sleeping cells: show a hint so test-fire's "bypasses schedule" behavior
  // doesn't surprise the user.
  const sleepingNote = info && info.sleeping && info.boundTo !== 'pending'
    ? `<div class="popover-sleeping-note">💤 Currently sleeping — outside the schedule window. Test fire still works.</div>`
    : '';

  bodyEl.innerHTML = `
    <div class="popover-status-row">
      <span class="status-pill ${pillClass}">${pillText}</span>
      <div class="popover-status-actions">${primaryActionBtn}</div>
    </div>

    <section class="popover-section${enabled ? '' : ' popover-section-dim'}">
      <h4 class="popover-section-head">Source</h4>
      ${!edgeSupported ? `<div class="dd-hw-support-banner hw-unsupported" style="margin-bottom:8px"><span class="hw-icon">✗</span> Hardware (Edge) tidak tersedia untuk ${esc(det.label)} — gunakan Auto atau Server</div>` : ''}
      <div class="source-segmented" role="group" aria-label="Source">
        ${seg('auto',   'Auto')}
        ${seg('edge',   'Edge')}
        ${seg('server', 'Server')}
      </div>
      <div class="popover-source-hint" style="font-size:11px;color:var(--text-300);margin-top:4px">
        Auto = Hardware jika didukung, jika tidak → Software &nbsp;|&nbsp; Edge = Hardware &nbsp;|&nbsp; Server = Software
      </div>

      <dl class="popover-bound">
        <dt>Now bound to:</dt>
        <dd><span class="popover-bound-glyph">${boundGlyph}</span> ${esc(boundLabel)}</dd>
        <dt>Why this:</dt>
        <dd class="popover-bound-reason">${esc(reason)}</dd>
      </dl>

      ${warnBlockHtml}

      ${compareHtml}
    </section>

    <section class="popover-section popover-section-schedule${enabled ? '' : ' popover-section-dim'}">
      <h4 class="popover-section-head">Schedule</h4>
      <div class="popover-config-row">
        <span class="popover-config-value">${esc(scheduleLabel)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-pop-act="edit-schedule"${!enabled ? ' disabled' : ''}>Change</button>
      </div>
      ${sleepingNote}
    </section>

    <section class="popover-section popover-section-zones${enabled ? '' : ' popover-section-dim'}">
      <h4 class="popover-section-head">Zones</h4>
      <div class="popover-config-row">
        <span class="popover-config-value">Zones: ${esc(zonesLabel)}</span>
        <button type="button" class="btn btn-secondary btn-sm" data-pop-act="edit-binding"${!enabled || !geom || !geom.zones || !geom.zones.length ? ' disabled' : ''}>Edit binding</button>
      </div>
      <div class="popover-config-row popover-config-row-sub">
        <span class="popover-config-value">
          ${lineCount ? `Lines: ${lineCount}` : 'No tripwires'}
          ${maskCount ? ` · Masks: ${maskCount}` : ''}
        </span>
        <button type="button" class="btn btn-secondary btn-sm" data-pop-act="edit-geometry">Edit zones / lines / masks</button>
      </div>
    </section>

    <section class="popover-section popover-section-test">
      <h4 class="popover-section-head">Test fire</h4>
      <div class="popover-config-row">
        <span class="popover-config-value popover-config-sub">Inject a synthetic event so you can see the full toast → tile flash → log row pipeline.</span>
        <button type="button" class="btn btn-secondary btn-sm" data-pop-act="test-fire" ${canTestFire ? '' : 'disabled'} title="${esc(testFireTitle)}">🧪 Test fire</button>
      </div>
    </section>
  `;

  // ── Wire up handlers for this freshly-rendered body ──
  bodyEl.querySelectorAll('.seg-source').forEach(b => {
    if (b.disabled || b.classList.contains('disabled-source')) return; // skip disabled Edge
    b.addEventListener('click', () => _handlePopoverSourceClick(b.getAttribute('data-source')));
  });

  const toggleBtn = bodyEl.querySelector('.popover-toggle-btn');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      const action = toggleBtn.getAttribute('data-action');
      if (action === 'enable') _handlePopoverEnable();
      else if (action === 'turn-off') _handlePopoverTurnOff();
    });
  }

  bodyEl.querySelectorAll('.popover-remediation').forEach(b => {
    b.addEventListener('click', () => _handlePopoverRemediation(b.getAttribute('data-remedy')));
  });

  const compareToggleBtn = bodyEl.querySelector('.compare-toggle');
  if (compareToggleBtn) {
    compareToggleBtn.addEventListener('click', () => {
      if (!_popoverState) return;
      _popoverState.compareOpen = !_popoverState.compareOpen;
      _renderAnalyticsPopoverBody();
    });
  }

  // Phase 2 row actions.
  bodyEl.querySelectorAll('[data-pop-act]').forEach(btn => {
    btn.addEventListener('click', () => {
      const act = btn.getAttribute('data-pop-act');
      if (act === 'edit-schedule') openScheduleModal(cameraId, detectorId);
      else if (act === 'edit-geometry') openZoneEditor(cameraId);
      else if (act === 'edit-binding') openZoneBindingModal(cameraId, detectorId);
      else if (act === 'test-fire') testFireDetector(cameraId, detectorId);
    });
  });
}

// User clicked one of the Auto / Edge / Server segments.
function _handlePopoverSourceClick(nextSource) {
  if (!_popoverState) return;
  const { cameraId, detectorId } = _popoverState;
  const cfg = _ensureCellCfg(cameraId, detectorId);
  if (!cfg.enabled) {
    // Clicking a source on a disabled cell auto-enables and sets the source —
    // matches the "click Edge to arm it" intuition.
    cfg.enabled = true;
  }
  if (cfg.source === nextSource) return;
  cfg.source = nextSource;
  saveAnalytics();
  renderAnalyticsTab();          // matrix reflects new state behind the popover
  _renderAnalyticsPopoverBody(); // popover updates in place
}

// User clicked Enable on a currently-off cell.
function _handlePopoverEnable() {
  if (!_popoverState) return;
  const { cameraId, detectorId } = _popoverState;
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;
  const cfg = _ensureCellCfg(cameraId, detectorId);
  cfg.enabled = true;
  if (!cfg.source) cfg.source = 'auto';
  saveAnalytics();
  syncDetectorToCamera(cameraId, detectorId, true);
  renderAnalyticsTab();
  _renderAnalyticsPopoverBody();
  // Resolver may have produced pending — fire severity accordingly.
  const info = resolveSource(cameraId, detectorId);
  if (info.boundTo === 'pending') {
    notify(`${det.label} detection on ${cam.name} is pending: no source available`,
      { category: 'analytics', severity: 'warning' });
  } else {
    notify(`${det.label} detection enabled on ${cam.name}`,
      { category: 'analytics', severity: 'info', cameraId: cam.id, cameraName: cam.name });
  }
}

// User clicked Turn off on a currently-active cell.
function _handlePopoverTurnOff() {
  if (!_popoverState) return;
  const { cameraId, detectorId } = _popoverState;
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;
  const cfg = _ensureCellCfg(cameraId, detectorId);
  cfg.enabled = false;
  saveAnalytics();
  syncDetectorToCamera(cameraId, detectorId, false);
  renderAnalyticsTab();
  _renderAnalyticsPopoverBody();
  notify(`${det.label} detection disabled on ${cam.name}`,
    { category: 'analytics', severity: 'info', cameraId: cam.id, cameraName: cam.name });
}

// User clicked one of the inline remediation buttons inside the warning block.
function _handlePopoverRemediation(remedy) {
  if (!_popoverState) return;
  const { cameraId, detectorId } = _popoverState;
  const det = DETECTOR_BY_ID[detectorId];
  if (!det) return;

  if (remedy === 'switch-edge')   { _handlePopoverSourceClick('edge');   return; }
  if (remedy === 'switch-server') { _handlePopoverSourceClick('server'); return; }
  if (remedy === 'use-auto')      { _handlePopoverSourceClick('auto');   return; }

  if (remedy === 'enable-server-global') {
    // Per spec: close the popover, scroll the Global panel into view, flash the
    // relevant checkbox. The Global panel lives inside #analytics-content; the
    // matrix is rendered there too. Use the data-srv-det attribute to pinpoint
    // the checkbox.
    closeAnalyticsCellPopover();
    // The matrix may have just been re-rendered; find the checkbox by attribute.
    requestAnimationFrame(() => {
      const cb = document.querySelector(`input[data-srv-det="${CSS.escape(det.id)}"]`);
      if (!cb) return;
      const pill = cb.closest('.srv-det') || cb.parentElement;
      // Scroll the Global panel into view inside the modal scroller.
      const globalPanel = document.querySelector('.analytics-global');
      if (globalPanel && globalPanel.scrollIntoView) {
        globalPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      // Flash the pill.
      if (pill) {
        pill.classList.add('srv-det-flash');
        setTimeout(() => pill.classList.remove('srv-det-flash'), 1800);
      }
    });
  }
}

/* ══════════════════════════════════════════
   Schedule editor modal (Phase 2 — UC-VA2-05, UC-VA2-06)
   ──────────────────────────────────────────
   Lets the user pick a schedule for a single cell. Reuses the existing
   .analytics-popover chrome (no new modal primitive). Custom schedules
   live as a Uint8Array(336) — 7 days × 48 half-hour cells. Empty grid is
   permitted but confirmed because it means "never fires".
   ══════════════════════════════════════════ */

let _scheduleModalState = null; // { cameraId, detectorId, draft, backdropEl, keydownHandler }

const _DAY_NAMES_FULL = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function _scheduleToDraft(schedule) {
  const kind = (schedule && schedule.kind) || '24/7';
  if (kind === 'custom') {
    return { kind, grid: schedule.grid ? new Uint8Array(schedule.grid) : new Uint8Array(336) };
  }
  return { kind };
}

function _draftToSchedule(draft) {
  if (!draft) return { kind: '24/7' };
  if (draft.kind === 'custom') return { kind: 'custom', grid: new Uint8Array(draft.grid) };
  return { kind: draft.kind };
}

function _draftHasAnyArmedTime(draft) {
  if (!draft) return false;
  if (draft.kind === '24/7' || draft.kind === 'after-hours' || draft.kind === 'business') return true;
  if (draft.kind === 'custom') {
    for (let i = 0; i < draft.grid.length; i++) if (draft.grid[i]) return true;
    return false;
  }
  return true;
}

function openScheduleModal(cameraId, detectorId) {
  closeScheduleModal();
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;

  const current = getSchedule(cameraId, detectorId);
  _scheduleModalState = {
    cameraId, detectorId,
    draft: _scheduleToDraft(current),
    paintMode: 'arm',   // 'arm' | 'sleep' (used by Custom grid drag-paint)
    backdropEl: null,
    keydownHandler: null
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';

  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-schedule-modal';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'schedule-modal-title');

  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3 id="schedule-modal-title">Schedule for: ${esc(cam.name)} · ${esc(det.label)}</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body" id="schedule-modal-body"></div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary" data-sch-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-sch-act="apply">Apply</button>
    </footer>
  `;

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  _scheduleModalState.backdropEl = backdrop;

  _renderScheduleModalBody();

  panel.querySelector('.analytics-popover-close').addEventListener('click', () => closeScheduleModal());
  panel.querySelector('[data-sch-act="cancel"]').addEventListener('click', () => closeScheduleModal());
  panel.querySelector('[data-sch-act="apply"]').addEventListener('click', _applyScheduleModal);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeScheduleModal(); });

  const keydownHandler = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeScheduleModal();
    }
  };
  document.addEventListener('keydown', keydownHandler, true);
  _scheduleModalState.keydownHandler = keydownHandler;
}

function closeScheduleModal() {
  if (!_scheduleModalState) return;
  const { backdropEl, keydownHandler } = _scheduleModalState;
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
  if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
  _scheduleModalState = null;
}

function _renderScheduleModalBody() {
  if (!_scheduleModalState) return;
  const { draft, backdropEl } = _scheduleModalState;
  const body = backdropEl.querySelector('#schedule-modal-body');
  if (!body) return;

  const radio = (kind, label, sub) => {
    const checked = draft.kind === kind;
    return `
      <label class="sch-radio${checked ? ' selected' : ''}">
        <input type="radio" name="sch-kind" value="${esc(kind)}" ${checked ? 'checked' : ''}>
        <span class="sch-radio-label">${esc(label)}</span>
        ${sub ? `<span class="sch-radio-sub">${esc(sub)}</span>` : ''}
      </label>
    `;
  };

  let effectiveHtml = '';
  if (draft.kind === '24/7') {
    effectiveHtml = `<div class="sch-effective">Detector armed continuously.</div>`;
  } else if (draft.kind === 'after-hours') {
    effectiveHtml = `<div class="sch-effective">
      <p><strong>Effective:</strong></p>
      <ul>
        <li>Armed every day from 18:00 to 07:00</li>
        <li>Sleeps from 07:00 to 18:00</li>
      </ul>
    </div>`;
  } else if (draft.kind === 'business') {
    effectiveHtml = `<div class="sch-effective">
      <p><strong>Effective:</strong></p>
      <ul>
        <li>Armed Mon–Fri 09:00 to 17:00</li>
        <li>Sleeps weekends and outside business hours</li>
      </ul>
    </div>`;
  } else if (draft.kind === 'custom') {
    effectiveHtml = `
      <div class="sch-effective">
        <p><strong>Effective windows:</strong></p>
        <div class="sch-effective-windows" id="sch-effective-windows"></div>
      </div>
    `;
  }

  // The custom grid. Built only when needed but always present in the DOM
  // hidden so its scroll/state survives radio toggles. To keep things simple
  // we just rebuild on every render.
  let customGridHtml = '';
  if (draft.kind === 'custom') {
    const rows = [];
    // Header: 0,2,4...22 (every 2 hours)
    let headerCells = '<th class="sch-grid-day"></th>';
    for (let h = 0; h < 24; h += 2) headerCells += `<th class="sch-grid-hourhead" colspan="4">${String(h).padStart(2, '0')}</th>`;
    rows.push(`<tr>${headerCells}</tr>`);

    for (let day = 0; day < 7; day++) {
      // Render in Mon..Sun order for readability.
      const realDay = day === 6 ? 0 : day + 1;
      let cells = `<th class="sch-grid-day">${_DAY_NAMES_FULL[realDay]}</th>`;
      for (let h = 0; h < 48; h++) {
        const idx = realDay * 48 + h;
        const armed = !!draft.grid[idx];
        const hourBoundary = (h % 2 === 0) ? ' sch-grid-hourstart' : '';
        cells += `<td class="sch-grid-cell${armed ? ' armed' : ''}${hourBoundary}" data-sch-idx="${idx}" aria-label="${_DAY_NAMES_FULL[realDay]} ${String(Math.floor(h/2)).padStart(2,'0')}:${(h%2)?'30':'00'} ${armed ? 'armed' : 'asleep'}"></td>`;
      }
      rows.push(`<tr>${cells}</tr>`);
    }
    customGridHtml = `
      <div class="sch-grid-toolbar">
        <button type="button" class="btn btn-secondary btn-sm" data-sch-paint="arm">Paint armed</button>
        <button type="button" class="btn btn-secondary btn-sm" data-sch-paint="sleep">Paint sleep</button>
        <button type="button" class="btn btn-secondary btn-sm" data-sch-clear-all>Clear all</button>
        <span class="sch-grid-hint">Click and drag to paint. Each cell = 30 min.</span>
      </div>
      <div class="sch-grid-wrap">
        <table class="sch-grid">${rows.join('')}</table>
      </div>
    `;
  }

  body.innerHTML = `
    <div class="sch-radio-group">
      ${radio('24/7',        '24/7',           'Detector armed every minute of the week.')}
      ${radio('after-hours', 'After hours',    '18:00 – 07:00 every day.')}
      ${radio('business',    'Business hours', 'Mon–Fri 09:00 – 17:00.')}
      ${radio('custom',      'Custom...',      'Paint a custom weekly grid.')}
    </div>
    ${customGridHtml}
    ${effectiveHtml}
  `;

  // ── Wire up radios ──
  body.querySelectorAll('input[name="sch-kind"]').forEach(r => {
    r.addEventListener('change', () => {
      if (!_scheduleModalState) return;
      const kind = r.value;
      if (kind === 'custom' && _scheduleModalState.draft.kind !== 'custom') {
        // Promote the previous schedule shape into a grid so the user starts
        // with something sensible.
        const prev = _scheduleModalState.draft.kind;
        const grid = new Uint8Array(336);
        if (prev === '24/7') {
          grid.fill(1);
        } else if (prev === 'after-hours') {
          for (let day = 0; day < 7; day++) {
            for (let h = 0; h < 48; h++) {
              if (h >= 36 || h < 14) grid[day * 48 + h] = 1;
            }
          }
        } else if (prev === 'business') {
          for (let day = 1; day <= 5; day++) {
            for (let h = 18; h < 34; h++) grid[day * 48 + h] = 1;
          }
        }
        _scheduleModalState.draft = { kind: 'custom', grid };
      } else if (kind !== 'custom') {
        _scheduleModalState.draft = { kind };
      }
      _renderScheduleModalBody();
    });
  });

  // ── Wire up the custom grid (drag-paint) ──
  if (draft.kind === 'custom') {
    _bindCustomGridDragPaint(body);
    _renderCustomEffectiveWindows();
    // Highlight active paint button.
    body.querySelectorAll('[data-sch-paint]').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-sch-paint') === _scheduleModalState.paintMode);
      btn.addEventListener('click', () => {
        if (!_scheduleModalState) return;
        _scheduleModalState.paintMode = btn.getAttribute('data-sch-paint');
        body.querySelectorAll('[data-sch-paint]').forEach(b =>
          b.classList.toggle('active', b.getAttribute('data-sch-paint') === _scheduleModalState.paintMode));
      });
    });
    const clearBtn = body.querySelector('[data-sch-clear-all]');
    if (clearBtn) clearBtn.addEventListener('click', () => {
      if (!_scheduleModalState) return;
      _scheduleModalState.draft.grid.fill(0);
      _renderScheduleModalBody();
    });
  }
}

function _bindCustomGridDragPaint(body) {
  const cells = body.querySelectorAll('.sch-grid-cell');
  let isPainting = false;
  let paintValue = 1;
  const paint = (cell) => {
    if (!_scheduleModalState) return;
    const idx = parseInt(cell.getAttribute('data-sch-idx'), 10);
    if (Number.isNaN(idx)) return;
    const desired = _scheduleModalState.paintMode === 'sleep' ? 0 : 1;
    if (_scheduleModalState.draft.grid[idx] === desired) return;
    _scheduleModalState.draft.grid[idx] = desired;
    cell.classList.toggle('armed', desired === 1);
    _renderCustomEffectiveWindows();
  };
  cells.forEach(cell => {
    cell.addEventListener('mousedown', (e) => {
      e.preventDefault();
      isPainting = true;
      const idx = parseInt(cell.getAttribute('data-sch-idx'), 10);
      paintValue = _scheduleModalState.paintMode === 'sleep' ? 0 : 1;
      _scheduleModalState.draft.grid[idx] = paintValue;
      cell.classList.toggle('armed', paintValue === 1);
      _renderCustomEffectiveWindows();
    });
    cell.addEventListener('mouseenter', () => {
      if (isPainting) paint(cell);
    });
  });
  const stop = () => { isPainting = false; };
  document.addEventListener('mouseup', stop, { once: true });
}

function _renderCustomEffectiveWindows() {
  if (!_scheduleModalState) return;
  const host = _scheduleModalState.backdropEl.querySelector('#sch-effective-windows');
  if (!host) return;
  const windows = summarizeCustomGrid(_scheduleModalState.draft.grid);
  if (!windows.length) {
    host.innerHTML = `<span class="sch-effective-empty">No armed time. Detector will never fire.</span>`;
    return;
  }
  host.innerHTML = windows.map(w => {
    const ranges = w.ranges.map(r => `${esc(r.from)}–${esc(r.to)}`).join(', ');
    return `<div class="sch-effective-row"><strong>${esc(w.day)}</strong> ${ranges}</div>`;
  }).join('');
}

function _applyScheduleModal() {
  if (!_scheduleModalState) return;
  const { cameraId, detectorId, draft } = _scheduleModalState;
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) { closeScheduleModal(); return; }

  if (!_draftHasAnyArmedTime(draft)) {
    if (!confirm('This schedule has no armed time — the detector will never fire. Continue?')) {
      return;
    }
  }

  const cfg = _ensureCellCfg(cameraId, detectorId);
  const schedule = _draftToSchedule(draft);
  if (schedule.kind === '24/7') {
    delete cfg.schedule;
  } else {
    cfg.schedule = schedule;
  }
  saveAnalytics();
  closeScheduleModal();

  // Run a scheduler tick immediately so the matrix / sidebar reflect the
  // Armed↔Sleeping outcome without waiting up to 15 s.
  analyticsSchedulerTick();
  // Force a render in case the tick logic decided nothing changed (e.g.
  // applying the same schedule again).
  renderAnalyticsTab();
  // If the popover is still open behind the modal, refresh it.
  if (_popoverState && _popoverState.cameraId === cameraId && _popoverState.detectorId === detectorId) {
    _renderAnalyticsPopoverBody();
  }

  const kindLabel = SCHEDULE_LABELS[schedule.kind] || schedule.kind;
  notify(`Schedule set: ${cam.name} · ${det.label} — ${kindLabel}`, {
    severity: 'info',
    category: 'analytics',
    subType: 'config',
    cameraId: cam.id,
    cameraName: cam.name,
    detectorId
  });
}

/* ══════════════════════════════════════════
   Test-fire (Phase 2 — UC-VA2-11)
   ──────────────────────────────────────────
   Injects a synthetic event into the same pipeline real detections use.
   Confidence is pinned to 0.99 as a giveaway. Bypasses the schedule check
   (the whole point is to validate config without waiting).
   ══════════════════════════════════════════ */
function testFireDetector(cameraId, detectorId) {
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;
  const cfg = analyticsConfig[cameraId] && analyticsConfig[cameraId][detectorId];
  if (!cfg || !cfg.enabled) return;
  const info = resolveSource(cameraId, detectorId);
  if (info.boundTo === 'pending' || info.boundTo === 'errored' || info.boundTo === 'off') return;

  fireAnalyticsEvent({
    cameraId, detectorId,
    class: detectorId,
    confidence: 0.99,
    source: info.boundTo,
    ts: Date.now(),
    zone: null,
    synthetic: true
  });
}

/* ══════════════════════════════════════════
   Zone editor + binding (Phase 2 — UC-VA2-07..10)
   ──────────────────────────────────────────
   Real implementations live in the Batch B section further below. These
   hoisted stubs would only fire if Batch B were stripped out — they exist
   so the page never throws ReferenceError mid-development.
   ══════════════════════════════════════════ */
// Real implementations come from Batch B; hoisting ensures the popover
// wiring above can reference them without ordering concerns.

/* ══════════════════════════════════════════
   Tile Analytics Badge & Popover  (chunk 4)
   ──────────────────────────────────────────
   Surfaces armed detectors directly on the live grid tile and gives the
   operator quick toggles + a jump-in to the full matrix.

   Functions intended to be called by chunk 5 (event simulator):
     • flashTileBorder(cameraId, severity)   — 'info' | 'critical'
     • updateTileEyeState(cameraId, severity) — sets badge tint, auto-reverts
                                                to 'idle' after 30 s.
   ══════════════════════════════════════════ */

// ── Module-level state ─────────────────────────────────────────────────
// Tracks the current eye-badge tint for each camera so re-renders preserve
// the visual state. Keyed by cameraId — value is one of:
//   'idle' | 'recent-info' | 'recent-critical'.
const _tileEyeStateByCam = new Map();
// Active 30 s revert timers, keyed by cameraId.
const _tileEyeTimers = new Map();
// Active 3 s border-flash timers, keyed by tile DOM element (one timer per
// tile, not per camera — a camera may occupy multiple tiles).
const _tileFlashTimers = new WeakMap();
// Currently-open per-tile popover state. Only one popover is open at a time.
let _tilePopoverState = null; // { cameraId, anchor, panelEl, docClickHandler, escHandler, scrollHandler }

// ── getArmedDetectorsForCamera ─────────────────────────────────────────
// Returns the detectors that contribute to the badge number — i.e. the ones
// that are enabled AND have actually bound to a source (boundTo !== 'pending').
// Each item: { detectorId, label, boundTo, pinned, enabled }
// Pending/errored detectors are returned separately by
// _getAllConfiguredDetectorsForCamera() — they show up in the popover but
// are not counted in the badge.
function getArmedDetectorsForCamera(cameraId) {
  const camCfg = analyticsConfig[cameraId];
  if (!camCfg) return [];
  const out = [];
  for (const det of DETECTORS) {
    const cfg = camCfg[det.id];
    if (!cfg || !cfg.enabled) continue;
    const info = resolveSource(cameraId, det.id);
    if (info.boundTo === 'pending') continue;
    out.push({
      detectorId: det.id,
      label: det.label,
      boundTo: info.boundTo,
      pinned: info.pinned,
      enabled: true
    });
  }
  return out;
}

// All detectors the user has flagged enabled for this camera — armed AND
// pending/errored — for the popover's read-out.
function _getAllConfiguredDetectorsForCamera(cameraId) {
  const camCfg = analyticsConfig[cameraId];
  if (!camCfg) return [];
  const out = [];
  for (const det of DETECTORS) {
    const cfg = camCfg[det.id];
    if (!cfg || !cfg.enabled) continue;
    const info = resolveSource(cameraId, det.id);
    out.push({
      detectorId: det.id,
      label: det.label,
      boundTo: info.boundTo,
      pinned: info.pinned,
      reason: info.reason
    });
  }
  return out;
}

// ── openTileAnalyticsPopover ───────────────────────────────────────────
// Small non-modal popover anchored under the eye badge. Click outside or
// Escape closes it. Because renderGrid() rewrites #grid-container's HTML
// (which contains the anchor element), the popover would be left orphaned —
// we attach it to document.body and close it on grid re-render via a
// scroll/reposition guard plus the docClickHandler trigger that fires when
// the user clicks anything outside the panel.
function openTileAnalyticsPopover(cameraId, anchor) {
  closeTileAnalyticsPopover();
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam || !anchor) return;

  const panel = document.createElement('div');
  panel.className = 'tile-analytics-popover';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', `${cam.name} — active analytics`);
  document.body.appendChild(panel);

  _tilePopoverState = {
    cameraId,
    anchor,
    panelEl: panel,
    docClickHandler: null,
    escHandler: null,
    scrollHandler: null
  };

  _renderTileAnalyticsPopoverBody();
  _positionTileAnalyticsPopover();

  // ── Scope the outside-click listener ──
  // Attached on the next tick so the click that *opened* the popover doesn't
  // immediately close it. Only fires when the click is not inside the panel
  // AND not on the original anchor (re-clicking the badge while open closes,
  // handled separately by handleTileAction → openTileAnalyticsPopover →
  // closeTileAnalyticsPopover at the top of this function).
  const docClickHandler = e => {
    if (!_tilePopoverState) return;
    if (panel.contains(e.target)) return;
    closeTileAnalyticsPopover();
  };
  setTimeout(() => document.addEventListener('click', docClickHandler), 0);
  _tilePopoverState.docClickHandler = docClickHandler;

  // Escape closes. Capture phase so we beat any other listeners.
  const escHandler = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      closeTileAnalyticsPopover();
    }
  };
  document.addEventListener('keydown', escHandler, true);
  _tilePopoverState.escHandler = escHandler;

  // If something scrolls the underlying viewport (rare in this app since
  // the grid scroll-locks, but defensive), reposition. Use passive listener.
  const scrollHandler = () => {
    if (!_tilePopoverState) return;
    // If the anchor disappeared (renderGrid wiped it), close instead.
    if (!document.body.contains(_tilePopoverState.anchor)) {
      closeTileAnalyticsPopover();
      return;
    }
    _positionTileAnalyticsPopover();
  };
  window.addEventListener('scroll', scrollHandler, true);
  window.addEventListener('resize', scrollHandler);
  _tilePopoverState.scrollHandler = scrollHandler;
}

function closeTileAnalyticsPopover() {
  if (!_tilePopoverState) return;
  const { panelEl, docClickHandler, escHandler, scrollHandler } = _tilePopoverState;
  if (docClickHandler) document.removeEventListener('click', docClickHandler);
  if (escHandler) document.removeEventListener('keydown', escHandler, true);
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler, true);
    window.removeEventListener('resize', scrollHandler);
  }
  if (panelEl && panelEl.parentNode) panelEl.parentNode.removeChild(panelEl);
  _tilePopoverState = null;
}

// Position the panel relative to its anchor using viewport coords.
function _positionTileAnalyticsPopover() {
  if (!_tilePopoverState) return;
  const { anchor, panelEl } = _tilePopoverState;
  if (!anchor || !panelEl) return;
  const rect = anchor.getBoundingClientRect();
  // Position below the anchor by default; if not enough room, flip above.
  // Make panel measurable first.
  panelEl.style.visibility = 'hidden';
  panelEl.style.left = '0px';
  panelEl.style.top = '0px';
  const pw = panelEl.offsetWidth || 280;
  const ph = panelEl.offsetHeight || 200;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 6;
  let left = rect.right - pw;            // right-align to badge
  if (left < margin) left = margin;
  if (left + pw > vw - margin) left = vw - pw - margin;
  let top = rect.bottom + margin;
  if (top + ph > vh - margin) {
    // Flip above the badge if it would overflow.
    top = rect.top - ph - margin;
    if (top < margin) top = margin;
  }
  panelEl.style.left = `${left}px`;
  panelEl.style.top = `${top}px`;
  panelEl.style.visibility = 'visible';
}

// Render (and re-render) the popover body in place. Called after each toggle.
function _renderTileAnalyticsPopoverBody() {
  if (!_tilePopoverState) return;
  const { cameraId, panelEl } = _tilePopoverState;
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam || !panelEl) return;

  const items = _getAllConfiguredDetectorsForCamera(cameraId);

  let rowsHtml;
  if (!items.length) {
    rowsHtml = `<div class="tile-pop-empty">No active detectors.</div>`;
  } else {
    rowsHtml = items.map(it => {
      const det = DETECTOR_BY_ID[it.detectorId];
      const shortLabel = det ? det.shortLabel : it.label;
      if (it.boundTo === 'pending' || it.boundTo === 'errored') {
        const stateLabel = it.boundTo === 'pending' ? 'Pending' : 'Errored';
        return `
          <li class="tile-pop-row tile-pop-row-warn" data-detector-id="${esc(it.detectorId)}">
            <span class="tile-pop-warn-icon" aria-hidden="true">⚠</span>
            <span class="tile-pop-name">${esc(it.label)}</span>
            <span class="tile-pop-source tile-pop-source-${esc(it.boundTo)}">${esc(stateLabel)}</span>
            <span class="tile-pop-reason" title="${esc(it.reason || '')}">${esc(it.reason || '')}</span>
          </li>
        `;
      }
      // Armed (edge or server) — show a real checkbox.
      const srcGlyph = _cellGlyph(it.boundTo);
      const srcLabel = it.boundTo === 'edge' ? 'Edge' : (it.boundTo === 'server' ? 'Server' : it.boundTo);
      const pinMark = it.pinned ? ' <span class="tile-pop-pin" title="Pinned (manual override)">\u{1F4CC}</span>' : '';
      return `
        <li class="tile-pop-row" data-detector-id="${esc(it.detectorId)}">
          <label class="tile-pop-check">
            <input type="checkbox" data-tile-pop-toggle="${esc(it.detectorId)}" checked aria-label="Disable ${esc(it.label)}">
            <span class="tile-pop-name">${esc(it.label)}</span>
          </label>
          <span class="tile-pop-source tile-pop-source-${esc(it.boundTo)}">
            <span class="tile-pop-glyph">${srcGlyph}</span> ${esc(srcLabel)}${pinMark}
          </span>
        </li>
      `;
    }).join('');
  }

  // Phase 2: bbox overlay toggle (per-tile, session-only). We need a tile
  // index to key the state by — derive it from the anchor's tile.
  let bboxRowHtml = '';
  let tileIndex = null;
  if (_tilePopoverState && _tilePopoverState.anchor) {
    const tile = _tilePopoverState.anchor.closest('.tile');
    if (tile && tile.dataset.index != null) {
      tileIndex = parseInt(tile.dataset.index, 10);
    }
  }
  if (tileIndex != null) {
    const checked = !!tileBboxOverlay[tileIndex];
    const lineChecked = tileLineOverlay[tileIndex] !== false;
    bboxRowHtml = `
      <div class="tile-pop-section-label tile-pop-bbox-row">
        <label class="tile-pop-bbox-check">
          <input type="checkbox" data-tile-bbox-toggle="${tileIndex}" ${checked ? 'checked' : ''}>
          <span>Show bounding boxes (this tile)</span>
        </label>
        <label class="tile-pop-bbox-check">
          <input type="checkbox" data-tile-line-toggle="${tileIndex}" ${lineChecked ? 'checked' : ''}>
          <span>Show line/region rules (this tile)</span>
        </label>
      </div>
    `;
  }

  panelEl.innerHTML = `
    <header class="tile-pop-header">
      <span class="tile-pop-title">${esc(cam.name)}</span>
      <button type="button" class="tile-pop-close" aria-label="Close">×</button>
    </header>
    <div class="tile-pop-section-label">Active detectors</div>
    <ul class="tile-pop-list">${rowsHtml}</ul>
    ${bboxRowHtml}
    <footer class="tile-pop-footer">
      <button type="button" class="tile-pop-open-settings">Open in Analytics settings →</button>
    </footer>
  `;

  // Close (×)
  const closeBtn = panelEl.querySelector('.tile-pop-close');
  if (closeBtn) closeBtn.addEventListener('click', closeTileAnalyticsPopover);

  // Toggle checkboxes — disable the detector on uncheck.
  panelEl.querySelectorAll('input[data-tile-pop-toggle]').forEach(cb => {
    cb.addEventListener('change', () => {
      const detId = cb.getAttribute('data-tile-pop-toggle');
      _handleTilePopoverToggle(cameraId, detId, cb.checked);
    });
  });

  // Bbox overlay toggle (Phase 2).
  const bboxCb = panelEl.querySelector('input[data-tile-bbox-toggle]');
  if (bboxCb) {
    bboxCb.addEventListener('change', () => {
      const idx = parseInt(bboxCb.getAttribute('data-tile-bbox-toggle'), 10);
      if (Number.isNaN(idx)) return;
      tileBboxOverlay[idx] = bboxCb.checked;
      // If turning off, remove any currently-displayed overlay so the user
      // sees the change immediately.
      if (!bboxCb.checked) {
        const tile = document.querySelector(`.tile[data-index="${idx}"]`);
        if (tile) tile.querySelectorAll('.tile-bbox').forEach(el => el.remove());
      }
    });
  }

  // Line/region overlay toggle.
  const lineCb = panelEl.querySelector('input[data-tile-line-toggle]');
  if (lineCb) {
    lineCb.addEventListener('change', () => {
      const idx = parseInt(lineCb.getAttribute('data-tile-line-toggle'), 10);
      if (Number.isNaN(idx)) return;
      tileLineOverlay[idx] = lineCb.checked;
      const tile = document.querySelector(`.tile[data-index="${idx}"]`);
      if (!tile) return;
      if (lineCb.checked) {
        const camId = tileAssignments[idx];
        if (camId) {
          fetchLineConfig(camId).then(cfg => {
            if (cfg && tile.isConnected) renderLineOverlay(tile, camId);
          });
        }
      } else {
        const overlay = tile.querySelector('.tile-line-overlay');
        if (overlay) overlay.remove();
      }
    });
  }

  // Open in Analytics settings →
  const openBtn = panelEl.querySelector('.tile-pop-open-settings');
  if (openBtn) openBtn.addEventListener('click', () => _openTilePopoverInSettings(cameraId));
}

function _handleTilePopoverToggle(cameraId, detectorId, nextEnabled) {
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;
  const cfg = _ensureCellCfg(cameraId, detectorId);
  cfg.enabled = !!nextEnabled;
  saveAnalytics();
  // Per project pattern: full re-render of dependent surfaces.
  renderGrid();
  renderAnalyticsTab(); // matrix may be visible behind the modal-less tile popover
  // Re-resolve the popover anchor (renderGrid replaced the badge element).
  // The new badge lives on a tile with data-camera-id="cameraId". Re-bind.
  if (_tilePopoverState && _tilePopoverState.cameraId === cameraId) {
    const newAnchor = document.querySelector(`.tile[data-camera-id="${CSS.escape(cameraId)}"] .tile-eye`);
    if (newAnchor) {
      _tilePopoverState.anchor = newAnchor;
      _renderTileAnalyticsPopoverBody();
      _positionTileAnalyticsPopover();
    } else {
      // No more armed detectors → badge gone → close popover.
      closeTileAnalyticsPopover();
    }
  }
  // UC-VA-02 style notification.
  notify(`${det.label} detection ${nextEnabled ? 'enabled' : 'disabled'} on ${cam.name}`,
    { category: 'analytics', severity: 'info', cameraId: cam.id, cameraName: cam.name });
}

function _openTilePopoverInSettings(cameraId) {
  closeTileAnalyticsPopover();
  // Reset the group filter so the target row is guaranteed to be in the matrix
  // (a leftover filter from a previous session would otherwise hide it).
  analyticsGroupFilter = 'All';
  openSettings();
  // Switch to Analytics tab.
  const analyticsTabBtn = document.querySelector('.modal-tab[data-tab="analytics"]');
  if (analyticsTabBtn) analyticsTabBtn.click();
  // Scroll to + highlight the row for this camera.
  requestAnimationFrame(() => {
    const row = document.querySelector(`tr.cap-row[data-camera-id="${CSS.escape(cameraId)}"]`);
    if (!row) return;
    if (row.scrollIntoView) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('cap-row-highlight');
    setTimeout(() => row.classList.remove('cap-row-highlight'), 3000);
  });
}

// ── flashTileBorder ────────────────────────────────────────────────────
// Called by chunk-5 simulator on each detected event. Severity is 'info'
// or 'critical'. Adds a temporary outline class to every tile currently
// displaying this camera, restarts the animation if already flashing.
function flashTileBorder(cameraId, severity) {
  const sev = severity === 'critical' ? 'critical' : 'info';
  const cls = sev === 'critical' ? 'tile-flash-critical' : 'tile-flash-info';
  const otherCls = sev === 'critical' ? 'tile-flash-info' : 'tile-flash-critical';
  const tiles = document.querySelectorAll(`.tile[data-camera-id="${CSS.escape(cameraId)}"]`);
  tiles.forEach(tile => {
    // Re-entrant safe: remove both possible flash classes, force reflow,
    // then add the new one so the animation restarts cleanly.
    tile.classList.remove(cls);
    tile.classList.remove(otherCls);
    void tile.offsetWidth;
    tile.classList.add(cls);
    // Clear any prior pending removal for this tile so a fresh 3 s window starts.
    const prev = _tileFlashTimers.get(tile);
    if (prev) clearTimeout(prev);
    const t = setTimeout(() => {
      tile.classList.remove(cls);
      _tileFlashTimers.delete(tile);
    }, 3000);
    _tileFlashTimers.set(tile, t);
  });
  // Update the eye badge tint in parallel.
  updateTileEyeState(cameraId, sev);
}

// ── updateTileEyeState ─────────────────────────────────────────────────
// Sets data-eye-state on every visible eye badge for this camera, then
// reverts to 'idle' after 30 s. Re-entrant: a later call replaces the
// existing timer.
function updateTileEyeState(cameraId, severity) {
  const sev = severity === 'critical' ? 'critical' : 'info';
  const state = `recent-${sev}`;
  _tileEyeStateByCam.set(cameraId, state);

  // Apply to live DOM eye badges for this camera.
  const badges = document.querySelectorAll(`.tile[data-camera-id="${CSS.escape(cameraId)}"] .tile-eye`);
  badges.forEach(b => { b.setAttribute('data-eye-state', state); });

  // Replace any pending revert timer.
  const prev = _tileEyeTimers.get(cameraId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    _tileEyeStateByCam.set(cameraId, 'idle');
    const live = document.querySelectorAll(`.tile[data-camera-id="${CSS.escape(cameraId)}"] .tile-eye`);
    live.forEach(b => { b.setAttribute('data-eye-state', 'idle'); });
    _tileEyeTimers.delete(cameraId);
  }, 30000);
  _tileEyeTimers.set(cameraId, t);
}

/* ══════════════════════════════════════════
   Analytics — Simulator, Dedupe & Cascade Dialog  (chunk 5)
   ──────────────────────────────────────────
   The simulator is the only producer of "live" analytics events in this
   prototype. Each tick picks one armed cell at random and pushes an event
   through fireAnalyticsEvent(), which handles dedupe, toast, tile flash,
   and Activity Log entry. The Activity Log render layer groups consecutive
   same-kind detection events into cluster rows (≥3 within 30 s); the
   cascade dialog handles UC-VA-11 when a server detector is globally
   disabled while cells depend on it.
   ══════════════════════════════════════════ */

// ── Module-level state ─────────────────────────────────────────────────
// _recentEvents: short-window suppression list for toast/flash dedupe.
// Entries: { key, ts }. Window: 5 000 ms (separate from cluster window).
let _recentEvents = [];
const _DEDUPE_WINDOW_MS = 5000;
const _CLUSTER_WINDOW_MS = 30000;

// Simulator wiring.
let _simulatorTimer = null;
let _firstSimulatorRun = true;

// Cluster expansion state — session-only Set, keyed by stable cluster id
// derived as `${cameraId}|${detectorId}|${zone||'-'}|${earliestTs}|${latestTs}`.
// Module-level so renderActivityFeed() (called on every filter change /
// new event) preserves expansion across renders.
const _expandedClusters = new Set();

// ── startAnalyticsSimulator ─────────────────────────────────────────────
// Single jittered setInterval. We use setTimeout + reschedule so the
// interval can vary each tick (8 000–25 000 ms).
function startAnalyticsSimulator() {
  if (_simulatorTimer) return; // idempotent
  const schedule = () => {
    const jitter = 8000 + Math.random() * 17000;
    _simulatorTimer = setTimeout(() => {
      try { simulatorTick(); } catch (e) { /* swallow — prototype */ }
      schedule();
    }, jitter);
  };

  // Burst once per page session: ~4 s after init, fire 4 same-kind events
  // 800 ms apart to exercise the dedupe cluster UI.
  if (_firstSimulatorRun) {
    _firstSimulatorRun = false;
    setTimeout(() => _simulatorBurst(), 4000);
  }
  schedule();
}

function _gatherArmedCells() {
  const out = [];
  for (const cam of cameras) {
    if (cam.status === 'offline') continue;
    // Skip cameras with active ISAPI detection — backend sends real events for those
    if (cam.detection && cam.detection.isapi && cam._isapiStatus === 'connected') continue;
    const camCfg = analyticsConfig[cam.id];
    if (!camCfg) continue;
    for (const det of DETECTORS) {
      if (det.id.startsWith('_')) continue;
      const cfg = camCfg[det.id];
      if (!cfg || !cfg.enabled) continue;
      if (cfg.state === 'errored') continue;
      const info = resolveSource(cam.id, det.id);
      if (info.boundTo === 'pending' || info.boundTo === 'errored' || info.boundTo === 'off') continue;
      // Phase 2: skip cells that are currently sleeping (outside their schedule window).
      if (info.sleeping) continue;
      out.push({ cameraId: cam.id, detectorId: det.id, boundTo: info.boundTo });
    }
  }
  return out;
}

/* ── startAnalyticsScheduler ─────────────────────────────────────────────
   15 s heartbeat that flips cells between Armed and Sleeping at schedule
   boundaries. No toast / log row — schedule transitions are silent. We
   compare each cell's current armed/sleeping state to the prior tick;
   only re-render the affected surfaces when something actually changed.
*/
function startAnalyticsScheduler() {
  if (_analyticsSchedulerTimer) return;
  // First tick fires immediately so newly-applied schedules take effect
  // without waiting 15 s.
  analyticsSchedulerTick();
  _analyticsSchedulerTimer = setInterval(() => {
    try { analyticsSchedulerTick(); } catch(e) { /* swallow — prototype */ }
  }, 15000);
}

// Update each on-grid tile's analytics eye-badge IN PLACE when armed detectors
// change (e.g. a schedule boundary), instead of rebuilding the entire video grid
// (which churned DOM + parked/adopted every stream + fired a dashboard save).
function refreshTileEyeBadges() {
  gridContainer.querySelectorAll('.tile[data-camera-id]').forEach((tile) => {
    const camId = tile.dataset.cameraId;
    const armed = getArmedDetectorsForCamera(camId);
    let badge = tile.querySelector('.tile-eye');
    if (armed.length === 0) { if (badge) badge.remove(); return; }
    const eyeState = _tileEyeStateByCam.get(camId) || 'idle';
    const titleLines = ['Active detectors:'].concat(armed.map((a) => `• ${a.label} (${a.boundTo})`)).join('\n');
    if (!badge) {
      const bar = tile.querySelector('.controls-bar');
      if (!bar) return;
      badge = document.createElement('button');
      badge.className = 'ctrl-btn tile-eye';
      badge.dataset.action = 'analytics-badge';
      bar.insertBefore(badge, bar.querySelector('[data-action="audio"]') || null);
    }
    badge.dataset.eyeState = eyeState;
    badge.title = titleLines;
    badge.setAttribute('aria-label', `Active analytics — ${armed.length} detector${armed.length === 1 ? '' : 's'}`);
    badge.innerHTML = `\u{1F441}<sup class="tile-eye-count">${esc(String(armed.length))}</sup>`;
  });
}

function analyticsSchedulerTick() {
  let anyChange = false;
  const seenKeys = new Set();
  for (const camId in analyticsConfig) {
    const camCfg = analyticsConfig[camId];
    if (!camCfg) continue;
    for (const detId in camCfg) {
      if (detId.startsWith('_')) continue;
      const cfg = camCfg[detId];
      if (!cfg || !cfg.enabled) continue;
      const schedule = getSchedule(camId, detId);
      // Cells on 24/7 don't need ticking at all.
      if (schedule.kind === '24/7') continue;
      const armed = isWithinSchedule(schedule);
      const next = armed ? 'armed' : 'sleeping';
      const key = `${camId}|${detId}`;
      seenKeys.add(key);
      const prev = _scheduleStateByCell.get(key);
      if (prev !== next) {
        _scheduleStateByCell.set(key, next);
        if (prev !== undefined) anyChange = true;  // initial assignment doesn't count
      }
    }
  }
  // Garbage-collect entries for cells that no longer have a schedule.
  for (const key of _scheduleStateByCell.keys()) {
    if (!seenKeys.has(key)) _scheduleStateByCell.delete(key);
  }
  if (anyChange) {
    // Partial re-renders. The matrix only re-renders if the Analytics tab is
    // currently visible (cheap idempotent check inside renderAnalyticsTab).
    if (settingsModal.classList.contains('open')) {
      const activeTab = document.querySelector('.modal-tab.active');
      if (activeTab && activeTab.dataset.tab === 'analytics') renderAnalyticsTab();
    }
    renderSidebar();
    refreshTileEyeBadges();   // patch eye-badges in place — no full grid rebuild
  }
}

function _makeEvent(cell, pos) {
  return {
    cameraId: cell.cameraId,
    detectorId: cell.detectorId,
    class: cell.detectorId,
    confidence: 0.70 + Math.random() * 0.25,
    source: cell.boundTo,
    ts: Date.now(),
    zone: pos && pos.zoneId ? pos.zoneId : null
  };
}

// Phase 2 (UC-VA2-21): generate a synthetic position on the geometry grid,
// then check masks + zone bindings. Returns:
//   { fire:true, pos, zoneId? }              — fire the event
//   { fire:false, suppressedBy:'mask'|'zone' } — bumps counter, no event
//   { fire:true, pos }                       — fire (no zone bindings)
function _geomCheckForCell(cell) {
  const cam = cameras.find(c => c.id === cell.cameraId);
  if (!cam) return { fire: false, suppressedBy: 'none' };
  const camCfg = analyticsConfig[cell.cameraId] || {};
  const cellCfg = camCfg[cell.detectorId] || {};
  const geom = camCfg._geometry || { zones: [], lines: [], masks: [] };
  const det = DETECTOR_BY_ID[cell.detectorId];
  if (!det) return { fire: false, suppressedBy: 'none' };

  // Line crossing: try up to ~5 attempts to land a synthetic path that crosses
  // a bound tripwire in the right direction. If none, suppress (counts as
  // "zone" suppression — line crossings without geometry effectively can't fire).
  if (det.id === 'line') {
    if (!geom.lines.length) {
      // No tripwires configured → line crossing has nothing to detect.
      // Treat as zone-suppressed for the counter.
      return { fire: false, suppressedBy: 'zone' };
    }
    for (let attempt = 0; attempt < 5; attempt++) {
      const a = { x: Math.random() * GEOM_GRID, y: Math.random() * GEOM_GRID };
      const b = { x: Math.random() * GEOM_GRID, y: Math.random() * GEOM_GRID };
      for (const line of geom.lines) {
        if (!segmentsIntersect(a, b, line.points[0], line.points[1])) continue;
        const dir = line.direction || 'both';
        if (dir === 'both') {
          return { fire: true, pos: b, lineId: line.id };
        }
        const sideA = sideOfLine(line, a);
        const sideB = sideOfLine(line, b);
        if (sideA === sideB || sideA === 0 || sideB === 0) continue;
        if (dir === 'inbound' && sideB < 0) {
          return { fire: true, pos: b, lineId: line.id };
        }
        if (dir === 'outbound' && sideB > 0) {
          return { fire: true, pos: b, lineId: line.id };
        }
      }
    }
    return { fire: false, suppressedBy: 'zone' };
  }

  // Other detectors: random point inside the canvas.
  const pos = { x: Math.random() * GEOM_GRID, y: Math.random() * GEOM_GRID };

  // Mask suppression (camera-wide). Mask appliesTo === 'all' covers every
  // detector; the per-detector form is reserved for future use.
  for (const mask of geom.masks) {
    const applies = mask.appliesTo === 'all'
      || (typeof mask.appliesTo === 'object' && mask.appliesTo.detectors && mask.appliesTo.detectors.includes(cell.detectorId))
      || mask.appliesTo === undefined;
    if (!applies) continue;
    if (pointInPolygon(pos, mask.points)) {
      return { fire: false, suppressedBy: 'mask' };
    }
  }

  // Zone binding. If the cell has zones bound (non-whole-frame), the event
  // must land inside one of them.
  const boundZoneIds = Array.isArray(cellCfg.zones) && cellCfg.zones.length
    ? cellCfg.zones.filter(z => z !== 'whole-frame')
    : [];
  if (boundZoneIds.length) {
    const boundZones = geom.zones.filter(z => boundZoneIds.includes(z.id));
    let hit = null;
    for (const z of boundZones) {
      if (pointInPolygon(pos, z.points)) { hit = z; break; }
    }
    if (!hit) return { fire: false, suppressedBy: 'zone' };
    return { fire: true, pos, zoneId: hit.id };
  }

  return { fire: true, pos };
}

function simulatorTick() {
  const cells = _gatherArmedCells();
  if (!cells.length) return;
  const cell = cells[Math.floor(Math.random() * cells.length)];
  const decision = _geomCheckForCell(cell);
  if (!decision.fire) {
    const key = `${cell.cameraId}|${cell.detectorId}`;
    if (decision.suppressedBy === 'mask') {
      _suppressedByMask.set(key, (_suppressedByMask.get(key) || 0) + 1);
    } else if (decision.suppressedBy === 'zone') {
      _suppressedByZone.set(key, (_suppressedByZone.get(key) || 0) + 1);
    }
    return;
  }
  fireAnalyticsEvent(_makeEvent(cell, decision));
}

function _simulatorBurst() {
  const cells = _gatherArmedCells();
  if (!cells.length) return;
  const cell = cells[Math.floor(Math.random() * cells.length)];
  // 4 events on the same (cameraId, detectorId, zone) — first one fires
  // toast+flash normally; subsequent ones are deduped (logged only).
  for (let i = 0; i < 4; i++) {
    setTimeout(() => fireAnalyticsEvent(_makeEvent(cell)), i * 800);
  }
}

// ── fireAnalyticsEvent ──────────────────────────────────────────────────
// The unified event-handling path. Dedupe, then either notify() (toast +
// flash + log) or logEvent() (log-only, flagged as deduped).
//
// Phase 2 additions:
//   • event.synthetic === true → subType is 'detection-test', message gains
//     a "Test event:" prefix, bypasses dedupe.
//   • event.suppressedBy === 'mask' | 'zone' → does NOT enter the pipeline
//     (counter-only path; the simulator handles that branch separately).
function fireAnalyticsEvent(event) {
  // Phase 1: severity is always 'info'. A future Watchlist tag (FR/LPR)
  // will mark detection events as 'critical' — leave the hook in place.
  const severity = 'info';

  const key = `${event.cameraId}|${event.detectorId}|${event.zone || '-'}`;
  const now = event.ts || Date.now();

  // Prune stale dedupe entries.
  _recentEvents = _recentEvents.filter(r => now - r.ts < _DEDUPE_WINDOW_MS);

  const cam = cameras.find(c => c.id === event.cameraId);
  const det = DETECTOR_BY_ID[event.detectorId];
  if (!cam || !det) return;

  const camName = cam.name;
  const confPct = Math.round((event.confidence || 0) * 100);
  const baseMsg = `${det.label} at ${camName} · conf ${confPct}%`;
  const synthetic = !!event.synthetic;
  const subType = synthetic ? 'detection-test' : 'detection';
  const message = synthetic ? `Test event: ${baseMsg}` : baseMsg;

  // ── Gate: only surface alerts for cameras placed on the grid ──────────
  // A detection should NOT pop a toast / flash a tile / decorate the sidebar
  // until the user has actually dragged that camera onto a tile. Off-grid
  // detections are still recorded in the activity log (so nothing is lost),
  // but stay silent. Synthetic test-fires bypass the gate so the explicit
  // "test detector" action always gives visible feedback.
  const onGrid = Object.values(tileAssignments).includes(cam.id);
  if (!onGrid && !synthetic) {
    logEvent({
      severity,
      category: 'analytics',
      message,
      cameraId: cam.id,
      cameraName: camName,
      subType,
      detectorId: event.detectorId,
      confidence: event.confidence,
      source: event.source,
      zone: event.zone,
      offGrid: true,
    });
    return;
  }

  // Track most-recent-event timestamp per camera for sidebar ●! decoration
  // (UC-VA2-20). 60 s decay handled by a per-camera timer that re-renders
  // the sidebar at the boundary; subsequent events reset the timer so the
  // badge stays "recent" while events keep coming.
  _camRecentEventAt.set(cam.id, now);
  const prevTimer = _camRecentDecayTimers.get(cam.id);
  if (prevTimer) clearTimeout(prevTimer);
  _camRecentDecayTimers.set(cam.id, setTimeout(() => {
    _camRecentDecayTimers.delete(cam.id);
    renderSidebar();
  }, _SIDEBAR_RECENT_WINDOW_MS));

  // Synthetic events never dedupe — the user wants to see every test fire.
  const duplicate = !synthetic && _recentEvents.find(r => r.key === key);
  if (duplicate) {
    // Dedupe: log only (so the cluster UI can find sibling events), no
    // toast, no tile flash.
    logEvent({
      severity,
      category: 'analytics',
      message,
      cameraId: cam.id,
      cameraName: camName,
      subType,
      detectorId: event.detectorId,
      confidence: event.confidence,
      source: event.source,
      zone: event.zone,
      dedupedFromKey: key
    });
    return;
  }

  // Fresh event — record the key, fire full notification path.
  if (!synthetic) _recentEvents.push({ key, ts: now });
  flashTileBorder(cam.id, severity);
  updateTileEyeState(cam.id, severity);
  notify(message, {
    severity,
    category: 'analytics',
    subType,
    cameraId: cam.id,
    cameraName: camName,
    detectorId: event.detectorId,
    confidence: event.confidence,
    source: event.source,
    zone: event.zone
  });

  // Phase 2: per-tile bbox overlay. Renders a fake bbox over the tile if
  // the user has toggled the overlay on. Applies to real and test events.
  if (cam) _maybeDrawBboxOverlay(cam.id, det, event);

  // Phase 2: refresh sidebar so the camera's ●! decoration appears.
  // Cheap — full re-render is O(cameras) and matches the project's
  // full-re-render convention.
  renderSidebar();
}

// Per-tile simulated bbox. Off by default; toggled from the per-tile
// analytics popover. Renders an absolutely-positioned div over the tile
// snapshot for 3 s. Random-but-plausible position — not real CV.
function _maybeDrawBboxOverlay(cameraId, det, event) {
  const tiles = document.querySelectorAll(`.tile[data-camera-id="${CSS.escape(cameraId)}"]`);
  tiles.forEach(tile => {
    const idxAttr = tile.getAttribute('data-index');
    if (idxAttr == null) return;
    const idx = parseInt(idxAttr, 10);
    if (!tileBboxOverlay[idx]) return;
    // Remove any prior overlay still showing on this tile.
    tile.querySelectorAll('.tile-bbox').forEach(el => el.remove());
    const w = 18 + Math.random() * 22;      // 18–40 %
    const h = 22 + Math.random() * 28;      // 22–50 %
    const left = 5 + Math.random() * (90 - w);
    const top  = 8 + Math.random() * (80 - h);
    const conf = Math.round((event.confidence || 0) * 100);
    const overlay = document.createElement('div');
    overlay.className = 'tile-bbox' + (event.synthetic ? ' tile-bbox-test' : '');
    overlay.style.left = left + '%';
    overlay.style.top = top + '%';
    overlay.style.width = w + '%';
    overlay.style.height = h + '%';
    overlay.innerHTML = `<span class="tile-bbox-label">${esc(det.label)} ${conf}%</span>`;
    tile.appendChild(overlay);
    setTimeout(() => { overlay.remove(); }, 3000);
  });
}

// ── Cluster computation for the Activity Log ───────────────────────────
// Walks an array of (already-filtered, ts-desc) entries and produces an
// ordered list of items: either { type:'entry', entry } or
// { type:'cluster', clusterId, children, leader }. Only consecutive
// analytics detection rows with the same (cameraId, detectorId, zone)
// within 30 s collapse. Groups of size ≤ 2 emit as individual rows.
function _computeActivityClusters(entries) {
  const items = [];
  let i = 0;
  while (i < entries.length) {
    const e = entries[i];
    const isDetection = e.category === 'analytics' && e.subType === 'detection';
    if (!isDetection) {
      items.push({ type: 'entry', entry: e });
      i++;
      continue;
    }
    // Greedy run: include subsequent same-key detection rows whose ts is
    // within CLUSTER_WINDOW_MS of the *current* entry (entries are ts-desc,
    // so older entries follow newer).
    const camId = e.cameraId;
    const detId = e.detectorId;
    const zone = e.zone || '-';
    let j = i + 1;
    const group = [e];
    while (j < entries.length) {
      const c = entries[j];
      if (c.category !== 'analytics' || c.subType !== 'detection') break;
      if (c.cameraId !== camId || c.detectorId !== detId || (c.zone || '-') !== zone) break;
      if ((e.ts - c.ts) > _CLUSTER_WINDOW_MS) break;
      group.push(c);
      j++;
    }
    if (group.length >= 3) {
      const earliest = group[group.length - 1].ts;
      const latest = group[0].ts;
      const clusterId = `${camId}|${detId}|${zone}|${earliest}|${latest}`;
      items.push({ type: 'cluster', clusterId, leader: group[0], children: group });
    } else {
      // Emit individually.
      for (const g of group) items.push({ type: 'entry', entry: g });
    }
    i = j;
  }
  return items;
}

/* ══════════════════════════════════════════
   Cascade Dialog — Disable global server detector (UC-VA-11)
   ══════════════════════════════════════════ */

// Classify every analyticsConfig cell currently bound to this server
// detector into three buckets:
//   willFallback : Auto cells with edge support — silent fallback.
//   willPend     : Auto cells without edge support — go Pending.
//   willError    : Pinned-to-server cells — go Errored.
function _analyzeServerDetectorDisable(detectorId) {
  const willFallback = [];
  const willPend = [];
  const willError = [];
  for (const cam of cameras) {
    const camCfg = analyticsConfig[cam.id];
    if (!camCfg) continue;
    const cfg = camCfg[detectorId];
    if (!cfg || !cfg.enabled) continue;
    const info = resolveSource(cam.id, detectorId);
    if (info.boundTo !== 'server') continue;
    const caps = cameraCapabilities[cam.id] || {};
    const edgeOk = !!caps[detectorId];
    const source = cfg.source || 'auto';
    if (source === 'server') {
      willError.push({ cameraId: cam.id, cameraName: cam.name });
    } else if (source === 'auto') {
      if (edgeOk) willFallback.push({ cameraId: cam.id, cameraName: cam.name });
      else willPend.push({ cameraId: cam.id, cameraName: cam.name });
    }
  }
  const byName = (a, b) => a.cameraName.localeCompare(b.cameraName);
  willFallback.sort(byName);
  willPend.sort(byName);
  willError.sort(byName);
  return { willFallback, willPend, willError };
}

function _applyServerDetectorDisable(detectorId, cascade) {
  serverDetectors[detectorId] = false;
  // Re-evaluate every affected cell. Auto cells (fallback / pend) settle
  // via resolveSource naturally; we just need to update `state` for
  // pinned cells (errored) and clear/set state for pending Auto cells.
  for (const item of cascade.willPend) {
    const cfg = _ensureCellCfg(item.cameraId, detectorId);
    cfg.state = 'pending';
  }
  for (const item of cascade.willError) {
    const cfg = _ensureCellCfg(item.cameraId, detectorId);
    cfg.state = 'errored';
  }
  // Auto-with-edge fallbacks: clear any stale state — Auto naturally
  // resolves to 'edge' now.
  for (const item of cascade.willFallback) {
    const camCfg = analyticsConfig[item.cameraId];
    if (camCfg && camCfg[detectorId]) {
      delete camCfg[detectorId].state;
    }
  }

  saveAnalytics();
  renderAnalyticsTab();
  renderGrid(); // tile badges depend on armed-detector count

  // One summary notify per UC-VA-11.
  const det = DETECTOR_BY_ID[detectorId];
  const detLabel = det ? det.label : detectorId;
  const parts = [];
  if (cascade.willPend.length) parts.push(`${cascade.willPend.length} cell${cascade.willPend.length === 1 ? '' : 's'} now pending`);
  if (cascade.willError.length) parts.push(`${cascade.willError.length} errored`);
  if (cascade.willFallback.length) parts.push(`${cascade.willFallback.length} fell back to edge`);
  const summary = parts.length
    ? `Server ${detLabel} disabled — ${parts.join(', ')}`
    : `Server ${detLabel} disabled`;
  notify(summary, {
    severity: 'warning',
    category: 'analytics',
    subType: 'config',
    detectorId
  });
}

// ── openServerDetectorCascadeDialog ────────────────────────────────────
// Simple backdrop+panel modal, similar to the cell drill-down popover.
// Reuses .analytics-popover-* classes so theming stays consistent.
function openServerDetectorCascadeDialog(detectorId, cascade, { onCancel, onConfirm }) {
  const det = DETECTOR_BY_ID[detectorId];
  if (!det) return;
  const total = cascade.willPend.length + cascade.willError.length + cascade.willFallback.length;
  const onlyFallback = cascade.willFallback.length > 0
    && !cascade.willPend.length
    && !cascade.willError.length;

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-cascade';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'cascade-title');

  // Build the affected camera list HTML.
  const lineFor = (item, tag) =>
    `<li class="cascade-row cascade-row-${esc(tag)}"><span class="cascade-cam">${esc(item.cameraName)}</span><span class="cascade-tag cascade-tag-${esc(tag)}">${esc(_cascadeTagLabel(tag))}</span></li>`;
  const linesHtml = [
    ...cascade.willFallback.map(it => lineFor(it, 'fallback')),
    ...cascade.willPend.map(it => lineFor(it, 'pend')),
    ...cascade.willError.map(it => lineFor(it, 'error'))
  ].join('');

  const headline = onlyFallback
    ? `Disable server ${esc(det.label)}?`
    : `Disable server ${esc(det.label)}?`;
  const lede = onlyFallback
    ? `This will affect ${total} camera${total === 1 ? '' : 's'}; all can fall back to edge.`
    : `This will affect ${total} camera${total === 1 ? '' : 's'}:`;
  const tail = (cascade.willError.length || cascade.willPend.length)
    ? `<p class="cascade-tail">Pinned cells will error and not fire events. Auto cells without edge support will pend.</p>`
    : `<p class="cascade-tail">Auto cells fall back to edge silently. No detector will be stranded.</p>`;

  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3 id="cascade-title">${headline}</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body">
      <p class="cascade-lede">${esc(lede)}</p>
      <ul class="cascade-list">${linesHtml}</ul>
      ${tail}
    </div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary cascade-cancel">Cancel</button>
      <button type="button" class="btn btn-danger cascade-confirm">Disable anyway</button>
    </footer>
  `;

  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  let closed = false;
  const close = (mode) => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', keydownHandler, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    if (mode === 'cancel' && typeof onCancel === 'function') onCancel();
    if (mode === 'confirm' && typeof onConfirm === 'function') onConfirm();
  };

  panel.querySelector('.analytics-popover-close').addEventListener('click', () => close('cancel'));
  panel.querySelector('.cascade-cancel').addEventListener('click', () => close('cancel'));
  panel.querySelector('.cascade-confirm').addEventListener('click', () => close('confirm'));
  backdrop.addEventListener('click', e => {
    if (e.target === backdrop) close('cancel');
  });

  const keydownHandler = e => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close('cancel');
    }
  };
  document.addEventListener('keydown', keydownHandler, true);

  setTimeout(() => {
    const btn = panel.querySelector('.cascade-confirm');
    if (btn) btn.focus();
  }, 0);
}

function _cascadeTagLabel(tag) {
  if (tag === 'fallback') return 'auto → falls back to edge';
  if (tag === 'pend')     return 'auto → will pend, no edge support';
  if (tag === 'error')    return 'pinned → will error';
  return tag;
}

/* ══════════════════════════════════════════
   Phase 2 — Batch B: Geometry editor + binding (UC-VA2-07..10, UC-VA2-21)
   ──────────────────────────────────────────
   Geometry is normalized to a 0..1000 integer grid so it survives image
   resizing. The editor renders the snapshot inside a div, with an SVG
   overlay sized to the image; SVG was chosen over canvas because shapes
   are individually click/hover-able (no hit-testing math needed) and
   the project has no prior canvas/SVG conventions to inherit.
   ══════════════════════════════════════════ */

const GEOM_PALETTE = [
  '#22c55e', '#3b82f6', '#f97316', '#eab308',
  '#ec4899', '#06b6d4', '#a3e635', '#8b5cf6'
];
const GEOM_GRID = 1000;        // SVG viewBox is 0 0 1000 1000-aspect

function _newGeomId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 100000).toString(36)}`;
}

function _ensureGeom(cameraId) {
  if (!analyticsConfig[cameraId]) analyticsConfig[cameraId] = {};
  if (!analyticsConfig[cameraId]._geometry) {
    analyticsConfig[cameraId]._geometry = { zones: [], lines: [], masks: [] };
  }
  const g = analyticsConfig[cameraId]._geometry;
  if (!Array.isArray(g.zones)) g.zones = [];
  if (!Array.isArray(g.lines)) g.lines = [];
  if (!Array.isArray(g.masks)) g.masks = [];
  return g;
}

// ── Geometry math ──
function pointInPolygon(pt, poly) {
  if (!poly || poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > pt.y) !== (yj > pt.y)) &&
      (pt.x < (xj - xi) * (pt.y - yi) / ((yj - yi) || 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function segmentsIntersect(a, b, c, d) {
  // Standard parametric segment-segment intersection.
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = r.x * s.y - r.y * s.x;
  if (denom === 0) return false;   // parallel — ignore collinear edge cases
  const t = ((c.x - a.x) * s.y - (c.y - a.y) * s.x) / denom;
  const u = ((c.x - a.x) * r.y - (c.y - a.y) * r.x) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function sideOfLine(line, pt) {
  const a = line.points[0], b = line.points[1];
  return Math.sign((b.x - a.x) * (pt.y - a.y) - (b.y - a.y) * (pt.x - a.x));
}

function polygonSelfIntersects(poly) {
  if (!poly || poly.length < 4) return false;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip adjacent (shared vertex) edges.
      if (j === i || j === (i + 1) % n || (j + 1) % n === i) continue;
      const c = poly[j], d = poly[(j + 1) % n];
      // Skip edges sharing a vertex.
      if (a === c || a === d || b === c || b === d) continue;
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function polygonInsideCanvas(poly) {
  if (!poly || !poly.length) return false;
  for (const p of poly) {
    if (p.x >= 0 && p.x <= GEOM_GRID && p.y >= 0 && p.y <= GEOM_GRID) return true;
  }
  return false;
}

// ── Zone editor modal ──
let _zoneEditorState = null; // { cameraId, draft, tool, selectedId, drawingPts, backdropEl, keydownHandler }

function openZoneEditor(cameraId) {
  closeZoneEditor();
  const cam = cameras.find(c => c.id === cameraId);
  if (!cam) return;
  const live = _ensureGeom(cameraId);
  // Work on a draft copy so Cancel reverts cleanly.
  const draft = {
    zones: live.zones.map(z => ({ ...z, points: z.points.map(p => ({ ...p })) })),
    lines: live.lines.map(l => ({ ...l, points: l.points.map(p => ({ ...p })) })),
    masks: live.masks.map(m => ({
      ...m,
      points: m.points.map(p => ({ ...p })),
      appliesTo: typeof m.appliesTo === 'object' ? { detectors: [...(m.appliesTo.detectors || [])] } : m.appliesTo
    }))
  };
  _zoneEditorState = {
    cameraId,
    draft,
    tool: null,        // 'polygon' | 'tripwire' | 'mask' | 'erase'
    selected: null,    // { type:'zone'|'line'|'mask', id }
    drawingPts: [],
    backdropEl: null,
    keydownHandler: null
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-zone-editor';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');

  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3>${esc(cam.name)} · Zones</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body zone-editor-body" id="zone-editor-body"></div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary" data-ze-act="cancel">Cancel</button>
      <button type="button" class="btn btn-primary" data-ze-act="apply">Apply zones</button>
    </footer>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);
  _zoneEditorState.backdropEl = backdrop;

  _renderZoneEditorBody();

  panel.querySelector('.analytics-popover-close').addEventListener('click', () => closeZoneEditor());
  panel.querySelector('[data-ze-act="cancel"]').addEventListener('click', () => closeZoneEditor());
  panel.querySelector('[data-ze-act="apply"]').addEventListener('click', _applyZoneEditor);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) closeZoneEditor(); });

  const keydownHandler = e => {
    if (!_zoneEditorState) return;
    if (e.key === 'Escape') {
      // If currently drawing, escape just cancels the in-progress shape.
      if (_zoneEditorState.drawingPts.length) {
        e.stopPropagation(); e.preventDefault();
        _zoneEditorState.drawingPts = [];
        _renderZoneEditorBody();
        return;
      }
      e.stopPropagation(); e.preventDefault();
      closeZoneEditor();
      return;
    }
    if (e.key === 'Enter' && _zoneEditorState.tool === 'polygon' && _zoneEditorState.drawingPts.length >= 3) {
      _commitPolygonShape();
    }
  };
  document.addEventListener('keydown', keydownHandler, true);
  _zoneEditorState.keydownHandler = keydownHandler;
}

function closeZoneEditor() {
  if (!_zoneEditorState) return;
  const { backdropEl, keydownHandler } = _zoneEditorState;
  if (keydownHandler) document.removeEventListener('keydown', keydownHandler, true);
  if (backdropEl && backdropEl.parentNode) backdropEl.parentNode.removeChild(backdropEl);
  _zoneEditorState = null;
}

function _renderZoneEditorBody() {
  if (!_zoneEditorState) return;
  const { cameraId, draft, tool, selected, drawingPts, backdropEl } = _zoneEditorState;
  const body = backdropEl.querySelector('#zone-editor-body');
  if (!body) return;

  // ── Build SVG content ──
  let svgBg = '';
  // Hatch pattern for masks.
  svgBg += `<defs>
    <pattern id="ze-hatch" patternUnits="userSpaceOnUse" width="14" height="14" patternTransform="rotate(45)">
      <rect width="14" height="14" fill="rgba(239,68,68,0.18)"/>
      <line x1="0" y1="0" x2="0" y2="14" stroke="rgba(239,68,68,0.55)" stroke-width="2"/>
    </pattern>
    <marker id="ze-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#fff"/>
    </marker>
  </defs>`;

  const shapeIsSelected = (type, id) => selected && selected.type === type && selected.id === id;

  // Masks (drawn first so they're behind)
  for (const m of draft.masks) {
    const pts = m.points.map(p => `${p.x},${p.y}`).join(' ');
    const sel = shapeIsSelected('mask', m.id) ? ' ze-shape-selected' : '';
    svgBg += `<polygon class="ze-mask${sel}" data-ze-shape="mask:${esc(m.id)}" points="${pts}" fill="url(#ze-hatch)" stroke="rgba(239,68,68,0.9)" stroke-width="3" stroke-dasharray="6 4"/>`;
  }
  // Zones
  for (const z of draft.zones) {
    const pts = z.points.map(p => `${p.x},${p.y}`).join(' ');
    const sel = shapeIsSelected('zone', z.id) ? ' ze-shape-selected' : '';
    const intersects = polygonSelfIntersects(z.points);
    const stroke = intersects ? 'var(--red)' : (z.color || '#3b82f6');
    svgBg += `<polygon class="ze-zone${sel}${intersects ? ' ze-zone-bad' : ''}" data-ze-shape="zone:${esc(z.id)}" points="${pts}" fill="${stroke}33" stroke="${stroke}" stroke-width="3"/>`;
    // Zone label.
    const cx = z.points.reduce((s, p) => s + p.x, 0) / z.points.length;
    const cy = z.points.reduce((s, p) => s + p.y, 0) / z.points.length;
    svgBg += `<text class="ze-label" x="${cx}" y="${cy}" text-anchor="middle" fill="#fff" stroke="rgba(0,0,0,0.55)" stroke-width="3" paint-order="stroke" font-size="32" font-weight="700">${esc(z.name)}</text>`;
  }
  // Lines (tripwires)
  for (const l of draft.lines) {
    const [a, b] = l.points;
    const sel = shapeIsSelected('line', l.id) ? ' ze-shape-selected' : '';
    const markerStart = (l.direction === 'outbound' || l.direction === 'both') ? ' marker-start="url(#ze-arrow)"' : '';
    const markerEnd = (l.direction !== 'outbound') ? ' marker-end="url(#ze-arrow)"' : '';
    svgBg += `<line class="ze-line${sel}" data-ze-shape="line:${esc(l.id)}" x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" stroke="#fff" stroke-width="5" ${markerStart}${markerEnd}/>`;
    // Label near midpoint.
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    svgBg += `<text class="ze-label" x="${mx}" y="${my - 14}" text-anchor="middle" fill="#fff" stroke="rgba(0,0,0,0.6)" stroke-width="3" paint-order="stroke" font-size="28" font-weight="700">${esc(l.name)}</text>`;
  }
  // In-progress drawing.
  if (drawingPts.length) {
    if ((tool === 'polygon' || tool === 'mask') && drawingPts.length >= 1) {
      const pts = drawingPts.map(p => `${p.x},${p.y}`).join(' ');
      svgBg += `<polyline class="ze-draft" points="${pts}" fill="none" stroke="${tool === 'mask' ? '#ef4444' : '#22c55e'}" stroke-width="3" stroke-dasharray="10 6"/>`;
      for (const p of drawingPts) {
        svgBg += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#22c55e" stroke="#fff" stroke-width="2"/>`;
      }
    }
    if (tool === 'tripwire' && drawingPts.length === 1) {
      const p = drawingPts[0];
      svgBg += `<circle cx="${p.x}" cy="${p.y}" r="6" fill="#22c55e" stroke="#fff" stroke-width="2"/>`;
    }
  }

  // ── Right rail ──
  const propsHtml = _renderZoneEditorPropsPane();
  const shapesListHtml = `
    ${draft.zones.length ? '<div class="ze-list-head">Zones</div>' : ''}
    ${draft.zones.map(z => `
      <div class="ze-list-row${shapeIsSelected('zone', z.id) ? ' ze-list-row-selected' : ''}" data-ze-list="zone:${esc(z.id)}">
        <span class="ze-list-dot" style="background:${esc(z.color || '#3b82f6')}"></span>
        <span class="ze-list-name">${esc(z.name)}</span>
        <button type="button" class="ze-list-del" data-ze-del="zone:${esc(z.id)}" aria-label="Delete">×</button>
      </div>
    `).join('')}
    ${draft.lines.length ? '<div class="ze-list-head">Lines</div>' : ''}
    ${draft.lines.map(l => `
      <div class="ze-list-row${shapeIsSelected('line', l.id) ? ' ze-list-row-selected' : ''}" data-ze-list="line:${esc(l.id)}">
        <span class="ze-list-dot ze-list-line-dot"></span>
        <span class="ze-list-name">${esc(l.name)}</span>
        <button type="button" class="ze-list-del" data-ze-del="line:${esc(l.id)}" aria-label="Delete">×</button>
      </div>
    `).join('')}
    ${draft.masks.length ? '<div class="ze-list-head">Masks</div>' : ''}
    ${draft.masks.map(m => `
      <div class="ze-list-row${shapeIsSelected('mask', m.id) ? ' ze-list-row-selected' : ''}" data-ze-list="mask:${esc(m.id)}">
        <span class="ze-list-dot ze-list-mask-dot"></span>
        <span class="ze-list-name">${esc(m.name)}</span>
        <button type="button" class="ze-list-del" data-ze-del="mask:${esc(m.id)}" aria-label="Delete">×</button>
      </div>
    `).join('')}
    ${!draft.zones.length && !draft.lines.length && !draft.masks.length
      ? '<div class="ze-list-empty">No shapes yet. Pick a tool and click on the snapshot to start.</div>'
      : ''}
  `;

  body.innerHTML = `
    <div class="ze-layout">
      <div class="ze-canvas-wrap">
        <img class="ze-canvas-img" src="${camImage(cameraId)}" alt="Snapshot for zone editing">
        <svg class="ze-canvas-svg" viewBox="0 0 ${GEOM_GRID} ${GEOM_GRID}" preserveAspectRatio="none">${svgBg}</svg>
      </div>
      <div class="ze-rail">
        <div class="ze-rail-section">
          <h4>Tool</h4>
          <div class="ze-tool-row">
            <button type="button" class="ze-tool-btn${tool === 'polygon' ? ' active' : ''}" data-ze-tool="polygon" title="Polygon zone">▢ Polygon</button>
            <button type="button" class="ze-tool-btn${tool === 'tripwire' ? ' active' : ''}" data-ze-tool="tripwire" title="Tripwire (line)">─ Tripwire</button>
            <button type="button" class="ze-tool-btn${tool === 'mask' ? ' active' : ''}" data-ze-tool="mask" title="Ignore mask">▓ Mask</button>
            <button type="button" class="ze-tool-btn${tool === 'erase' ? ' active' : ''}" data-ze-tool="erase" title="Click a shape to delete">✋ Erase</button>
          </div>
          <p class="ze-tool-hint">
            ${tool === 'polygon' || tool === 'mask'
              ? 'Click to add points. Double-click or press Enter to close. Esc cancels in-progress.'
              : tool === 'tripwire'
                ? 'Click start, then click end.'
                : tool === 'erase'
                  ? 'Click a shape on the snapshot to delete it.'
                  : 'Pick a tool above to draw, or click a shape to select.'}
          </p>
        </div>
        <div class="ze-rail-section">
          <h4>Shapes</h4>
          <div class="ze-list">${shapesListHtml}</div>
        </div>
        <div class="ze-rail-section">
          <h4>Properties</h4>
          ${propsHtml}
        </div>
      </div>
    </div>
  `;

  // ── Wire interactions ──
  // Tool selection
  body.querySelectorAll('[data-ze-tool]').forEach(b => {
    b.addEventListener('click', () => {
      if (!_zoneEditorState) return;
      const next = b.getAttribute('data-ze-tool');
      _zoneEditorState.tool = _zoneEditorState.tool === next ? null : next;
      _zoneEditorState.drawingPts = [];
      _zoneEditorState.selected = null;
      _renderZoneEditorBody();
    });
  });

  // SVG canvas
  const svgEl = body.querySelector('.ze-canvas-svg');
  if (svgEl) _bindZoneEditorCanvas(svgEl);

  // Shape list interactions
  body.querySelectorAll('[data-ze-list]').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.closest('[data-ze-del]')) return;
      const sel = row.getAttribute('data-ze-list');
      const [type, id] = sel.split(':');
      _zoneEditorState.selected = { type, id };
      _renderZoneEditorBody();
    });
  });
  body.querySelectorAll('[data-ze-del]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const sel = btn.getAttribute('data-ze-del');
      const [type, id] = sel.split(':');
      _deleteZoneEditorShape(type, id);
    });
  });

  // Props pane wiring
  _bindZoneEditorPropsPane(body);
}

function _renderZoneEditorPropsPane() {
  if (!_zoneEditorState || !_zoneEditorState.selected) {
    return `<div class="ze-props-empty">Click a shape on the snapshot or in the list to inspect it.</div>`;
  }
  const { draft, selected } = _zoneEditorState;
  const arr = selected.type === 'zone' ? draft.zones : selected.type === 'line' ? draft.lines : draft.masks;
  const shape = arr.find(s => s.id === selected.id);
  if (!shape) return `<div class="ze-props-empty">Selected shape no longer exists.</div>`;

  if (selected.type === 'zone') {
    const palette = GEOM_PALETTE.map(c =>
      `<button type="button" class="ze-swatch${shape.color === c ? ' selected' : ''}" data-ze-color="${esc(c)}" style="background:${esc(c)}" aria-label="${esc(c)}"></button>`
    ).join('');
    const bad = polygonSelfIntersects(shape.points);
    return `
      <div class="ze-props-row">
        <label class="ze-props-label">Name</label>
        <input type="text" class="form-input ze-props-name" value="${esc(shape.name)}">
      </div>
      <div class="ze-props-row">
        <label class="ze-props-label">Color</label>
        <div class="ze-swatches">${palette}</div>
      </div>
      ${bad ? '<div class="ze-props-warn">⚠ Self-intersecting polygon — detection behavior is undefined.</div>' : ''}
    `;
  }
  if (selected.type === 'line') {
    return `
      <div class="ze-props-row">
        <label class="ze-props-label">Name</label>
        <input type="text" class="form-input ze-props-name" value="${esc(shape.name)}">
      </div>
      <div class="ze-props-row">
        <label class="ze-props-label">Direction</label>
        <div class="ze-direction-row">
          <label><input type="radio" name="ze-dir" value="inbound" ${shape.direction === 'inbound' ? 'checked' : ''}> Inbound</label>
          <label><input type="radio" name="ze-dir" value="outbound" ${shape.direction === 'outbound' ? 'checked' : ''}> Outbound</label>
          <label><input type="radio" name="ze-dir" value="both" ${shape.direction === 'both' ? 'checked' : ''}> Both</label>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-ze-swap-dir>⇋ Swap endpoints</button>
      </div>
    `;
  }
  // mask
  return `
    <div class="ze-props-row">
      <label class="ze-props-label">Name</label>
      <input type="text" class="form-input ze-props-name" value="${esc(shape.name)}">
    </div>
    <div class="ze-props-row">
      <label class="ze-props-label">Applies to</label>
      <div class="ze-mask-applies">All detectors on this camera</div>
    </div>
  `;
}

function _bindZoneEditorPropsPane(body) {
  if (!_zoneEditorState || !_zoneEditorState.selected) return;
  const { selected, draft } = _zoneEditorState;
  const arr = selected.type === 'zone' ? draft.zones : selected.type === 'line' ? draft.lines : draft.masks;
  const shape = arr.find(s => s.id === selected.id);
  if (!shape) return;

  const nameInput = body.querySelector('.ze-props-name');
  if (nameInput) {
    nameInput.addEventListener('input', () => {
      shape.name = nameInput.value.trim() || shape.name;
      _renderZoneEditorBody();
    });
  }
  body.querySelectorAll('[data-ze-color]').forEach(sw => {
    sw.addEventListener('click', () => {
      shape.color = sw.getAttribute('data-ze-color');
      _renderZoneEditorBody();
    });
  });
  body.querySelectorAll('input[name="ze-dir"]').forEach(r => {
    r.addEventListener('change', () => {
      shape.direction = r.value;
      _renderZoneEditorBody();
    });
  });
  const swap = body.querySelector('[data-ze-swap-dir]');
  if (swap) swap.addEventListener('click', () => {
    shape.points = [shape.points[1], shape.points[0]];
    _renderZoneEditorBody();
  });
}

function _deleteZoneEditorShape(type, id) {
  if (!_zoneEditorState) return;
  const { draft } = _zoneEditorState;
  if (type === 'zone') {
    draft.zones = draft.zones.filter(s => s.id !== id);
    // Strip the zone from any detector's binding.
    const camCfg = analyticsConfig[_zoneEditorState.cameraId] || {};
    for (const k in camCfg) {
      if (k.startsWith('_')) continue;
      const cell = camCfg[k];
      if (cell && Array.isArray(cell.zones)) {
        cell.zones = cell.zones.filter(z => z !== id);
        if (!cell.zones.length) delete cell.zones;
      }
    }
  } else if (type === 'line') {
    draft.lines = draft.lines.filter(s => s.id !== id);
  } else if (type === 'mask') {
    draft.masks = draft.masks.filter(s => s.id !== id);
  }
  if (_zoneEditorState.selected && _zoneEditorState.selected.type === type && _zoneEditorState.selected.id === id) {
    _zoneEditorState.selected = null;
  }
  _renderZoneEditorBody();
}

function _bindZoneEditorCanvas(svgEl) {
  // Convert client coords to viewBox coords using the SVG's bounding rect.
  const toGrid = (clientX, clientY) => {
    const r = svgEl.getBoundingClientRect();
    const x = Math.round(((clientX - r.left) / r.width) * GEOM_GRID);
    const y = Math.round(((clientY - r.top) / r.height) * GEOM_GRID);
    return { x: Math.max(0, Math.min(GEOM_GRID, x)), y: Math.max(0, Math.min(GEOM_GRID, y)) };
  };

  svgEl.addEventListener('click', e => {
    if (!_zoneEditorState) return;
    const { tool } = _zoneEditorState;
    // Click-to-select if no tool active or if we clicked on an existing shape.
    const shapeEl = e.target.closest('[data-ze-shape]');
    if (!tool && shapeEl) {
      const [type, id] = shapeEl.getAttribute('data-ze-shape').split(':');
      _zoneEditorState.selected = { type, id };
      _renderZoneEditorBody();
      return;
    }
    if (tool === 'erase' && shapeEl) {
      const [type, id] = shapeEl.getAttribute('data-ze-shape').split(':');
      _deleteZoneEditorShape(type, id);
      return;
    }
    if (!tool) return;

    const pt = toGrid(e.clientX, e.clientY);

    if (tool === 'polygon' || tool === 'mask') {
      _zoneEditorState.drawingPts.push(pt);
      _renderZoneEditorBody();
      return;
    }
    if (tool === 'tripwire') {
      _zoneEditorState.drawingPts.push(pt);
      if (_zoneEditorState.drawingPts.length === 2) {
        const [a, b] = _zoneEditorState.drawingPts;
        if (a.x === b.x && a.y === b.y) {
          // Zero-length — discard and let the user retry.
          _zoneEditorState.drawingPts = [];
          _renderZoneEditorBody();
          return;
        }
        const newLine = {
          id: _newGeomId('line'),
          name: `Line ${String.fromCharCode(64 + _zoneEditorState.draft.lines.length + 1)}`,
          points: [a, b],
          direction: 'inbound'
        };
        _zoneEditorState.draft.lines.push(newLine);
        _zoneEditorState.selected = { type: 'line', id: newLine.id };
        _zoneEditorState.drawingPts = [];
        _renderZoneEditorBody();
      } else {
        _renderZoneEditorBody();
      }
      return;
    }
  });

  svgEl.addEventListener('dblclick', e => {
    if (!_zoneEditorState) return;
    const { tool, drawingPts } = _zoneEditorState;
    if ((tool === 'polygon' || tool === 'mask') && drawingPts.length >= 3) {
      e.preventDefault();
      _commitPolygonShape();
    }
  });
}

function _commitPolygonShape() {
  if (!_zoneEditorState) return;
  const { tool, drawingPts, draft } = _zoneEditorState;
  if (drawingPts.length < 3) return;
  // Dedupe consecutive duplicate points (and drop the closing duplicate).
  const pts = drawingPts.filter((p, i, arr) =>
    i === 0 || (arr[i - 1].x !== p.x || arr[i - 1].y !== p.y)
  );
  if (pts.length < 3) {
    _zoneEditorState.drawingPts = [];
    _renderZoneEditorBody();
    return;
  }
  if (tool === 'polygon') {
    const newZone = {
      id: _newGeomId('zone'),
      name: `Zone ${String.fromCharCode(64 + draft.zones.length + 1)}`,
      color: GEOM_PALETTE[draft.zones.length % GEOM_PALETTE.length],
      points: pts
    };
    draft.zones.push(newZone);
    _zoneEditorState.selected = { type: 'zone', id: newZone.id };
  } else if (tool === 'mask') {
    const newMask = {
      id: _newGeomId('mask'),
      name: `Mask ${draft.masks.length + 1}`,
      points: pts,
      appliesTo: 'all'
    };
    draft.masks.push(newMask);
    _zoneEditorState.selected = { type: 'mask', id: newMask.id };
  }
  _zoneEditorState.drawingPts = [];
  _renderZoneEditorBody();
}

function _applyZoneEditor() {
  if (!_zoneEditorState) return;
  const { cameraId, draft } = _zoneEditorState;
  // Validation — block on empty / outside-canvas; warn (but allow) on self-intersection.
  let blocker = null;
  for (const z of draft.zones) {
    if (!z.points || z.points.length < 3) {
      blocker = `Zone "${z.name}" needs at least 3 points.`;
      _zoneEditorState.selected = { type: 'zone', id: z.id };
      break;
    }
    if (!polygonInsideCanvas(z.points)) {
      blocker = `Zone "${z.name}" lies entirely outside the snapshot.`;
      _zoneEditorState.selected = { type: 'zone', id: z.id };
      break;
    }
  }
  if (!blocker) {
    for (const m of draft.masks) {
      if (!m.points || m.points.length < 3) {
        blocker = `Mask "${m.name}" needs at least 3 points.`;
        _zoneEditorState.selected = { type: 'mask', id: m.id };
        break;
      }
    }
  }
  if (blocker) {
    showToast(blocker, true);
    _renderZoneEditorBody();
    return;
  }

  // Self-intersection: confirm to save anyway.
  const badZones = draft.zones.filter(z => polygonSelfIntersects(z.points));
  if (badZones.length) {
    const ok = confirm(
      `${badZones.length} self-intersecting polygon${badZones.length === 1 ? '' : 's'} — detection behavior is undefined. Save anyway?`
    );
    if (!ok) return;
  }

  const live = _ensureGeom(cameraId);
  live.zones = draft.zones;
  live.lines = draft.lines;
  live.masks = draft.masks;
  saveAnalytics();

  const cam = cameras.find(c => c.id === cameraId);
  notify(
    `Zones updated on ${cam ? cam.name : cameraId} — ${live.zones.length} zone${live.zones.length === 1 ? '' : 's'}, ${live.lines.length} line${live.lines.length === 1 ? '' : 's'}, ${live.masks.length} mask${live.masks.length === 1 ? '' : 's'}`,
    { category: 'analytics', subType: 'config', severity: 'info', cameraId: cam && cam.id, cameraName: cam && cam.name }
  );

  closeZoneEditor();
  renderAnalyticsTab();
}

/* ── Zone-binding mini-modal (UC-VA2-10) ───────────────────────────────── */
function openZoneBindingModal(cameraId, detectorId) {
  const cam = cameras.find(c => c.id === cameraId);
  const det = DETECTOR_BY_ID[detectorId];
  if (!cam || !det) return;
  const geom = _ensureGeom(cameraId);
  if (!geom.zones.length) {
    showToast('No zones defined yet — open the editor first.', true);
    return;
  }
  const cfg = _ensureCellCfg(cameraId, detectorId);
  const current = Array.isArray(cfg.zones) ? cfg.zones.slice() : [];
  const isWhole = !current.length || current.includes('whole-frame');

  const backdrop = document.createElement('div');
  backdrop.className = 'analytics-popover-backdrop';
  const panel = document.createElement('div');
  panel.className = 'analytics-popover analytics-zone-binding';
  panel.setAttribute('role', 'dialog');

  const zoneRows = geom.zones.map(z => `
    <label class="zb-row">
      <input type="checkbox" data-zb-zone="${esc(z.id)}" ${!isWhole && current.includes(z.id) ? 'checked' : ''}>
      <span class="zb-zone-dot" style="background:${esc(z.color || '#3b82f6')}"></span>
      <span class="zb-zone-name">${esc(z.name)}</span>
    </label>
  `).join('');

  panel.innerHTML = `
    <header class="analytics-popover-header">
      <h3>Zones for: ${esc(cam.name)} · ${esc(det.label)}</h3>
      <button type="button" class="analytics-popover-close" aria-label="Close">×</button>
    </header>
    <div class="analytics-popover-body">
      ${zoneRows}
      <label class="zb-row zb-whole">
        <input type="checkbox" id="zb-whole" ${isWhole ? 'checked' : ''}>
        <span class="zb-zone-name">Whole frame (overrides zone selection)</span>
      </label>
    </div>
    <footer class="analytics-popover-footer">
      <button type="button" class="btn btn-secondary" data-zb-cancel>Cancel</button>
      <button type="button" class="btn btn-primary" data-zb-apply>Apply</button>
    </footer>
  `;
  backdrop.appendChild(panel);
  document.body.appendChild(backdrop);

  const close = () => {
    document.removeEventListener('keydown', keydown, true);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
  };
  const keydown = e => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); }
  };
  document.addEventListener('keydown', keydown, true);
  backdrop.addEventListener('click', e => { if (e.target === backdrop) close(); });
  panel.querySelector('.analytics-popover-close').addEventListener('click', close);
  panel.querySelector('[data-zb-cancel]').addEventListener('click', close);

  // Validation: at least one checkbox must be selected.
  const refreshApply = () => {
    const anyZone = panel.querySelectorAll('input[data-zb-zone]:checked').length > 0;
    const whole = panel.querySelector('#zb-whole').checked;
    panel.querySelector('[data-zb-apply]').disabled = !anyZone && !whole;
  };
  panel.querySelectorAll('input').forEach(cb => cb.addEventListener('change', refreshApply));
  refreshApply();

  panel.querySelector('[data-zb-apply]').addEventListener('click', () => {
    const whole = panel.querySelector('#zb-whole').checked;
    const selected = Array.from(panel.querySelectorAll('input[data-zb-zone]:checked'))
      .map(cb => cb.getAttribute('data-zb-zone'));
    if (whole || !selected.length) {
      delete cfg.zones;     // absence = whole frame (canonical)
    } else {
      cfg.zones = selected;
    }
    saveAnalytics();
    close();
    renderAnalyticsTab();
    if (_popoverState && _popoverState.cameraId === cameraId && _popoverState.detectorId === detectorId) {
      _renderAnalyticsPopoverBody();
    }
    notify(`Zone binding updated on ${cam.name} · ${det.label}`, {
      category: 'analytics', subType: 'config', severity: 'info',
      cameraId: cam.id, cameraName: cam.name, detectorId
    });
  });
}

/* ══════════════════════════════════════════
   Custom Group Dropdown & Inline Creation
   ══════════════════════════════════════════ */
function populateGroupDropdown(selectEl) {
  if (!selectEl) selectEl = document.getElementById('cam-add-group');
  const prev = selectEl.value;
  selectEl.innerHTML = '';

  // Built-in groups
  for (const name of BUILTIN_GROUPS) {
    const opt = document.createElement('option');
    opt.value = name; opt.textContent = name;
    selectEl.appendChild(opt);
  }

  // Custom groups (with separator if any)
  if (customGroups.length) {
    const sep = document.createElement('option');
    sep.disabled = true; sep.textContent = '───────────';
    selectEl.appendChild(sep);
    for (const g of customGroups) {
      const opt = document.createElement('option');
      opt.value = g.name; opt.textContent = g.name;
      selectEl.appendChild(opt);
    }
  }

  // "+ New Group..." option
  const sep2 = document.createElement('option');
  sep2.disabled = true; sep2.textContent = '───────────';
  selectEl.appendChild(sep2);
  const newOpt = document.createElement('option');
  newOpt.value = '__new_group__'; newOpt.textContent = '+ New Group...';
  selectEl.appendChild(newOpt);

  // Restore previous selection if still valid
  const allNames = getAllGroupNames();
  if (allNames.includes(prev)) selectEl.value = prev;
  else selectEl.value = BUILTIN_GROUPS[0];
}

function initGroupCreationInline() {
  const selectEl = document.getElementById('cam-add-group');
  const formGroup = selectEl.closest('.form-group');

  // Create inline form
  const inlineForm = document.createElement('div');
  inlineForm.className = 'group-inline-create';
  inlineForm.id = 'group-inline-create';
  inlineForm.innerHTML = `
    <input class="form-input" id="new-group-name" placeholder="Group name…" style="margin-bottom:8px">
    <div class="color-swatches" id="new-group-swatches">
      ${GROUP_COLOR_PALETTE.map((c, i) =>
        `<div class="color-swatch${i === 0 ? ' selected' : ''}" data-color="${c}" style="background:${c}" title="${c}"></div>`
      ).join('')}
    </div>
    <div class="inline-row">
      <button class="btn btn-primary btn-sm" id="new-group-create">Create</button>
      <button class="btn btn-secondary btn-sm" id="new-group-cancel">Cancel</button>
    </div>
  `;
  formGroup.appendChild(inlineForm);

  let selectedColor = GROUP_COLOR_PALETTE[0];

  // Swatch clicks
  inlineForm.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      inlineForm.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      sw.classList.add('selected');
      selectedColor = sw.dataset.color;
    });
  });

  // Show inline form when "+ New Group..." is selected
  selectEl.addEventListener('change', () => {
    if (selectEl.value === '__new_group__') {
      selectEl.style.display = 'none';
      inlineForm.classList.add('visible');
      document.getElementById('new-group-name').value = '';
      document.getElementById('new-group-name').focus();
      // Reset swatch selection
      inlineForm.querySelectorAll('.color-swatch').forEach((s, i) => s.classList.toggle('selected', i === 0));
      selectedColor = GROUP_COLOR_PALETTE[0];
    }
  });

  function confirmCreate() {
    const nameInput = document.getElementById('new-group-name');
    const name = nameInput.value.trim();
    if (!name) { nameInput.classList.add('error'); return; }
    nameInput.classList.remove('error');

    // Check for duplicates
    if (BUILTIN_GROUPS.includes(name) || customGroups.some(g => g.name === name)) {
      showToast(`Group "${name}" already exists`, true);
      return;
    }

    customGroups.push({ name, color: selectedColor });
    saveCustomGroups();

    // Hide inline form, show select, select new group
    inlineForm.classList.remove('visible');
    selectEl.style.display = '';
    populateGroupDropdown(selectEl);
    selectEl.value = name;

    renderGroupManager();
    renderSidebar();
    notify(`Group "${name}" created`, { category: 'config' });
  }

  function cancelCreate() {
    inlineForm.classList.remove('visible');
    selectEl.style.display = '';
    selectEl.value = BUILTIN_GROUPS[0];
  }

  document.getElementById('new-group-create').addEventListener('click', confirmCreate);
  document.getElementById('new-group-cancel').addEventListener('click', cancelCreate);

  // Enter/Escape in name input
  document.getElementById('new-group-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); confirmCreate(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelCreate(); }
  });
}

/* ══════════════════════════════════════════
   Group Manager (in Cameras tab)
   ══════════════════════════════════════════ */
function renderGroupManager() {
  const pane = document.getElementById('cam-list-view');
  let mgr = document.getElementById('group-manager');

  if (!mgr) {
    mgr = document.createElement('div');
    mgr.id = 'group-manager';
    pane.appendChild(mgr);
  }

  if (!customGroups.length) {
    mgr.innerHTML = `
      <div class="gm-header" id="gm-header">
        <h3>Custom Groups <span class="gm-chevron">&#9660;</span></h3>
      </div>
      <div class="gm-body"><div class="gm-empty">No custom groups yet. Use the Group dropdown above to create one.</div></div>`;
    mgr.querySelector('.gm-header').addEventListener('click', toggleGroupManager);
    return;
  }

  // Count cameras per group
  const counts = {};
  cameras.forEach(c => { counts[c.group] = (counts[c.group] || 0) + 1; });

  mgr.innerHTML = `
    <div class="gm-header" id="gm-header">
      <h3>Custom Groups (${customGroups.length}) <span class="gm-chevron">&#9660;</span></h3>
    </div>
    <div class="gm-body" id="gm-body">
      ${customGroups.map((g, i) => `
        <div class="group-manager-row" data-gidx="${i}">
          <div style="position:relative;display:inline-block">
            <button class="color-swatch-btn gm-color-btn" data-gidx="${i}" style="background:${g.color}" title="Change color"></button>
          </div>
          <input class="gm-name-input" value="${esc(g.name)}" data-gidx="${i}" data-orig="${esc(g.name)}">
          <span class="gm-count">${counts[g.name] || 0} cam${(counts[g.name] || 0) !== 1 ? 's' : ''}</span>
          <button class="btn btn-danger btn-sm gm-del-btn" data-gidx="${i}">Del</button>
        </div>
      `).join('')}
    </div>`;

  mgr.querySelector('.gm-header').addEventListener('click', toggleGroupManager);

  // Rename handlers
  mgr.querySelectorAll('.gm-name-input').forEach(input => {
    input.addEventListener('change', () => {
      const idx = +input.dataset.gidx;
      const newName = input.value.trim();
      const oldName = input.dataset.orig;
      if (!newName || newName === oldName) { input.value = oldName; return; }
      if (BUILTIN_GROUPS.includes(newName) || customGroups.some((g, j) => g.name === newName && j !== idx)) {
        showToast(`Group "${newName}" already exists`, true);
        input.value = oldName;
        return;
      }
      // Update cameras referencing this group
      cameras.forEach(c => { if (c.group === oldName) c.group = newName; });
      customGroups[idx].name = newName;
      input.dataset.orig = newName;
      saveCustomGroups();
      populateGroupDropdown();
      renderSidebar();
      renderCameraTable();
      notify(`Group renamed to "${newName}"`, { category: 'config' });
    });
  });

  // Color picker handlers
  mgr.querySelectorAll('.gm-color-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      showColorPicker(btn, +btn.dataset.gidx);
    });
  });

  // Delete handlers
  mgr.querySelectorAll('.gm-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.gidx;
      const g = customGroups[idx];
      const camCount = cameras.filter(c => c.group === g.name).length;
      const msg = camCount
        ? `Delete group "${g.name}"? ${camCount} camera(s) will be moved to Perimeter.`
        : `Delete group "${g.name}"?`;
      if (!confirm(msg)) return;
      // Reassign cameras
      cameras.forEach(c => { if (c.group === g.name) c.group = 'Perimeter'; });
      customGroups.splice(idx, 1);
      saveCustomGroups();
      populateGroupDropdown();
      renderGroupManager();
      renderSidebar();
      renderCameraTable();
      notify(`Group "${g.name}" deleted`, { severity: 'warning', category: 'config' });
    });
  });
}

function toggleGroupManager() {
  const header = document.querySelector('#group-manager .gm-header');
  const body = document.querySelector('#group-manager .gm-body');
  if (!header || !body) return;
  header.classList.toggle('collapsed');
  body.classList.toggle('collapsed');
}

function showColorPicker(anchorEl, groupIdx) {
  // Remove any existing popover
  document.querySelectorAll('.color-picker-popover').forEach(p => p.remove());

  const popover = document.createElement('div');
  popover.className = 'color-picker-popover';
  popover.innerHTML = GROUP_COLOR_PALETTE.map(c =>
    `<div class="color-swatch${customGroups[groupIdx].color === c ? ' selected' : ''}" data-color="${c}" style="background:${c}"></div>`
  ).join('');

  anchorEl.parentElement.appendChild(popover);

  popover.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', e => {
      e.stopPropagation();
      customGroups[groupIdx].color = sw.dataset.color;
      saveCustomGroups();
      anchorEl.style.background = sw.dataset.color;
      popover.remove();
      renderSidebar();
      renderGroupManager();
    });
  });

  // Close on outside click
  const closeHandler = e => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

function openSettings() {
  settingsModal.classList.add('open');
  syncSettingsUI();
  populateGroupDropdown();
  resetCamForm();
  showCamList();
  renderSettingsLayouts();
  renderGroupManager();
  renderAnalyticsTab();
  // Focus trap setup
  document.getElementById('modal-close-btn').focus();
}

function closeSettings() {
  settingsModal.classList.remove('open');
  document.getElementById('btn-settings').focus();
}

// Focus trap inside modal
settingsModal.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const modal = settingsModal.querySelector('.modal');
  const focusable = modal.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* Settings UI sync */
function syncSettingsUI() {
  document.getElementById('set-default-quality').value = settings.defaultQuality;
  document.getElementById('set-max-streams').value = settings.maxStreams;
  document.getElementById('set-max-streams-val').textContent = settings.maxStreams;
  document.getElementById('set-reconnect').value = settings.reconnectInterval;
  document.getElementById('set-reconnect-val').textContent = settings.reconnectInterval + 's';
  document.getElementById('set-audio-default').checked = settings.audioDefault;
  document.getElementById('set-grid-gap').value = settings.gridGap;
  document.getElementById('set-grid-gap-val').textContent = settings.gridGap + 'px';
  document.getElementById('set-show-names').checked = settings.showNames;
  document.getElementById('set-show-live').checked = settings.showLive;
  document.getElementById('set-aspect-ratio').value = settings.aspectRatio;
  document.getElementById('set-anim-speed').value = settings.animSpeed;
  // Protocol selector sync
  syncProtocolUI();
}

// Wire up settings controls
document.getElementById('set-default-quality').addEventListener('change', e => { settings.defaultQuality = e.target.value; saveSettings(); });
document.getElementById('set-max-streams').addEventListener('input', e => { settings.maxStreams = +e.target.value; document.getElementById('set-max-streams-val').textContent = e.target.value; saveSettings(); });
document.getElementById('set-reconnect').addEventListener('input', e => { settings.reconnectInterval = +e.target.value; document.getElementById('set-reconnect-val').textContent = e.target.value + 's'; saveSettings(); });
document.getElementById('set-audio-default').addEventListener('change', e => { settings.audioDefault = e.target.checked; saveSettings(); });
document.getElementById('set-grid-gap').addEventListener('input', e => { settings.gridGap = +e.target.value; document.getElementById('set-grid-gap-val').textContent = e.target.value + 'px'; saveSettings(); });
document.getElementById('set-show-names').addEventListener('change', e => { settings.showNames = e.target.checked; saveSettings(); });
document.getElementById('set-show-live').addEventListener('change', e => { settings.showLive = e.target.checked; saveSettings(); });

/* ── Playback timezone (country → capital-city fixed offset) ──
   The backend converts recording times using this single offset. Standard-time
   offsets (DST not auto-applied). Pick the country whose capital matches the
   timezone your devices' OSD clock uses. */
const TZ_COUNTRIES = [
  { code: 'ID', label: 'Indonesia — Jakarta (WIB)', offsetMin: 420 },
  { code: 'ID2', label: 'Indonesia — Makassar (WITA)', offsetMin: 480 },
  { code: 'ID3', label: 'Indonesia — Jayapura (WIT)', offsetMin: 540 },
  { code: 'MY', label: 'Malaysia — Kuala Lumpur', offsetMin: 480 },
  { code: 'SG', label: 'Singapore', offsetMin: 480 },
  { code: 'TH', label: 'Thailand — Bangkok', offsetMin: 420 },
  { code: 'VN', label: 'Vietnam — Hanoi', offsetMin: 420 },
  { code: 'PH', label: 'Philippines — Manila', offsetMin: 480 },
  { code: 'IN', label: 'India — New Delhi', offsetMin: 330 },
  { code: 'BD', label: 'Bangladesh — Dhaka', offsetMin: 360 },
  { code: 'PK', label: 'Pakistan — Islamabad', offsetMin: 300 },
  { code: 'CN', label: 'China — Beijing', offsetMin: 480 },
  { code: 'HK', label: 'Hong Kong', offsetMin: 480 },
  { code: 'TW', label: 'Taiwan — Taipei', offsetMin: 480 },
  { code: 'JP', label: 'Japan — Tokyo', offsetMin: 540 },
  { code: 'KR', label: 'South Korea — Seoul', offsetMin: 540 },
  { code: 'AE', label: 'UAE — Abu Dhabi', offsetMin: 240 },
  { code: 'SA', label: 'Saudi Arabia — Riyadh', offsetMin: 180 },
  { code: 'TR', label: 'Turkey — Ankara', offsetMin: 180 },
  { code: 'RU', label: 'Russia — Moscow', offsetMin: 180 },
  { code: 'EG', label: 'Egypt — Cairo', offsetMin: 120 },
  { code: 'ZA', label: 'South Africa — Pretoria', offsetMin: 120 },
  { code: 'NG', label: 'Nigeria — Abuja', offsetMin: 60 },
  { code: 'GB', label: 'United Kingdom — London', offsetMin: 0 },
  { code: 'DE', label: 'Germany — Berlin', offsetMin: 60 },
  { code: 'FR', label: 'France — Paris', offsetMin: 60 },
  { code: 'NL', label: 'Netherlands — Amsterdam', offsetMin: 60 },
  { code: 'ES', label: 'Spain — Madrid', offsetMin: 60 },
  { code: 'IT', label: 'Italy — Rome', offsetMin: 60 },
  { code: 'US', label: 'United States — Washington DC (ET)', offsetMin: -300 },
  { code: 'MX', label: 'Mexico — Mexico City', offsetMin: -360 },
  { code: 'BR', label: 'Brazil — Brasília', offsetMin: -180 },
  { code: 'AR', label: 'Argentina — Buenos Aires', offsetMin: -180 },
  { code: 'AU', label: 'Australia — Canberra', offsetMin: 600 },
  { code: 'NZ', label: 'New Zealand — Wellington', offsetMin: 720 },
];

function _fmtUtcOffset(off) {
  const sign = off < 0 ? '-' : '+';
  const a = Math.abs(off), h = Math.floor(a / 60), m = a % 60;
  return `UTC${sign}${h}${m ? ':' + String(m).padStart(2, '0') : ''}`;
}

function populateCountryDropdown() {
  const sel = document.getElementById('set-country');
  if (!sel) return;
  sel.innerHTML = TZ_COUNTRIES.map(c =>
    `<option value="${c.code}" data-off="${c.offsetMin}">${esc(c.label)} (${_fmtUtcOffset(c.offsetMin)})</option>`
  ).join('');
}

let _tzCountry = 'ID', _tzOffsetMin = 420;

async function loadTimezoneFromAPI() {
  populateCountryDropdown();
  try {
    const r = await fetch('/api/timezone');
    if (r.ok) {
      const d = await r.json();
      if (d && Number.isFinite(Number(d.offsetMin))) {
        _tzOffsetMin = Number(d.offsetMin);
        _tzCountry = d.country || _tzCountry;
      }
    }
  } catch (e) { /* keep defaults */ }
  const sel = document.getElementById('set-country');
  if (sel) {
    const byCode = TZ_COUNTRIES.find(c => c.code === _tzCountry);
    const byOff = TZ_COUNTRIES.find(c => c.offsetMin === _tzOffsetMin);
    sel.value = (byCode || byOff || TZ_COUNTRIES[0]).code;
  }
}

document.getElementById('set-country').addEventListener('change', e => {
  const opt = e.target.selectedOptions[0];
  const offsetMin = Number(opt && opt.dataset.off);
  const country = e.target.value;
  if (!Number.isFinite(offsetMin)) return;
  _tzCountry = country; _tzOffsetMin = offsetMin;
  fetch('/api/timezone', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country, offsetMin }),
  }).then(() => {
    notify(`Playback timezone: ${opt.textContent}`, { category: 'config' });
    // If the playback modal is open, re-run the day search so the timeline updates.
    const pbDate = document.getElementById('pb-date');
    if (pbDate && pbDate.offsetParent !== null && typeof _pbLoadDay === 'function') _pbLoadDay();
  }).catch(err => console.warn('timezone save failed:', err.message));
});
document.getElementById('set-aspect-ratio').addEventListener('change', e => { settings.aspectRatio = e.target.value; saveSettings(); renderGrid(); });
document.getElementById('set-anim-speed').addEventListener('change', e => { settings.animSpeed = e.target.value; saveSettings(); });

// Protocol selector
function syncProtocolUI() {
  const pane = document.getElementById('pane-streams');
  document.querySelectorAll('.seg-btn[data-proto]').forEach(btn => {
    const isActive = btn.dataset.proto === settings.streamProtocol;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive);
  });
  const isMJPEG = settings.streamProtocol === 'mjpeg';
  pane.classList.toggle('protocol-mjpeg', isMJPEG);
  const audioDesc = document.getElementById('audio-setting-desc');
  audioDesc.textContent = isMJPEG ? 'Not available with MJPEG' : 'New camera tiles start with audio on';
  if (isMJPEG) audioDesc.style.fontStyle = 'italic';
  else audioDesc.style.fontStyle = '';
}

document.querySelectorAll('.seg-btn[data-proto]').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.proto === settings.streamProtocol) return;
    settings.streamProtocol = btn.dataset.proto;
    syncProtocolUI();
    saveSettings();
    if (settings.streamProtocol === 'mjpeg') {
      notify('Switched to MJPEG. Audio not supported. Active streams will reconnect.', { category: 'config' });
    } else {
      notify('Switched to WebRTC. Active streams will reconnect.', { category: 'config' });
    }
    // Reconnect all active streams with new protocol
    renderGrid();
  });
});

/* ══════════════════════════════════════════
   Camera management in settings
   ══════════════════════════════════════════ */
const camListView = document.getElementById('cam-list-view');
const camFormView = document.getElementById('cam-form-view');
const camListSearch = document.getElementById('cam-list-search');

function getDeviceType() {
  let dt = 'ipcamera';
  document.querySelectorAll('#cam-form-view .seg-btn[data-device]').forEach(b => {
    if (b.classList.contains('active')) dt = b.dataset.device;
  });
  return dt;
}

/* ── List / form view toggle ── */
function showCamForm() {
  camListView.hidden = true;
  camFormView.hidden = false;
  const sc = document.querySelector('.modal-content');
  if (sc) sc.scrollTop = 0;
}

function showCamList() {
  camFormView.hidden = true;
  camListView.hidden = false;
  renderCameraTable();
}

// Cameras checked for bulk deletion (tracked by stable camera id, survives re-render).
const selectedCamIds = new Set();

/**
 * Delete one or more cameras by id: removes them on the backend (DELETE
 * /api/cameras/:id so it persists), clears any tile assignments, then re-renders.
 */
async function deleteCamerasByIds(ids) {
  for (const id of ids) {
    const cam = cameras.find(c => c.id === id);
    try {
      await fetch(`/api/cameras/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      console.warn('API delete failed:', e.message);
    }
    for (const [k, v] of Object.entries(tileAssignments)) {
      if (v === id) {
        StreamAdapter.disconnect(+k);   // tear down the stream for this tile (don't leak the pc/img)
        delete tileAssignments[k]; delete tileHqState[k]; delete tileAudioState[k];
      }
    }
    // Clear per-camera timers/state so a deleted camera leaves nothing behind
    // (the 60s decay timer would otherwise fire a full renderSidebar later).
    const decayT = _camRecentDecayTimers.get(id);
    if (decayT) { clearTimeout(decayT); _camRecentDecayTimers.delete(id); }
    const eyeT = _tileEyeTimers.get(id);
    if (eyeT) { clearTimeout(eyeT); _tileEyeTimers.delete(id); }
    _camRecentEventAt.delete(id);
    _tileEyeStateByCam.delete(id);
    if (cam) {
      logEvent({ severity: 'warning', category: 'camera',
        message: `Camera "${cam.name}" deleted`, cameraId: cam.id, cameraName: cam.name });
    }
    selectedCamIds.delete(id);
  }
  const idSet = new Set(ids);
  cameras = cameras.filter(c => !idSet.has(c.id));
  pruneEmptyCustomGroups();   // a group with no cameras left should not linger
  renderCameraTable();
  renderSidebar();
  renderGrid();
}

// Currently-selected camera ids that still exist (selection survives re-render).
function selectedCameraIds() {
  return cameras.filter(c => selectedCamIds.has(c.id)).map(c => c.id);
}

function updateBulkDeleteBar() {
  const bar = document.getElementById('cam-bulk-bar');
  const selectAll = document.getElementById('cam-select-all');
  const visibleChecks = [...document.querySelectorAll('.cam-row-check')];
  const checkedCount = visibleChecks.filter(cb => cb.checked).length;

  if (bar) {
    bar.style.display = checkedCount > 0 ? 'flex' : 'none';
    const countEl = document.getElementById('cam-bulk-count');
    if (countEl) countEl.textContent = String(checkedCount);
    if (checkedCount > 0) {
      // Refresh the "Move to group" dropdown with the current group list
      const sel = document.getElementById('cam-bulk-group');
      if (sel) {
        const groups = getAllGroupNames();
        sel.innerHTML = '<option value="">group…</option>'
          + groups.map(g => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
        sel.value = '';
      }
    }
  }
  if (selectAll) {
    selectAll.checked = visibleChecks.length > 0 && checkedCount === visibleChecks.length;
    selectAll.indeterminate = checkedCount > 0 && checkedCount < visibleChecks.length;
  }
}

function renderCameraTable() {
  const tbody = document.getElementById('cam-table-body');
  const q = (camListSearch.value || '').toLowerCase().trim();
  const rows = cameras
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !q
      || c.name.toLowerCase().includes(q)
      || c.group.toLowerCase().includes(q)
      || (c.ip || '').includes(q));

  tbody.innerHTML = rows.map(({ c, i }) => {
    const status = c.status || 'online';
    const checked = selectedCamIds.has(c.id) ? 'checked' : '';
    return `
    <tr data-idx="${i}">
      <td class="cam-check-col"><input type="checkbox" class="cam-row-check" data-id="${esc(c.id)}" ${checked} aria-label="Select ${esc(c.name)}"></td>
      <td>${esc(c.name)}</td>
      <td><span class="grp-dot" style="background:${getGroupColor(c.group)}"></span>${esc(c.group)}</td>
      <td style="font-variant-numeric:tabular-nums">${esc(c.ip || '—')}</td>
      <td><span class="status-pill status-${status}">${status}</span></td>
      <td class="actions">
        <button class="btn btn-secondary btn-sm cam-edit-btn" data-idx="${i}">Edit</button>
        <button class="btn btn-danger btn-sm cam-del-btn" data-idx="${i}">Del</button>
      </td>
    </tr>`;
  }).join('');

  document.getElementById('cam-count-label').textContent =
    cameras.length === 1 ? '1 camera' : `${cameras.length} cameras`;
  const emptyEl = document.getElementById('cam-empty');
  emptyEl.hidden = rows.length > 0;
  emptyEl.textContent = cameras.length === 0
    ? 'No cameras yet. Click “Add Camera” to get started.'
    : 'No cameras match your search.';

  tbody.querySelectorAll('.cam-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => enterEditMode(+btn.dataset.idx));
  });

  tbody.querySelectorAll('.cam-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.idx;
      const cam = cameras[idx];
      if (!confirm(`Delete camera "${cam.name}"?`)) return;
      deleteCamerasByIds([cam.id]);
    });
  });

  tbody.querySelectorAll('.cam-row-check').forEach(cb => {
    cb.addEventListener('change', () => {
      if (cb.checked) selectedCamIds.add(cb.dataset.id);
      else selectedCamIds.delete(cb.dataset.id);
      updateBulkDeleteBar();
    });
  });

  updateBulkDeleteBar();
}

camListSearch.addEventListener('input', renderCameraTable);

/* ── Bulk selection actions ── */
// Move the selected cameras into a group (persisted via API).
async function moveCamerasToGroup(ids, group) {
  for (const id of ids) {
    const cam = cameras.find(c => c.id === id);
    if (!cam) continue;
    cam.group = group;
    try {
      await fetch(`/api/cameras/${encodeURIComponent(id)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ group }),
      });
    } catch (e) { console.warn('API group update failed:', e.message); }
  }
  notify(`${ids.length} camera${ids.length !== 1 ? 's' : ''} moved to "${group}"`, { category: 'camera' });
  renderCameraTable();
  renderSidebar();
}

function clearCamSelection() {
  selectedCamIds.clear();
  document.querySelectorAll('.cam-row-check').forEach(cb => { cb.checked = false; });
  updateBulkDeleteBar();
}

document.getElementById('cam-select-all').addEventListener('change', e => {
  document.querySelectorAll('.cam-row-check').forEach(cb => {
    cb.checked = e.target.checked;
    if (cb.checked) selectedCamIds.add(cb.dataset.id);
    else selectedCamIds.delete(cb.dataset.id);
  });
  updateBulkDeleteBar();
});

document.getElementById('cam-bulk-del-btn').addEventListener('click', () => {
  const ids = selectedCameraIds();
  if (!ids.length) return;
  if (!confirm(`Delete ${ids.length} selected camera${ids.length !== 1 ? 's' : ''}?`)) return;
  deleteCamerasByIds(ids);
});

document.getElementById('cam-bulk-group').addEventListener('change', e => {
  const group = e.target.value;
  if (!group) return;
  const ids = selectedCameraIds();
  if (!ids.length) { e.target.value = ''; return; }
  moveCamerasToGroup(ids, group);
});

document.getElementById('cam-bulk-export-btn').addEventListener('click', () => {
  const ids = new Set(selectedCameraIds());
  const subset = cameras.filter(c => ids.has(c.id));
  if (!subset.length) return;
  downloadJSON('cameras-selected.json', JSON.stringify(subset, null, 2));
  notify(`${subset.length} camera${subset.length !== 1 ? 's' : ''} exported`, { category: 'config' });
});

document.getElementById('cam-bulk-clear-btn').addEventListener('click', clearCamSelection);

/* ── Device mode (IP camera vs NVR) ── */
function applyDeviceMode() {
  const isNvr = getDeviceType() === 'nvr';
  document.getElementById('nvr-channels-block').hidden = !isNvr;
  document.getElementById('name-field-group').style.display = isNvr ? 'none' : '';
  document.getElementById('cam-test-btn').textContent = isNvr ? 'Scan for channels' : 'Test connection';
  document.querySelector('#identify-block .form-block-title').textContent = isNvr ? 'Assign group' : 'Name & group';
  // NVR scanning needs the HTTP/ISAPI "Web port" (e.g. 81) — reveal Advanced so
  // the user can set it (RTSP port alone won't list channels).
  if (isNvr) {
    document.getElementById('advanced-content').classList.add('open');
    document.getElementById('advanced-toggle-btn').classList.add('open');
  }
  updateSaveButtonLabel();
}

function updateSaveButtonLabel() {
  const btn = document.getElementById('cam-add-btn');
  const editing = btn.dataset.editIdx !== undefined && btn.dataset.editIdx !== '';
  if (editing) { btn.textContent = 'Update camera'; return; }
  if (getDeviceType() === 'nvr') {
    const sel = [...document.querySelectorAll('.nvr-ch-check')].filter(c => c.checked).length;
    btn.textContent = sel > 0 ? `Add ${sel} camera${sel !== 1 ? 's' : ''}` : 'Add cameras';
  } else {
    btn.textContent = 'Save camera';
  }
}

/* ── Reset the camera form to a blank "Add" state ── */
function resetCamForm() {
  const addBtn = document.getElementById('cam-add-btn');
  delete addBtn.dataset.editIdx;
  document.querySelectorAll('#cam-form-view .seg-btn[data-device]').forEach(b => {
    const first = b.dataset.device === 'ipcamera';
    b.classList.toggle('active', first);
    b.setAttribute('aria-checked', String(first));
  });
  document.getElementById('cam-add-brand').value = 'hikvision';
  document.getElementById('cam-add-ip').value = '';
  document.getElementById('cam-add-user').value = '';
  const passEl = document.getElementById('cam-add-pass');
  passEl.value = ''; passEl.type = 'password';
  document.getElementById('cam-add-rtsp-port').value = '554';
  document.getElementById('cam-add-web-port').value = '80';
  document.getElementById('cam-add-stream-path').value = '/Streaming/Channels/101';
  const nameEl = document.getElementById('cam-add-name');
  nameEl.value = ''; nameEl.classList.remove('error');
  document.getElementById('cam-add-thumb').value = '';
  document.getElementById('cam-form-title').textContent = 'Add Camera';
  setConnStatus('', '');
  document.getElementById('nvr-channels-list').innerHTML = '';
  document.getElementById('nvr-toolbar').hidden = true;
  document.getElementById('nvr-hint').hidden = false;
  document.getElementById('advanced-content').classList.remove('open');
  document.getElementById('advanced-toggle-btn').classList.remove('open');
  applyDeviceMode();
  updateStreamPathHint();
  updateRtspPreview();
}

function enterEditMode(idx) {
  const c = cameras[idx];
  resetCamForm();
  const addBtn = document.getElementById('cam-add-btn');
  const groupInput = document.getElementById('cam-add-group');
  document.getElementById('cam-add-brand').value = c.brand || 'hikvision';
  document.getElementById('cam-add-ip').value = c.ip || '';
  document.getElementById('cam-add-user').value = c.username || '';
  document.getElementById('cam-add-pass').value = c.password || '';
  document.getElementById('cam-add-rtsp-port').value = c.rtspPort || 554;
  document.getElementById('cam-add-web-port').value = c.webPort || 80;
  document.getElementById('cam-add-stream-path').value = c.streamPath || '/Streaming/Channels/';
  document.getElementById('cam-add-name').value = c.name;
  populateGroupDropdown(groupInput);
  groupInput.value = getAllGroupNames().includes(c.group) ? c.group : 'Perimeter';
  document.getElementById('cam-add-thumb').value = c.thumbnailUrl || '';
  addBtn.dataset.editIdx = idx;
  document.getElementById('cam-form-title').textContent = 'Edit Camera';
  updateSaveButtonLabel();
  updateRtspPreview();
  updateStreamPathHint();
  showCamForm();
}

function exitEditMode() {
  resetCamForm();
  showCamList();
}

/* ── Connection test (mocked) ── */
function setConnStatus(state, msg) {
  const el = document.getElementById('conn-status');
  el.className = 'conn-status' + (state ? ' ' + state : '');
  if (state === 'testing') {
    el.innerHTML = `<span class="mini-spinner"></span>${esc(msg)}`;
  } else {
    el.textContent = msg || '';
  }
}

let connTestTimer = null;
function runConnectionTest() {
  const isNvr = getDeviceType() === 'nvr';
  const ip = document.getElementById('cam-add-ip').value.trim();
  if (!ip) {
    setConnStatus('err', 'Enter an IP address first');
    document.getElementById('cam-add-ip').focus();
    return;
  }
  clearTimeout(connTestTimer);

  if (isNvr) {
    // Real scan: ask the backend for the recorder's channel list (InputProxy).
    // Uses the HTTP/ISAPI "Web port" (e.g. 81), NOT the RTSP port.
    const port = parseInt(document.getElementById('cam-add-web-port').value, 10) || 80;
    const username = document.getElementById('cam-add-user').value.trim();
    const password = document.getElementById('cam-add-pass').value;
    setConnStatus('testing', `Scanning ${ip}:${port}…`);
    fetch('/api/nvr/channels', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip, port, username, password }),
    }).then(r => r.json()).then(data => {
      if (data.error) { setConnStatus('err', data.error); return; }
      const chans = data.channels || [];
      setConnStatus('ok', `Found ${chans.length} channel${chans.length !== 1 ? 's' : ''}`);
      renderNvrChannels(chans);
      logEvent({ category: 'camera', message: `NVR scan found ${chans.length} channels — ${ip}` });
    }).catch(e => setConnStatus('err', `Scan failed: ${e.message}`));
    return;
  }

  // Real check for IP cameras: probe storage/HDD management via ISAPI. Getting
  // any HTTP answer proves reachability + credentials; the storage result also
  // tells us whether on-device playback (SD/HDD/NAS) is available.
  const port = parseInt(document.getElementById('cam-add-web-port').value, 10) || 80;
  const username = document.getElementById('cam-add-user').value.trim();
  const password = document.getElementById('cam-add-pass').value;
  setConnStatus('testing', `Memeriksa ${ip}:${port}…`);
  fetch('/api/storage/check', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ip, port, username, password }),
  }).then(r => r.json()).then(data => {
    if (data.error) {
      const msg = data.code === 401 ? 'Terhubung, tapi auth gagal — cek user/password'
        : data.code === 0 ? `Tidak bisa menjangkau ${ip}:${port}`
        : `Gagal: ${data.error}`;
      setConnStatus(data.code === 401 ? 'err' : 'err', msg);
      return;
    }
    let stMsg;
    if (!data.hasStorage) {
      stMsg = 'Terhubung · tanpa penyimpanan (SD/HDD) — tidak ada playback dari kamera';
    } else {
      const d = data.media[0];
      const kind = d.kind === 'nas' ? 'NAS' : (d.type || 'Disk');
      const total = d.capacityMB >= 1024 ? (d.capacityMB/1024).toFixed(1) + ' GB' : d.capacityMB + ' MB';
      const free = d.freeSpaceMB != null ? `, ${d.freeSpaceMB >= 1024 ? (d.freeSpaceMB/1024).toFixed(1)+' GB' : d.freeSpaceMB+' MB'} kosong` : '';
      stMsg = `Terhubung · ${data.media.length}× penyimpanan: ${kind} ${total}${free}, ${d.status}`;
    }
    setConnStatus('ok', stMsg);
    logEvent({ category: 'camera', message: `Cek kamera ${ip} — ${data.hasStorage ? data.media.length + ' media penyimpanan' : 'tanpa penyimpanan'}` });
  }).catch(e => setConnStatus('err', `Cek gagal: ${e.message}`));
}

/* ── NVR channel list (live from device) ── */
function renderNvrChannels(channels) {
  const list = document.getElementById('nvr-channels-list');
  document.getElementById('nvr-hint').hidden = true;
  document.getElementById('nvr-toolbar').hidden = false;
  list.innerHTML = '';
  for (const c of channels) {
    const row = document.createElement('div');
    row.className = 'nvr-channel-row';
    row.innerHTML = `
      <input type="checkbox" class="nvr-ch-check" checked aria-label="Include channel ${c.channel}">
      <span class="nvr-ch-num">CH ${c.channel}</span>
      <input class="form-input nvr-ch-name" value="${esc(c.name || ('Channel ' + c.channel))}" data-ch="${c.channel}" aria-label="Channel ${c.channel} name">
      <span class="nvr-ch-ip">${esc(c.ip || '')}</span>
      <span class="nvr-ch-status" title="channel ${c.channel}"><span class="cam-dot"></span></span>`;
    list.appendChild(row);
  }
  list.querySelectorAll('.nvr-ch-check').forEach(cb => cb.addEventListener('change', updateNvrSelCount));
  document.getElementById('nvr-select-all').checked = true;
  updateNvrSelCount();
}

function updateNvrSelCount() {
  const checks = [...document.querySelectorAll('.nvr-ch-check')];
  const sel = checks.filter(c => c.checked).length;
  const el = document.getElementById('nvr-sel-count');
  if (el) el.textContent = `${sel} of ${checks.length} selected`;
  updateSaveButtonLabel();
}

/* ── Form view: open / close ── */
document.getElementById('cam-show-form-btn').addEventListener('click', () => {
  resetCamForm();
  populateGroupDropdown(document.getElementById('cam-add-group'));
  showCamForm();
});
document.getElementById('cam-form-back').addEventListener('click', exitEditMode);
document.getElementById('cam-form-cancel').addEventListener('click', exitEditMode);

/* ── Device type toggle ── */
document.querySelectorAll('#cam-form-view .seg-btn[data-device]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#cam-form-view .seg-btn[data-device]').forEach(b => {
      b.classList.remove('active');
      b.setAttribute('aria-checked', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-checked', 'true');
    setConnStatus('', '');
    applyDeviceMode();
    updateStreamPathHint();
    updateRtspPreview();
  });
});

/* ── Connection test wiring ── */
document.getElementById('cam-test-btn').addEventListener('click', runConnectionTest);
document.getElementById('nvr-select-all').addEventListener('change', e => {
  document.querySelectorAll('.nvr-ch-check').forEach(c => { c.checked = e.target.checked; });
  updateNvrSelCount();
});

/* ── Password visibility toggle ── */
document.getElementById('pass-toggle-btn').addEventListener('click', () => {
  const passInput = document.getElementById('cam-add-pass');
  const eyeOpen = document.querySelector('#pass-toggle-btn .eye-open');
  const eyeClosed = document.querySelector('#pass-toggle-btn .eye-closed');
  const btn = document.getElementById('pass-toggle-btn');
  if (passInput.type === 'password') {
    passInput.type = 'text';
    eyeOpen.style.display = 'none';
    eyeClosed.style.display = '';
    btn.title = 'Hide password';
  } else {
    passInput.type = 'password';
    eyeOpen.style.display = '';
    eyeClosed.style.display = 'none';
    btn.title = 'Show password';
  }
});

/* ── Advanced section toggle ── */
document.getElementById('advanced-toggle-btn').addEventListener('click', () => {
  const content = document.getElementById('advanced-content');
  const toggle = document.getElementById('advanced-toggle-btn');
  content.classList.toggle('open');
  toggle.classList.toggle('open');
});

/* ── Live RTSP preview updates (clears a stale "Connected" status) ── */
['cam-add-ip', 'cam-add-user', 'cam-add-pass', 'cam-add-rtsp-port', 'cam-add-stream-path'].forEach(id => {
  document.getElementById(id).addEventListener('input', () => {
    updateRtspPreview();
    const s = document.getElementById('conn-status');
    if (s.classList.contains('ok')) setConnStatus('', '');
  });
});

/* ── Brand change → auto-fill stream path ── */
function updateStreamPathHint() {
  const pathInput = document.getElementById('cam-add-stream-path');
  if (getDeviceType() === 'nvr') {
    pathInput.placeholder = 'e.g. 101=ch1 main, 201=ch2 main, 202=ch2 sub';
  } else {
    pathInput.placeholder = 'e.g. 101=ch1 main, 102=ch1 sub';
  }
}

document.getElementById('cam-add-brand').addEventListener('change', () => {
  const brand = document.getElementById('cam-add-brand').value;
  const pathInput = document.getElementById('cam-add-stream-path');
  if (brand === 'hikvision') {
    pathInput.value = '/Streaming/Channels/101';
    document.getElementById('cam-add-rtsp-port').value = '554';
    document.getElementById('cam-add-web-port').value = '80';
  }
  updateStreamPathHint();
  updateRtspPreview();
});

document.getElementById('cam-add-btn').addEventListener('click', () => {
  const addBtn = document.getElementById('cam-add-btn');
  const fields = readFormFields();
  const editIdx = addBtn.dataset.editIdx;
  const isEditing = editIdx !== undefined && editIdx !== '';
  const isNvr = getDeviceType() === 'nvr';

  // NVR: import one camera per selected channel — routed through the recorder.
  if (isNvr && !isEditing) {
    const checked = [...document.querySelectorAll('.nvr-channel-row')]
      .filter(row => row.querySelector('.nvr-ch-check').checked);
    if (!checked.length) { showToast('Select at least one channel to add', true); return; }
    const channels = checked.map(row => {
      const el = row.querySelector('.nvr-ch-name');
      return { channel: Number(el.dataset.ch), name: el.value.trim() || `Channel ${el.dataset.ch}` };
    });
    const recorder = {
      ip: fields.ip, rtspPort: fields.rtspPort, isapiPort: fields.webPort,
      username: fields.username, password: fields.password,
    };
    addBtn.disabled = true;
    setConnStatus('testing', `Importing ${channels.length} channel(s)…`);
    fetch('/api/nvr/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recorder, group: fields.group, channels }),
    }).then(r => r.json()).then(async (data) => {
      addBtn.disabled = false;
      if (data.error) { setConnStatus('err', data.error); showToast(`Import failed: ${data.error}`, true); return; }
      await loadCamerasFromAPI();           // pull the server-persisted entries back
      notify(`${data.added} channel${data.added !== 1 ? 's' : ''} imported from NVR`, { category: 'camera' });
      exitEditMode();
      renderCameraTable();
      renderSidebar();
      if (typeof updateBudget === 'function') updateBudget();
    }).catch(e => { addBtn.disabled = false; setConnStatus('err', e.message); showToast(`Import failed: ${e.message}`, true); });
    return;
  }

  // IP camera: add or update a single camera
  const nameInput = document.getElementById('cam-add-name');
  nameInput.classList.toggle('error', !fields.name);
  if (!fields.name) { nameInput.focus(); return; }

  if (isEditing) {
    const cam = cameras[+editIdx];
    // Update via API
    fetch(`/api/cameras/${encodeURIComponent(cam.id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fields.name, group: fields.group,
        ip: fields.ip, username: fields.username, password: fields.password,
        port: fields.rtspPort, rtspPath: fields.streamPath,
        isapiPort: fields.webPort,
        detection: { isapi: true, channelID: channelIdFromPath(fields.streamPath) }
      })
    }).catch(e => console.warn('API update failed:', e.message));

    Object.assign(cam, {
      name: fields.name, group: fields.group,
      deviceType: 'ipcamera', brand: fields.brand,
      ip: fields.ip, username: fields.username, password: fields.password,
      rtspPort: fields.rtspPort, webPort: fields.webPort, isapiPort: fields.webPort,
      streamPath: fields.streamPath, thumbnailUrl: fields.thumbnailUrl
    });
    notify(`Camera "${fields.name}" updated`, { category: 'camera' });
  } else {
    // Add via API
    fetch('/api/cameras', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fields.name, group: fields.group,
        ip: fields.ip || '0.0.0.0', username: fields.username, password: fields.password,
        port: fields.rtspPort, rtspPath: fields.streamPath,
        isapiPort: fields.webPort,
        detection: { isapi: true, channelID: channelIdFromPath(fields.streamPath) }
      })
    }).then(res => res.json()).then(apiCam => {
      // Update local camera with server-assigned ID
      const localCam = cameras.find(c => c.name === fields.name && c.id.startsWith('cam-'));
      if (localCam && apiCam.id) localCam.id = apiCam.id;
    }).catch(e => console.warn('API add failed:', e.message));

    cameras.push({
      id: `cam-${camIdCounter++}`, name: fields.name, group: fields.group,
      deviceType: 'ipcamera', brand: fields.brand,
      ip: fields.ip || '0.0.0.0', username: fields.username, password: fields.password,
      rtspPort: fields.rtspPort, webPort: fields.webPort, isapiPort: fields.webPort,
      streamPath: fields.streamPath, thumbnailUrl: fields.thumbnailUrl,
      status: 'online'
    });
    notify(`Camera "${fields.name}" added`, { category: 'camera' });
  }

  exitEditMode();
  renderSidebar();
  updateBudget();
});

// Import/Export cameras
document.getElementById('cam-export-btn').addEventListener('click', () => {
  downloadJSON('cameras.json', JSON.stringify(cameras, null, 2));
  notify('Cameras exported', { category: 'config' });
});

document.getElementById('cam-import-btn').addEventListener('click', () => document.getElementById('cam-import-file').click());
document.getElementById('cam-import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (Array.isArray(imported)) {
        cameras = imported.map(c => migrateCameraData(c));
        camIdCounter = cameras.length;
        // Auto-create custom groups for unknown group names
        const knownGroups = new Set([...BUILTIN_GROUPS, ...customGroups.map(g => g.name)]);
        let colorIdx = 0;
        cameras.forEach(c => {
          if (c.group && !knownGroups.has(c.group)) {
            customGroups.push({ name: c.group, color: GROUP_COLOR_PALETTE[colorIdx % GROUP_COLOR_PALETTE.length] });
            knownGroups.add(c.group);
            colorIdx++;
          }
        });
        if (colorIdx > 0) saveCustomGroups();
        populateGroupDropdown();
        renderCameraTable();
        renderSidebar();
        renderGrid();
        renderGroupManager();
        notify(`${imported.length} cameras imported`, { category: 'config' });
      }
    } catch(err) { alert('Invalid JSON file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ══════════════════════════════════════════
   Layouts in settings
   ══════════════════════════════════════════ */
function renderSettingsLayouts() {
  const container = document.getElementById('settings-layout-list');
  const layouts = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
  const names = Object.keys(layouts);
  if (!names.length) {
    container.innerHTML = '<div style="color:var(--text-300);font-size:12px">No saved layouts yet. Use the Save button in the top bar.</div>';
    return;
  }
  container.innerHTML = names.map(n => {
    const lay = layouts[n];
    let lbl;
    if (lay.activeLayout && lay.activeLayout.type === 'focus') {
      const fl = FOCUS_LAYOUTS.find(l => l.id === lay.activeLayout.id);
      lbl = fl ? fl.label : lay.activeLayout.id;
    } else {
      const sz = lay.gridSize || (lay.activeLayout && lay.activeLayout.size) || '?';
      lbl = `${sz}\u00D7${sz}`;
    }
    return `
    <div class="layout-item" data-name="${esc(n)}">
      <input class="form-input" value="${esc(n)}" data-orig="${esc(n)}" style="flex:1" aria-label="Layout name">
      <span style="color:var(--text-300);font-size:11px;white-space:nowrap">${lbl}</span>
      <button class="btn btn-secondary btn-sm layout-load-btn">Load</button>
      <button class="btn btn-danger btn-sm layout-del-btn">Del</button>
    </div>`;
  }).join('');

  container.querySelectorAll('.layout-item input').forEach(input => {
    input.addEventListener('change', () => {
      const orig = input.dataset.orig;
      const newName = input.value.trim();
      if (!newName || newName === orig) return;
      const layouts = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
      if (layouts[orig]) {
        layouts[newName] = layouts[orig];
        delete layouts[orig];
        localStorage.setItem('go2rtc-layouts', JSON.stringify(layouts));
        input.dataset.orig = newName;
        notify(`Layout renamed to "${newName}"`, { category: 'layout' });
      }
    });
  });

  container.querySelectorAll('.layout-load-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.closest('.layout-item').querySelector('input').dataset.orig;
      const layout = layouts[name];
      if (!layout) return;
      if (layout.activeLayout) {
        activeLayout = { ...layout.activeLayout };
        if (activeLayout.type === 'uniform') gridSize = activeLayout.size;
      } else {
        gridSize = layout.gridSize;
        activeLayout = { type: 'uniform', size: gridSize };
      }
      tileAssignments = { ...layout.assignments };
      tileHqState = layout.hqState ? { ...layout.hqState } : {};
      presetsEl.querySelectorAll('button[data-size]').forEach(b => b.classList.toggle('active', activeLayout.type === 'uniform' && +b.dataset.size === activeLayout.size));
      presetsEl.querySelectorAll('button.focus-preset').forEach(b => b.classList.toggle('active', activeLayout.type === 'focus' && b.dataset.focusId === activeLayout.id));
      renderGrid();
      closeSettings();
      notify(`Layout "${name}" loaded`, { category: 'layout' });
    });
  });

  container.querySelectorAll('.layout-del-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const name = btn.closest('.layout-item').querySelector('input').dataset.orig;
      const layouts = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
      delete layouts[name];
      localStorage.setItem('go2rtc-layouts', JSON.stringify(layouts));
      renderSettingsLayouts();
      notify(`Layout "${name}" deleted`, { severity: 'warning', category: 'layout' });
    });
  });
}

document.getElementById('layout-reset-btn').addEventListener('click', () => {
  if (!confirm('Delete all saved layouts?')) return;
  localStorage.removeItem('go2rtc-layouts');
  renderSettingsLayouts();
  notify('All layouts deleted', { severity: 'warning', category: 'layout' });
});

document.getElementById('layout-export-btn').addEventListener('click', () => {
  downloadJSON('layouts.json', localStorage.getItem('go2rtc-layouts') || '{}');
  notify('Layouts exported', { category: 'config' });
});

document.getElementById('layout-import-btn').addEventListener('click', () => document.getElementById('layout-import-file').click());
document.getElementById('layout-import-file').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      const existing = JSON.parse(localStorage.getItem('go2rtc-layouts') || '{}');
      Object.assign(existing, imported);
      localStorage.setItem('go2rtc-layouts', JSON.stringify(existing));
      renderSettingsLayouts();
      notify('Layouts imported', { category: 'config' });
    } catch(err) { alert('Invalid JSON file'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

/* ══════════════════════════════════════════
   Mute All
   ══════════════════════════════════════════ */
const muteAllBtn = document.getElementById('btn-mute-all');
muteAllBtn.addEventListener('click', toggleMuteAll);

function toggleMuteAll() {
  allMuted = !allMuted;
  muteAllBtn.classList.toggle('muted', allMuted);
  muteAllBtn.title = allMuted ? 'Unmute All Streams' : 'Mute All Streams';
  for (const idx of Object.keys(tileAssignments)) {
    tileAudioState[idx] = !allMuted;
  }
  renderGrid();
  notify(allMuted ? 'All streams muted' : 'All streams unmuted', { category: 'stream' });
}

/* ══════════════════════════════════════════
   Activity Log — drawer UI
   ══════════════════════════════════════════ */
function updateActivityBadge() {
  const badge = document.getElementById('activity-badge');
  if (!badge) return;
  const unread = activityLog.filter(e => !e.read).length;
  if (unread > 0) {
    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
}

function activityRelativeTime(ts) {
  const diff = Date.now() - ts;
  const m = 60000, h = 3600000, d = 86400000;
  if (diff < m) return 'just now';
  if (diff < h) return Math.floor(diff / m) + 'm ago';
  if (diff < d) return Math.floor(diff / h) + 'h ago';
  if (diff < 7 * d) return Math.floor(diff / d) + 'd ago';
  return new Date(ts).toLocaleDateString();
}

function activityDayLabel(ts) {
  const d = new Date(ts); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diffDays = Math.round((today - d) / 86400000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// Phase 2 (UC-VA2-11 / C.3): session-only "Hide test events" toggle. Surfaces
// in the Activity Log filter row only when the Analytics category is active.
let _analyticsHideTestEvents = false;

function renderActivityFeed() {
  const feed = document.getElementById('activity-feed');
  const emptyEl = document.getElementById('activity-empty');
  if (!feed) return;

  const severity = document.getElementById('activity-filter-severity').value;
  const category = document.getElementById('activity-filter-category').value;
  const timeKey = document.getElementById('activity-filter-time').value;
  const search = (document.getElementById('activity-search').value || '').toLowerCase().trim();
  document.getElementById('activity-search-clear').style.display = search ? 'flex' : 'none';

  // Phase 2: dynamically inject the "Hide test events" toggle into the
  // existing drawer filters row when the Analytics category is selected.
  // We attach it just after the category select. Removed when filter
  // changes to anything else.
  const filtersRow = document.querySelector('.drawer-filters');
  if (filtersRow) {
    let toggle = filtersRow.querySelector('#activity-hide-test-wrap');
    if (category === 'analytics') {
      if (!toggle) {
        toggle = document.createElement('label');
        toggle.id = 'activity-hide-test-wrap';
        toggle.className = 'activity-hide-test';
        toggle.innerHTML = `<input type="checkbox" id="activity-hide-test" ${_analyticsHideTestEvents ? 'checked' : ''}><span>Hide test events</span>`;
        filtersRow.appendChild(toggle);
        toggle.querySelector('input').addEventListener('change', e => {
          _analyticsHideTestEvents = e.target.checked;
          renderActivityFeed();
        });
      }
    } else if (toggle) {
      toggle.remove();
    }
  }

  const windows = { '1h': 3600000, '24h': 86400000, '7d': 604800000 };
  const now = Date.now();
  const filtered = activityLog.filter(e => {
    if (severity && e.severity !== severity) return false;
    if (category && e.category !== category) return false;
    if (timeKey && windows[timeKey] && (now - e.ts) > windows[timeKey]) return false;
    // Phase 2: hide-test-events toggle. Only applies when filter is
    // explicitly set to Analytics, otherwise test events still appear.
    if (category === 'analytics' && _analyticsHideTestEvents && e.subType === 'detection-test') return false;
    if (search) {
      const hay = (e.message + ' ' + (e.cameraName || '')).toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!filtered.length) {
    feed.innerHTML = '';
    emptyEl.hidden = false;
    emptyEl.textContent = activityLog.length ? 'No matching events.' : 'No activity yet.';
    return;
  }
  emptyEl.hidden = true;

  // Group consecutive analytics detection events with same (cam, det, zone)
  // within 30 s into cluster rows (≥3 events).
  const items = _computeActivityClusters(filtered);

  const entryHtml = (e, extraClass) => {
    const cat = CATEGORY_LABELS[e.category] || e.category;
    // Phase 2: visually distinguish synthetic (test-fire) events.
    const testChip = e.subType === 'detection-test'
      ? '<span class="activity-test-chip" title="Synthetic test event">🧪 Test</span>'
      : '';
    return `
      <div class="activity-entry${e.read ? '' : ' unread'}${extraClass ? ' ' + extraClass : ''}${e.subType === 'detection-test' ? ' activity-entry-test' : ''}" data-id="${e.id}">
        <span class="activity-sev-dot sev-${esc(e.severity)}" title="${esc(e.severity)}"></span>
        <div class="activity-entry-body">
          <div class="activity-msg">${highlightMatch(e.message, search)}${testChip}</div>
          <div class="activity-meta">
            <span class="activity-cat">${esc(cat)}</span>
            <span class="activity-time" title="${esc(new Date(e.ts).toLocaleString())}">${esc(activityRelativeTime(e.ts))}</span>
          </div>
        </div>
      </div>`;
  };

  let html = '';
  let lastDay = null;
  for (const item of items) {
    const headTs = item.type === 'cluster' ? item.leader.ts : item.entry.ts;
    const day = activityDayLabel(headTs);
    if (day !== lastDay) {
      html += `<div class="activity-day-header">${esc(day)}</div>`;
      lastDay = day;
    }
    if (item.type === 'entry') {
      html += entryHtml(item.entry);
      continue;
    }
    // Cluster row.
    const lead = item.leader;
    const cam = cameras.find(c => c.id === lead.cameraId);
    const det = DETECTOR_BY_ID[lead.detectorId];
    const camName = lead.cameraName || (cam ? cam.name : 'camera');
    const detLabel = det ? det.label : (lead.detectorId || 'event');
    const expanded = _expandedClusters.has(item.clusterId);
    const chevron = expanded ? '▼' : '▶';
    const cat = CATEGORY_LABELS[lead.category] || lead.category;
    const sevClass = `sev-${esc(lead.severity)}`;
    html += `
      <div class="activity-cluster${expanded ? ' expanded' : ''}" data-cluster-id="${esc(item.clusterId)}">
        <button type="button" class="activity-cluster-head" aria-expanded="${expanded ? 'true' : 'false'}">
          <span class="activity-sev-dot ${sevClass}" title="${esc(lead.severity)}"></span>
          <span class="activity-cluster-pill">⊕ ${item.children.length}</span>
          <span class="activity-cluster-msg">${esc(detLabel)} events at ${esc(camName)}</span>
          <span class="activity-cluster-meta">
            <span class="activity-cat">${esc(cat)}</span>
            <span class="activity-time" title="${esc(new Date(lead.ts).toLocaleString())}">${esc(activityRelativeTime(lead.ts))}</span>
            <span class="activity-cluster-chevron">${chevron}</span>
          </span>
        </button>
        ${expanded ? `<div class="activity-cluster-children">${item.children.map(c => entryHtml(c, 'activity-entry-child')).join('')}</div>` : ''}
      </div>`;
  }
  feed.innerHTML = html;

  // Wire up cluster expand/collapse (delegated via the head button).
  feed.querySelectorAll('.activity-cluster-head').forEach(btn => {
    btn.addEventListener('click', () => {
      const wrap = btn.closest('.activity-cluster');
      if (!wrap) return;
      const cid = wrap.getAttribute('data-cluster-id');
      if (!cid) return;
      if (_expandedClusters.has(cid)) _expandedClusters.delete(cid);
      else _expandedClusters.add(cid);
      renderActivityFeed();
    });
  });
}

function openActivityDrawer() {
  if (settingsModal.classList.contains('open')) return;   // don't stack on the settings modal
  activityDrawerOpen = true;
  const drawer = document.getElementById('activity-drawer');
  drawer.classList.add('open');
  drawer.setAttribute('aria-hidden', 'false');
  document.getElementById('activity-backdrop').classList.add('open');
  renderActivityFeed();                  // render first, so unread accents stay visible this session
  activityLog.forEach(e => e.read = true);
  saveActivityLog();
  updateActivityBadge();
  document.getElementById('activity-close-btn').focus();
}

function closeActivityDrawer() {
  activityDrawerOpen = false;
  const drawer = document.getElementById('activity-drawer');
  drawer.classList.remove('open');
  drawer.setAttribute('aria-hidden', 'true');
  document.getElementById('activity-backdrop').classList.remove('open');
  document.getElementById('btn-activity').focus();
}

function toggleActivityDrawer() {
  if (activityDrawerOpen) closeActivityDrawer();
  else openActivityDrawer();
}

function initActivityDrawer() {
  document.getElementById('btn-activity').addEventListener('click', toggleActivityDrawer);
  document.getElementById('activity-close-btn').addEventListener('click', closeActivityDrawer);
  document.getElementById('activity-backdrop').addEventListener('click', closeActivityDrawer);

  const search = document.getElementById('activity-search');
  search.addEventListener('input', renderActivityFeed);
  document.getElementById('activity-search-clear').addEventListener('click', () => {
    search.value = '';
    renderActivityFeed();
    search.focus();
  });
  ['activity-filter-severity', 'activity-filter-category', 'activity-filter-time'].forEach(id => {
    document.getElementById(id).addEventListener('change', renderActivityFeed);
  });

  document.getElementById('activity-export-btn').addEventListener('click', () => {
    const data = activityLog.map(e => ({
      timestamp: new Date(e.ts).toISOString(),
      severity: e.severity,
      category: e.category,
      message: e.message,
      camera: e.cameraName || undefined
    }));
    downloadJSON('activity-log.json', JSON.stringify(data, null, 2));
    showToast('Activity log exported');
  });

  document.getElementById('activity-markread-btn').addEventListener('click', () => {
    activityLog.forEach(e => e.read = true);
    saveActivityLog();
    updateActivityBadge();
    renderActivityFeed();
  });

  document.getElementById('activity-clear-btn').addEventListener('click', () => {
    if (!activityLog.length) return;
    if (!confirm('Clear all activity log entries?')) return;
    activityLog = [];
    saveActivityLog();
    updateActivityBadge();
    renderActivityFeed();
  });

  // Focus trap + Escape, scoped to the drawer
  document.getElementById('activity-drawer').addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (e.target.matches('select')) return;   // let a native dropdown handle its own Escape
      closeActivityDrawer();
      return;
    }
    if (e.key !== 'Tab') return;
    const drawer = document.getElementById('activity-drawer');
    const focusable = drawer.querySelectorAll('button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/* ══════════════════════════════════════════
   Keyboard Shortcuts
   ══════════════════════════════════════════ */
document.addEventListener('keydown', e => {
  if (e.target.matches('input,textarea,select')) return;

  const total = getLayoutTotal();
  const cols = activeLayout.type === 'uniform' ? activeLayout.size : (FOCUS_LAYOUTS.find(l => l.id === activeLayout.id) || {}).cols || 1;

  if (e.key === 'Escape') {
    if (activityDrawerOpen) { closeActivityDrawer(); return; }
    if (settingsModal.classList.contains('open')) { closeSettings(); return; }
    if (focusedTile !== null) { exitFocus(); return; }
    if (selectedTileIndex !== null) { selectedTileIndex = null; updateTileSelection(); return; }
  }
  if (e.key >= '1' && e.key <= '6') { setGridSize(+e.key); return; }
  if (e.key === 'f' || e.key === 'F') {
    if (focusedTile !== null) {
      const tile = gridContainer.querySelector(`.tile[data-index="${focusedTile}"]`);
      if (tile && tile.requestFullscreen) tile.requestFullscreen();
    }
  }
  if (e.key === 'm' || e.key === 'M') { toggleMuteAll(); return; }
  if (e.key === 'b' || e.key === 'B') { toggleSidebarCollapsed(); return; }
  if (e.key === 'l' || e.key === 'L') { toggleActivityDrawer(); return; }

  // Arrow key tile navigation
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) {
    e.preventDefault();
    if (selectedTileIndex === null) { selectedTileIndex = 0; }
    else if (e.key === 'ArrowLeft' && selectedTileIndex > 0) selectedTileIndex--;
    else if (e.key === 'ArrowRight' && selectedTileIndex < total - 1) selectedTileIndex++;
    else if (e.key === 'ArrowUp' && selectedTileIndex >= cols) selectedTileIndex -= cols;
    else if (e.key === 'ArrowDown' && selectedTileIndex + cols < total) selectedTileIndex += cols;
    updateTileSelection();
    return;
  }

  // Delete/Backspace — remove camera from selected tile
  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedTileIndex !== null) {
    if (tileAssignments[selectedTileIndex]) {
      delete tileAssignments[selectedTileIndex];
      delete tileHqState[selectedTileIndex];
      delete tileAudioState[selectedTileIndex];
      delete tileAutoHq[selectedTileIndex];
      renderGrid();
    }
    return;
  }

  // Space — toggle audio on selected tile
  if (e.key === ' ' && selectedTileIndex !== null) {
    e.preventDefault();
    if (tileAssignments[selectedTileIndex]) {
      tileAudioState[selectedTileIndex] = !tileAudioState[selectedTileIndex];
      renderGrid();
    }
    return;
  }
});

/* ══════════════════════════════════════════
   Grid Fullscreen
   ══════════════════════════════════════════ */
const gridArea = document.getElementById('grid-area');
const btnFullscreenGrid = document.getElementById('btn-fullscreen-grid');

btnFullscreenGrid.addEventListener('click', () => {
  if (!document.fullscreenElement) {
    gridArea.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
});

document.addEventListener('fullscreenchange', () => {
  const isGridFullscreen = document.fullscreenElement === gridArea;
  btnFullscreenGrid.classList.toggle('active', isGridFullscreen);
  btnFullscreenGrid.title = isGridFullscreen ? 'Exit Fullscreen' : 'Fullscreen Grid';

  document.querySelectorAll('.tile').forEach(t => {
    const badge = t.querySelector('.quality-badge');
    const idx = +t.dataset.index;
    if (document.fullscreenElement === t) {
      if (badge) { badge.className = 'quality-badge main'; badge.textContent = 'MAIN'; }
      t.classList.add('hq');
    } else if (!document.fullscreenElement) {
      // Revert only if user hadn't manually set HQ
      if (!tileHqState[idx]) {
        if (badge) { badge.className = 'quality-badge sub'; badge.textContent = 'SUB'; }
        t.classList.remove('hq');
      }
    }
  });
});

/* ══════════════════════════════════════════
   Init
   ══════════════════════════════════════════ */
loadCustomGroups();
loadActivityLog();
loadAnalytics();
populateGroupDropdown();
initGroupCreationInline();
initActivityDrawer();
applyDeviceMode();
loadSettings();
renderGrid();
updateRtspPreview();
updateStreamPathHint();

// Chunk 5: start the simulated analytics event firing. Tolerant of an empty
// armed-cell set (each tick does nothing until at least one cell is armed).
startAnalyticsSimulator();
// Phase 2: schedule scheduler — 15 s tick that flips cells between Armed
// and Sleeping at schedule boundaries.
startAnalyticsScheduler();

/* ══════════════════════════════════════════
   ENGINE-CCTV: Async Init — load cameras from API + SSE
   ══════════════════════════════════════════ */
(async function engineCCTVInit() {
  // Try loading cameras from backend API
  const loaded = await loadCamerasFromAPI();
  if (loaded) {
    console.log('[ENGINE-CCTV] Loaded', cameras.length, 'cameras from API');
  } else {
    // No cameras on the backend (or API unreachable) — show an empty list, not dummy data.
    cameras = [];
    console.log('[ENGINE-CCTV] No cameras from API — starting empty');
  }
  pruneEmptyCustomGroups();        // remove leftover empty (dummy) groups
  loadTimezoneFromAPI();           // load playback timezone (country) setting
  await loadDashboardFromAPI();    // restore the saved grid arrangement
  _dashboardReady = true;          // arm auto-save now that the saved layout is applied
  populateGroupDropdown();
  renderSidebar();
  renderGrid();
  _syncCheckboxesFromCamera();

  // Refresh line overlays when the engine tab regains focus/visibility.
  // Catches line-crossing changes made on the camera's own web UI without
  // requiring a full page reload, and without any background polling.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refreshLineOverlaysFromCamera();
  });
  window.addEventListener('focus', () => refreshLineOverlaysFromCamera());

  // Coalesce bursts of camera/capability SSE events (a bulk import or probe
  // completion can fan out many in a row) into ONE reload + render instead of N
  // back-to-back full grid rebuilds.
  let _sseReloadTimer = null;
  function reloadCamerasCoalesced() {
    clearTimeout(_sseReloadTimer);
    _sseReloadTimer = setTimeout(() => {
      loadCamerasFromAPI().then(ok => {
        if (!ok) cameras = [];
        pruneEmptyCustomGroups();
        invalidateLineConfigCache();
        renderSidebar();
        renderGrid();
        _syncCheckboxesFromCamera();
      });
    }, 200);
  }

  // Connect SSE for real-time events from backend
  try {
    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        if (data.type === 'camera-added' || data.type === 'camera-removed'
            || data.type === 'camera-updated' || data.type === 'capabilities-updated') {
          reloadCamerasCoalesced();
        }

        // Real detection events from ISAPI alert stream or VCA proxy.
        // Always fire so events appear in the activity log — proves the
        // detection pipeline is working even before the analytics wizard
        // has been completed.  If the user explicitly disabled a detector
        // in analyticsConfig we still log (activity-log only) but skip
        // toast / tile-flash by routing through logEvent() directly.
        if (data.type === 'detection') {
          const _camCfg = analyticsConfig[data.cameraId];
          const _detCfg = _camCfg && _camCfg[data.detectorId];
          const _explicitlyDisabled = _detCfg && _detCfg.enabled === false;

          if (_explicitlyDisabled) {
            // User turned this detector off — still record in activity log
            // so the event is visible, but no toast / flash.
            const _cam = cameras.find(c => c.id === data.cameraId);
            const _det = DETECTOR_BY_ID[data.detectorId];
            if (_cam && _det) {
              logEvent({
                severity: 'info',
                category: 'analytics',
                message: `${_det.label} at ${_cam.name} · conf ${Math.round((data.confidence || 0.85) * 100)}%`,
                cameraId: data.cameraId,
                cameraName: _cam.name,
                subType: 'detection',
                detectorId: data.detectorId,
                confidence: data.confidence || 0.85,
                source: data.source || 'edge',
                zone: data.zone || null,
              });
            }
          } else {
            // Normal path — full pipeline: dedupe → toast → flash → log
            fireAnalyticsEvent({
              cameraId:   data.cameraId,
              detectorId: data.detectorId,
              confidence: data.confidence || 0.85,
              source:     data.source || 'edge',
              ts:         data.ts || Date.now(),
              zone:       data.zone || null,
            });
          }
        }

        // ISAPI alert stream connection status updates
        if (data.type === '_isapi_connected' || data.type === '_isapi_disconnected') {
          const cam = cameras.find(c => c.id === data.cameraId);
          if (cam) {
            cam._isapiStatus = data.type === '_isapi_connected' ? 'connected' : 'disconnected';
          }
        }

        // Log to activity feed (skip internal status events and detection events)
        if (data.type && data.type !== 'connected' && data.type !== 'detection' && !data.type.startsWith('_')) {
          logEvent({
            severity: 'info',
            category: 'system',
            message: `Server event: ${data.type}`,
          });
        }
      } catch (err) {}
    };
    evtSource.onerror = () => {
      console.warn('[ENGINE-CCTV] SSE connection lost, will auto-reconnect');
    };
  } catch (e) {
    console.warn('[ENGINE-CCTV] SSE not available');
  }
})();

// Cleanup streams on page unload
window.addEventListener('beforeunload', () => {
  StreamAdapter.disconnectAll();
});
