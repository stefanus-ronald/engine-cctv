# V-007 Summary — Region Entrance / Region Exit Detection

## Apa yang berubah?

1. **Region Entrance dan Region Exit masuk ke pipeline deteksi** — Dua tipe event baru ditambahkan ke ISAPI probe, alert stream normalizer, dan frontend detector definitions.

2. **Overlay visualization 2 warna baru** — Region entrance tampil sebagai polygon hijau (●), region exit sebagai polygon merah (●), melengkapi overlay yang sudah ada (cyan lines + orange intrusion).

3. **Model-agnostic seperti sebelumnya** — Kamera lama (6 unit installed) probe 404 → HW=false, tidak ada perubahan UI. Kamera baru G3P/AcuSense saat ditambahkan: probe 200 → HW=true → event langsung masuk activity log + overlay fetch.

## Latar Belakang

Dari rekonsiliasi datasheet produk baru (17 Juni 2026), 5 dari 9 kamera kandidat mendukung Region Entrance + Region Exit via ISAPI:
- DS-2CD23127/23167G3P-LIS2UY (Panoramic Turret)
- DS-2CD2387G3P-LIS2UY (Panoramic Turret)
- DS-2CD2T127/2T167G3P-LIS2UY (Panoramic Bullet)
- DS-2CD2546G2-IWS-C (AcuSense Dome)
- DS-2SE4C425MWG-E/14 (TandemVu PTZ)

Fitur ini di-upgrade dari prioritas Medium → **High** karena mayoritas kamera baru mendukungnya.

## Cara Kerja

1. Saat probe startup, ENGINE-CCTV GET `/ISAPI/Smart/RegionEntrance/{ch}` dan `/ISAPI/Smart/RegionExiting/{ch}`
2. HTTP 200 → `hwCapabilities.regionIn/regionOut = true`; 404 → false
3. Alert stream event `regionEntrance` / `regionExiting` dinormalisasi ke detectorId `regionIn` / `regionOut`
4. Frontend: tile flash + toast + activity log entry (identik dengan line/loitering)
5. Overlay: `GET /api/detection/lines/:id` kini juga return `entranceRegions` dan `exitRegions` → render sebagai polygon berwarna berbeda

## ISAPI Event Types

| Alert Stream Event | detectorId | Confidence |
|-------------------|-----------|-----------|
| `regionEntrance` | `regionIn` | 0.88 |
| `regionExiting`  | `regionOut` | 0.88 |

## Overlay Color Scheme (setelah V-007)

| Type | Color |
|------|-------|
| Line Crossing | Cyan |
| Intrusion | Orange |
| **Region Entrance** | **Green** |
| **Region Exit** | **Red** |

## Files

| File | Aksi |
|------|------|
| `src/isapi/capabilities-probe.js` | MODIFY |
| `src/events/event-normalizer.js` | MODIFY |
| `src/isapi/line-crossing-api.js` | MODIFY |
| `public/js/app.js` | MODIFY |
| `public/css/style.css` | MODIFY (minor) |
