# V-013 Changelog — Hardening Hasil Audit (anti-crash, anti-leak, anti-lag)

**Tanggal:** 2026-06-30
**Scope:** Perbaikan dari audit kode menyeluruh (backend Node + frontend SPA). Fokus: hilangkan penyebab **crash proses**, **leak** (process/FD/Map/timer), dan **over-render** yang bikin lag. Tidak ada perubahan fitur — murni stabilitas & performa.

> Verifikasi: `npm run check` (27 file JS lolos `node --check`) + boot server sungguhan (go2rtc ready, kamera connect, HW probe) tanpa crash.

---

## P0 — Penyebab crash proses

### 1. Error handler global + URL-decoding aman — `src/router.js`, `src/server.js`
- `handleRequest` dibungkus `try/catch` (route logic dipindah ke `routeRequest`) → throw/Promise-reject dari **route mana pun** tidak lagi menjatuhkan proses; client dapat `500`, bukan socket menggantung.
- `new URL(...)` dan `decodeURIComponent(pathname)` di-`try/catch` → URL malformed (mis. `/%`) = `400`, bukan `URIError` uncaught.
- `src/server.js`: tambah `process.on('unhandledRejection')` & `uncaughtException` (log, tidak exit) sebagai jaring pengaman terakhir untuk task background (socket ISAPI, event FFmpeg, timer).

### 2. `getSnapshot` callback ganda → crash route thumbnail — `src/mjpeg/mjpeg-manager.js`
- Guard `done` agar callback **tepat sekali**. Sebelumnya `on('error')` + `on('close')` (+ timeout) bisa memanggil callback ≥2×, membuat handler thumbnail `res.writeHead` dua kali → "headers already sent" → crash. `clearTimeout` ditambahkan.

---

## P1 — Leak (process/FD/Map/timer) & reconnect storm

### 3. MJPEG: entri Map & restart-timer bocor + FFmpeg orphan — `src/mjpeg/mjpeg-manager.js`
- `streams.delete(streamKey)` saat client terakhir putus → Map (dan buffer parser) tidak tumbuh tanpa batas saat id kamera berganti (NVR sync).
- Restart `setTimeout` di-track ke `stream.restartTimer`, di-clear di `stopFFmpeg`, dan **cek ulang `clients.size`** sebelum start → tidak ada FFmpeg yang hidup tanpa penonton.

### 4. go2rtc respawn setelah stop — `src/webrtc/go2rtc-manager.js`
- Flag `shuttingDown` + `go2rtcRestartTimer` yang di-clear di `stop()`; handler `'close'` tidak respawn saat shutdown → **tidak ada proses go2rtc yatim** setelah app berhenti.

### 5. Alert stream ISAPI — `src/isapi/alert-stream-manager.js`
- **403/404** kini dijadwalkan reconnect (5 menit), bukan mati permanen → fitur VCA yang diaktifkan belakangan bisa pulih sendiri.
- Body tantangan **401 di-cap 64 KB** + handler `res.on('error')` → device nakal tak bisa bikin buffer membengkak / crash.
- Handler `res.on('data')` dibungkus `try/catch` → throw saat parse/normalize/broadcast tidak menjatuhkan proses (buffer di-reset, stream tetap hidup).
- (Sebelumnya, V-012) flag `closing` agar disconnect sengaja tidak memicu reconnect.

### 6. go2rtc proxy — `src/webrtc/go2rtc-proxy.js`
- `timeout: 15s` + `proxyReq.on('timeout')`; `req.on('error')` (client abort tak lagi uncaught); `res.on('close')` → `proxyReq.destroy()` (tutup upstream saat client putus); guard `res.headersSent` sebelum kirim 503 → tidak ada socket/FD menggantung.

### 7. JPEG parser buffer di-cap — `src/mjpeg/jpeg-parser.js`
- Cap **8 MB**: bila tak pernah menemukan akhir frame (stream korup), buffer di-reset (resync) alih-alih tumbuh tanpa batas.

### 8. Frontend — timer & koneksi per-kamera dibersihkan saat delete — `public/js/app.js`
- `deleteCamerasByIds`: `StreamAdapter.disconnect()` untuk tile kamera tsb (tutup pc/img), serta clear `_camRecentDecayTimers`, `_tileEyeTimers`, dan hapus entri `_camRecentEventAt`/`_tileEyeStateByCam`. Sebelumnya timer 60s kamera terhapus tetap fire `renderSidebar()`.

---

## P2 — Lag / jank / korupsi data

### 9. Tulis JSON atomik — `src/config.js`
- `writeJsonAtomic()` (tulis temp → `rename`) dipakai untuk `cameras.json`, `dashboard.json`, `timezone.json` → crash/penulisan bersamaan tak bisa meninggalkan file korup yang membuat load berikutnya melempar & **menghapus seluruh daftar**.

### 10. Static serving non-blocking — `src/router.js`
- `fs.existsSync` + `fs.statSync` sinkron di hot path **dihapus**; mengandalkan `serveStaticFile` (async `readFile`, 404 saat tak ada/dir). Containment path tetap dijaga.

### 11. Over-render frontend (penyebab flicker/lag) — `public/js/app.js`
- **Scheduler 15s**: `renderGrid()` penuh diganti `refreshTileEyeBadges()` (patch badge mata in-place) → tidak rebuild seluruh grid hanya untuk perubahan jadwal.
- **Search sidebar**: di-debounce 120ms (tidak rebuild tiap ketukan).
- **SSE burst**: `camera-*` & `capabilities-updated` di-coalesce (`reloadCamerasCoalesced`, debounce 200ms) → 1 reload+render, bukan N rebuild beruntun.

---

## File yang diubah
- `src/server.js`, `src/router.js`, `src/config.js`
- `src/mjpeg/mjpeg-manager.js`, `src/mjpeg/jpeg-parser.js`
- `src/webrtc/go2rtc-manager.js`, `src/webrtc/go2rtc-proxy.js`
- `src/isapi/alert-stream-manager.js`
- `public/js/app.js`

## Belum dikerjakan (low-priority / butuh verifikasi)
- xml-parser precompile RegExp per-event (mikro-optimasi hot path).
- `go2rtc-manager.addStream` param `name`/`src` — perlu cek doc go2rtc API sebelum diubah (runtime-add).
- SSE keepalive/heartbeat untuk prune koneksi half-open.
- Verifikasi: butuh observasi runtime panjang untuk konfirmasi tidak ada regresi reconnect.
