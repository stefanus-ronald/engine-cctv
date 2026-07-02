# ENGINE-CCTV — Master Summary

> Ringkasan menyeluruh sistem **ENGINE-CCTV**: apa fungsinya, modul-modulnya, fitur, dan rujukan dokumen. Untuk teknologi lihat [TECH-STACK.md](./TECH-STACK.md); untuk alur lihat [APP-FLOW.md](./APP-FLOW.md).
> Terakhir diperbarui: 2 Jul 2026 (V-014: dukungan ONVIF multi-protokol — **live & events & deteksi kapabilitas tervalidasi di kamera ONVIF nyata**; PTZ & playback Profile-G siap, menunggu perangkat pendukung. **+ Hardening pasca-review**: retry-pull events, Renew, clock-offset auth, fix 2MB-hang, duplikat-instance exit bersih pada EADDRINUSE — lihat V-014 §16).
> Cara menjalankan (PC baru / dari ZIP): lihat [`../README.md`](../README.md).

---

## 1. Apa Itu ENGINE-CCTV

Server streaming CCTV terpadu (Node.js, tanpa framework) untuk kamera/recorder **Hikvision (ISAPI)** dan — sejak V-014 — kamera **ONVIF multi-merek** lewat lapisan driver (`cam.protocol: 'isapi' | 'onvif'`). Jalur video (go2rtc/FFmpeg/WebRTC/MJPEG/SSE) vendor-neutral; hanya kontrol perangkat yang per-protokol. Satu proses HTTP menggabungkan:

- **Live streaming** ke browser via **WebRTC** (go2rtc) dengan fallback **MJPEG** (FFmpeg).
- **Playback rekaman** dari NVR/DVR (timeline scrubber, unduh klip).
- **Deteksi/analitik** (motion, line-crossing, intrusion/loitering, face, dll.) via **ISAPI** + alert stream realtime, overlay di tile.
- **Manajemen kamera** (tambah IP camera tunggal atau **NVR/DVR → import semua channel**).
- **Grid multi-kamera** dengan layout, grup, fokus/fullscreen, snapshot, dll.

Target: dijalankan di LAN, diakses lewat browser. UI = single-page app vanilla JS.

---

## 2. Peta Modul (Backend `src/`)

| Modul | Peran |
|---|---|
| `server.js` | Bootstrap: load kamera → **auto-sync NVR** → start go2rtc → start ISAPI alert/probe → HTTP server → graceful shutdown |
| `router.js` | Semua route HTTP: API kamera, MJPEG, proxy WebRTC, SSE, deteksi, **playback**, **NVR scan/import**, static files |
| `config.js` | Konfigurasi dari env (`.env`) + load/save `cameras.json` + **load `nvrs.json`** |
| `camera-manager.js` | CRUD kamera, build URL RTSP (live & playback tracks), `getDeviceType`, **`replaceRecorderCameras`** |
| `nvr-sync.js` | **Auto-scan recorder di `nvrs.json` saat startup → bangun daftar kamera dari NVR (per-channel), dikelompokkan di bawah nama NVR** |
| `webrtc/go2rtc-manager.js` | Spawn & kelola proses go2rtc, daftarkan stream live |
| `webrtc/go2rtc-proxy.js` | Proxy signaling WebRTC (`/api/webrtc`, `/api/streams`) ke go2rtc |
| `webrtc/playback-stream.js` | Stream playback sementara via go2rtc `ffmpeg:<rtsp tracks>` (timestamped) |
| `mjpeg/mjpeg-manager.js` | Fallback MJPEG: spawn FFmpeg per kamera, multiplex ke klien |
| `isapi/digest-auth.js` | Digest Auth (RFC 2617) — dipakai semua request ISAPI |
| `isapi/alert-stream-manager.js` | Listener alert stream ISAPI (event deteksi realtime) |
| `isapi/capabilities-probe.js` | Probe kemampuan HW tiap kamera (motion/line/face/…) |
| `isapi/line-crossing-api.js` | Get/set konfigurasi deteksi: line, field, **motion/face enabled**, gambar garis |
| `isapi/sensitivity-api.js` | Get/set sensitivitas detektor |
| `isapi/playback-search.js` | Search rekaman (`ContentMgmt/search`, searchID GUID, UTC) |
| `isapi/playback-source.js` | Resolusi sumber playback: **NVR** (default) vs **SD** (pilihan eksplisit) |
| `isapi/nvr-channel-map.js` | Map IP→channel + **scan semua channel** NVR (onboarding) + **baca nama device NVR** (`getDeviceName`) |
| `isapi/storage-api.js` | **Cek HDD/SD/NAS management** (`ContentMgmt/Storage`) — kapasitas, sisa, status disk |
| `events/sse-broadcaster.js` | Push event ke browser via Server-Sent Events |
| `events/event-normalizer.js`, `event-dedup.js` | Normalisasi & dedup event deteksi |
| `vca/vca-proxy.js` | (Opsional) proxy ke layanan AI/VCA Python |
| `drivers/device-driver.js` | **(V-014)** Abstraksi driver multi-protokol: `getDriver(cam)`/`getProtocol(cam)` (default `isapi`) |
| `drivers/isapi-driver.js` | **(V-014)** Wrapper tipis atas modul `isapi/*` (perilaku Hikvision lama) |
| `drivers/onvif-driver.js` | **(V-014)** Driver ONVIF: discover, resolve stream, PTZ, Profile-G playback |
| `onvif/ws-security.js` | **(V-014)** WS-Security UsernameToken (digest SHA1) |
| `onvif/soap-client.js` | **(V-014)** Klien SOAP 1.2 (+ fallback HTTP Digest, WS-Addressing) |
| `onvif/ws-discovery.js` | **(V-014)** WS-Discovery multicast (auto-detect LAN) |
| `onvif/media.js` | **(V-014)** GetProfiles / GetStreamUri (onboarding live) |
| `onvif/events.js` + `onvif-event-manager.js` | **(V-014)** PullPoint subscription → SSE (event realtime) |
| `onvif/ptz.js` | **(V-014)** PTZ ContinuousMove/Stop |
| `onvif/replay.js` | **(V-014)** Recording Search + Replay (Profile G playback) |

## 3. Peta Frontend (`public/`)

| File | Peran |
|---|---|
| `index.html` | Shell UI: topbar, sidebar kamera, grid, modal settings (kamera/stream/display/analytics) |
| `js/app.js` | Inti SPA: grid/tile, sidebar, settings, **modal playback scrubber**, **form Add Camera/NVR**, overlay deteksi, analitik |
| `js/stream-adapter.js` | Koneksi stream per-tile (WebRTC↔MJPEG, transfer/reuse, indikator loading) |
| `css/style.css` | Seluruh styling |

---

## 4. Fitur Utama

### 4.1 Live Streaming
- WebRTC via go2rtc (utama), fallback MJPEG otomatis bila go2rtc 503/gagal.
- Reuse koneksi saat grid re-render (hindari renegosiasi).
- **Indikator loading** (spinner + progress) sampai frame pertama benar-benar tampil.

### 4.2 Playback Rekaman (lihat [RESEARCH/NVR-DVR_Playback](../../RESEARCH/NVR-DVR_Playback))
- **Timeline scrubber 24 jam** (ruang UTC agar cocok OSD kamera): klik/drag = seek.
- Sumber **NVR by default** (mapping IP→channel), atau **SD kamera** (pilihan eksplisit).
- **Unduh klip** rentang pilihan **1–60 menit** dengan progress nyata + Cancel.
- **Notifikasi ketersediaan (V-009):** ada rekaman → pilihan tampil + status hijau; tak ada sumber/rekaman → status merah/kuning **+ toast** agar terlihat.
- **Storage/HDD management (V-010):** modal playback menampilkan status penyimpanan perangkat (SD/HDD/NAS: kapasitas, sisa, kesehatan). Berlaku IP camera (microSD/NAS) & NVR (HDD).
- Backend: `ContentMgmt/search` → RTSP `Streaming/tracks` (go2rtc `ffmpeg:` source) / ffmpeg download (`-c:v copy -an -t`).

### 4.3 Onboarding NVR/DVR + Auto-sync (V-009)
- **Auto-sync saat startup:** tiap recorder di `nvrs.json` di-scan (`InputProxy/channels` + `deviceInfo`) → tiap channel jadi kamera, dikelompokkan di bawah **nama NVR asli**. Kamera IP standalone tetap tampil sebagai fallback (lokasi tanpa NVR). `host` bisa **LAN / IP publik / DDNS** (WAN: port-forward ISAPI+RTSP). Nonaktif via `NVR_AUTOSYNC=false`.
- Form Add Camera manual: **IP Camera** atau **NVR/Recorder** → **scan** → **import** per-channel.

### 4.4 Deteksi / Analitik
- Probe kapabilitas HW per kamera; alert stream realtime → toast + flash + overlay.
- **Alert hanya untuk kamera yang ada di grid (V-009):** deteksi untuk kamera yang belum di-drag ke tile tetap masuk activity log tapi **tanpa toast/flash**.
- Toggle on/off **disinkron ke kamera** (ISAPI PUT) dan **state asli dibaca** saat load.
- Line crossing: gambar garis + **arah panah** (A→B / B→A / A↔B); intrusion/loitering region.

### 4.5 Manajemen UI
- Grid presets, custom groups, focus/fullscreen, snapshot, keyboard shortcuts, activity log, notifications, persistensi layout (localStorage).

---

## 5. Keamanan & Keandalan (ringkas)

- **Auth token opsional** (`CCTV_API_TOKEN`) untuk endpoint mutasi (default off = LAN terbuka).
- Kredensial **diredaksi** dari log; static serving ber-**containment** anti path-traversal.
- Download playback: `-t` durasi + watchdog + kill-on-disconnect → **tak membocorkan sesi NVR**; deteksi `453`→`503`.
- `Cache-Control: no-cache` untuk `.js/.css/.html` agar UI selalu fresh.

Detail perbaikan & audit: [Implementasi-Feature/V-008-changelog.md](./Implementasi-Feature/V-008-changelog.md) · [V-009 (NVR auto-sync, alert per-grid, notif playback)](./Implementasi-Feature/V-009-changelog.md) · [V-010 (storage/HDD management)](./Implementasi-Feature/V-010-changelog.md) · [V-012 (input manual, dashboard UX)](./Implementasi-Feature/V-012-changelog.md) · [V-013 (hardening anti-crash/leak)](./Implementasi-Feature/V-013-changelog.md) · [**V-014 (dukungan ONVIF: driver + live + events + PTZ + playback)**](./Implementasi-Feature/V-014-onvif-design.md).

---

## 6. Indeks Dokumen

| Lokasi | Isi |
|---|---|
| [../README.md](../README.md) | **Cara menjalankan (PC baru / dari ZIP), prasyarat, troubleshooting** |
| [TECH-STACK.md](./TECH-STACK.md) | Stack teknologi & dependensi |
| [APP-FLOW.md](./APP-FLOW.md) | Alur aplikasi (startup, live, playback, deteksi, onboarding) |
| [Feature/](./Feature/) | Spesifikasi fitur UI (grid, sidebar, layout, dll.) |
| [Implementasi-Feature/](./Implementasi-Feature/) | Changelog & summary implementasi (V-001 … V-008) |
| [../../RESEARCH/NVR-DVR_Playback/](../../RESEARCH/NVR-DVR_Playback) | Riset & verifikasi playback NVR/DVR |
| [../../MASTER_SUMMARY_SAMPLEPROJECT/](../../MASTER_SUMMARY_SAMPLEPROJECT) | Referensi ISAPI/VCA proyek sampel |
