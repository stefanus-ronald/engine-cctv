# V-006 Summary — Line Crossing & Intrusion Region Overlay

## Apa yang berubah?

1. **Backend API untuk fetch konfigurasi garis/region dari kamera** — Endpoint baru `GET /api/detection/lines/:cameraId` yang fetch LineDetection dan FieldDetection XML dari kamera via ISAPI, parse ke JSON, cache 5 menit.

2. **SVG overlay di tile video** — Garis line crossing dan polygon intrusion region yang dikonfigurasi di web UI Hikvision sekarang tampil sebagai overlay transparan di atas tile video live.

3. **Toggle per-tile** — Checkbox di tile analytics popover untuk show/hide overlay.

## Cara kerja

1. Saat tile dibuat (`createTile()`), jika kamera punya `hwCapabilities.line` atau `.loitering`, frontend fetch `GET /api/detection/lines/:cameraId`
2. Backend GET XML dari kamera via ISAPI Digest Auth, parse `<LineItem>` dan `<FieldDetectionRegion>` entries
3. Frontend render SVG overlay dengan `viewBox="0 0 1000 1000"` — koordinat Hikvision langsung di-map ke SVG, hanya Y-axis di-invert (`svgY = 1000 - hikY`)
4. Line crossing tampil cyan, intrusion region tampil orange (polygon dashed)
5. Overlay semi-transparan saat tile tidak di-hover, full opacity saat hover

## Konversi Koordinat

```
Hikvision XML         Backend JSON         Frontend SVG
positionX=83        x: 83               x1="83"
positionY=687       y: 687              y1="313"  (1000-687)
```

Y-axis inversion karena Hikvision Y=0 di BAWAH, SVG Y=0 di ATAS.

## Files

| File | Aksi |
|------|------|
| `src/isapi/line-crossing-api.js` | CREATE |
| `src/router.js` | MODIFY |
| `public/js/app.js` | MODIFY |
| `public/css/style.css` | MODIFY |
