# V-012 Changelog — Input Kamera Manual (RTSP/ISAPI/HW), Tombol HQ Main/Sub, Bulk Action, Drag-Swap Tile & Auto-Restore Dashboard

**Tanggal:** 2026-06-30
**Scope:** Perbaikan alur **tambah kamera manual** + UX dashboard:
(A) bug RTSP path tanpa nomor channel, (B) field ISAPI port + dukungan HW (Edge AI) untuk kamera manual, (C) tombol HQ benar-benar pindah channel MAIN/SUB, (D) bulk-action bar (pilih → move/export/delete) + perbaikan layout, (E) delete kamera persist ke backend, (F) hapus data dummy (kamera & grup kosong), (G) drag-swap antar-tile, (H) auto-restore susunan dashboard saat reload/restart engine.

> Lanjutan dari V-011 (data existing sudah dikosongkan ke `[]` untuk input manual). Kasus uji nyata diambil dari `cameras.json.bak.20260622-171430` (Parkiran .195 isapiPort 85, NVR .181 ch6 `/Streaming/Channels/601`+alt `602`, dll).

---

## A. Bug RTSP path tanpa nomor channel (FFmpeg 400 / Invalid data)

**Masalah:** Form default `rtspPath = "/Streaming/Channels/"` (tanpa angka). FFmpeg menolak: `Server returned 400 Bad Request` / `Invalid data found`. Hikvision butuh `<channel><stream>` — `101`=CH1 main, `102`=CH1 sub.

### `src/camera-manager.js`
- `normalizeRtspPath(rtspPath)`: path kosong / berakhir `/Streaming/Channels/` tanpa digit → otomatis `/Streaming/Channels/101`. Dipakai di `buildRtspUrl`, `add`, `update` → memperbaiki kamera baru **dan** yang sudah terlanjur tersimpan.

### `public/js/app.js` & `public/index.html`
- `normalizeStreamPath()` (mirror frontend) + default field diubah ke `/Streaming/Channels/101`.

---

## B. Field ISAPI port + dukungan HW (Edge AI) untuk kamera manual

**Masalah:** Kamera yang ditambah manual hanya dapat deteksi **SW**, panel Analytics menampilkan *"No ISAPI port configured"*. Penyebab: probe HW (`isapi/capabilities-probe.js#probeAllCameras`) **hanya** memproses kamera ber-`isapiPort`, sedangkan form tak pernah mengirim port tersebut.

### `public/index.html`
- Field **"ISAPI / HTTP port"** dipindah dari Advanced ke blok **Connect** (terlihat jelas), `id=cam-add-web-port`.

### `public/js/app.js`
- `channelIdFromPath()` → derive `detection.channelID` dari path (`101→"1"`, `601→"6"`).
- POST/PUT `/api/cameras` kini mengirim `isapiPort: fields.webPort` + `detection:{isapi:true, channelID}`.
- `loadCamerasFromAPI()` memetakan `webPort = c.isapiPort || 80` agar nilai benar saat Edit.

### `src/router.js`
- Helper `probeCameraCapabilities(cam)`: setelah **add/update**, jika `cam.isapiPort && config.isapiEnabled` → probe HW async + broadcast SSE `capabilities-updated`. HW menyala **tanpa restart**.

---

## C. Tombol HQ benar-benar pindah channel MAIN/SUB

**Masalah:** Tombol HQ dulu hanya kosmetik (ganti badge), tidak mengubah stream. Seharusnya **HQ aktif = MAIN (x01)**, **HQ nonaktif = SUB (x02)** — berpengaruh ke kualitas.

### `src/camera-manager.js`
- `buildRtspUrlForQuality(cam, 'main'|'sub')`: remap digit stream-type pada channel (CH1 `101↔102`, CH6 `601↔602`). Path non-Hikvision dibiarkan apa adanya.

### `src/mjpeg/mjpeg-manager.js`
- Stream kini di-key per **streamKey**: `cameraId` (main) / `${cameraId}::sub` (sub) → main & sub satu kamera bisa jalan bersamaan di tile berbeda. `handleStream(cameraId, res, quality)`.

### `src/router.js`
- `/mjpeg/:id` membaca `?quality=main|sub`.

### `src/webrtc/go2rtc-manager.js`
- Daftarkan stream sub `"<id>_sub"` (lazy) di `buildGo2RTCConfig`, `addStream`, hapus di `removeStream`.

### `public/js/stream-adapter.js` & `app.js`
- `connect/reconnect(...quality)`; MJPEG `/mjpeg/<id>?quality=`, WebRTC src `<id>` / `<id>_sub`.
- `createTile` connect sesuai `isHq`; klik HQ → `reconnect` ke channel sesuai. Default tile = **SUB**.

---

## D. Bulk-action bar (checkbox) + perbaikan layout

**Masalah:** Diminta checkbox untuk aksi massal, bukan hanya delete. Tombol "Delete selected" lama selalu tampil & menabrak baris (atribut `hidden` ketimpa `display` dari class `.btn`).

### `public/index.html` & `css/style.css`
- Kolom checkbox + **select-all** di header tabel kamera.
- `#cam-bulk-bar` (block tersendiri, flex-wrap, muncul saat ≥1 dipilih) berisi: **Move to group**, **Export**, **Delete**, **Clear**.

### `public/js/app.js`
- `selectedCamIds` (Set, survive re-render), `updateBulkDeleteBar()` (show/hide via `display`, isi count + dropdown grup), `moveCamerasToGroup()`, export subset, `clearCamSelection()`.

---

## E. Delete kamera persist ke backend

### `public/js/app.js`
- `deleteCamerasByIds(ids)` memanggil `DELETE /api/cameras/:id` (dulu hanya `splice` lokal → balik lagi saat refresh). Membersihkan `tileAssignments`/`tileHqState`/`tileAudioState` terkait.

---

## F. Hapus data dummy (kamera & grup kosong)

**Masalah:** Saat backend kosong, muncul kamera dummy (Front Gate, dst.) + grup custom sisa (Outdoor, NVR, …) yang tidak punya kamera.

### `public/js/app.js`
- Generator `buildCameraList()` (kamera simulasi) **dihapus**. Kamera kini hanya dari API; backend kosong = grid/list kosong.
- `pruneEmptyCustomGroups()`: grup custom tanpa kamera dibuang (saat init, setelah delete, & SSE reload).

---

## G. Drag-and-drop tukar posisi tile

**Masalah:** Swap antar-tile tidak jalan. Penyebab: `dragover` selalu set `dropEffect='copy'` padahal drag tile pakai `effectAllowed='move'` → kombinasi tidak cocok membuat browser **menolak drop**.

### `public/js/app.js`
- `dragover` set `dropEffect` sesuai jenis drag: tile→tile = `move`, sidebar→tile = `copy` (deteksi via `dataTransfer.types.includes('application/tile-index')`). Kini bisa **tukar** dua tile atau **pindah** ke slot kosong (state HQ/audio ikut). Logika swap di handler `drop` sudah ada sejak awal, hanya terblokir bug `dropEffect` ini.

---

## H. Auto-restore susunan dashboard (reload / restart engine)

**Masalah:** `tileAssignments`/layout hanya di memori → hilang tiap reload. Diminta auto-load konfigurasi dashboard + datanya.

### `dashboard.json` (baru) + `src/config.js`
- `loadDashboard()` / `saveDashboard(data)`, path `config.dashboardFile`.

### `src/router.js`
- `GET /api/dashboard` (kembalikan layout tersimpan atau `{}`), `PUT /api/dashboard` (persist).

### `public/js/app.js`
- `persistDashboard()` (debounce 400ms) PUT `{gridSize, activeLayout, tileAssignments, tileHqState, tileAudioState}`. Dipanggil di akhir `renderGrid` + toggle HQ/audio. Digerbangi `_dashboardReady` agar tak menimpa data saat load awal.
- `loadDashboardFromAPI()` di init: terapkan layout + assignment (di-filter ke kamera yang masih ada) → grid auto-restore saat reload **dan** restart engine.

---

## I. Fullscreen / Focus tidak lagi auto-HQ

**Masalah:** Saat tile di-expand (focus / dobel-klik), sistem otomatis menaikkan ke MAIN (HQ) lalu mengembalikan ke SUB saat keluar — kini ini juga memicu reconnect channel (efek samping fitur C).

### `public/js/app.js` — `enterFocus()`
- Hapus auto-promote ke HQ. Focus/fullscreen mempertahankan kualitas tile apa adanya; MAIN/SUB sepenuhnya dikontrol manual via tombol HQ. `focusAutoHqIndex` selalu `null` (badge "AUTO" tidak lagi muncul).

---

## J. Stream dipertahankan saat ganti layout (tanpa reconnect)

**Masalah:** Tiap `renderGrid()` melakukan `gridContainer.innerHTML=''` → semua tile dibangun ulang & **stream reconnect**. WebRTC sebagian terselamatkan (transfer), tetapi MJPEG selalu putus-sambung saat ganti ukuran/layout grid.

### `public/js/stream-adapter.js`
- **Park & adopt:** `parkMedia()` memindahkan elemen media (`<video>`/`<img>`) ke holder off-screen `#stream-keepalive` **sebelum** grid dibersihkan, sehingga koneksi (RTCPeerConnection / multipart MJPEG) **tidak putus**.
- `connect(...staggerMs)` punya **reuse path**: jika tile index yang sama masih memakai kamera+quality+protokol yang sama → **adopsi** elemen yang di-park (`_adoptMedia`), bukan reconnect. Hanya koneksi benar-benar baru yang di-stagger.
- `sweep(totalTiles)`: setelah rebuild, putuskan koneksi untuk tile yang sudah tidak ada + buang media park yang tak teradopsi (kameranya hilang). Mencegah kebocoran stream saat layout mengecil.
- Objek koneksi MJPEG kini menyimpan `mediaEl`/`tile` agar bisa di-park/adopt.

### `public/js/app.js`
- `createTile`: stagger dipindah ke `StreamAdapter.connect(..., index*300)` (reuse berjalan sinkron, hanya fresh yang ditunda).
- **Penting:** koneksi **immediate** (staggerMs=0, mis. tile index 0) berjalan **saat `createTile`** — sebelum tile di-`appendChild`. Cek `isConnected` hanya untuk koneksi yang **ditunda**; bila diterapkan ke koneksi immediate, `isConnected` masih `false` → koneksi di-skip → **gambar kamera tidak muncul** (bug yang sempat terjadi, sudah diperbaiki).
- `renderGrid`: `parkMedia()` sebelum `innerHTML=''`, `sweep(total)` setelah membangun tile.

- **Drag pindah/tukar tile tanpa reconnect:** `StreamAdapter.swapTiles(a,b)` me-rekey koneksi mengikuti swap; drop handler memanggilnya + `_swapKey()` menukar map per-tile (key kosong tetap kosong agar `tileIsHq` tidak ke-pin). Stream **ikut pindah** ke tile baru, bukan reconnect.
- **Fix layar hitam saat adopt:** memindahkan elemen `<video>` antar-DOM **mem-pause**-nya (autoplay tak terpicu lagi) → tile hitam. `_adoptMedia` kini memanggil `mediaEl.play()` untuk video; `<img>` MJPEG tidak terpengaruh.

> Hasil: ganti ukuran grid / focus layout / **drag pindah-tukar tile** **tidak memutus** stream (WebRTC & MJPEG). Reconnect hanya terjadi bila kamera di tile itu berubah, quality berubah (HQ), atau protokol diganti.

## J.2 Default quality tile baru mengikuti setting "Default Stream Quality"

**Masalah:** Tile kamera baru selalu SUB (hardcoded), padahal ada setting **Settings → Streams → Default Stream Quality**.

### `public/js/app.js`
- Helper `tileIsHq(index)`: toggle per-tile eksplisit menang; bila belum di-set, tile mengikuti `settings.defaultQuality` (`main`=HQ, `sub`=tidak). Dipakai di `createTile` & aksi reconnect.

---

## K. Bug: alert stream ISAPI tetap hidup setelah kamera dihapus (banjir log)

**Masalah:** Setelah kamera dihapus, log dibanjiri `Cannot resolve camera for event on <ip>:<port> ch=1`. Endpoint alert stream tidak benar-benar mati.

**Akar masalah:** `disconnectEndpoint()` memanggil `state.request.destroy()`; ini memicu `res.on('error'/'end')` → `scheduleReconnect()` yang **menjadwalkan koneksi ulang baru** (setelah `retryTimer` lama di-clear). Endpoint tersambung lagi dengan `state.cameras` kosong → tiap event tak punya kamera → banjir warning, berulang selamanya.

### `src/isapi/alert-stream-manager.js`
- `disconnectEndpoint()`: set `state.closing = true` **sebelum** destroy + null-kan `retryTimer`/`request`; log "endpoint closed".
- `scheduleReconnect()`: `if (state.closing) return` — penutupan disengaja tidak di-resurrect.
- `connectEndpoint()`: bail bila `state.closing` / sudah tidak ada di `connections`.
- Warning "Cannot resolve" kini di-throttle (maks 1×/30s per endpoint) agar tak membanjiri log di skenario lain.

> Catatan: koneksi yatim yang sudah terlanjur jalan akan hilang setelah **restart server** (cameras.json sudah tak memuat kamera tsb). Penghapusan berikutnya langsung bersih tanpa perlu restart.

---

## L. Timezone playback by-country (offset tetap, tanpa deteksi otomatis)

**Masalah:** Timeline playback tidak sinkron dengan jam OSD rekaman (mis. klik 08 tapi footage 18). Penyebab: heuristik auto-deteksi konvensi waktu per-device (`getDisplayOffsetMin` membandingkan rekaman terbaru vs UTC/WIB) tidak deterministik dan salah untuk sebagian perangkat.

**Keputusan user:** buang tebakan otomatis; pilih **negara** di Settings → engine pakai **offset ibukota negara** (tetap) untuk semua kamera.

### Backend
- `src/config.js`: `displayCountry` + `displayTzOffsetMin` (default `ID`/+420 WIB), file `timezone.json`, fungsi `loadTimezone()`/`saveTimezone()` (dipanggil saat startup).
- `src/isapi/playback-search.js`: `getDisplayOffsetMin()` kini **mengembalikan `config.displayTzOffsetMin`** (offset tetap) — heuristik probe + cache dihapus. Search/stream/download memakai offset yang sama → konsisten.
- `src/router.js`: `GET/PUT /api/timezone` → `{ country, offsetMin }`.

### Frontend (`public/index.html`, `public/js/app.js`)
- Settings → Display: dropdown **"Playback Timezone (Country)"** (`#set-country`), daftar `TZ_COUNTRIES` (negara → offset ibukota, mis. Indonesia/Jakarta +7, termasuk WITA/WIT, ASEAN, Asia, Eropa, US, dll). Label menampilkan `UTC±H`.
- `loadTimezoneFromAPI()` saat init (set nilai dari backend). On change → `PUT /api/timezone`; bila modal playback terbuka → `_pbLoadDay()` ulang agar timeline ikut.

> Catatan: offset = waktu standar (DST tidak diterapkan otomatis). Asumsi rekaman device ber-tag UTC (standar Hikvision); displayed = device-UTC + offset negara. Pilih negara yang cocok dengan jam OSD perangkat. Default Indonesia/WIB.

---

## File yang diubah
- `src/config.js`, `src/router.js`, `src/camera-manager.js`, `src/mjpeg/mjpeg-manager.js`, `src/webrtc/go2rtc-manager.js`, `src/isapi/alert-stream-manager.js`
- `public/index.html`, `public/css/style.css`, `public/js/app.js`, `public/js/stream-adapter.js`
- Baru: `dashboard.json` (dibuat saat susunan pertama disimpan)

## Cara verifikasi
1. Restart server Node + hard refresh (`Ctrl+Shift+R`).
2. Add kamera IP manual → isi **ISAPI / HTTP port** → stream jalan, panel Analytics tampil detektor HW.
3. Klik **HQ** di tile → kualitas berubah (MAIN↔SUB).
4. Centang beberapa kamera → bar aksi (Move/Export/Delete) muncul rapi.
5. Drag tile ke tile lain / slot kosong → tertukar/pindah.
6. Susun grid → reload / restart engine → susunan kembali otomatis.
7. Focus/fullscreen sebuah tile → kualitas tidak berubah otomatis (tetap sesuai tombol HQ).
8. Ganti ukuran/layout grid → stream kamera yang tetap di tempat **tidak reconnect** (video mulus, MJPEG tidak loading ulang).
