const path = require('path');
const fs = require('fs');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const CAMERAS_FILE = path.join(ROOT_DIR, 'cameras.json');
const NVRS_FILE = path.join(ROOT_DIR, 'nvrs.json');
const DASHBOARD_FILE = path.join(ROOT_DIR, 'dashboard.json');
const TIMEZONE_FILE = path.join(ROOT_DIR, 'timezone.json');

const config = {
  port: parseInt(process.env.PORT) || 3000,

  // go2rtc
  go2rtcApiPort: parseInt(process.env.GO2RTC_API_PORT) || 1984,
  go2rtcWebrtcPort: parseInt(process.env.GO2RTC_WEBRTC_PORT) || 8555,
  go2rtcBin: process.env.GO2RTC_BIN || path.join(ROOT_DIR, 'bin', 'go2rtc.exe'),

  // FFmpeg
  ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
  mjpegFps: parseInt(process.env.MJPEG_FPS) || 10,
  mjpegQuality: parseInt(process.env.MJPEG_QUALITY) || 5,

  // Paths
  rootDir: ROOT_DIR,
  publicDir: path.join(ROOT_DIR, 'public'),
  camerasFile: CAMERAS_FILE,
  nvrsFile: NVRS_FILE,
  dashboardFile: DASHBOARD_FILE,
  timezoneFile: TIMEZONE_FILE,

  // Playback display timezone — a FIXED offset (minutes to ADD to a device's
  // UTC-tagged recording times to get the wall-clock the user wants to see).
  // Chosen by country in Settings (capital-city offset). Default: Indonesia/WIB
  // (UTC+7 = 420). No per-device auto-detection — deterministic & user-controlled.
  displayCountry: process.env.DISPLAY_COUNTRY || 'ID',
  displayTzOffsetMin: Number.isFinite(parseInt(process.env.DISPLAY_TZ_OFFSET_MIN))
    ? parseInt(process.env.DISPLAY_TZ_OFFSET_MIN) : 420,
  go2rtcConfigFile: path.join(ROOT_DIR, 'go2rtc.yaml'),

  // NVR auto-sync: on startup, scan every recorder in nvrs.json and (re)build
  // its channel list as cameras grouped under the recorder. Set
  // NVR_AUTOSYNC=false to disable (e.g. when running off-LAN for UI work).
  nvrAutoSync: process.env.NVR_AUTOSYNC !== 'false',  // default true

  // Optional API token: when set (env CCTV_API_TOKEN), state-mutating endpoints
  // (camera CRUD, NVR scan/import, detection writes) require header
  // `x-api-token` (or ?token=). Default null = open (current LAN behavior).
  apiToken: process.env.CCTV_API_TOKEN || null,

  // Detection: ISAPI Alert Stream
  isapiEnabled: process.env.ISAPI_ENABLED !== 'false',  // default true

  // Detection: Python VCA (optional)
  vcaEnabled: process.env.VCA_ENABLED === 'true',       // default false
  vcaHost: process.env.VCA_HOST || '127.0.0.1',
  vcaPort: parseInt(process.env.VCA_PORT) || 5001,
  vcaFps: parseInt(process.env.VCA_FPS) || 2,
  vcaConfidence: parseFloat(process.env.VCA_CONFIDENCE) || 0.5,

  // Detection: Simulator fallback
  simulatorFallback: process.env.SIMULATOR_FALLBACK !== 'false',
};

// Atomic JSON write: write to a temp file then rename over the target. A crash
// or concurrent write can never leave a half-written (corrupt) file that would
// make the next load throw and wipe the whole list.
function writeJsonAtomic(filePath, value) {
  const tmp = `${filePath}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(tmp, filePath);
}

// Load cameras from cameras.json
function loadCameras() {
  try {
    if (fs.existsSync(config.camerasFile)) {
      const data = fs.readFileSync(config.camerasFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load cameras.json:', err.message);
  }
  return [];
}

// Save cameras to cameras.json
function saveCameras(cameras) {
  writeJsonAtomic(config.camerasFile, cameras);
}

// Load NVR/DVR recorder registry from nvrs.json.
// Each recorder: { id, name?, group?, host, rtspPort, isapiPort, username, password }
// `host` may be a LAN IP (192.168.x.x), a public IP, or a DDNS hostname — the
// scan only needs host:isapiPort reachable (port-forward the recorder for WAN).
function loadNvrs() {
  try {
    if (fs.existsSync(config.nvrsFile)) {
      const data = fs.readFileSync(config.nvrsFile, 'utf8');
      const list = JSON.parse(data);
      return Array.isArray(list) ? list : [];
    }
  } catch (err) {
    console.error('Failed to load nvrs.json:', err.message);
  }
  return [];
}

// Load the saved dashboard layout (grid size, active layout, tile→camera
// assignments, per-tile HQ/audio state) so the grid auto-restores on reload or
// engine restart. Returns null when no dashboard has been saved yet.
function loadDashboard() {
  try {
    if (fs.existsSync(config.dashboardFile)) {
      const data = fs.readFileSync(config.dashboardFile, 'utf8');
      return JSON.parse(data);
    }
  } catch (err) {
    console.error('Failed to load dashboard.json:', err.message);
  }
  return null;
}

// Persist the dashboard layout. `data` is the plain object sent by the UI.
function saveDashboard(data) {
  writeJsonAtomic(config.dashboardFile, data);
}

// Playback display timezone (country + fixed offset in minutes).
function loadTimezone() {
  try {
    if (fs.existsSync(config.timezoneFile)) {
      const d = JSON.parse(fs.readFileSync(config.timezoneFile, 'utf8'));
      if (d && Number.isFinite(Number(d.offsetMin))) {
        config.displayTzOffsetMin = Number(d.offsetMin);
        config.displayCountry = d.country || config.displayCountry;
      }
    }
  } catch (err) {
    console.error('Failed to load timezone.json:', err.message);
  }
  return { country: config.displayCountry, offsetMin: config.displayTzOffsetMin };
}

function saveTimezone({ country, offsetMin }) {
  if (Number.isFinite(Number(offsetMin))) config.displayTzOffsetMin = Number(offsetMin);
  if (country) config.displayCountry = country;
  writeJsonAtomic(config.timezoneFile, { country: config.displayCountry, offsetMin: config.displayTzOffsetMin });
  return { country: config.displayCountry, offsetMin: config.displayTzOffsetMin };
}

// Apply any persisted timezone at startup so config reflects the saved choice.
loadTimezone();

module.exports = { config, loadCameras, saveCameras, loadNvrs, loadDashboard, saveDashboard, loadTimezone, saveTimezone };
