const path = require('path');
const fs = require('fs');

// Load .env from project root
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const ROOT_DIR = path.join(__dirname, '..');
const CAMERAS_FILE = path.join(ROOT_DIR, 'cameras.json');
const NVRS_FILE = path.join(ROOT_DIR, 'nvrs.json');

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
  fs.writeFileSync(config.camerasFile, JSON.stringify(cameras, null, 2), 'utf8');
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

module.exports = { config, loadCameras, saveCameras, loadNvrs };
