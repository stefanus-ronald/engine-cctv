# V-007 Changelog — Region Entrance / Region Exit Detection

**Tanggal:** *[To be filled on implementation]*
**Scope:** Tambah probe + event normalization + overlay untuk Region Entrance dan Region Exit via ISAPI Hikvision.

---

## Files Modified

### `src/isapi/capabilities-probe.js`

#### PROBE_ENDPOINTS (setelah entry `vehicle`):
```javascript
{ detectorId: 'regionIn',  path: '/ISAPI/Smart/RegionEntrance/{ch}' },
{ detectorId: 'regionOut', path: '/ISAPI/Smart/RegionExiting/{ch}' },
```

#### EVENT_TO_DETECTOR (setelah entry `vehicledetection`):
```javascript
'regionEntrance': 'regionIn',
'regionExiting':  'regionOut',
```
Fallback ini memungkinkan NVR yang return 403 untuk Smart endpoint tetap mendapat capabilities dari `detection.events` config di cameras.json.

---

### `src/events/event-normalizer.js`

#### ISAPI_TO_DETECTOR (setelah `vehicledetection`):
```javascript
'regionEntrance': 'regionIn',
'regionExiting':  'regionOut',
```

#### ISAPI_CONFIDENCE (setelah `vehicledetection`):
```javascript
'regionEntrance': 0.88,
'regionExiting':  0.88,
```

---

### `src/isapi/line-crossing-api.js`

#### New Constants (setelah FIELD_DETECTION_ENDPOINT):
```javascript
const REGION_ENTRANCE_ENDPOINT = '/ISAPI/Smart/RegionEntrance/{ch}';
const REGION_EXIT_ENDPOINT     = '/ISAPI/Smart/RegionExiting/{ch}';
```

#### `getLineConfig()` — result init update:
```javascript
const result = { lines: [], regions: [], entranceRegions: [], exitRegions: [] };
```

#### `getLineConfig()` — 2 fetch block baru (setelah FieldDetection fetch):
```javascript
// Fetch RegionEntrance config
if (caps.regionIn) {
  const uri = REGION_ENTRANCE_ENDPOINT.replace('{ch}', channelID);
  const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
  if (res.statusCode === 200) {
    const parsed = parseFieldDetectionXml(res.body); // reuse existing parser
    if (parsed) {
      result.regionEntranceEnabled = parsed.enabled;
      result.entranceRegions = parsed.regions;
    }
  }
}

// Fetch RegionExiting config
if (caps.regionOut) {
  const uri = REGION_EXIT_ENDPOINT.replace('{ch}', channelID);
  const res = await isapiGet(cam.ip, cam.isapiPort, uri, user, pass);
  if (res.statusCode === 200) {
    const parsed = parseFieldDetectionXml(res.body); // reuse existing parser
    if (parsed) {
      result.regionExitEnabled = parsed.enabled;
      result.exitRegions = parsed.regions;
    }
  }
}
```

#### Log line update:
Include count entranceRegions dan exitRegions.

**Note:** `parseFieldDetectionXml()` di-reuse tanpa perubahan karena XML structure dari RegionEntrance/RegionExiting identik dengan FieldDetection (`<Coordinates>` polygon pattern sama).

---

### `public/js/app.js`

#### DETECTORS array (setelah `loitering`):
```javascript
{ id: 'regionIn',  label: 'Region Entrance', shortLabel: 'RegIn',  requiresGallery: false },
{ id: 'regionOut', label: 'Region Exit',      shortLabel: 'RegOut', requiresGallery: false },
```

#### `createTile()` — fetchLineConfig guard condition:
```javascript
// Before V-007:
if (cam.hwCapabilities && (cam.hwCapabilities.line || cam.hwCapabilities.loitering)) {

// After V-007:
if (cam.hwCapabilities && (
    cam.hwCapabilities.line || cam.hwCapabilities.loitering ||
    cam.hwCapabilities.regionIn || cam.hwCapabilities.regionOut)) {
```

#### `renderLineOverlay()` — tambah 2 render block (setelah intrusion regions):
```javascript
// Region Entrance: green dotted polygon, label E1, E2, ...
const enabledEntrance = (cfg.entranceRegions || [])
  .filter(r => r.enabled && r.coordinates?.length >= 3);
// loop → polygon points (Y-invert), stroke="rgba(0,220,100,0.8)", stroke-dasharray="6,3"
// text label E{index+1} at centroid

// Region Exit: red dotted polygon, label X1, X2, ...
const enabledExit = (cfg.exitRegions || [])
  .filter(r => r.enabled && r.coordinates?.length >= 3);
// loop → polygon points (Y-invert), stroke="rgba(255,80,80,0.8)", stroke-dasharray="6,3"
// text label X{index+1} at centroid
```

---

### `public/css/style.css`

Minor: tidak ada perubahan wajib (warna inline di SVG attributes). Opsional tambah comment referensi warna overlay.

---

## API Endpoints

| Method | Path | Perubahan | Versi |
|--------|------|-----------|-------|
| GET | `/api/detection/lines/:cameraId` | Response tambah `entranceRegions` + `exitRegions` | V-007 |

Response format setelah V-007:
```json
{
  "lineDetectionEnabled": true,
  "lines": [...],
  "fieldDetectionEnabled": true,
  "regions": [...],
  "regionEntranceEnabled": false,
  "entranceRegions": [],
  "regionExitEnabled": false,
  "exitRegions": []
}
```

---

## Coordinate System

Identik dengan V-006 — Hikvision Y=0 di bawah, SVG Y=0 di atas:
```
svgY = 1000 - hikY
```

---

## Backward Compatibility

| Aspect | Impact |
|--------|--------|
| Existing 6 cameras | Zero — probe 404 → HW=false, overlay array kosong |
| API response | Additive only — 2 field baru, tidak ada field yang berubah |
| Frontend DETECTORS | 2 kolom baru di analytics matrix, tidak mengganggu kolom lama |
| Overlay render | Hanya tambah conditional render, existing lines/regions tidak berubah |

---

## Audit

| Check | Status |
|-------|--------|
| XSS via SVG | Safe — coordinates are integers (same as V-006) |
| Cache staleness | Existing 5-min TTL + invalidateCache on re-probe (inherited) |
| Error handling | Null-safe, reuses existing pattern from V-006 |
| New dependencies | Zero |
