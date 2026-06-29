# V-008 Changelog — Playback Timeline Scrubber, NVR Onboarding & Detection State Fixes

**Tanggal:** 2026-06-23
**Scope:** (a) Playback UI timeline-scrubber + perbaikan timezone, (b) onboarding NVR/DVR (scan & import semua channel) + pilihan sumber NVR/SD, (c) perbaikan bug konfigurasi deteksi (motion/face state, panah line crossing, anti-leak sesi NVR).

> Terverifikasi live terhadap NVR `DS-7616NI-E2` + IP camera Hikvision di LAN kantor. Detail bukti playback: `RESEARCH/NVR-DVR_Playback/07_VERIFIED_LIVE_TEST.md`.

---

## A. Playback Timeline Scrubber (ganti UI daftar-download)

### `public/js/app.js` — modal playback ditulis ulang (`_pb*`)
- UI lama (From/To + daftar `<li>` segmen Play/Download per baris) → **timeline scrubber 24 jam** ala Frigate: blok hijau = rekaman, klik/drag = seek, playhead realtime (rAF dari `video.currentTime`), zoom 1×–8×, navigasi hari `‹ ›`/Today, "Save block" sekunder.
- **Fix timezone (kritis):** NVR mengembalikan timestamp jam-dinding lokal tapi berlabel `Z` (UTC) → UI dulu geser +7 jam. Sekarang seluruh axis di **ruang UTC**: `_pbDayStart()` = `Date.UTC(y,m,d)`, semua label diformat `timeZone:'UTC'`. Angka UI kini cocok OSD kamera.
- Selector sumber (`#pb-source`): NVR vs on-camera SD, dikirim sebagai `source` ke search/stream/download.

### `public/css/style.css`
- Styling timeline `.pb-*` (track, segmen, playhead, cursor-time, zoom), `.pb-source`.

---

## B. Onboarding NVR/DVR + Pilihan Sumber

### `src/isapi/nvr-channel-map.js`
- `parseInputProxyFull(xml)` → `[{channel,name,ip,online}]` (sebelumnya hanya map IP→id).
- `scanChannels({ip,port,username,password})` → daftar channel recorder (pakai **port HTTP/ISAPI**, mis. 81). Verified: DS-7616NI balik **16 channel**.

### `src/isapi/playback-source.js`
- `describeSources(cameraId)` → enumerasi sumber: **NVR** (jika ter-mapping) + **SD kamera** (selalu sebagai alternatif eksplisit).
- `resolve(cameraId, preferred)` → default NVR; `preferred='sd'` paksa SD; `preferred='nvr'` tanpa mapping → **error `no_nvr_source`** (TIDAK diam-diam pindah ke SD). Balas `sourceKey`, `sourceLabel`, `options[]`, `nvrAvailable`.

### `src/isapi/playback-search.js`
- `searchRecordings(…, {source})`; response tambah `sources[]`, `sourceLabel`, `nvrAvailable`. Tangani `src.error`.

### `src/webrtc/playback-stream.js`
- `startPlayback(…, source)` meneruskan pilihan sumber.

### `src/camera-manager.js`
- `add()` kini **persist `deviceType`** (`'nvr'`/`'dvr'`) — penting agar channel hasil import resolve playback ke channel NVR (`via:'self'`).

### `src/router.js`
| Method | Path | Perubahan |
|--------|------|-----------|
| POST | `/api/nvr/channels` | **BARU** — scan recorder → `{channels[],count}` |
| POST | `/api/nvr/import` | **BARU** — import channel terpilih jadi kamera per-channel (`deviceType:'nvr'`, `rtspPath=/Streaming/Channels/<ch>01`, `detection.channelID`) |
| GET | `/api/playback/search` | +`source` |
| POST | `/api/playback/stream/start` | body +`source` |
| GET | `/api/playback/download` | +`source`; **+`-t <durasi>`** + watchdog + kill saat klien putus + deteksi `453`→`503` |

### `public/js/app.js` — form Add Camera
- `runConnectionTest()` mode NVR → **scan asli** ke `/api/nvr/channels` (bukan mock 8 channel).
- `renderNvrChannels(channels)` → terima array asli (nama+IP).
- Save handler NVR → `POST /api/nvr/import` lalu `loadCamerasFromAPI()`.
- `applyDeviceMode()` → buka Advanced otomatis saat NVR (agar field Web/ISAPI port terlihat untuk scan).

---

## C. Perbaikan Bug Konfigurasi Deteksi

### Bug: motion/face "tidak bisa dimatikan" / tak tersimpan saat refresh
**Akar:** `_syncCheckboxesFromCamera()` (app.js) dulu **memaksa `cell.enabled=true`** untuk motion & face bila HW mendukung — mengabaikan state nyata kamera. Saat refresh, disable selalu balik ON.

- **`src/isapi/line-crossing-api.js` `getLineConfig()`** — tambah fetch master-enabled **motion** (`/ISAPI/System/Video/inputs/channels/{ch}/motionDetection`) & **face** (`/ISAPI/Smart/FaceDetect/{ch}`) → response tambah `motionEnabled`, `faceEnabled`.
- **`public/js/app.js` `_syncCheckboxesFromCamera()`** — satu fetch `/api/detection/lines`, lalu **mirror state asli** kamera untuk motion/face/line/loitering. Tak pernah paksa ON; state tak terbaca → biarkan.
- Backend `setDetectionEnabled()` (GET→ubah `<enabled>`→PUT) **terverifikasi** benar mengubah kamera (enable→`true`, disable→`false`).

### Bug: panah arah line crossing hilang setelah Save
**Akar:** `renderLineOverlay()` dulu menggambar panah hanya `if (line.enabled)`.
- Sekarang panah arah **selalu digambar** (opacity 0.45 saat off, 0.95 saat on), konsisten dengan tampilan saat menggambar. Mapping arah: `any`/`both`→A↔B, `left-right`→A→B, `right-left`→B→A (cocok token `directionSensitivity` kamera).

---

---

## D. Indikator Loading Tile (saat gambar belum muncul)

**Akar bug:** `.reconnect-overlay` divisible-kan lewat class `.show` (CSS opacity), tapi `_setTileStatus` malah toggle `style.display` → overlay **tak pernah terlihat**. Selain itu WebRTC set status `connected` saat `ontrack` (sebelum frame terlukis).

- `public/js/stream-adapter.js` — `_setTileStatus()` kini toggle class `.show` + set teks label; `_waitForFirstFrame(conn)` menahan status `connecting` (spinner) sampai `<video>` benar-benar punya frame (`loadeddata`/`playing`, fallback 12s) baru `connected`.
- `public/js/app.js` — overlay tile tambah `<div class="tile-loading-label">Connecting…</div>`.
- `public/css/style.css` — `.reconnect-overlay` kolom + `.tile-loading-label`.

Hasil: spinner "Connecting…/Reconnecting…" tampil sampai gambar pertama benar-benar muncul.

---

## E. Perbaikan Hasil Audit Kode

| # | Sev | Perbaikan | File |
|---|-----|-----------|------|
| 1 | High | `setDetectionEnabled` ganti **hanya master `<enabled>`** (bukan `/g` semua) — sub-fitur motion/grid/highlight & LineItem tak ikut ter-toggle. Verified: disable→master=false, `enableHighlight` tetap true | `line-crossing-api.js` |
| 2 | High | **Redaksi kredensial** `user:pass@` di log download + `detail` response + `src` yang dikembalikan playback-stream | `router.js`, `playback-stream.js` |
| 3 | High | **Auth token opsional** (`CCTV_API_TOKEN`) untuk endpoint mutasi (cameras CRUD, nvr scan/import, detection writes); default off = tak mengubah perilaku LAN. Header `x-api-token`/`?token=` | `config.js`, `router.js` |
| 4 | Med | Download **honor backpressure** (`res.write()===false → ff.stdout.pause()`, resume on `drain`) — cegah buffer multi-GB di RAM | `router.js` |
| 5 | Med | Tolak rentang `end<=start` (400) + **selalu** `-t` (≥1s) → tak ada pull tanpa batas. Verified: inverted→400 | `router.js` |
| 6 | Med | Channel-map: IP duplikat → ambil **channel terendah** deterministik (bukan last-write-wins) | `nvr-channel-map.js` |
| 7 | Med | `getDeviceType` **buang inferensi `channelID>1⇒nvr`** (multi-sensor/fisheye tak salah klasifikasi) | `camera-manager.js` |
| 8 | Med | `update()` kini **persist `deviceType`** | `camera-manager.js` |
| 9 | Low | Static serving: **containment check** `path.resolve(...).startsWith(root)` | `router.js` |
| 10 | Low | `_pbPopulateSources` buang dead branch; pertahankan pilihan user bila masih valid | `app.js` |

> Catatan #3: token default **off** agar deployment LAN tetap jalan. Bila operator set `CCTV_API_TOKEN`, frontend perlu mengirim header token (follow-up). Streaming routes (`/api/webrtc`, `/api/streams`, `/api/playback/stream/*`) sengaja tak di-gate agar video tetap jalan. CORS wildcard masih ada (risiko rendah untuk alat LAN; auth penuh = follow-up lebih besar).

---

---

## F. Iterasi Lanjutan (UX playback & perbaikan lapangan)

- **Animasi loading playback** — overlay spinner "Buffering…" di atas video playback (`#pb-loading`); tampil saat seek/buffering, hilang saat frame pertama (`loadeddata`/`playing`), auto-hide 20s. (`app.js` `_pbShowLoading`, `style.css` `.pb-loading`)
- **Arah panah line crossing dibalik** — A→B (`left-right`) → sisi perpendicular **kiri**, B→A → kanan; identik di mode menggambar & overlay tersimpan. Terverifikasi: kamera menyimpan koordinat/token persis seperti dikirim (tak membalik). (`app.js` `_updateDrawSvg`, `renderLineOverlay`)
- **Download playback pilih rentang** — tombol "Download…" membuka panel (From + Length menit), **clamp 1–60 menit**; default From = playhead, Length = min(10, sisa blok). Ganti perilaku lama yang mengunduh seluruh blok (bisa 5+ jam). (`app.js` `_pbToggleDownloadPanel`/`_pbDoDownload`)
- **Download bebaskan sesi NVR dulu + guard anti-ganda** — sebelum mengunduh, `_pbStopActiveStream()` dipanggil; tombol di-disable + flag `_pbState.downloading` mencegah download kedua selagi satu berjalan (NVR playback **realtime** & batasi 1 sesi/channel → `453` bila tumpang tindih). Status memberi tahu estimasi ≈ panjang klip.
- **Fix cam-ptz live 500** — RTSP PTZ `192.168.1.186` ternyata di **port 8554**, bukan 554 (ISAPI 88 tetap jalan). `cameras.json` `cam-ptz.port: 554 → 8554`. Terverifikasi: live frame H.264 720p OK.
- **UI download disatukan + progress NYATA** — hilangkan duplikasi "dua tombol Download": kini **satu kontrol** selalu tampil — baris **"Save clip"** (`From` + `Length 1–60 min` + tombol **"Download clip"**). `From` otomatis mengikuti **playhead** (klik timeline = set start). Saat mengunduh: tombol disable, muncul **overlay loading** dengan progress **0–100% berbasis byte nyata** (response dibaca sebagai stream → bar berhenti bila data berhenti, tampilkan MB nyata) + tombol **Cancel** (AbortController → batal & bebaskan sesi NVR). Tutup modal otomatis membatalkan.
- **Header no-cache untuk aset** — `serveStaticFile` (router.js) kini mengirim `Cache-Control: no-cache, must-revalidate` untuk `.js/.css/.html`, supaya perubahan UI selalu termuat tanpa hard-refresh berulang (sebelumnya tanpa header → browser menyajikan `app.js` basi, mis. tombol Download lama tetap muncul).
- **Progress NYATA pada semua loading (bukan timer)** — progress 0–100% kini digerakkan oleh **milestone koneksi sebenarnya**, bukan animasi timer:
  - **Live tile** (`stream-adapter.js` `_setTileProgress`): start 5% → offer 25% → ICE selesai 45% → answer go2rtc 70% → ter-negosiasi 88% → track diterima 95% → **frame pertama 100%**. MJPEG: request 50% → JPEG pertama 100%.
  - **Buffering playback** (`_pbSetProgress` di `_pbSeekTo`/`_pbConnectWebRTC`): stream terdaftar 40% → offer 55% → ICE 68% → ter-negosiasi 85% → track 92% → frame pertama 100%.
  - **Download** (`_pbDoDownload`): membaca response sebagai **stream**, progress mengikuti **byte nyata** yang diterima (berhenti bila data berhenti) + tampil MB.
  - Helper: `_pbShowLoading({manual,abort,persist})` (mode `manual` = bar 0% digerakkan pemanggil), `_pbSetProgress(value[,ceil])`, `_pbFinishLoading`.
  - **Trickle acak (organik)** — nilai tiap milestone **di-jitter** (rentang acak, mis. offer 20–28%) dan **di antara milestone** bar merayap dengan **langkah acak** (kebanyakan kecil, kadang lompatan, kadang nyaris berhenti) pada **interval acak** (kadang cepat, kadang jeda lama) menuju ceiling — sehingga loading **tak pernah terlihat sama** dua kali & terasa benar-benar memuat, tetapi tetap menempel pada milestone nyata (`_rand`/`_randStep`/`_randInterval` di stream-adapter; `_pbRand`/`_pbRandStep`/`_pbRandInterval` di app.js). Download tetap **murni byte-nyata** (tanpa trickle).

---

## API Response — perubahan

`GET /api/detection/lines/:cameraId` — tambah field:
```json
{ "...": "...", "motionEnabled": false, "faceEnabled": false }
```
`GET /api/playback/search` — tambah `sources[]`, `sourceLabel`, `nvrAvailable`, `sourceKey`.

---

## Backward Compatibility

| Aspect | Impact |
|--------|--------|
| 6 kamera existing | Zero — field baru additive; playback tetap route ke NVR |
| cameras.json | `deviceType` kini ikut tersimpan untuk entri baru (lama tetap di-infer `getDeviceType`) |
| Detection state | Kini mengikuti kamera (sumber kebenaran), bukan localStorage paksa-ON |
| Download | `-t` membatasi durasi pull → tak ada sesi NVR bocor |

---

## Audit / Verifikasi Live

| Check | Status |
|-------|--------|
| Motion enable/disable engine→kamera | ✅ enable→`true`, disable→`false` (cam-kreatif .86) |
| Refresh menampilkan state asli | ✅ `motionEnabled=false` dilaporkan endpoint |
| Scan NVR | ✅ 16 channel + nama (DS-7616NI .181) |
| Import channel → playback | ✅ CH7 `via=self` track 701, 12 segmen |
| Download anti-leak | ✅ klip 10s exit bersih, ffmpeg tak menggantung |
| Pipeline WebRTC playback | ✅ frame JPEG 70 KB via go2rtc |
| Audit kode otomatis | dijalankan (subagent) — temuan ditindaklanjuti |
