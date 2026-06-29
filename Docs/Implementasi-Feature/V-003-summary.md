# V-003 Summary — Real Hardware Capabilities Probe

## Apa yang berubah?

Sebelumnya, data "Hardware Support" di deep-dive panel dan matrix analytics **palsu** — menggunakan hash acak (`_capHash()`) dengan probability weights. Sekarang diganti dengan **probe ISAPI real** ke setiap kamera saat startup.

## Cara kerja

1. Server startup → `probeAllCameras()` dijalankan async (non-blocking)
2. Setiap kamera dengan `isapiPort` di-probe via HTTP GET ke 5 endpoint ISAPI Smart
3. Response 200 = kamera support fitur tersebut (HW), 404 = tidak support
4. Untuk NVR/Dahua yang return 403, fallback ke `detection.events` dari cameras.json
5. Hasil disimpan di memory via `camera-manager.setHwCapabilities()`
6. Frontend fetch `GET /api/cameras` → `cam.hwCapabilities` → `buildCameraCapabilities()`

## Hasil Probe (Real)

| Kamera | Model | Motion | Line | Loitering | Face | Vehicle |
|--------|-------|--------|------|-----------|------|---------|
| Parkiran | DS-2CD2042WD-I | HW | HW | HW | - | - |
| Lantai 3 | DS-2CD2420F-I | HW | HW | HW | - | - |
| R. Kreatif | DS-2CD2420F-I | HW | HW | HW | - | - |
| PTZ LT.1 | DS-2DF8236IV-AEL | HW | HW | HW | HW | - |
| Pintu Depan | Dahua (NVR) | HW* | HW* | - | - | - |
| Ruang Dev 1 | DS-2CD2120F-I | HW | HW | HW | - | - |

*\* = dari detection.events config (ISAPI Smart endpoint return 403 di NVR)*

## API Baru

- `POST /api/detection/probe` — Trigger re-probe manual (untuk setelah update firmware kamera)

## Files

| File | Aksi |
|------|------|
| `src/isapi/capabilities-probe.js` | CREATE |
| `src/camera-manager.js` | MODIFY |
| `src/server.js` | MODIFY |
| `src/router.js` | MODIFY |
| `public/js/app.js` | MODIFY |
