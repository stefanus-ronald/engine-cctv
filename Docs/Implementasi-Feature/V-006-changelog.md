# V-006 Changelog — Line Crossing & Intrusion Region Overlay

**Tanggal:** 2026-06-17
**Scope:** Fetch konfigurasi line crossing dan intrusion region dari kamera Hikvision, render sebagai SVG overlay di tile video.

---

## Files Created

### `src/isapi/line-crossing-api.js` (NEW — ~210 lines)
- Module untuk fetch dan parse konfigurasi LineDetection dan FieldDetection dari kamera via ISAPI
- `httpRequest(method, host, port, uri, authHeader)` — HTTP GET dengan optional Digest Auth
- `isapiGet(ip, port, uri, user, pass)` — 2-step Digest Auth wrapper (401 → retry)
- `parseLineDetectionXml(xml)` — Extract `<LineItem>` entries: id, enabled, sensitivity, direction, coordinates
- `parseFieldDetectionXml(xml)` — Extract `<FieldDetectionRegion>` entries: id, enabled, sensitivity, coordinates (polygon)
- `getLineConfig(cameraId)` — Fetch kedua config, merge ke satu response, cache 5 menit
- `invalidateCache(cameraId?)` — Clear cache (dipanggil saat re-probe)
- In-memory cache dengan TTL 5 menit

### ISAPI Endpoints Fetched
| Config | ISAPI Path | Data Extracted |
|--------|-----------|----------------|
| Line Crossing | `/ISAPI/Smart/LineDetection/{ch}` | LineItem: id, enabled, sensitivity, direction, 2 coordinates |
| Intrusion Region | `/ISAPI/Smart/FieldDetection/{ch}` | Region: id, enabled, sensitivity, N coordinates (polygon) |

---

## Files Modified

### `src/router.js`

#### New Route: `GET /api/detection/lines/:cameraId`
- Fetch line crossing + intrusion region config untuk satu kamera
- Response format:
  ```json
  {
    "lineDetectionEnabled": true,
    "lines": [
      { "id": "1", "enabled": true, "sensitivity": 50, "direction": "left-right",
        "coordinates": [{"x":83,"y":687}, {"x":989,"y":24}] }
    ],
    "fieldDetectionEnabled": true,
    "regions": [
      { "id": "1", "enabled": true, "sensitivity": 50,
        "coordinates": [{"x":0,"y":0}, {"x":500,"y":0}, {"x":500,"y":500}, {"x":0,"y":500}] }
    ]
  }
  ```
- Guard: 400 jika ISAPI_ENABLED=false

#### Modified: `POST /api/detection/probe`
- Tambah `lineCrossingApi.invalidateCache()` setelah trigger re-probe

### `public/js/app.js`

#### State Variables (near line 336)
- `tileLineOverlay = {}` — per-tile toggle (default: true)
- `_lineConfigCache = {}` — cameraId → config cache

#### New Functions
- `fetchLineConfig(cameraId)` — GET `/api/detection/lines/:cameraId`, cache result
- `invalidateLineConfigCache()` — Clear frontend cache
- `renderLineOverlay(tile, cameraId)` — Build SVG overlay:
  - Line crossing: cyan `<line>` with direction arrows via SVG `<marker>`
  - Intrusion region: orange dashed `<polygon>`
  - Labels at midpoint/centroid (L1, L2, R1, etc.)
  - Y-axis inversion: `svgY = 1000 - hikY`

#### createTile() Integration
- After stream connect, fetch + render overlay if `cam.hwCapabilities.line || .loitering`
- Default: overlay ON for all tiles

#### Tile Analytics Popover
- New checkbox "Show line/region rules (this tile)" alongside existing bbox toggle
- Toggle handler: on=render overlay, off=remove SVG element

#### SSE Handler
- `capabilities-updated` event: `invalidateLineConfigCache()` before re-fetch

### `public/css/style.css`
- `.tile-line-overlay` — absolute positioned, inset:0, pointer-events:none, z-index:4
- `.tile:not(:hover) .tile-line-overlay` — opacity 0.45 saat tile tidak di-hover
- `.tile-pop-bbox-row` — flex-direction:column untuk stack checkboxes

---

## API Endpoints

| Method | Path | Fungsi | Versi |
|--------|------|--------|-------|
| GET | `/api/detection/lines/:cameraId` | Fetch line + region config dari kamera | V-006 |

---

## Coordinate System

Hikvision menggunakan normalized coordinates 0-1000 dengan Y=0 di BAWAH.
SVG viewBox 0 0 1000 1000 memiliki Y=0 di ATAS.

```
Hikvision → SVG: svgY = 1000 - hikY
```

Backend meneruskan koordinat Hikvision apa adanya. Y-inversion hanya terjadi di frontend saat render SVG.

---

## Audit Report

| Severity | Checked | Status |
|----------|---------|--------|
| - | XSS via SVG injection | Safe — coordinates are integers, no user-controlled strings in SVG |
| - | Cache staleness | 5-min TTL + manual invalidation on re-probe |
| - | Error handling | Timeout/network failure returns null, overlay not rendered |

Zero new npm dependencies.
