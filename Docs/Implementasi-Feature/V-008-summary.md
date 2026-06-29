# V-008 Summary — Playback Scrubber, NVR Onboarding & Detection Fixes

**Tanggal:** 2026-06-23 · **Status:** ✅ Implemented & verified live (DS-7616NI-E2 + IP cam Hikvision)

## Ringkasan
Tiga area:
1. **Playback** — UI timeline-scrubber 24 jam (klik/drag=seek, playhead realtime, zoom) menggantikan daftar-download; perbaikan **timezone** (axis di ruang UTC agar cocok OSD kamera).
2. **Onboarding NVR/DVR** — form Add Camera mode NVR kini **scan channel asli** (`/api/nvr/channels`, 16 channel) dan **import** jadi kamera per-channel (`/api/nvr/import`); pilihan sumber playback **NVR vs SD** eksplisit.
3. **Bug deteksi** — motion/face kini baca **state asli** kamera (tak lagi paksa-ON saat refresh); panah arah line crossing **tetap tampak setelah Save**; download playback `-t`/watchdog → **tak membocorkan sesi NVR** (penyebab `453`/WebRTC 500).
4. **Indikator loading tile** — spinner "Connecting…" tampil sampai frame pertama benar-benar muncul (fix overlay yang tak pernah terlihat + tunggu `loadeddata`).
5. **Perbaikan audit kode** (10 temuan) — a.l. `setDetectionEnabled` master-only, redaksi kredensial di log, backpressure download, validasi rentang, auth token opsional, containment static-serve. Lihat changelog §E.
6. **Iterasi UX** (§F) — animasi loading playback; arah panah line crossing dibalik (A→B/B→A); **download playback pilih rentang 1–60 menit** (ganti unduh seluruh blok); download bebaskan sesi NVR dulu; **fix cam-ptz live** (RTSP port 554→8554); UI download dirapikan (hilangkan tombol ganda) + **progress 0–100% & tombol Cancel** pada semua loading (live, buffering playback, download).

## File utama
- BE: `src/router.js`, `src/isapi/{nvr-channel-map,playback-source,playback-search,line-crossing-api}.js`, `src/webrtc/playback-stream.js`, `src/camera-manager.js`
- FE: `public/js/app.js`, `public/css/style.css`

## Endpoint baru
- `POST /api/nvr/channels` — scan recorder
- `POST /api/nvr/import` — import channel terpilih
- `+source` pada `/api/playback/{search,stream/start,download}`
- `/api/detection/lines` +`motionEnabled`,`faceEnabled`

## Detail
Lihat `V-008-changelog.md`. Bukti playback: `RESEARCH/NVR-DVR_Playback/07_VERIFIED_LIVE_TEST.md`, UX scrubber: `08_TIMELINE_SCRUBBER_UX.md`.
