# V-003 Changelog — Real Hardware Capabilities Probe via ISAPI

**Tanggal:** 2026-06-12
**Scope:** Mengganti `buildCameraCapabilities()` yang simulasi (hash acak) dengan data real dari ISAPI probe.

---

## Files Created

### `src/isapi/capabilities-probe.js` (NEW — ~190 lines)
- Module untuk probe VCA capabilities dari kamera Hikvision via ISAPI
- `probeEndpoint(ip, port, uri, user, pass)` — HTTP GET dengan Digest Auth (2-step: 401 → retry)
- `probeCamera(cam)` — Probe 5 endpoint per kamera (motion, line, loitering, face, vehicle) secara parallel
- `probeAllCameras()` — Probe semua kamera yang punya `isapiPort`, sequential antar kamera
- Fallback: Jika ISAPI Smart endpoint return 403 (NVR/Dahua), gunakan `detection.events` dari cameras.json
- Timeout per request: 5 detik
- `person` dan `lpr` selalu false (server-only / YOLO)
- Audit fix: Tambah `res.on('error')` handler di `httpGet()` untuk mencegah unhandled error

### Probe Endpoints
| Feature | ISAPI Path | Frontend ID |
|---------|-----------|-------------|
| Motion (VMD) | `/ISAPI/System/Video/inputs/channels/{ch}/motionDetection` | `motion` |
| Line Crossing | `/ISAPI/Smart/LineDetection/{ch}` | `line` |
| Intrusion/Field | `/ISAPI/Smart/FieldDetection/{ch}` | `loitering` |
| Face Detection | `/ISAPI/Smart/FaceDetect/{ch}` | `face` |
| Vehicle Detection | `/ISAPI/Smart/VehicleDetection/{ch}` | `vehicle` |

---

## Files Modified

### `src/camera-manager.js`
- Tambah `setHwCapabilities(cameraId, caps)` — store capabilities in-memory (tidak di-persist ke disk, probe ulang setiap startup)
- `list()` — expose `hwCapabilities` field ke API
- Export `setHwCapabilities`

### `src/server.js`
- Step 2.7: Panggil `capabilitiesProbe.probeAllCameras()` setelah alert-stream-manager init
- Non-blocking (fire-and-forget, async)

### `src/router.js`
- Tambah `POST /api/detection/probe` — trigger re-probe semua kamera (manual refresh)
- Guard: return 400 jika ISAPI_ENABLED=false

### `public/js/app.js`
- **Hapus** `_capHash()` function (simulated hash)
- **Rewrite** `buildCameraCapabilities()`:
  - Jika kamera punya `cam.hwCapabilities` → gunakan data real dari probe
  - Fallback → assume motion-only
  - Shape `cameraCapabilities[camId]` tetap sama (`{ motion: bool, line: bool, ... }`)
  - Semua consumer (`resolveSource()`, `renderCameraDeepDive()`, matrix wizard) tidak perlu diubah

---

## Verification Results

```
[isapi-probe] Probing 6 camera(s) for hardware capabilities...
[isapi-probe] cam-parkiran (192.168.1.195:85): motion, line, loitering
[isapi-probe] cam-lantai3 (192.168.1.188:80): motion, line, loitering
[isapi-probe] cam-kreatif (192.168.1.86:8086): motion, line, loitering
[isapi-probe] cam-ptz (192.168.1.186:88): motion, line, loitering, face
[isapi-probe] cam-nvr-ch6 (192.168.1.181:81): motion, line
[isapi-probe] cam-ruangdev (192.168.1.185:8080): motion, line, loitering
[isapi-probe] Hardware capabilities probe complete
```

- cam-parkiran (DS-2CD2042WD-I): Face detection TIDAK didukung model ini, events facedetection dihapus dari cameras.json
- cam-ptz (DS-2DF8236IV-AEL): Face detection DIDUKUNG, events facedetection ditambahkan ke cameras.json
- cam-nvr-ch6 (Pintu Depan 1): Kamera Dahua di belakang NVR Hikvision. ISAPI Smart endpoints return 403 → fallback ke `detection.events` config (VMD, linedetection)
- cam-ruangdev (DS-2CD2120F-I): isapiPort diisi 8080, detection events ditambahkan — probe berhasil

---

## Audit Report

| Severity | Issue | Fix |
|----------|-------|-----|
| Low | Missing `res.on('error')` in `httpGet()` — could crash on mid-response connection reset | Added error handler that resolves with statusCode 0 |

No other issues found. Zero new npm dependencies.
