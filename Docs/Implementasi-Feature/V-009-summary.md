# V-009 Summary — Daftar Kamera dari NVR (auto-sync), Alert per-Grid & Notifikasi Playback

**Tanggal:** 2026-06-27 · **Status:** ✅ Implemented & verified live (NVR `Kantor JMP-NVR` @ `192.168.1.181:81`, 16 channel)

## Ringkasan
1. **Daftar kamera bersumber dari NVR (auto-sync)** — saat startup, setiap recorder di `nvrs.json` di-**scan** (`InputProxy/channels` + `deviceInfo`) dan tiap channel jadi kamera, dikelompokkan di bawah **nama NVR asli**. Kamera IP standalone di `cameras.json` tetap tampil sebagai fallback (untuk lokasi tanpa NVR). Verifikasi live: 5 kamera yang tadinya terdaftar via IP ternyata channel NVR (mis. Parkiran `.195`=CH3, Lantai 3 `.188`=CH11).
2. **NVR via LAN / IP publik / DDNS** — `host` di registry bebas; akses WAN tinggal port-forward port ISAPI + RTSP. Logika scan & playback sama.
3. **Alert hanya untuk kamera di grid** — notifikasi/flash deteksi hanya muncul untuk kamera yang **sudah di-drag ke tile**. Off-grid tetap masuk activity log (silent). Test-fire tetap tampil.
4. **Notifikasi ketersediaan playback** — saat buka playback: ada rekaman → tampilkan pilihan + status hijau; tidak ada sumber/rekaman → status merah/kuning **+ toast** agar jelas terlihat.
5. **Fix label sumber playback** — dropdown dulu salah pakai nama channel ("NVR Gerbang Keluar · CH3"); kini **nama NVR asli** ("Kantor JMP-NVR · CH3"), recorder di-dedup per endpoint.
6. **Fix bug frontend** — `loadCamerasFromAPI()` dulu hardcode `deviceType:'ipcamera'` → badge NVR tak pernah muncul; kini teruskan `deviceType`/`recorderId`/`recorderName`/`sourceIp` asli.

## File utama
- **Baru:** `nvrs.json` (registry recorder), `src/nvr-sync.js` (auto-scan), `README.md`
- **BE:** `src/config.js` (`loadNvrs`, `nvrAutoSync`), `src/isapi/nvr-channel-map.js` (`getDeviceName`), `src/isapi/playback-source.js` (label NVR), `src/camera-manager.js` (`replaceRecorderCameras`, passthrough recorder), `src/server.js` (sync saat startup)
- **FE:** `public/js/app.js` (gate alert per-grid, deviceType passthrough, notif playback), `public/css/style.css` (status playback berwarna)

## Konfigurasi baru
- `nvrs.json` — `[{ id, name?, group?, host, rtspPort, isapiPort, username, password }]`
- `.env` — `NVR_AUTOSYNC` (default `true`; `false` untuk kerja UI off-LAN)

## Detail
Lihat `V-009-changelog.md`. Cara menjalankan di PC baru / dari ZIP: `../../README.md`.
