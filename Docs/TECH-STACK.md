# ENGINE-CCTV — Tech Stack

> Teknologi, dependensi, dan keputusan desain. Lihat juga [00-MASTER-SUMMARY.md](./00-MASTER-SUMMARY.md) & [APP-FLOW.md](./APP-FLOW.md).

---

## 1. Ringkasan

| Lapisan | Teknologi |
|---|---|
| Runtime | **Node.js** (CommonJS) |
| HTTP server | Node `http` **murni** (tanpa Express/framework) |
| Dependensi npm | **`dotenv`** saja (lihat `package.json`) |
| WebRTC | **go2rtc** (binary eksternal, `bin/go2rtc.exe`) |
| Transcoding/stream | **FFmpeg** (binary eksternal) — MJPEG & download playback |
| Kamera/Recorder | **Hikvision ISAPI** (HTTP+XML, Digest Auth) + **ONVIF** (SOAP/XML, WS-Security — V-014) + **RTSP** |
| Realtime ke browser | **Server-Sent Events (SSE)** untuk event; **WebRTC/MJPEG** untuk video |
| Frontend | **Vanilla JS** (tanpa framework/bundler) + CSS murni |
| Penyimpanan | **`cameras.json`** (file) + **localStorage** (preferensi UI) |
| AI/VCA (opsional) | Proxy ke layanan **Python** eksternal |

> Filosofi: **zero-framework, zero-build**. Tidak ada bundler, transpiler, atau dependensi berat. Mudah dijalankan & diaudit.
>
> **Multi-protokol (V-014):** kontrol perangkat di balik lapisan driver (`src/drivers/`), tiap kamera `protocol: 'isapi' | 'onvif' | 'rtsp'` (default `isapi`). ONVIF (WS-Discovery, Media/Events/PTZ/Profile-G) **hand-rolled SOAP** — tetap zero-dep (hanya `dotenv`). Video (go2rtc/FFmpeg) tak berubah: vendor-neutral.

---

## 2. Backend

- **Bahasa:** JavaScript (Node.js, CommonJS `require`).
- **Server:** `http.createServer(handleRequest)` — satu handler router manual (pattern-match `pathname`+`method`).
- **Tanpa framework** (no Express): routing, body-parse, static-serve, CORS, SSE semuanya manual di `router.js`.
- **Proses anak (child_process `spawn`):**
  - **go2rtc** — engine WebRTC; menarik RTSP kamera → WebRTC ke browser. API lokal (default `:1984`), media `:8555`.
  - **FFmpeg** — (a) MJPEG live fallback; (b) download playback (`-rtsp_transport tcp -i <rtsp tracks> -t <durasi> -map 0:v:0 -c:v copy -an -f mp4 pipe:1`).
- **ISAPI client:** `http` + **Digest Auth** (`isapi/digest-auth.js`), parsing XML via regex (konsisten, tanpa lib XML).
- **Konfigurasi:** `.env` (via `dotenv`) → `config.js`. Variabel kunci: `PORT`, `GO2RTC_*`, `FFMPEG_BIN`, `ISAPI_ENABLED`, `VCA_*`, `CCTV_API_TOKEN`.

### Dependensi runtime eksternal
| Binary | Wajib? | Fungsi |
|---|---|---|
| `go2rtc` | Direkomendasikan | WebRTC live + playback stream; tanpa ini → mode MJPEG-only |
| `ffmpeg` | Ya (untuk MJPEG & download) | Transcode/copy stream |

---

## 3. Frontend

- **Vanilla JS** (satu file besar `app.js` + `stream-adapter.js`), tanpa modul/bundler — di-load via `<script defer>`.
- **WebRTC:** `RTCPeerConnection` langsung; SDP offer → `POST /api/webrtc?src=<id>` → answer dari go2rtc.
- **MJPEG:** `<img src="/mjpeg/<id>">`.
- **SSE:** `EventSource('/api/events')` untuk event deteksi realtime.
- **Overlay deteksi:** SVG digambar di atas tile (line/region/arah panah), koordinat ruang Hikvision 0–1000 (Y dibalik).
- **Persistensi UI:** `localStorage` (layout, grup, preferensi analitik).
- **Render:** manipulasi DOM langsung (innerHTML + elemen), tanpa virtual DOM.

---

## 4. Protokol & Format

| Hal | Detail |
|---|---|
| ISAPI Auth | Digest (RFC 2617), realm-tolerant |
| Search rekaman | `POST /ISAPI/ContentMgmt/search`, body `CMSearchDescription`, **searchID = GUID**, waktu **UTC (Z)** |
| RTSP playback | `rtsp://…/Streaming/tracks/<ch*100+1>?starttime=&endtime=` (compact UTC) |
| RTSP live | `rtsp://…/Streaming/Channels/<ch>01` |
| Channel list NVR | `GET /ISAPI/ContentMgmt/InputProxy/channels` |
| ONVIF auth (V-014) | WS-Security UsernameToken (`Base64(SHA1(nonce+created+pass))`) + fallback HTTP Digest + **clock-offset otomatis** via GetSystemDateAndTime utk device dgn jam meleset (V-014 §16) |
| ONVIF discovery (V-014) | WS-Discovery Probe → UDP multicast `239.255.255.250:3702` |
| ONVIF live (V-014) | Media `GetProfiles` + `GetStreamUri` → RTSP (kredensial disuntik saat build) |
| ONVIF events (V-014) | Events `CreatePullPointSubscription` + `PullMessages` → normalisasi → SSE; retry-pull 2× di subscription sama + `Renew` periodik 30s (§16) |
| ONVIF PTZ / playback (V-014) | PTZ `ContinuousMove`/`Stop`; Profile-G `GetRecordingSummary`/`GetReplayUri` |
| Motion/Face enabled | `…/motionDetection`, `/ISAPI/Smart/FaceDetect/<ch>` |
| Event push | SSE (`text/event-stream`) |

---

## 5. Catatan go2rtc (penting)

- Reader RTSP internal go2rtc **mengabaikan** `starttime/endtime` → playback memakai **source `ffmpeg:`** (`ffmpeg:<url>#input=rtsp#video=copy`).
- `#input=rtsp` memaksa **RTSP-over-TCP** (UDP ditolak banyak IP cam); `#video=copy` **tanpa audio** (channel NVR sering tanpa audio → muxer gagal bila audio diikutkan).

---

## 6. Struktur Folder (ringkas)

```
ENGINE-CCTV/
├─ src/                 # backend Node.js
│  ├─ server.js         # bootstrap
│  ├─ router.js         # semua route HTTP
│  ├─ config.js, camera-manager.js
│  ├─ drivers/          # (V-014) device-driver (abstraksi), isapi-driver, onvif-driver
│  ├─ webrtc/           # go2rtc manager/proxy, playback-stream (+ startPlaybackFromUrl)
│  ├─ mjpeg/            # MJPEG fallback
│  ├─ isapi/            # digest-auth, alert-stream, probe, line/sensitivity, playback-*, nvr-channel-map
│  ├─ onvif/            # (V-014) ws-security, soap-client, ws-discovery, media, events, ptz, replay
│  ├─ events/           # SSE, normalizer, dedup
│  └─ vca/              # proxy AI/VCA (opsional)
├─ public/              # frontend (index.html, js/app.js, js/stream-adapter.js, css/style.css)
├─ bin/                 # go2rtc.exe
├─ cameras.json         # konfigurasi kamera
├─ .env                 # konfigurasi runtime
└─ Docs/                # dokumentasi (file ini)
```
