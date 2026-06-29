# V-009 Changelog — Daftar Kamera Bersumber dari NVR (auto-sync) & Alert Hanya untuk Kamera di Grid

**Tanggal:** 2026-06-27
**Scope:** (a) Daftar kamera dibangun **dari NVR** (auto-scan saat startup), dikelompokkan di bawah nama recorder yang benar; kamera IP standalone tetap ditampilkan sebagai fallback. (b) Notifikasi/alert deteksi hanya muncul untuk kamera yang sudah di-drag ke grid. (c) Perbaikan bug: frontend dulu meng-hardcode `deviceType:'ipcamera'` sehingga badge NVR tak pernah muncul.

> Terverifikasi live: scan NVR `Kantor JMP-NVR` (host `192.168.1.181:81`) → **16 channel** ter-sync; kelima kamera yang sebelumnya terdaftar via IP ternyata channel di NVR ini (mis. Parkiran `.195`=ch3, Lantai 3 `.188`=ch11).

---

## A. Daftar kamera bersumber dari NVR (auto-sync)

**Masalah:** `cameras.json` dibuat manual dari IP tiap kamera. Seharusnya kamera yang direkam NVR di-route lewat NVR dan ditampilkan di bawah nama NVR — IP langsung hanya untuk lokasi tanpa NVR.

### `nvrs.json` (baru)
- Registry recorder yang di-auto-sync: `{ id, name?, group?, host, rtspPort, isapiPort, username, password }`.
- `host` bebas: **IP LAN**, **IP publik**, atau **DDNS** (untuk akses WAN, port-forward port ISAPI + RTSP recorder).

### `src/config.js`
- `loadNvrs()` membaca `nvrs.json`; path `nvrsFile`.
- Flag `config.nvrAutoSync` (env `NVR_AUTOSYNC`, default `true`; set `false` untuk kerja UI off-LAN).

### `src/isapi/nvr-channel-map.js`
- `getDeviceName({ip,port,username,password})` → baca `<deviceName>` dari `/ISAPI/System/deviceInfo` → jadi label grup sidebar (nama NVR yang benar).

### `src/nvr-sync.js` (baru)
- `syncAll()` / `syncOne(nvr)`: untuk tiap recorder → ambil nama device + `scanChannels` → bentuk 1 kamera per channel (`id: nvr-<id>-ch<N>`, `deviceType:'nvr'`, `group=<nama NVR>`, `recorderId`, `recorderName`, `sourceIp`, `rtspPath:/Streaming/Channels/<N>01`, `detection.channelID`).
- **Graceful:** recorder tak terjangkau → channel terakhir yang tersimpan dipertahankan (tidak dihapus). Kamera IP standalone **tidak disentuh**.

### `src/camera-manager.js`
- `list()` meneruskan `recorderId`, `recorderName`, `sourceIp`.
- `replaceRecorderCameras(recorderId, host, channelCams)`: ganti set channel milik 1 recorder (match `recorderId`, plus fallback legacy: deviceType nvr/dvr + ip==host) tanpa mengganggu kamera IP; pertahankan `hwCapabilities` hasil probe.

### `src/server.js`
- Setelah load kamera dan **sebelum** init go2rtc/alert → `nvrSync.syncAll()` (await), agar streaming & alert melihat seluruh set kamera. Alert stream tetap 1 koneksi per `ip:port` (16 channel NVR → 1 koneksi).

---

## B. Alert hanya untuk kamera yang ada di grid

### `public/js/app.js` — `fireAnalyticsEvent()`
- Gate baru: jika kamera **belum** di-assign ke tile (`tileAssignments`), event deteksi **tetap dicatat di activity log** (`offGrid:true`) tapi **tanpa toast / flash tile / dot sidebar**. Test-fire sintetis tetap tampil (umpan balik tombol test).

---

## B.2 Notifikasi ketersediaan playback

### `public/js/app.js` — `_pbLoadDay()` / `_pbStatus()` / `_pbNotifyNoPlayback()`
- Saat buka playback: jika kamera **punya rekaman** → tampilkan pilihan (timeline + dropdown sumber) dengan status hijau "N recording block(s)". Jika **tidak ada sumber playback** (mis. IP camera tanpa NVR & tanpa SD) atau **tidak ada rekaman** pada hari/sumber terpilih → status merah/kuning **+ toast** (`notify`) agar jelas terlihat & tercatat di activity log.
- `_pbStatus(msg, state)` kini berwarna (`ok`/`warn`/`error`). Toast "no playback" di-dedup per (kamera+alasan) supaya pindah-hari tidak spam; reset saat modal dibuka ulang.

### `public/css/style.css`
- `.pb-status-ok/.pb-status-warn/.pb-status-error` (hijau/kuning/merah).

## C. Perbaikan bug terkait

### `public/js/app.js` — `loadCamerasFromAPI()`
- Dulu hardcode `deviceType:'ipcamera'` untuk semua kamera → badge NVR/DVR tak pernah muncul & channel NVR tak terbedakan. Kini meneruskan `deviceType` asli dari backend + `recorderId`/`recorderName`/`sourceIp`.

### `src/isapi/playback-source.js` — label sumber playback salah nama NVR
- **Bug:** setelah auto-sync, semua 16 channel ber-`deviceType:'nvr'` → resolver memperlakukan tiap channel sebagai recorder terpisah dan memakai **nama channel pertama** sebagai nama NVR. Dropdown sumber tampil mis. `NVR Gerbang Keluar · CH3` (salah).
- **Fix:** label pakai **nama NVR asli** (`recorderName`, mis. `Kantor JMP-NVR · CH3`). Recorder di-dedup per endpoint (`recorderId` / `ip:isapiPort`) agar tak men-scan NVR berkali-kali & tak memilih nama channel sembarang. `_target` membawa `recorderId`/`recorderName` recorder, bukan id/nama channel.

---

## Catatan
- Kelima kamera IP standalone (Parkiran/Lantai 3/R. Kreatif/PTZ/Ruang Dev) kini juga muncul sebagai channel NVR → **ada duplikasi nama** (sesuai keputusan: kamera IP tetap ditampilkan). Bisa dihapus manual lewat Settings → Cameras bila ingin daftar bersih.
