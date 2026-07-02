# ENGINE-CCTV — Application Flow

> Alur kerja sistem dari startup sampai tiap fitur. Lihat juga [00-MASTER-SUMMARY.md](./00-MASTER-SUMMARY.md) & [TECH-STACK.md](./TECH-STACK.md).

---

## 1. Startup (server.js)

```
node src/server.js
   |
   1. cameraManager.init()        baca cameras.json
   2. go2rtcManager.init()        spawn go2rtc, daftarkan stream live tiap kamera
   3. (jika ISAPI_ENABLED)
        alertStreamManager.init() listener event deteksi realtime
        capabilitiesProbe.probeAllCameras()  deteksi HW (async)
   4. (jika VCA_ENABLED) vcaProxy.init()
   4.5 (kecuali ONVIF_EVENTS=false) onvifEventManager.init()  PullPoint loop tiap kamera ONVIF (V-014)
   5. http.createServer(handleRequest).listen(PORT)
   |
   v
 UI di http://localhost:<PORT>   (SIGINT/SIGTERM → stopAll + close)
```

---

## 2. Live Streaming (browser → tile)

```
Browser load UI
   |  GET /api/cameras  ──────────────► daftar kamera (cameraManager.list)
   |  EventSource /api/events ────────► SSE event deteksi
   v
Tile dibuat (createTile) → StreamAdapter.connect(tile, camId, protocol)
   |
   ├─ WebRTC (default):
   |     RTCPeerConnection → offer → POST /api/webrtc?src=<camId>
   |        └─ go2rtc-proxy ► go2rtc ► tarik RTSP kamera ► answer SDP
   |     ontrack → set <video>.srcObject
   |     [LOADING spinner + progress] sampai frame pertama (loadeddata) → 'connected'
   |     gagal/503 → _fallbackToMJPEG
   |
   └─ MJPEG (fallback):
         <img src="/mjpeg/<camId>"> ► mjpegManager ► spawn FFmpeg ► multipart JPEG
```

Reuse: saat grid re-render, koneksi WebRTC ditransfer ke elemen tile baru (tanpa renegosiasi).

---

## 3. Playback Rekaman (timeline scrubber)

```
Klik tombol ⏱ pada tile → openPlaybackModal(camId)
   |
   1. Pilih hari (default hari ini) → _pbLoadDay()
   |     GET /api/playback/search?cam=&start=&end=&source=
   |        └─ playbackSource.resolve(cam, source)   NVR (default) | SD
   |        └─ playbackSearch.searchRecordings()     ContentMgmt/search (GUID, UTC)
   |     ◄ segments[] (+ sources[], sourceLabel)
   |     render blok hijau di timeline 24 jam (ruang UTC)
   |
   2. Klik/drag timeline → _pbSeekTo(ms)
   |     POST /api/playback/stream/start {cam,start,end,source}
   |        └─ playbackStream.startPlayback → daftarkan go2rtc stream
   |              src = ffmpeg:rtsp://…/Streaming/tracks/<ch01>?starttime&endtime#input=rtsp#video=copy
   |     ◄ {name}
   |     _pbConnectWebRTC(video, name)  via /api/webrtc?src=<name>
   |     [LOADING "Buffering…" + progress] sampai frame pertama
   |     playhead berjalan realtime (rAF dari video.currentTime)
   |     re-seek → stopActiveStream (DELETE go2rtc stream) → start lagi
   |
   3. Unduh klip (Save clip: From + Length 1–60 min)
         From mengikuti playhead; klik "Download clip"
         stopActiveStream (bebaskan sesi NVR)
         GET /api/playback/download?cam=&start=&end=&source=
            └─ ffmpeg -i <rtsp tracks> -t <durasi> -map 0:v:0 -c:v copy -an -f mp4 pipe:1
         baca response sebagai STREAM → progress 0–100% by bytes (real) + MB
         Cancel → AbortController → putus → backend kill ffmpeg → sesi NVR bebas
```

**Catatan kritis NVR (DS-7616NI):** playback dilayani **realtime** & **1 sesi/channel**. Karena itu: download `-t` (exit bersih, anti-leak), stop stream sebelum download, guard anti-download-ganda, dan deteksi `453 Not Enough Bandwidth` → HTTP `503`.

**Timezone:** NVR melabeli waktu lokal sebagai `Z`. UI menjalankan seluruh axis di **ruang UTC** agar angka = OSD kamera.

---

## 4. Deteksi / Analitik

```
Startup: capabilitiesProbe → set hwCapabilities per kamera
SSE: alertStreamManager menerima event ISAPI → normalizer/dedup → /api/events
   browser: toast + flash tile + (jika line/region) render overlay SVG

Toggle detektor di UI (motion/line/loitering/face):
   PUT /api/detection/rule/<camId> {detectorId, enabled}
      └─ line-crossing-api.setDetectionEnabled  GET→ubah master <enabled>→PUT ke kamera
   (saat load) GET /api/detection/lines/<camId>?refresh=true
      ◄ lineDetectionEnabled, fieldDetectionEnabled, motionEnabled, faceEnabled, lines[], regions[]
      UI mirror state ASLI kamera (tidak memaksa ON)

Gambar garis (draw mode):
   pilih arah (A→B / B→A / A↔B) → PUT /api/detection/line-draw/<camId> {x1,y1,x2,y2,direction}
      └─ setLineCoordinates (Hikvision coords 0–1000, Y dibalik)
   overlay menampilkan panah arah (kiri/kanan perpendicular) konsisten draw & saved.

Sensitivitas:
   GET/PUT /api/detection/sensitivity/<camId>
```

---

## 5. Onboarding Kamera

```
Settings → Cameras → Add Camera
   |
   ├─ Tipe "IP Camera":
   |     isi IP/port/kredensial → Test connection → Save
   |        POST /api/cameras  → cameraManager.add → cameras.json
   |
   └─ Tipe "NVR / Recorder":
         isi IP + Web/ISAPI port + kredensial → "Scan for channels"
            POST /api/nvr/channels {ip,port,username,password}
               └─ nvrChannelMap.scanChannels  GET InputProxy/channels
            ◄ channels[] (mis. 16 channel + nama + IP)
         centang channel → "Add N cameras"
            POST /api/nvr/import {recorder, group, channels[]}
               └─ untuk tiap channel: cameraManager.add
                    ip=NVR, port=RTSP NVR, isapiPort=ISAPI NVR,
                    rtspPath=/Streaming/Channels/<ch>01, deviceType='nvr',
                    detection.channelID=<ch>
         loadCamerasFromAPI → tampil di grid/sidebar
```

Hasil: tiap channel jadi kamera yang **live** dari NVR dan **playback** resolve ke channel NVR (`via='self'`).

### 5b. Onboarding ONVIF (V-014)

```
Settings → Cameras → Add Camera → Brand "ONVIF"
   |
   ├─ "Discover ONVIF"  → POST /api/onvif/discover (WS-Discovery multicast)
   |     ◄ devices[] (ip, model) → klik untuk auto-isi IP/port
   ├─ isi user/pass → "Get profiles" → POST /api/onvif/profiles
   |     └─ onvif-driver.resolveStreamUris: GetProfiles + GetStreamUri (main/sub)
   |        + deteksi kapabilitas ptz & profileG
   |     ◄ { profiles[], streamUri, streamUriSub, ptz, profileG, deviceInfo }
   └─ pilih profil → Save → POST /api/cameras { protocol:'onvif', onvif:{…} }

Live      : go2rtc pakai onvif.streamUri (kredensial disuntik) — sama seperti ISAPI.
Events    : onvif-event-manager PullPoint → normalizeOnvifEvent → SSE (toast/flash/overlay).
PTZ       : tombol ✚ di tile → pad → POST /api/onvif/ptz/:id (tekan-tahan move, lepas stop).
Playback  : tombol ⏱ (bila profileG) → modal ONVIF → summary + replay via go2rtc.
```

> Kamera Hikvision tetap `protocol:'isapi'` (default) → semua alur di atas memakai jalur ISAPI lama tanpa perubahan.

---

## 6. Ringkasan Endpoint

| Method | Path | Fungsi |
|---|---|---|
| GET | `/health`, `/api/stats` | status |
| GET/POST | `/api/cameras` | list / add |
| GET/PUT/DELETE | `/api/cameras/:id` | detail / update / hapus |
| POST | `/api/nvr/channels` | scan channel NVR |
| POST | `/api/nvr/import` | import channel jadi kamera |
| POST | `/api/onvif/discover` | **(V-014)** WS-Discovery kamera ONVIF di LAN |
| POST | `/api/onvif/profiles` | **(V-014)** resolve profil + stream URI + ptz/profileG |
| POST | `/api/onvif/ptz/:id` | **(V-014)** kontrol PTZ (move/stop) |
| GET | `/api/onvif/playback/summary` | **(V-014)** ringkasan rekaman Profile G |
| POST | `/api/onvif/playback/start` | **(V-014)** mulai replay Profile G via go2rtc |
| POST | `/api/webrtc`, `/api/streams` | signaling/proxy go2rtc |
| GET | `/mjpeg/:id` | MJPEG fallback |
| GET | `/api/events` | SSE event deteksi |
| GET | `/api/detection/status`, `/lines/:id`, `/sensitivity/:id` | baca konfigurasi deteksi |
| PUT | `/api/detection/rule/:id`, `/line-draw/:id`, `/sensitivity/:id` | tulis konfigurasi deteksi |
| GET | `/api/playback/search` | cari segmen rekaman |
| POST | `/api/playback/stream/start` `/stop` | stream playback sementara |
| GET | `/api/playback/download` | unduh klip MP4 |

> Endpoint mutasi (cameras/nvr/detection) dapat diproteksi token bila `CCTV_API_TOKEN` di-set (header `x-api-token`).
