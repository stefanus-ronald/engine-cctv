/**
 * Event Normalizer — transforms raw ISAPI events and Python VCA detections
 * into the unified event format consumed by the frontend fireAnalyticsEvent().
 *
 * Frontend expects:
 *   { type:'detection', cameraId, detectorId, confidence, source, ts, zone }
 */

// ISAPI eventType → frontend detectorId mapping
const ISAPI_TO_DETECTOR = {
  'VMD': 'motion',
  'linedetection': 'line',
  'fielddetection': 'loitering',
  'facedetection': 'face',
  'vehicledetection': 'vehicle',
  'shelteralarm': null,    // system event
  'videoloss': null,       // system event
  'diskfull': null,        // system event
  'diskerror': null,       // system event
  'illaccess': null,       // system event
  'nicbroken': null,       // system event
};

// Default confidence for ISAPI events (hardware VCA doesn't carry confidence scores)
const ISAPI_CONFIDENCE = {
  'VMD': 0.80,
  'linedetection': 0.90,
  'fielddetection': 0.85,
  'facedetection': 0.85,
  'vehicledetection': 0.88,
};

// Python VCA YOLO class → frontend detectorId mapping
const VCA_CLASS_TO_DETECTOR = {
  'person': 'person',
  'car': 'vehicle',
  'truck': 'vehicle',
  'bus': 'vehicle',
  'motorcycle': 'vehicle',
  'bicycle': 'vehicle',
  'face': 'face',
};

/**
 * Normalize an ISAPI alert stream event into the unified detection format.
 *
 * @param {object} rawEvent - Parsed XML event from xml-parser.js
 * @param {string} cameraId - Resolved camera ID
 * @returns {object|null} Normalized event or null if not a detection event
 */
function normalizeIsapiEvent(rawEvent, cameraId) {
  const detectorId = ISAPI_TO_DETECTOR[rawEvent.eventType];
  if (!detectorId) return null; // skip system events

  // Only process "active" events (not "inactive" which signals event end)
  if (rawEvent.eventState && rawEvent.eventState !== 'active') return null;

  return {
    type: 'detection',
    cameraId,
    detectorId,
    confidence: ISAPI_CONFIDENCE[rawEvent.eventType] || 0.80,
    source: 'edge',
    ts: rawEvent.dateTime && !isNaN(new Date(rawEvent.dateTime).getTime())
      ? new Date(rawEvent.dateTime).getTime()
      : Date.now(),
    zone: null,
    _isapi: {
      eventType: rawEvent.eventType,
      channelID: rawEvent.channelID,
      eventState: rawEvent.eventState,
      activePostCount: rawEvent.activePostCount,
    },
  };
}

// ONVIF notification topic (keyword) → frontend detectorId. Matched case-
// insensitively as a substring because topic dialects differ across vendors
// (e.g. "tns1:RuleEngine/CellMotionDetector/Motion", "tns1:VideoSource/MotionAlarm",
// "tns1:RuleEngine/LineDetector/Crossed", "tns1:RuleEngine/FieldDetector/ObjectsInside").
const ONVIF_TOPIC_TO_DETECTOR = [
  ['linedetector', 'line'],
  ['linecross', 'line'],
  ['fielddetector', 'loitering'],
  ['objectsinside', 'loitering'],
  ['intrusion', 'loitering'],
  ['loiter', 'loitering'],
  ['facedetect', 'face'],
  ['facerecognition', 'face'],
  ['motion', 'motion'],       // CellMotionDetector/Motion, MotionAlarm (keep last — broad)
];

const ONVIF_CONFIDENCE = { motion: 0.80, line: 0.90, loitering: 0.85, face: 0.85 };

/**
 * Normalize an ONVIF PullPoint notification into the unified detection format.
 *
 * @param {object} note - { topic, active, utcTime } from onvif/events.js
 * @param {string} cameraId
 * @returns {object|null} normalized event, or null for inactive/unmapped topics
 */
function normalizeOnvifEvent(note, cameraId) {
  if (!note || !note.topic) return null;
  if (note.active === false) return null;       // event end — skip (mirror ISAPI 'inactive')
  const topic = String(note.topic).toLowerCase();
  let detectorId = null;
  for (const [kw, det] of ONVIF_TOPIC_TO_DETECTOR) {
    if (topic.includes(kw)) { detectorId = det; break; }
  }
  if (!detectorId) return null;                 // tamper/audio/system topics → ignore
  const ts = note.utcTime && !isNaN(new Date(note.utcTime).getTime())
    ? new Date(note.utcTime).getTime() : Date.now();
  return {
    type: 'detection',
    cameraId,
    detectorId,
    confidence: ONVIF_CONFIDENCE[detectorId] || 0.80,
    source: 'edge',
    ts,
    zone: null,
    _onvif: { topic: note.topic },
  };
}

/**
 * Normalize a Python VCA detection into the unified detection format.
 *
 * @param {object} detection - { label, confidence, bbox_normalized }
 * @param {string} cameraId - Camera ID
 * @returns {object|null} Normalized event or null if class not mapped
 */
function normalizeVcaDetection(detection, cameraId) {
  const detectorId = VCA_CLASS_TO_DETECTOR[detection.label];
  if (!detectorId) return null;

  return {
    type: 'detection',
    cameraId,
    detectorId,
    confidence: detection.confidence || 0.50,
    source: 'server',
    ts: Date.now(),
    zone: null,
    bbox: detection.bbox_normalized || null,
  };
}

module.exports = { normalizeIsapiEvent, normalizeVcaDetection, normalizeOnvifEvent, ISAPI_TO_DETECTOR };
