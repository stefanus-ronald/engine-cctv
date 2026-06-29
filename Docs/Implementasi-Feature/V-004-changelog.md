# V-004 Changelog — Dynamic VMD Sensitivity Control + Activity Log Detection Events

**Tanggal:** 2026-06-12
**Scope:** UI slider untuk kontrol sensitivity kamera via ISAPI, dan memastikan detection events muncul di activity log.

---

## Files Created

### `src/isapi/sensitivity-api.js` (NEW — ~183 lines)
- Module untuk GET/PUT sensitivity kamera Hikvision via ISAPI
- `httpRequest(method, host, port, uri, authHeader, body)` — HTTP request dengan optional Digest Auth, support GET dan PUT
- `isapiRequest(method, ip, port, uri, user, pass, body)` — Wrapper 2-step Digest Auth (401 → retry with credentials)
- `parseSensitivity(xml)` — Extract `<sensitivityLevel>` dan `<enabled>` dari XML response
- `getSensitivity(cameraId, detectorId)` — GET sensitivity satu detector dari kamera
- `getAllSensitivities(cameraId)` — GET sensitivity semua detector (motion, line, loitering), skip yang tidak di-support per `hwCapabilities`
- `setSensitivity(cameraId, detectorId, value)` — GET-Modify-PUT pattern: ambil XML → regex replace `<sensitivityLevel>` → PUT balik. Preserves semua field XML lain
- Timeout: 5 detik per request
- Value clamped 0-100, NaN validation

### ISAPI Endpoints
| Detector | ISAPI Path | Sensitivity Field |
|----------|-----------|-------------------|
| Motion (VMD) | `/ISAPI/System/Video/inputs/channels/{ch}/motionDetection` | `<sensitivityLevel>0-100</sensitivityLevel>` |
| Line Crossing | `/ISAPI/Smart/LineDetection/{ch}` | `<sensitivityLevel>0-100</sensitivityLevel>` |
| Loitering | `/ISAPI/Smart/FieldDetection/{ch}` | `<sensitivityLevel>0-100</sensitivityLevel>` |

---

## Files Modified

### `src/router.js`
- Tambah `GET /api/detection/sensitivity/:cameraId` — return sensitivity semua detector yang supported
- Tambah `PUT /api/detection/sensitivity/:cameraId` — body `{ detectorId, sensitivity }` → ISAPI PUT
- Guard: return 400 jika ISAPI_ENABLED=false
- Fix: null body check (return 400 instead of 500 TypeError)

### `public/js/app.js`

#### Hardware Sensitivity section di deep dive panel
- Ditambahkan di `renderCameraDeepDive()` setelah section "Camera defaults", sebelum "Detectors"
- Async fetch dari `GET /api/detection/sensitivity/:cameraId` saat panel dibuka
- Range slider (0-100) per detector yang supported, hanya tampil jika `hwCapabilities[detId]` true
- Live value display (`input` event), disabled saat PUT request
- `change` event → `PUT /api/detection/sensitivity/:cameraId` → toast success/failure
- Loading state, error state, fallback message untuk kamera tanpa isapiPort

#### Detection events di activity log
- **Sebelum:** SSE handler hanya memanggil `fireAnalyticsEvent()` jika detector enabled di `analyticsConfig`. Jika analytics wizard belum dijalankan, detection events dari ISAPI silently dropped — tidak muncul di activity log
- **Sesudah:** Detection events selalu di-proses:
  - Default path → `fireAnalyticsEvent()` (dedupe → toast → flash → log)
  - Jika detector explicitly disabled → `logEvent()` only (tetap muncul di activity log, tanpa toast/flash)
- Membuktikan detection pipeline berfungsi tanpa harus setup analytics wizard dulu

### `public/css/style.css`
- Tambah CSS classes untuk sensitivity slider:
  - `.dd-sensitivity-body` — section container
  - `.dd-sensitivity-row` — flex row (label + slider + value)
  - `.dd-sensitivity-label` — detector label (min-width 140px)
  - `.dd-sensitivity-slider` — range input (custom thumb styling, accent color)
  - `.dd-sensitivity-value` — value display (tabular-nums, accent color)
  - `.dd-sensitivity-hint` — info text
  - `.dd-sensitivity-error` — error message (red)
  - `.dd-sensitivity-loading` — loading state

---

## API Endpoints

### `GET /api/detection/sensitivity/:cameraId`
Response:
```json
{
  "motion": { "detectorId": "motion", "sensitivity": 40, "enabled": true, "supported": true },
  "line": { "detectorId": "line", "sensitivity": 50, "enabled": true, "supported": true },
  "loitering": { "sensitivity": null, "enabled": null, "supported": false }
}
```

### `PUT /api/detection/sensitivity/:cameraId`
Request body:
```json
{ "detectorId": "motion", "sensitivity": 30 }
```
Response:
```json
{ "ok": true, "detectorId": "motion", "sensitivity": 30 }
```

---

## Audit Report

| Severity | Issue | Fix |
|----------|-------|-----|
| Low | Router PUT: null body dari invalid JSON menyebabkan TypeError (500) | Tambah null check → return 400 dengan pesan jelas |

No other issues found. Zero new npm dependencies.
