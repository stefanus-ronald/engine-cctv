# ENGINE-CCTV

Server streaming CCTV terpadu (Node.js, tanpa framework) untuk kamera/recorder **Hikvision (ISAPI)** dan kamera **ONVIF multi-merek** (V-014). Satu proses menggabungkan: live **WebRTC** (go2rtc) + fallback **MJPEG** (FFmpeg), **playback** rekaman NVR/DVR, **deteksi/analitik** (ISAPI alert stream + ONVIF PullPoint events), **PTZ** (ONVIF), dan **manajemen kamera** (IP camera tunggal, **auto-sync semua channel dari NVR**, atau **discovery ONVIF** di LAN).

> **Multi-protokol (V-014):** tiap kamera `protocol: 'isapi' | 'onvif' | 'rtsp'` (default `isapi`) di balik lapisan driver. Backbone video (go2rtc/FFmpeg) vendor-neutral. ONVIF live & events tervalidasi di perangkat nyata; detail: [`Docs/Implementasi-Feature/V-014-onvif-design.md`](Docs/Implementasi-Feature/V-014-onvif-design.md).

UI = single-page app (vanilla JS), diakses lewat browser di LAN.

> Dokumentasi lengkap: [`Docs/00-MASTER-SUMMARY.md`](Docs/00-MASTER-SUMMARY.md) · [`Docs/TECH-STACK.md`](Docs/TECH-STACK.md) · [`Docs/APP-FLOW.md`](Docs/APP-FLOW.md)

---

## 0. ⚡ Mulai cepat

**Langkah 5 menit (Windows + PowerShell):**

```powershell
# 1) Clone & masuk ke folder
git clone <repo-url>
cd ENGINE-CCTV

# 2) Pastikan Node.js & FFmpeg sudah terpasang
node -v            # harus 18+
ffmpeg -version    # kalau "not recognized" → install FFmpeg dulu (langkah 1)

# 3) Install dependency
npm install

# 4) Siapkan binary go2rtc (engine WebRTC) → unduh dari
#    https://github.com/AlexxIT/go2rtc/releases → taruh sebagai bin\go2rtc.exe

# 5) Siapkan konfigurasi & data dari file contoh
Copy-Item .env.example .env
Copy-Item cameras.example.json cameras.json
Copy-Item nvrs.example.json nvrs.json
#    lalu edit cameras.json / nvrs.json sesuai jaringan Anda (lihat langkah 4)

# 6) Jalankan
npm start
```

Buka browser ke **http://localhost:3000**. Selesai. Detail tiap langkah ada di bawah.

> 💡 Tanpa `go2rtc.exe`, aplikasi tetap jalan tapi **MJPEG-only** (tanpa WebRTC). Tanpa FFmpeg, stream tidak akan tampil.

---

## 1. Prasyarat (di PC baru)

| Kebutuhan | Versi | Catatan |
|---|---|---|
| **Node.js** | 18+ (disarankan 20/22 LTS) | Wajib. Cek: `node -v` |
| **FFmpeg** | terbaru | Wajib (engine MJPEG & download playback). Harus ada di **PATH**. Cek: `ffmpeg -version` |
| **go2rtc** | 1.9.x | Engine WebRTC. Binary disertakan di `bin/` (lihat langkah 2). |
| **Browser** | Chrome/Edge/Firefox modern | Untuk akses UI. |
| **Jaringan** | — | PC harus bisa menjangkau IP kamera/NVR (mis. `192.168.1.x`). |

### Instalasi FFmpeg
- **Windows:** unduh dari <https://www.gyan.dev/ffmpeg/builds/> (paket *full*), ekstrak, lalu tambahkan folder `bin` FFmpeg ke **Environment Variables → Path**. Atau set `FFMPEG_BIN` di `.env` ke path absolut `ffmpeg.exe`.
- **Linux:** `sudo apt install ffmpeg`
- **macOS:** `brew install ffmpeg`

---

## 2. Salin file yang TIDAK ikut Git

`.gitignore` mengecualikan file berikut (berisi kredensial / state lokal) — di PC baru, file ini **tidak ikut** dan harus disiapkan manual:

```
node_modules/      → dibuat oleh `npm install`
.env               → salin dari .env.example, isi sesuai jaringan Anda
cameras.json       → salin dari cameras.example.json, isi kamera IP Anda
nvrs.json          → salin dari nvrs.example.json, isi recorder Anda
dashboard.json     → dibuat OTOMATIS saat Anda menata grid (opsional: salin dari dashboard.example.json)
timezone.json      → dibuat OTOMATIS saat memilih negara di Settings (default Indonesia/WIB)
bin/go2rtc*        → binary go2rtc (lihat di bawah)
go2rtc.yaml        → dibuat OTOMATIS oleh server saat start (jangan dibuat manual)
```

> File `*.example.json` (dan `.env.example`) **ikut di-commit** sebagai template tanpa kredensial. Salin → buang akhiran `.example` → isi nilai asli. File aslinya sengaja di-_ignore_ agar password kamera tidak pernah ter-commit.

**Menyiapkan binary go2rtc** (bila belum ada di `bin/`):
- **Windows:** unduh `go2rtc_win64.zip` dari <https://github.com/AlexxIT/go2rtc/releases>, ekstrak, taruh sebagai `bin/go2rtc.exe`.
- **Linux/macOS:** unduh binary yang sesuai, taruh sebagai `bin/go2rtc`, lalu `chmod +x bin/go2rtc`, dan set `GO2RTC_BIN=./bin/go2rtc` di `.env`.

---

## 3. Setup

```bash
# 1) Masuk ke folder proyek
cd ENGINE-CCTV

# 2) Install dependency (hanya butuh 'dotenv')
npm install

# 3) Buat file .env dari contoh
#    Windows (PowerShell):  Copy-Item .env.example .env
#    Linux/macOS/Git Bash:  cp .env.example .env
```

Lalu **edit `.env`** seperlunya (lihat bagian 4).

---

## 4. Konfigurasi

### a. `.env` — pengaturan server & engine
| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port UI/HTTP. |
| `GO2RTC_API_PORT` | `1984` | Port API go2rtc (lokal). |
| `GO2RTC_WEBRTC_PORT` | `8555` | Port WebRTC (UDP). Buka di firewall bila akses dari perangkat lain. |
| `GO2RTC_BIN` | `./bin/go2rtc.exe` | Ganti ke `./bin/go2rtc` di Linux/macOS. |
| `FFMPEG_BIN` | `ffmpeg` | Set ke path absolut bila FFmpeg tidak di PATH. |
| `MJPEG_FPS` / `MJPEG_QUALITY` | `10` / `5` | Mutu fallback MJPEG. |
| `ISAPI_ENABLED` | `true` | Deteksi/alert ISAPI (kamera Hikvision). |
| `ONVIF_EVENTS` | `true` | Listener event ONVIF PullPoint per kamera ONVIF (set `false` untuk mematikan). |
| `NVR_AUTOSYNC` | `true` | Auto-scan NVR saat start (set `false` bila kerja UI di luar LAN). |
| `CCTV_API_TOKEN` | (kosong) | Opsional. Bila diisi, endpoint mutasi butuh header `x-api-token`. |

### b. `cameras.json` — kamera IP standalone
Daftar kamera yang **tidak** lewat NVR (akses langsung via jaringan). Tiap item:
```json
{
  "id": "cam-parkiran", "name": "Parkiran", "group": "Outdoor",
  "ip": "192.168.1.195", "port": 554, "isapiPort": 85,
  "username": "admin", "password": "******",
  "rtspPath": "/Streaming/Channels/101",
  "detection": { "isapi": true, "channelID": "1" }
}
```

### c. `nvrs.json` — registry NVR/DVR (auto-sync)
Daftar recorder yang di-**scan otomatis** saat start; tiap channel-nya jadi kamera, dikelompokkan di bawah nama NVR.
```json
[
  {
    "id": "nvr-main",
    "name": "",                 // kosong = pakai nama device dari NVR
    "group": "",                // kosong = pakai nama NVR sebagai grup sidebar
    "host": "192.168.1.181",    // IP LAN / IP publik / DDNS
    "rtspPort": 5541,
    "isapiPort": 81,            // port web/ISAPI NVR (BUKAN port RTSP)
    "username": "admin",
    "password": "******"
  }
]
```

**Akses NVR dari luar (IP publik / kantor lain):** ganti `host` ke IP publik atau DDNS NVR, dan pastikan **port `isapiPort` + `rtspPort` sudah di-port-forward** di router lokasi NVR. Logika scan & playback sama persis dengan LAN.

> ⚠️ `cameras.json`, `nvrs.json`, dan `.env` berisi **kredensial**. Jangan commit/bagikan sembarangan.

---

## 5. Menjalankan

```bash
npm start          # produksi
# atau
npm run dev        # mode watch (auto-restart saat file berubah)
```

Output sukses kira-kira:
```
[cameras] Loaded N camera(s)
[nvr-sync] Kantor JMP-NVR: 16 channel(s) synced
[go2rtc] WebRTC streaming ready
[isapi] Initialized — X endpoint(s) to connect
ENGINE-CCTV running on http://localhost:3000
```

**Buka di browser:** `http://localhost:3000`
**Dari perangkat lain di LAN:** `http://<IP-PC-server>:3000` (cek IP PC: `ipconfig` / `ip a`).

Hentikan dengan `Ctrl + C` (shutdown rapi: matikan go2rtc, FFmpeg, listener).

---

## 6. Port & Firewall

| Port | Protokol | Untuk |
|---|---|---|
| `3000` | TCP | UI / API (buka bila diakses dari perangkat lain) |
| `8555` | UDP | WebRTC media (buka bila stream WebRTC diakses dari perangkat lain) |
| `1984` | TCP | go2rtc API (lokal saja, tak perlu dibuka) |

PC server juga harus bisa **menjangkau** kamera/NVR di port RTSP (mis. 554, 5541) dan ISAPI/web/ONVIF (mis. 80, 81, 85, 88, 8080, 8086).

> **ONVIF discovery** memakai UDP multicast `239.255.255.250:3702`. Andal di LAN kabel; lewat **WiFi/antar-VLAN sering diblokir** → gunakan **input IP manual + Get profiles** sebagai fallback (Add Camera → Brand: ONVIF).

---

## 7. Pindah PC / jaringan — checklist cepat

1. Copy seluruh folder `ENGINE-CCTV` **atau** git clone + siapkan file di langkah 2.
2. Pastikan **Node.js**, **FFmpeg**, dan binary **go2rtc** tersedia.
3. `npm install`.
4. Buat/sesuaikan `.env` (perhatikan `GO2RTC_BIN` & `FFMPEG_BIN` per OS).
5. Cek `cameras.json` & `nvrs.json` — IP/host/credential **harus cocok dengan jaringan baru**.
   - Jaringan LAN sama → biasanya tetap jalan.
   - Jaringan beda → update IP kamera/NVR (atau pakai IP publik/DDNS + port-forward).
6. `npm start` → buka `http://localhost:3000`.

---

## 8. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `[go2rtc] ... ENOENT` / WebRTC unavailable | Binary go2rtc tak ada/salah path. Cek `bin/` & `GO2RTC_BIN`. Tanpa go2rtc, sistem jalan **MJPEG-only**. |
| Stream tidak muncul, hanya spinner | FFmpeg tak ada di PATH → set `FFMPEG_BIN`. Atau RTSP port/credential salah, atau kamera tak terjangkau. |
| `[nvr-sync] ... keeping last-known channels` | NVR tak terjangkau (host/port/credential salah, atau beda jaringan). Channel terakhir yang tersimpan tetap ditampilkan. Set `NVR_AUTOSYNC=false` bila sengaja kerja off-LAN. |
| NVR ter-scan tapi channel 0 | `isapiPort` salah (harus port **web/ISAPI**, mis. 81 — bukan port RTSP), atau perangkat bukan NVR ber-IP-channel. |
| Tidak bisa diakses dari perangkat lain | Buka port `3000` (dan `8555/UDP` untuk WebRTC) di firewall PC server. |
| Kamera dobel di sidebar (IP + channel NVR) | Normal bila kamera yang sama terdaftar di `cameras.json` **dan** ada di NVR. Hapus entri IP lewat Settings → Cameras bila ingin bersih. |
| Notifikasi deteksi tak muncul | By design: alert hanya tampil untuk kamera yang **sudah di-drag ke grid**. Drag kameranya dulu ke tile. |

---

## 9. Struktur singkat

```
ENGINE-CCTV/
├─ src/                  # backend (server, router, camera-manager, nvr-sync, drivers/, isapi/, onvif/, webrtc/, mjpeg/)
├─ public/               # frontend SPA (index.html, js/app.js, css/)
├─ bin/                  # binary go2rtc (di-ignore)
├─ Docs/                 # dokumentasi fitur & changelog (V-001 … V-014)
├─ *.example.json        # template (cameras/nvrs/dashboard/timezone) — di-commit, tanpa kredensial
├─ cameras.json          # kamera IP standalone (di-ignore — salin dari .example)
├─ nvrs.json             # registry NVR auto-sync (di-ignore — salin dari .example)
├─ dashboard.json        # layout grid tersimpan (di-ignore, dibuat otomatis)
├─ timezone.json         # zona waktu playback (di-ignore, dibuat otomatis)
├─ .env                  # konfigurasi (di-ignore — salin dari .env.example)
└─ package.json
```
