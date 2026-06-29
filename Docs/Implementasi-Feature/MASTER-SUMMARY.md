# ENGINE-CCTV — Master Summary Implementasi

**Tanggal:** 17 Juni 2026
**Stack:** Node.js + go2rtc + Hikvision ISAPI
**Kamera:** 6 unit (5 Hikvision + 1 Dahua via NVR)

---

## Versi Implementasi

### V-001 — Protocol Badge & Hardware Support Label
Menampilkan badge protokol streaming (WebRTC/MJPEG) dan quality (SUB/MAIN) di top bar. Menambahkan label hardware support per detector di deep dive panel (HW/SW), disable Edge option jika hardware tidak support.

### V-002 — Real ISAPI Alert Stream Detection
Koneksi persistent ke ISAPI alertStream tiap kamera menggunakan Digest Auth. Parse XML event Hikvision, normalize ke format unified, dedup (10s window), broadcast ke browser via SSE real-time. Termasuk Python VCA proxy (opsional, default off).

### V-003 — Real Hardware Capabilities Probe
Auto-probe ISAPI Smart endpoint tiap kamera saat startup untuk deteksi fitur hardware yang didukung. Mengganti simulasi hash acak dengan data real. Fallback untuk NVR/Dahua yang return 403. Data cameras.json disesuaikan per spek model kamera.

### V-004 — Dynamic VMD Sensitivity + Activity Log
Slider UI di deep dive panel untuk atur sensitivity detector (motion, line, loitering) langsung ke kamera via ISAPI GET-Modify-PUT pattern. Detection events dari ISAPI sekarang selalu muncul di activity log tanpa harus setup analytics wizard.

### V-005 — hwCapabilities Fix + SSE Notification
Fix bug hwCapabilities tidak sampai ke frontend (field tidak di-mapping di `loadCamerasFromAPI()`). Tambah SSE broadcast `capabilities-updated` saat probe selesai agar browser yang load sebelum probe otomatis refresh.

### V-006 — Line Crossing & Intrusion Region Overlay
Fetch konfigurasi line crossing dan intrusion region dari kamera via ISAPI, render sebagai SVG overlay di tile video. Garis yang dibuat di web UI Hikvision sekarang muncul di ENGINE-CCTV. Toggle per-tile, auto-refresh saat re-probe.

### V-007 — Region Entrance / Region Exit Detection *(Planned)*
Tambah probe + event normalization + overlay untuk Region Entrance (`regionIn`) dan Region Exit (`regionOut`). Dipicu oleh rekonsiliasi datasheet: 5 dari 9 kamera kandidat baru mendukung fitur ini. Overlay 4 warna: cyan (line) + orange (intrusion) + **green (entrance)** + **red (exit)**. Zero breaking changes untuk 6 kamera existing.

### V-008 — Playback Scrubber, Onboarding NVR/DVR & Detection Fixes
Timeline-scrubber playback 24 jam (klik/drag=seek, playhead realtime, zoom) + fix timezone (axis UTC). Onboarding NVR/DVR: scan channel asli (`/api/nvr/channels`) + import per-channel (`/api/nvr/import`); pilihan sumber playback NVR vs SD eksplisit. Perbaikan deteksi (state asli motion/face, arah panah line, anti-leak sesi NVR) + indikator loading tile + 10 temuan audit kode. Lihat `V-008-summary.md`.

### V-009 — Daftar Kamera dari NVR (auto-sync), Alert per-Grid & Notifikasi Playback
Daftar kamera dibangun **dari NVR** saat startup (`nvrs.json` → scan `InputProxy/channels` + `deviceInfo`), dikelompokkan di bawah nama NVR asli; kamera IP standalone tetap tampil sebagai fallback. NVR bisa via LAN/IP publik/DDNS. Alert deteksi hanya muncul untuk kamera yang sudah di-drag ke grid. Notifikasi jelas saat kamera tidak punya rekaman/playback. Fix label sumber playback (nama NVR asli) + fix `deviceType` hilang di frontend. Verified live: NVR `Kantor JMP-NVR`, 16 channel. Lihat `V-009-summary.md`.

### V-010 — Storage / HDD Management & Playback dari Penyimpanan Perangkat
Cek **HDD/SD/NAS management** perangkat via `GET /ISAPI/ContentMgmt/Storage` (`storage-api.js`) — berlaku untuk IP camera (microSD/NAS) maupun NVR/DVR (HDD). Status penyimpanan tampil di modal playback; **Test Connection IP camera kini nyata** (cek HDD management, bukan mock). Endpoint baru `GET /api/cameras/:id/storage` + `POST /api/storage/check`. Verified live: IP cam rekam ke NAS, NVR HDD SATA ~932 GB. Lihat `V-010-summary.md`.

---

## Kamera & Capabilities (Probe Results)

| Kamera | Model | IP | ISAPI | Motion | Line | Loiter | Face |
|--------|-------|----|-------|--------|------|--------|------|
| Parkiran | DS-2CD2042WD-I | 192.168.1.195:85 | OK | HW | HW | HW | - |
| Lantai 3 | DS-2CD2420F-I | 192.168.1.188:80 | OK | HW | HW | HW | - |
| R. Kreatif | DS-2CD2120F-I | 192.168.1.86:8086 | OK | HW | HW | HW | - |
| PTZ LT.1 | DS-2DF8236IV-AEL | 192.168.1.186:88 | OK | HW | HW | HW | HW |
| Pintu Depan | Dahua (NVR ch6) | 192.168.1.181:81 | 403* | HW | HW | - | - |
| Ruang Dev 1 | DS-2CD2120F-I | 192.168.1.185:8080 | OK | HW | HW | HW | - |

*\* NVR return 403 untuk Smart endpoint — fallback ke detection.events config*

---

## Fitur Native Kamera vs ENGINE-CCTV

Setiap model kamera punya fitur VCA bawaan firmware yang berbeda-beda. ENGINE-CCTV menggunakan pendekatan **model-agnostic** — probe ISAPI endpoint secara dinamis, tidak perlu database per-model.

| Fitur | DS-2CD2042WD-I | DS-2CD2420F-I | DS-2CD2120F-I | DS-2DF8236IV-AEL | ENGINE-CCTV |
|-------|:-:|:-:|:-:|:-:|:-:|
| | *Parkiran* | *Lantai 3* | *R. Kreatif* | *PTZ LT.1* | |
| **Motion Detection** | HW | HW | HW | HW | **Probe + Event** |
| **Line Crossing** | HW | HW | HW | HW | **Probe + Event** |
| **Intrusion (Field)** | HW | HW | HW | HW | **Probe + Event** |
| **Face Detection** | HW (basic) | HW | - | HW | **Probe + Event** |
| **Vehicle Detection** | - | - | - | - | **Probe (none)** |
| Audio Exception | HW | HW | - | HW | Belum |
| Tampering Alarm | HW | HW | HW | HW | Belum |
| Scene Change | HW | HW | - | - | Belum |
| Defocus Detection | HW | HW | - | - | Belum |
| Region Entrance | - | HW | - | HW | Belum |
| Region Exit | - | HW | - | HW | Belum |
| Unattended Baggage | - | HW | - | HW | Belum |
| Object Removal | - | HW | - | HW | Belum |
| Smart Tracking (PTZ) | - | - | - | HW | Belum |
| Heat Map | - | HW | - | - | Belum |
| Dynamic Analysis | HW | HW | HW | HW | Belum |

> Detail lengkap per model: lihat [15-camera-hardware-features.md](../Feature/15-camera-hardware-features.md)

---

## Hardware Baru — Datasheet 2025-2026

Berdasarkan 21 datasheet produk yang diterima, berikut adalah lineup kamera dan NVR baru yang kompatibel dengan ENGINE-CCTV.

### Kamera Baru (9 model)

| Model | Tipe | Smart Events | Deep Learning | API |
|-------|------|-------------|--------------|-----|
| DS-2CD1T47G3-LIUF | 4MP ColorVu Bullet | **Tidak ada** | - | ONVIF S/G, ISAPI |
| DS-2CD23127G3P-LIS2UY | 12MP Panoramic Turret | Line, Intrusion, RegionIn/Out | Face Capture, Perimeter | ONVIF S/G/T, ISAPI, ISUP |
| DS-2CD23167G3P-LIS2UY | 16MP Panoramic Turret | Line, Intrusion, RegionIn/Out | Face Capture, Perimeter | ONVIF S/G/T, ISAPI, ISUP |
| DS-2CD2387G3P-LIS2UY | 8MP Panoramic Turret | Line, Intrusion, RegionIn/Out | Face Capture, Perimeter | ONVIF S/G/T, ISAPI, ISUP |
| DS-2CD2T127G3P-LIS2UY | 12MP Panoramic Bullet | Line, Intrusion, RegionIn/Out | Face Capture, Perimeter | ONVIF S/G/T, ISAPI, ISUP |
| DS-2CD2T167G3P-LIS2UY | 16MP Panoramic Bullet | Line, Intrusion, RegionIn/Out | Face Capture, Perimeter | ONVIF S/G/T, ISAPI, ISUP |
| DS-2CD3041G2E-LIU | 4MP DualLight Bullet | Line, Intrusion | - | ONVIF S/G, ISAPI |
| DS-2CD2546G2-IWS-C | 4MP AcuSense Dome (WiFi) | Line, Intrusion, RegionIn/Out, SceneChange | Face Capture, Perimeter | ONVIF S/G/T, ISAPI |
| DS-2SE4C425MWG-E/14 | TandemVu 4+4MP PTZ | Line, Intrusion, RegionIn/Out, AudioException | Face Capture, People Counting | ONVIF S/G/T, ISAPI, ISUP |

### NVR Baru (11 model — VPro AcuSeek Series)

K1: DS-7604NXI-K1, DS-7604NXI-K1/4P, DS-7608NXI-K1/8P, DS-7616NXI-K1
K2: DS-7608NXI-K2, DS-7608NXI-K2/8P, DS-7616NXI-K2, DS-7616NXI-K2/16P, DS-7632NXI-K2/16P
K4: DS-7716NXI-K4/16P, DS-7732NXI-K4/16P

Semua NVR VPro: AI by NVR (perimeter protection, motion 2.0, face recognition, AcuSeek), ISUP support.

### Impact terhadap ENGINE-CCTV

- **Kamera G3P Panoramic** (5 model): Region Entrance + Region Exit tersedia via ISAPI — **fitur ini perlu di-probe** di V-007 mendatang
- **DS-2CD1T47G3-LIUF**: Tidak ada Smart Events → ENGINE-CCTV probe 404 → label SW only — **behavior sudah benar tanpa perubahan**
- **NVR VPro**: Jika kamera AcuSense terhubung ke NVR, ISAPI Smart tersedia via proxy NVR — kompatibel dengan pattern yang sudah ada
- Semua kamera baru mendukung ISAPI — model-agnostic probe ENGINE-CCTV bekerja tanpa perubahan kode

> Detail lengkap: [16-hardware-catalog.md](../Feature/16-hardware-catalog.md)

---

## Arsitektur Detection Pipeline

```
Kamera (ISAPI alertStream)       Python VCA (Optional)
        |                               |
        v                               v
  alert-stream-manager           vca-proxy
  (Digest Auth + XML)            (snapshot -> AI)
        |                               |
        +---------------+---------------+
                        |
                 event-normalizer
                (raw -> unified format)
                        |
                  event-dedup
                 (10s window)
                        |
                sse-broadcaster
               (SSE -> browser)
                        |
                    app.js
              fireAnalyticsEvent()
                        |
              +---------+---------+
              |         |         |
           Toast     Tile      Activity
           notif     flash       Log
```

---

## API Endpoints

| Method | Path | Fungsi | Versi |
|--------|------|--------|-------|
| GET | `/api/detection/status` | Status koneksi ISAPI per kamera | V-002 |
| POST | `/api/detection/reconnect/:id` | Force reconnect satu kamera | V-002 |
| POST | `/api/detection/probe` | Re-probe capabilities semua kamera | V-003 |
| GET | `/api/detection/sensitivity/:id` | Get sensitivity semua detector | V-004 |
| PUT | `/api/detection/sensitivity/:id` | Set sensitivity satu detector | V-004 |
| GET | `/api/detection/lines/:id` | Get line crossing + region config | V-006 |
| POST | `/api/nvr/channels` · `/api/nvr/import` | Scan & import channel NVR | V-008 |
| GET | `/api/cameras/:id/storage` | Status HDD/SD/NAS kamera | V-010 |
| POST | `/api/storage/check` | Cek storage by-credential (Add Camera) | V-010 |

---

## Files

### Dibuat (12 modul)
| File | Fungsi | Versi |
|------|--------|-------|
| `src/isapi/digest-auth.js` | HTTP Digest Authentication | V-002 |
| `src/isapi/xml-parser.js` | ISAPI XML event parser | V-002 |
| `src/isapi/alert-stream-manager.js` | Persistent alert stream koneksi | V-002 |
| `src/isapi/capabilities-probe.js` | Auto-probe HW capabilities | V-003 |
| `src/isapi/sensitivity-api.js` | GET/PUT sensitivity via ISAPI | V-004 |
| `src/isapi/line-crossing-api.js` | Fetch line/region config via ISAPI | V-006 |
| `src/events/event-normalizer.js` | Raw event → unified format | V-002 |
| `src/events/event-dedup.js` | Server-side dedup (10s) | V-002 |
| `src/vca/vca-proxy.js` | Python VCA proxy (optional) | V-002 |
| `src/isapi/{playback-search,playback-source}.js` | Search rekaman + resolusi sumber NVR/SD | V-008 |
| `src/webrtc/playback-stream.js` | Stream playback via go2rtc `ffmpeg:` | V-008 |
| `src/nvr-sync.js` | Auto-scan NVR → bangun daftar kamera dari recorder | V-009 |
| `src/isapi/storage-api.js` | Cek HDD/SD/NAS management (`ContentMgmt/Storage`) | V-010 |

### Konfigurasi baru
| File | Fungsi | Versi |
|------|--------|-------|
| `nvrs.json` | Registry NVR/DVR untuk auto-sync (host LAN/publik/DDNS) | V-009 |
| `README.md` | Panduan jalankan di PC baru / dari ZIP | V-009 |

### Dimodifikasi (7 file)
| File | Perubahan |
|------|-----------|
| `cameras.json` | isapiPort, detection events, model-specific config |
| `src/config.js` | ISAPI + VCA config variables |
| `src/camera-manager.js` | hwCapabilities, findByIpAndChannel, **replaceRecorderCameras + passthrough recorder (V-009)** |
| `src/config.js` | ISAPI/VCA config, **loadNvrs + nvrAutoSync (V-009)** |
| `src/server.js` | ISAPI init, probe, graceful shutdown, **NVR auto-sync saat startup (V-009)** |
| `src/router.js` | detection API endpoints, **NVR scan/import + playback (V-008)** |
| `src/isapi/nvr-channel-map.js` | scan channel NVR (V-008), **getDeviceName (V-009)** |
| `src/isapi/playback-source.js` | resolusi NVR/SD (V-008), **label nama NVR asli (V-009)** |
| `public/js/app.js` | Deep dive UI, sensitivity, activity log, SSE, line overlay, **deviceType/recorder passthrough, alert per-grid, notif playback (V-009)** |
| `public/css/style.css` | Slider + badge + overlay, **status playback berwarna (V-009)** |

---

## Bug Fixes (10 total)

| Bug | Versi |
|-----|-------|
| Map mutation saat iterasi | V-002 |
| NaN timestamp crash | V-002 |
| Race condition reconnectCamera | V-002 |
| Detection saat disabled | V-002 |
| Log spam filter | V-002 |
| Undeclared variable di probe filter | V-003 |
| Missing res.on('error') handler | V-003 |
| Double JSON.parse di PUT handler | V-004 |
| hwCapabilities tidak di-mapping di frontend | V-005 |
| Race condition: browser load sebelum probe selesai | V-005 |
| isapiPort tidak di-mapping di frontend → sensitivity slider tidak muncul | V-006 |
| Overlay tidak render jika rule `enabled=false` meski koordinat ada | V-006 |
| `deviceType` hardcode `'ipcamera'` di frontend → badge NVR/DVR tak pernah muncul | V-009 |
| Label sumber playback pakai nama channel, bukan nama NVR | V-009 |
| Alert deteksi muncul untuk kamera yang belum di grid | V-009 |
