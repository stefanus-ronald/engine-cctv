# LightNVR — Ringkasan Teknis Mendalam

> Riset internal untuk Project Engine CCTV
> Sumber: [github.com/opensensor/lightNVR](https://github.com/opensensor/lightNVR) (branch utama, commit `2335e3f5`)
> Dibuat: 29 Juni 2026 · Lisensi repo: **GPLv3** (+ opsi commercial)
> Lihat presentasi visual: [index.html](index.html)

---

## Daftar Isi
1. [Apa itu LightNVR](#1-apa-itu-lightnvr)
2. [Skala project (terverifikasi)](#2-skala-project-terverifikasi)
3. [Arsitektur inti: go2rtc sebagai backbone](#3-arsitektur-inti-go2rtc-sebagai-backbone)
4. [Subsistem detection / AI](#4-subsistem-detection--ai)
5. [Database & retention](#5-database--retention)
6. [Web server & REST API](#6-web-server--rest-api)
7. [Build, deploy & lifecycle](#7-build-deploy--lifecycle)
8. [Pelajaran untuk engine CCTV kita](#8-pelajaran-untuk-engine-cctv-kita)
9. [Catatan lisensi](#9-catatan-lisensi)

---

## 1. Apa itu LightNVR

NVR (Network Video Recorder) open-source ditulis dalam **C**, dioptimalkan untuk perangkat hemat memori. Awalnya didesain untuk Ingenic A1 SoC (RAM 256MB) tapi jalan di Linux apa saja (ARM, x86, MIPS), kernel ≥ 4.4.

**Use case:** home security, small business, IoT/edge, DIY, warehouse/logistik.

**Fitur unggulan:**
- Detection zones (editor poligon visual)
- WebRTC sub-detik + HLS
- Object detection ONNX/TFLite/SOD
- ONVIF (discovery, motion, PTZ)
- MQTT → Home Assistant
- Retention berlapis + recording protected
- TOTP/MFA + RBAC

---

## 2. Skala project (terverifikasi)

| Metrik | Nilai |
|--------|-------|
| Baris kode C | ~128.000 (174 file `.c`) |
| Migrasi SQLite | **42** (0001–0042) — *docs menyebut 22, sudah outdated* |
| Subsistem `src/video/` | 63 file `.c` (terbesar) |
| Subsistem `src/web/` | 48 file `.c` |
| Subsistem `src/database/` | 19 file `.c` |
| go2rtc | submodule fork `opensensor/go2rtc` branch `dev` |

Struktur direktori:
```
src/core/      lifecycle, config, logger, shutdown, mqtt
src/video/     stream, go2rtc, hls, mp4, detection (terbesar)
src/database/  sqlite, migrations, CRUD
src/web/       libuv server + 48 API handler
src/storage/   retention, storage manager
src/telemetry/ metrics
web/           frontend Preact + Tailwind + Vite
db/migrations/ 42 file SQL
```

---

## 3. Arsitektur inti: go2rtc sebagai backbone

**Insight terpenting:** LightNVR **tidak** menyentuh kamera langsung. Semua I/O kamera didelegasikan ke **go2rtc** (proses Go terpisah).

```
Kamera (RTSP/ONVIF)
       │
       ▼
   ┌─────────┐   WebRTC ──▶ Browser (live, sub-detik)
   │ go2rtc  │   HLS    ──▶ LightNVR HLS Writer ──▶ segmen .ts
   │ :1984   │   RTSP   ──▶ LightNVR MP4 Recorder ──▶ file .mp4
   └─────────┘   frame.jpeg ──▶ Detection (JPEG snapshot)
       │
       ▼
   SQLite metadata ──▶ Storage /var/lib/lightnvr/data
```

### Manajemen proses go2rtc
| Aspek | Detail |
|-------|--------|
| Spawn | `fork` + `execl` (bukan `system()`), set `PR_SET_PDEATHSIG(SIGTERM)` |
| Binary discovery | path config → well-known → `$PATH`, verifikasi `--version` (timeout 2s) |
| Komunikasi | HTTP REST `localhost:1984/go2rtc/api/*` via libcurl |
| Health monitor | thread cek 30s: API responsive? + **stream consensus** (>50% gagal = go2rtc bermasalah) |
| Rate limit restart | cooldown 120s, max 5 restart / 10 menit |
| Quarantine | `override.yaml` bikin crash 3×/60s → auto rename `.quarantined`, restart tanpa override |

### Pola registrasi multi-source (penting)
Setiap stream didaftarkan dengan 3 source sekaligus:
```
Source 0: URL kamera asli
Source 1: ffmpeg audio transcode → OPUS   (WebRTC butuh OPUS, bukan AAC)
Source 2: ffmpeg video transcode → H.264  (browser tak support WebRTC H.265)
```

### Port penting
| Port | Fungsi |
|------|--------|
| 8080 | Web UI (HTTP) |
| 8554 | RTSP server (go2rtc) |
| 8555 | WebRTC (TCP + UDP) |
| 1984 | go2rtc REST API |

### Endpoint go2rtc yang dipakai
| Endpoint | Method | Tujuan |
|----------|--------|--------|
| `/go2rtc/api/streams` | PUT/GET/DELETE | register/list/unregister stream |
| `/go2rtc/api/frame.jpeg?src=X&cache=30s` | GET | snapshot JPEG untuk detection |
| `/go2rtc/api/preload?src=X&video` | PUT | start producer untuk HLS |
| `/go2rtc/webrtc/{name}` | HTTP upgrade | handshake WebRTC |

---

## 4. Subsistem detection / AI

**Model thread:** satu **unified detection thread per stream** dengan state machine:
```
INITIALIZING → CONNECTING → BUFFERING → RECORDING → POST_BUFFER → (kembali BUFFERING)
```

### 3 backend detection (switchable per stream)
| Backend | Kapan dipakai | Cara kerja |
|---------|--------------|-----------|
| **SOD** (embedded) | device kecil/offline | RealNet (face, ringan) / CNN (PASCAL VOC 20 class), linked ke binary |
| **TFLite/LiteRT** | in-process | conditional compile `-DHAVE_LITERT`, delegate XNNPACK |
| **HTTP API** (light-object-detect) | scalable | POST JPEG → terima JSON, pisahkan beban AI dari core |

### Kunci hemat memori
Detection mengambil **JPEG snapshot** dari go2rtc (`/api/frame.jpeg?src=X&cache=30s`), **bukan** decode full video. Param `cache=30s` bikin tetap dapat frame walau kamera sempat disconnect.

### Zone filtering
- Poligon koordinat **normalized 0.0–1.0**
- Algoritma **ray-casting** point-in-polygon
- Filter per-class (CSV: `"person,car,truck"`)
- Threshold confidence per-zona

### Pre-detection buffer
- Circular buffer AVPacket (`packet_buffer_t`)
- Rekam beberapa detik **sebelum** event
- Estimasi memori 1280×720@15fps, 5 detik ≈ **~1 MB/stream** (H.264 ~0.1 bpp)
- Saat deteksi terpicu → flush buffer ke MP4

### 4 strategi buffer (swappable)
`go2rtc-native` · `hls-segment` · `memory-packet` · `mmap`

### 4 mode recording
| `record` | `detection_based_recording` | Perilaku |
|----------|------------------------------|----------|
| false | false | tidak rekam |
| true | false | continuous saja (`trigger_type='scheduled'`) |
| false | true | detection-only (MP4 hanya saat ada deteksi) |
| true | true | **annotation mode** — continuous + deteksi di-link via `recording_id` |

---

## 5. Database & retention

### Sistem migrasi
- 42 file SQL versioned di `db/migrations/`
- Dual-mode (kompatibel skema lama integer + filename baru)
- Discovery: env `LIGHTNVR_MIGRATIONS_DIR` → lokal `./db/migrations` → `/usr/share/lightnvr/migrations`
- Strategi aman: `ALTER TABLE ADD COLUMN` dengan default (backward compatible), tanpa `DROP COLUMN`

### Tabel utama
`streams` · `recordings` · `detections` · `detection_zones` · `users` · `sessions` · `motion_settings` · `motion_recording_config` · `motion_recordings` · `storage_daily_stats` · `events` · `system_settings` · `recording_tags`

### Retention berlapis 4 tier (desain matang)
| Tier | Multiplier default | Contoh (base 30 hari) |
|------|-------------------|----------------------|
| Critical | 3.0× | 90 hari |
| Important | 2.0× | 60 hari |
| Standard | 1.0× | 30 hari |
| Ephemeral | 0.25× | 7,5 hari |

**Prioritas penghapusan:** regular → detection (disimpan lebih lama) → **protected (tak pernah auto-delete)** + per-recording `retention_override_days`.

### Optimasi penting
- **Storage stats anti-blocking:** SQL aggregate `SUM(size_bytes)` bukan subprocess `du` → O(1) per stream
- **Recording sync thread:** hanya sync recording `size_bytes=0` yang complete (tidak scan 100k+ row)
- **Transaction pattern:** `begin_transaction()` hold mutex, `commit/rollback` unlock — cegah interleaving

---

## 6. Web server & REST API

### HTTP server
- **libuv + llhttp** (migrasi dari Mongoose di v0.20)
- Event loop di thread khusus, handler di-offload ke **thread pool** (default 2× CPU core, clamp [2,128])
- Konfigurasi `web_thread_pool_size` / env `UV_THREADPOOL_SIZE`
- Graceful shutdown + health check thread (recovery kalau event loop mati)

### API: 60+ endpoint per resource
streams · recordings · timeline · detection · zones · PTZ · ONVIF · system · settings · users · TOTP · health · ice-servers · metrics · go2rtc-proxy

### Autentikasi
| Mekanisme | Cara |
|-----------|------|
| Session cookie | login → token di HTTP-only cookie (default 24 jam) |
| API key | header `X-API-Key` atau `Authorization: Bearer` |
| HTTP Basic | `curl -u user:pass` |
| TOTP/MFA | RFC 6238, HMAC-SHA1 via mbedTLS, QR code setup |

- RBAC: admin / user / api / viewer
- Rate limit login: 5× gagal / 15 menit per-username

### Gotcha proxy WebRTC (PENTING)
Proxy internal LightNVR **hanya HTTP** (HLS/snapshot). MSE & WebRTC butuh **WebSocket** → reverse proxy harus route `/go2rtc/*` **langsung** ke port 1984, bukan lewat LightNVR.

### Frontend
- Preact + Tailwind + Vite, multi-page (9 entry HTML)
- @tanstack/query untuk caching
- 3 mode playback: WebRTC (~1–3s) · MSE (~2–4s) · HLS (~6–10s)

---

## 7. Build, deploy & lifecycle

### Dependencies
**Wajib:** FFmpeg (libav* ≥61), SQLite3, libcurl, libuv, llhttp, cJSON, **mbedTLS** (wajib untuk ONVIF/auth walau SSL opsional), pthread
**Opsional:** libyaml (validasi go2rtc), libmosquitto (MQTT), SOD, LiteRT

### Build flags utama
```bash
-DENABLE_SOD=ON          # object detection embedded
-DENABLE_LITERT=ON       # TFLite in-process (auto-off kalau submodule kosong)
-DENABLE_GO2RTC=ON       # streaming backbone
-DENABLE_MQTT=ON         # auto-off kalau libmosquitto tak ada
-DENABLE_SSL=OFF         # default; mbedTLS tetap dipakai untuk crypto
```

### Docker
- Multi-stage (builder Debian sid → runtime minimal)
- go2rtc dibuild `CGO_ENABLED=0` → static binary
- ⚠️ **Jangan** mount `/var/lib/lightnvr` langsung — menimpa web assets; mount `/var/lib/lightnvr/data`

### Shutdown coordinator (pola bagus)
Shutdown berurutan by-priority:
```
Detection thread → HLS writer → MP4 writer → Server thread → go2rtc
```
Pakai atomic + condition variable. Signal handler hanya pakai fungsi async-signal-safe.

### Thread model (15–30 thread)
main · web (libuv pool) · go2rtc monitor · per-stream RTSP · HLS unified · MP4 recorder · detection · ONVIF · MQTT (3 thread) · storage · telemetry · health · schedule monitor

### Gotcha menarik yang mereka temukan & fix
- Disable Transparent Huge Pages (`PR_SET_THP_DISABLE`) → cegah RSS membengkak
- Jangan `chdir()` di daemon mode → bikin SQLite locking rusak di Linux 4.4
- XNNPACK assembly kernel korup multi-thread cortex_a53 → dipaksa NEON intrinsic portable
- Verifikasi `/proc/<pid>/comm` sebelum kill PID lama → cegah salah bunuh proses saat container restart

---

## 7b. Engine CCTV kita vs LightNVR + roadmap implementasi

**Kabar baik:** ENGINE-CCTV kita **sudah memakai backbone yang sama** (go2rtc + FFmpeg). Banyak pola LightNVR bisa diadopsi tanpa ganti fondasi.

### Perbandingan
| Aspek | 🟢 ENGINE-CCTV (kita) | 🔵 LightNVR |
|-------|----------------------|-------------|
| Bahasa | Node.js (zero-build) | C (~128k baris) |
| Lisensi | **MIT** (bebas komersial) | GPLv3 |
| Streaming backbone | **go2rtc ✅ (sama!)** | go2rtc ✅ |
| Fallback live | MJPEG (FFmpeg) | HLS |
| Target kamera | Hikvision (ISAPI mendalam) | Generic RTSP/ONVIF |
| Deteksi | Hardware kamera (ISAPI) | AI on-frame (SOD/TFLite/API) + zona + ONVIF |
| Recording | Tidak rekam — andalkan NVR | Rekam MP4/HLS sendiri |
| Playback | Dari NVR langsung (ISAPI ContentMgmt) | Dari rekaman sendiri |
| Database | File JSON | SQLite (42 migrasi) |
| Frontend | Vanilla JS SPA | Preact + Tailwind |
| Auth | Token opsional | Session + TOTP + RBAC |
| Zona deteksi | ❌ Belum ada | ✅ Editor poligon |
| MQTT/Home Assistant | ❌ Belum ada | ✅ Ada |
| Target perangkat | Desktop/server LAN | Embedded 256MB+ |

### Kekuatan kita (pertahankan)
- **ISAPI mendalam** — line-crossing arah panah, sensitivity, capabilities probe (LightNVR tak punya)
- **NVR auto-sync** — import semua channel otomatis
- **Playback dari NVR** — tidak rekam ulang, hemat storage besar
- **MIT + Node.js** — bebas komersial, mudah dikembangkan/diaudit

### Roadmap adopsi (nilai vs effort) — meniru POLA, bukan kode GPLv3

**① AI Object Detection on-frame — PRIORITAS TINGGI, effort rendah**
Deteksi kita sekarang 100% hardware kamera (ISAPI). Tambah deteksi AI server-side. Fondasi sudah ada semua:
```
go2rtc /api/frame.jpeg?src=ID&cache=30s  →  JPEG (tanpa decode video penuh)
   → POST ke layanan AI Python (kita SUDAH punya vca-proxy.js)
   → SSE broadcaster → overlay bbox di tile (kita SUDAH punya SSE + overlay)
```
Cara: modul baru `src/detection/ai-detection.js` → snapshot go2rtc → `vca/vca-proxy.js` → `events/sse-broadcaster.js`.

**② Zona Deteksi Poligon — PRIORITAS TINGGI, effort sedang**
Filter deteksi per-area (kurangi false positive). Simpan poligon normalized 0–1 per kamera di `cameras.json` field `detection.zones[]`. Filter pakai **ray-casting** point-in-polygon (pola `zone_filter.c`). Editor: canvas overlay di settings modal `public/js/app.js`.

**③ MQTT → Home Assistant — PRIORITAS SEDANG, effort rendah**
Tambah npm `mqtt`, modul `src/integrations/mqtt-client.js`. Publish event (ISAPI + AI) ke topic `cctv/{camera}/detection` + HA auto-discovery + motion timeout 30s.

**④ Recording Independen + Retention 4-Tier — OPSIONAL, effort tinggi**
Hanya jika butuh rekaman tidak bergantung NVR. Rekam dari `rtsp://localhost:8554/ID` via FFmpeg `-c copy` ke MP4 tersegmen. Adopsi pre-detection buffer + retention 4-tier + protected. Butuh SQLite untuk index.

**⑤ Hardening (saat scale naik):** SQLite ganti JSON · TOTP/MFA + RBAC · health monitor consensus (restart go2rtc bila >50% stream gagal, cooldown 120s).

> **Ringkas:** Item ① & ② memberi lompatan fitur terbesar (AI cerdas + zona) dan bisa cepat karena fondasi (go2rtc + SSE + vca-proxy) sudah ada. Item ④ hanya kalau strategi storage berubah dari "andalkan NVR" ke "rekam sendiri".

---

## 8. Pelajaran untuk engine CCTV kita

### ✅ Layak diadopsi
1. **Pola "go2rtc sebagai backbone"** — jangan reinvent RTSP/WebRTC/ICE. Keputusan arsitektur terbaik mereka.
2. **Detection via HTTP API eksternal** — pisahkan beban AI dari core, mudah scaling/ganti model.
3. **JPEG snapshot untuk detection** (bukan decode video) — hemat memori & CPU drastis.
4. **Skema DB + retention 4 tier** — blueprint matang, langsung bisa jadi referensi tabel kita.
5. **Shutdown coordinator + multi-source registration** — pola produksi teruji.

### ⚠️ Perlu diwaspadai
1. **Lisensi GPLv3** — aman untuk belajar pola, TIDAK aman copy-paste kode ke produk proprietary.
2. **Codebase C low-level** — manual thread/mutex/FFmpeg → maintenance berat.
3. **Fokus embedded 256MB** — beberapa optimasi kurang relevan kalau target server besar / banyak kamera.

---

## 9. Catatan lisensi

**GPLv3 + opsi Commercial License (OpenSensor Engineering).**

- ✅ **Aman:** mempelajari arsitektur, pola desain, ide implementasi.
- ❌ **Tidak aman:** menyalin/menurunkan kode LightNVR ke produk proprietary/tertutup tanpa commercial license.

**Rekomendasi:** kalau engine CCTV kita mau closed-source, replikasi *ide & pola*-nya — jangan *kode*-nya. **go2rtc sendiri berlisensi MIT** (lebih permisif) sehingga aman dipakai sebagai backbone.

---

## Dokumentasi penting di repo (worth dibaca)
`docs/ARCHITECTURE.md` · `docs/GO2RTC_INTEGRATION.md` · `docs/ZONE_CONFIGURATION.md` · `docs/MOTION_BUFFER.md` · `docs/PRE_DETECTION_BUFFER_IMPLEMENTATION.md` · `docs/SOD_INTEGRATION.md` · `docs/API.md` · `docs/PRD_Recording_Retention_Policies.md` · `docs/REVERSE_PROXY.md` · `docs/MQTT_INTEGRATION.md`
