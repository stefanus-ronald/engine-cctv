# V-005 Summary — hwCapabilities Fix + SSE Notification

## Apa yang berubah?

1. **Bug fix: hwCapabilities tidak sampai ke frontend** — Field `hwCapabilities` dari backend API tidak di-mapping saat `loadCamerasFromAPI()`, menyebabkan semua kamera tampil "SW only" meskipun hardware mendukung.

2. **SSE notification saat probe selesai** — Karena `probeAllCameras()` berjalan async (non-blocking), browser yang sudah connect sebelum probe selesai mendapat `hwCapabilities: null`. Sekarang server broadcast SSE event `capabilities-updated` saat probe selesai, frontend otomatis refresh.

## Root Cause

1. **Missing field mapping**: `loadCamerasFromAPI()` di `app.js` tidak include `hwCapabilities` saat mapping response `/api/cameras` → variabel `cameras[]`. Akibatnya `buildCameraCapabilities()` selalu menerima `null` → fallback ke motion-only.

2. **Race condition**: `probeAllCameras()` dipanggil fire-and-forget di `server.js`. Jika browser load sebelum probe selesai, `GET /api/cameras` return `hwCapabilities: null` — dan tidak ada mekanisme untuk refresh setelahnya.

## Fix yang diterapkan

| Fix | File | Perubahan |
|-----|------|-----------|
| Mapping hwCapabilities | `public/js/app.js` | Tambah `hwCapabilities: c.hwCapabilities \|\| null` di `loadCamerasFromAPI()` |
| SSE broadcast | `src/isapi/capabilities-probe.js` | Import `sse-broadcaster`, broadcast `{ type: 'capabilities-updated' }` setelah probe selesai |
| SSE handler | `public/js/app.js` | Handle event `capabilities-updated` → re-fetch cameras → re-render sidebar + grid |

## Hasil

- Kamera dengan HW support sekarang tampil "HW ✓" di deep dive panel
- Kamera tanpa HW support tetap tampil "SW only"
- Browser yang load sebelum probe selesai otomatis refresh saat probe complete

## Files

| File | Aksi |
|------|------|
| `public/js/app.js` | MODIFY (2 perubahan) |
| `src/isapi/capabilities-probe.js` | MODIFY (2 perubahan) |
