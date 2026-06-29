# V-010 Changelog — Storage / HDD Management & Playback dari Penyimpanan Perangkat

**Tanggal:** 2026-06-27
**Scope:** Cek **HDD/SD/NAS management** sebuah perangkat (IP camera maupun NVR) via ISAPI, tampilkan statusnya, dan kaitkan dengan ketersediaan playback dari penyimpanan perangkat.

> Terverifikasi live (27 Jun 2026): IP camera Parkiran/R.Kreatif merekam ke **NAS**, Ruang Dev **tanpa storage**, NVR Kantor 1× **HDD SATA ~932 GB**. Detail riset: `RESEARCH/NVR-DVR_Playback/10_STORAGE_HDD_MANAGEMENT.md`.

---

## A. Backend

### `src/isapi/storage-api.js` (baru)
- `getStorage({ ip, port, username, password })` → `GET /ISAPI/ContentMgmt/Storage` (2-step Digest), parse `<hddList>` + `<nasList>`.
- Output ternormalisasi: `{ ok, hasStorage, recordable, media:[{ kind:'hdd'|'nas', id, name, type, status, capacityMB, freeSpaceMB, usedMB, usedPct, property }] }`.
- `capacity`/`freeSpace` ISAPI dalam **MB**. `recordable` = ada disk `ok`/`idle`/`sleeping` + property RW.
- Robust: `404`/`403` → `{ ok:true, hasStorage:false }` (perangkat tanpa storage, mis. IP cam tanpa SD); `401` → auth gagal; grab tag case-insensitive (`freeSpace`/`freespace`).

### `src/router.js`
- `GET /api/cameras/:id/storage` — storage kamera existing (IP cam microSD/NAS atau channel NVR → HDD recorder).
- `POST /api/storage/check { ip, port, username, password }` — cek by-credential untuk form Add Camera (sebelum kamera dibuat). Ditambahkan ke daftar endpoint ter-guard auth-token.

---

## B. Frontend (`public/js/app.js`, `public/css/style.css`)

### Modal playback — status storage
- Saat modal dibuka → `_pbLoadStorage(cameraId)` fetch `/api/cameras/:id/storage` dan tampilkan chip `#pb-storage`:
  - ada media → "💾 SATA 932 GB, 0 GB kosong, ok" (hijau bila recordable, kuning bila tidak), tooltip detail tiap disk.
  - tanpa media → "💾 Tanpa penyimpanan di perangkat" (kuning).
- Helper `_fmtSize(mb)` MB→GB/TB.

### Test Connection (IP camera) — kini nyata
- Sebelumnya **mock** (`setTimeout` → "Connected · 1920×1080…"). Sekarang `POST /api/storage/check`:
  - sukses → "Terhubung · N× penyimpanan: NAS 9.9 GB, 2 GB kosong, ok" atau "Terhubung · tanpa penyimpanan (SD/HDD)".
  - `401` → "Terhubung, tapi auth gagal"; tak terjangkau → "Tidak bisa menjangkau ip:port".
- Tetap berbeda dari mode NVR (yang memakai scan channel).

### CSS
- `.pb-storage` (chip storage di toolbar playback).

---

## C. Opsi playback dari storage perangkat (HDD management) lebih jelas

- **Label sumber `'sd'`** diubah dari "On-camera SD · <nama>" → **"Penyimpanan kamera · <nama>"** (`playback-source.js`), karena media bisa microSD **atau NAS/HDD**, bukan selalu SD.
- Frontend memperkaya label opsi ini dengan media terdeteksi → mis. **"Penyimpanan kamera · NAS 9.9 GB · Parkiran"** (`_pbDecorateSdOption`, dipanggil saat storage selesai dimuat & saat dropdown dibangun ulang).
- Chip storage men-**dedup** media identik (mis. NAS ter-mount ganda) agar tak tampil dobel.
- Hasilnya: untuk IP camera yang ter-map ke NVR, dropdown sumber berisi **2 pilihan** — `Kantor JMP-NVR · CH3` (default) dan `Penyimpanan kamera · NAS … · <nama>`; pengguna bisa memilih playback dari **storage kamera (HDD management)**.

## D. Perbaikan UX playback (rekaman storage = klip pendek)

Rekaman di SD/NAS kamera sering berupa **klip pendek motion-only** (mis. 30 detik) dengan banyak gap, sehingga sulit di-klik tepat & layar tampak hitam ("No footage at this time").

### `public/js/app.js`
- **Auto-play saat buka:** `_pbLoadDay(true)` dari `openPlaybackModal` → otomatis mulai memutar **rekaman pertama** begitu modal dibuka (tak lagi hitam menunggu klik).
- **Snap ke rekaman terdekat:** `_pbNearestSegment(ms)` — klik di gap kini **melompat ke blok rekaman terdekat** dan memutarnya, bukan diam dengan pesan "No footage".

> Terverifikasi live: ffprobe RTSP `Streaming/tracks/101` kamera `.195` → H264 1920×1080; `POST /api/playback/stream/start source=sd` mendaftarkan go2rtc `pb-cam-parkiran-…` (NAS) → WebRTC ke browser.

## E. Kecepatan playback realtime (SD/NAS) & stop semua proses saat modal ditutup

### Kecepatan playback (`go2rtc-manager.js`, `playback-stream.js`)
- **Masalah:** playback `Streaming/tracks` langsung dari kamera (SD/NAS) dikirim **secepat jaringan** → video berjalan lebih cepat dari realtime. (NVR self-throttle ke realtime, kamera tidak.)
- **Fix:** template input ffmpeg baru di `go2rtc.yaml` → `rtsp_re: "-re -rtsp_transport tcp -i {input}"`; playback memakai `#input=rtsp_re` (`-re` = baca pada native frame rate → realtime). Verified: `go2rtc.yaml` berisi template, stream `pb-…` register & play h264.

### Stop semua proses saat modal ditutup (`app.js`)
- `closePlaybackModal()` → tutup WebRTC pc + **DELETE stream go2rtc** (mematikan proses ffmpeg & membebaskan sesi NVR/kamera), `await` sampai selesai; `pause()` + bersihkan `srcObject`/`src` video; kosongkan segments.
- **Anti-race:** `_pbState.gen` di-bump saat open/close; bila `stream/start` selesai setelah modal ditutup, stream yang terlanjur dibuat **langsung di-stop** (`_pbStopStreamByName`) — mencegah stream/ffmpeg yatim yang menahan sesi NVR.
- **Tab ditutup/hidden:** listener `pagehide` mengirim `navigator.sendBeacon('/api/playback/stream/stop')` → sesi tetap dibebaskan walau browser ditutup saat playback jalan.

## F. Jam playback kamera (SD/NAS) salah segmen — fix `name=`

- **Masalah:** klik waktu tertentu (mis. 27 Jun 02:31) malah memutar footage lama (12 Jun 17:34). Penyebab: `playbackURI` hasil search kamera menyertakan **`name=ch01_…&size=`** (id file rekaman di SD/NAS), tetapi engine hanya mengirim `starttime/endtime`. NVR bisa seek murni-waktu, tapi **kamera butuh `name=`** — tanpanya ia memutar rekaman **terlama**.
- **Diagnosa live:** clock kamera benar (`2026-06-27T12:50+07:00`); search kamera melaporkan waktu sebagai wall-clock lokal-ber-Z; ada rekaman 27 Jun (50+ match) dengan `name=`; engine sebelumnya membuang `name=`.
- **Fix:**
  - Frontend mengirim `playbackURI` segmen ke `/api/playback/stream/start`.
  - Backend (`playback-stream.js`) mengekstrak **hanya** `name=`/`size=` (disanitasi: `name` = `[A-Za-z0-9_]`, `size` = digit) dan menambahkannya ke URL `Streaming/tracks` → kamera seek ke segmen yang benar. Aman untuk NVR (name= diabaikan device, resolve tetap by-time).
  - Verified: source go2rtc kini `…/tracks/101?starttime=…&endtime=…&name=ch01_…&size=…`.
- **Catatan:** download rentang (1–60 mnt) bisa melintasi banyak klip pendek, jadi `name=` tunggal belum diterapkan ke download — menyusul bila diperlukan.

## Catatan
- Playback dari storage perangkat tetap memakai jalur yang sudah ada (source `'sd'`, `ContentMgmt/search` trackID 101 ke port ISAPI kamera). V-010 menambah **visibilitas** storage, menjadikan "cek IP camera" benar-benar mengecek HDD management, menjadikan playback-dari-storage sebagai **pilihan eksplisit** di dropdown, dan memperbaiki UX agar rekaman langsung terlihat.
- Untuk IP camera yang merekam ke **NAS**, search rekaman tetap via ISAPI kamera (source `'sd'`) — engine tidak perlu akses NAS langsung.
