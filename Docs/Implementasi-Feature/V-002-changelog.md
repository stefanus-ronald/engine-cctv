# V-002 Changelog — Real Detection Integration (ISAPI Alert Stream + VCA)

**Tanggal**: 2026-06-12
**Request**: Implementasi real detection dari hardware kamera (ISAPI) dan AI (Python VCA)
**Status**: Implemented

---

## Summary

Mengganti simulated analytics events dengan real detection events dari:
1. **Hikvision ISAPI Alert Stream** — koneksi HTTP persisten ke setiap kamera untuk menerima event VCA hardware (motion, line crossing, intrusion, face detection)
2. **Python VCA Proxy** (opsional) — AI detection via YOLOv8 (person, vehicle, face)

Backend menerima event → normalize → dedup → broadcast via SSE → frontend `fireAnalyticsEvent()` pipeline yang sudah ada.

---

## File Baru

### 1. `src/isapi/digest-auth.js` (~65 lines)

Implementasi HTTP Digest Authentication (RFC 2617) untuk ISAPI.

| Fungsi | Deskripsi |
|--------|-----------|
| `parseDigestChallenge(header)` | Parse WWW-Authenticate header dari 401 response |
| `buildDigestHeader(method, uri, user, pass, challenge)` | Compute MD5 response hash untuk Authorization header |

- Menggunakan native `crypto` module saja (zero dependency)
- Support empty realm (beberapa model Hikvision menggunakan realm kosong)

### 2. `src/isapi/xml-parser.js` (~60 lines)

Parser XML ISAPI berbasis regex.

| Fungsi | Deskripsi |
|--------|-----------|
| `extractEventFromXml(xml)` | Extract eventType, dateTime, channelID, eventState dari XML |
| `parseAccountLockStatus(body)` | Detect account lock dari 401 response body |

- Tidak menggunakan xml2js — regex cukup untuk struktur XML ISAPI yang predictable
- Support kedua namespace Hikvision

### 3. `src/isapi/alert-stream-manager.js` (~320 lines) — **Core Module**

Manager koneksi alert stream per kamera/NVR.

| Fungsi | Deskripsi |
|--------|-----------|
| `init()` | Inisialisasi koneksi ke semua kamera ISAPI-enabled |
| `stop()` | Graceful shutdown semua koneksi |
| `getStatus()` | Status koneksi per kamera untuk API |
| `reconnectCamera(id)` | Force reconnect satu kamera |

**Fitur utama:**
- Digest Auth 2-step (challenge → authenticate)
- Multipart/mixed stream parsing (boundary detection + XML extraction)
- Exponential backoff reconnection (5s → 7.5s → 11.25s → ... → 60s max)
- Account lock detection (wait `unlockTime` seconds)
- NVR dedup: satu koneksi per IP:port, dispatch event berdasarkan channelID
- Stale connection detection: reconnect jika 5 menit tanpa event
- Runtime camera add/update/remove via `cameraManager.onCameraChange()`

### 4. `src/events/event-normalizer.js` (~85 lines)

Transformer raw events ke format unified frontend.

| Fungsi | Deskripsi |
|--------|-----------|
| `normalizeIsapiEvent(raw, cameraId)` | ISAPI XML → `{ type:'detection', detectorId, source:'edge' }` |
| `normalizeVcaDetection(det, cameraId)` | YOLO result → `{ type:'detection', detectorId, source:'server' }` |

**Mapping ISAPI → Frontend:**

| ISAPI eventType | Frontend detectorId | Default Confidence |
|-----------------|--------------------|--------------------|
| VMD | motion | 0.80 |
| linedetection | line | 0.90 |
| fielddetection | loitering | 0.85 |
| facedetection | face | 0.85 |
| vehicledetection | vehicle | 0.88 |

### 5. `src/events/event-dedup.js` (~50 lines)

Server-side event deduplication.

| Fungsi | Deskripsi |
|--------|-----------|
| `isDuplicate(event)` | Check duplikasi berdasarkan key (10s window) |
| `reset()` | Reset cache (untuk testing/reconnection) |
| `getSize()` | Jumlah entries di cache |

- Key: `${detectorId}:${cameraId}:${dateTimeSecond}`
- Self-cleaning Map setiap 10 detik
- Timer menggunakan `.unref()` agar tidak blocking process exit

### 6. `src/vca/vca-proxy.js` (~145 lines) — **Optional**

Python VCA sidecar integration.

| Fungsi | Deskripsi |
|--------|-----------|
| `init()` | Start analysis timers untuk semua kamera |
| `stop()` | Stop semua timers |

- Timer per kamera (configurable FPS, default 2 fps)
- Capture snapshot dari MJPEG manager → POST ke Python VCA
- Hanya aktif jika `VCA_ENABLED=true` di .env

---

## File yang Dimodifikasi

### 7. `cameras.json`

Tambah field per kamera:

```json
{
  "isapiPort": 85,
  "detection": {
    "isapi": true,
    "channelID": "1",
    "events": ["VMD", "linedetection", "fielddetection", "facedetection"]
  }
}
```

| Kamera | isapiPort | channelID | Events |
|--------|-----------|-----------|--------|
| Parkiran (DS-2CD2042WD-I) | 85 | 1 | VMD, linedetection, fielddetection |
| Lantai 3 (DS-2CD2420F-I) | 80 | 1 | VMD, linedetection, fielddetection |
| R. Kreatif (DS-2CD2420F-I) | 8086 | 1 | VMD, linedetection, fielddetection |
| PTZ LT. 1 (DS-2DF8236IV-AEL) | 88 | 1 | VMD, linedetection, fielddetection, facedetection |
| Pintu Depan 1 (Dahua/NVR) | 81 | 6 | VMD, linedetection |
| Ruang Dev 1 (DS-2CD2120F-I) | 8080 | 1 | VMD, linedetection, fielddetection |

*Update V-003: cam-parkiran facedetection dihapus (model tidak support), cam-ptz facedetection ditambah, cam-ruangdev isapiPort diisi 8080.*

### 8. `src/config.js` (+8 lines)

Tambah detection config fields:
- `isapiEnabled` (default true)
- `vcaEnabled` (default false)
- `vcaHost`, `vcaPort`, `vcaFps`, `vcaConfidence`
- `simulatorFallback` (default true)

### 9. `.env` (+14 lines)

Tambah section:
- `ISAPI_ENABLED=true`
- `VCA_ENABLED=false`, `VCA_HOST`, `VCA_PORT`, `VCA_FPS`, `VCA_CONFIDENCE`
- `SIMULATOR_FALLBACK=true`

### 10. `src/server.js` (+14 lines)

- Step 2.5: Initialize `alert-stream-manager` jika `config.isapiEnabled`
- Step 2.6: Initialize `vca-proxy` jika `config.vcaEnabled`
- SIGINT/SIGTERM: Stop alert stream manager dan VCA proxy

### 11. `src/router.js` (+22 lines)

Tambah 2 route baru:
- `GET /api/detection/status` — Status koneksi ISAPI per kamera
- `POST /api/detection/reconnect/:id` — Force reconnect satu kamera

### 12. `src/camera-manager.js` (+16 lines)

- `list()`: Expose `isapiPort` dan `detection` fields
- `add()`: Accept `isapiPort` dan `detection` fields
- `update()`: Accept `isapiPort` dan `detection` fields
- Tambah fungsi `findByIpAndChannel(ip, channelID)` untuk resolve ISAPI events
- Export `findByIpAndChannel`

### 13. `public/js/app.js` (+17 lines)

**SSE handler** (line ~6771):
- Tambah handler `type: 'detection'` → call `fireAnalyticsEvent()` dengan event data
- Tambah handler `type: '_isapi_connected'` / `'_isapi_disconnected'` → update `cam._isapiStatus`
- Skip `detection` dan internal events dari activity log

**Simulator guard** (`_gatherArmedCells()`, line ~4170):
- Skip kamera dengan `cam.detection.isapi === true && cam._isapiStatus === 'connected'`
- Kamera tanpa ISAPI tetap mendapat simulated events

---

## Data Flow

```
Hikvision Camera (ISAPI)           Python VCA (Optional)
    alertStream                        :5001/detect
        │                                   │
        ▼                                   ▼
  alert-stream-manager.js            vca-proxy.js
  (Digest Auth + XML parse)          (snapshot → AI)
        │                                   │
        └──────────────┬────────────────────┘
                       ▼
              event-normalizer.js
              (raw → unified format)
                       │
                       ▼
               event-dedup.js
              (10s sliding window)
                       │
                       ▼
             sse-broadcaster.js
             broadcast({ type:'detection' })
                       │
                       ▼ SSE
                Browser app.js
                fireAnalyticsEvent()
                       │
              ┌────────┼────────┐
              ▼        ▼        ▼
           Toast    Tile     Activity
           notif    flash      Log
```

---

## API Endpoints Baru

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/detection/status` | `{ isapiEnabled, vcaEnabled, cameras: { cam-id: { connected, endpoint, retryCount, lastEventAt } } }` |
| POST | `/api/detection/reconnect/:id` | `{ ok: true, message: "Reconnecting cam-id" }` |

---

## Error Handling

| Kondisi | Aksi |
|---------|------|
| Camera unreachable | Exponential backoff (5s → 60s max) |
| 401 Bad credentials | Log error, TIDAK auto-retry (mencegah account lock) |
| Account locked | Tunggu `unlockTime` detik, lalu retry sekali |
| 403 Forbidden | Log warning, skip kamera ini |
| 404 alertStream not supported | Log info, skip kamera ini |
| Stream ends unexpectedly | Reset retryCount, reconnect setelah 5s |
| 5 menit tanpa event | Anggap koneksi stale, reconnect |
