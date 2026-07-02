# V-014 (DESAIN) — Dukungan ONVIF: arsitektur driver multi-protokol + perubahan layout frontend

**Tanggal:** 2026-06-30
**Status:** 🟢 **Fase 0–5 SUDAH DIIMPLEMENTASI** (2026-06-30 → 2026-07-01) — abstraksi driver +
ONVIF live + events PullPoint → SSE + PTZ + playback Profile G + **deteksi kapabilitas** (GetServices +
GetEventProperties → panel Analytics real). Implementasi & rollback: **§10**–**§15**.
🟢 **Hardening pasca-review (2026-07-02)**: retry-pull + Renew + clock-offset + fix 2MB-hang — **§16**.
✅ **Live & events & deteksi kapabilitas TERVALIDASI di kamera ONVIF nyata (192.168.1.185)**;
discovery tervalidasi (banyak device). ⚠️ PTZ & playback Profile G belum teruji (belum ada perangkat
yang mendukungnya). Isu "socket hang up" long-poll events sudah ditangani retry-pull (§16 — tervalidasi
nyata di .185).
**Scope:** Menjelaskan (a) cara kerja ONVIF, (b) bagaimana ia masuk ke engine yang
sekarang **full ISAPI**, (c) perubahan layout frontend, dan (d) rencana implementasi bertahap.

> Konteks riset: lihat [../Comparission/NVR-Comparison.md](../Comparission/NVR-Comparison.md)
> (Frigate/Shinobi/LightNVR semua **Generic RTSP/ONVIF**; hanya kita yang "Hikvision ISAPI mendalam").
> ONVIF adalah jalan kita menuju dukungan kamera **multi-merek** tanpa kehilangan keunggulan ISAPI.

---

## 0. TL;DR — keputusan inti

1. **Ini BUKAN rombak total.** Backbone video kita (**go2rtc + FFmpeg + SSE + overlay + timeline
   playback**) sudah **vendor-neutral** — ia hanya butuh URL RTSP. ISAPI cuma dipakai untuk
   **kontrol perangkat** (cari URL, scan channel, events, analytics, playback-search, storage).
2. Solusinya: **lapisan kontrol perangkat dijadikan driver/adapter.** Tiap kamera dapat field
   `protocol: 'isapi' | 'onvif' | 'rtsp'`. Driver ISAPI sekarang dibungkus apa adanya;
   driver ONVIF ditambahkan di sebelahnya. Frontend menjadi **capability-driven** (tombol muncul
   sesuai kemampuan perangkat, bukan asumsi Hikvision).
3. **Tanpa dependensi npm berat.** ONVIF = SOAP/XML over HTTP — cocok dengan gaya kita yang sudah
   hand-roll XML + Digest. Untuk discovery & stream-URI kita boleh **sandar ke go2rtc** (sudah
   punya ONVIF bawaan); untuk events/PTZ kita hand-roll SOAP secukupnya. **Hindari `npm i onvif`.**
4. **Dikerjakan bertahap** (Fase 0 → 5). Fase 1 (ONVIF live-only) memberi nilai terbesar dengan
   risiko terkecil.

---

## 1. Apa itu ONVIF & cara kerjanya

**ONVIF** (Open Network Video Interface Forum) = standar interoperabilitas kamera/NVR lintas merek.
Bedakan dua hal yang sering tercampur:

- **Video tetap lewat RTSP** (sama seperti sekarang) → tidak ada yang berubah di go2rtc/FFmpeg.
- **Kontrol perangkat lewat SOAP/XML web service** (inilah "ONVIF" yang menggantikan ISAPI).

### 1.1 Mekanisme teknis (yang perlu kita implement)

| Hal | ONVIF | Bandingkan dgn ISAPI kita |
|---|---|---|
| Transport | **SOAP 1.2 / XML over HTTP** (POST ke `http://ip/onvif/<service>`) | ISAPI = HTTP+XML juga → gaya mirip |
| Auth | **WS-Security UsernameToken** (digest nonce di header SOAP) | kita: HTTP Digest RFC 2617 ([digest-auth.js](../../src/isapi/digest-auth.js)) — **beda, perlu modul baru** |
| Discovery | **WS-Discovery**: kirim 1 SOAP "Probe" ke **UDP multicast `239.255.255.250:3702`**, kamera balas alamat service-nya | ISAPI **tak punya** — sekarang IP diketik manual |
| Parsing | XML (regex, konsisten dgn [xml-parser.js](../../src/isapi/xml-parser.js)) | sama |

### 1.2 Service ONVIF utama

| Service | Endpoint khas | Fungsi | Padanan ISAPI sekarang |
|---|---|---|---|
| **Device Management** | `/onvif/device_service` | `GetDeviceInformation`, `GetServices`, `GetCapabilities`, `GetSystemDateAndTime` | probe + deviceInfo |
| **Media** | `/onvif/Media` | `GetProfiles` (tiap profil = video source+encoder), `GetStreamUri` → **URL RTSP**, `GetSnapshotUri` | hardcode `/Streaming/Channels/101` ([camera-manager.js:27](../../src/camera-manager.js#L27)) |
| **Events** | `/onvif/Events` | **PullPoint subscription** (`CreatePullPointSubscription` → `PullMessages` loop) atau Base-Notification | alertStream ([alert-stream-manager.js](../../src/isapi/alert-stream-manager.js)) |
| **PTZ** | `/onvif/PTZ` | `ContinuousMove`, `AbsoluteMove`, `Stop`, `GotoPreset` | (selama ini tidak ada panel PTZ) |
| **Analytics** | `/onvif/Analytics` | `GetAnalyticsModules`, konfigurasi rule (line/field) | line-crossing + sensitivity ([line-crossing-api.js](../../src/isapi/line-crossing-api.js)) ⚠️ dukungan vendor **tidak merata** |
| **Recording (Profile G)** | `/onvif/recording`, `/onvif/replay` | `FindRecordings`/`FindEvents` (search) + `GetReplayUri` (RTSP `Range:`) | `ContentMgmt/search` + `Streaming/tracks?starttime` ([playback-search.js](../../src/isapi/playback-search.js)) |

### 1.3 Profil ONVIF (peta dukungan)

- **Profile S** — live streaming. Hampir semua kamera punya. **Cukup untuk Fase 1.**
- **Profile T** — streaming lanjutan (H.265, dll).
- **Profile G** — recording & playback. **Sering tidak lengkap di NVR Hikvision** ⚠️ → playback ONVIF dibuat opsional/fallback.
- **Profile M** — metadata/analytics (deteksi objek).

---

## 2. Pemetaan: apa yang berubah, apa yang TIDAK

### ✅ TIDAK berubah (sudah vendor-neutral)
- `webrtc/go2rtc-manager.js`, `go2rtc-proxy.js`, `playback-stream.js` — hanya butuh URL RTSP.
- `mjpeg/*` — FFmpeg atas RTSP.
- `events/sse-broadcaster.js`, `event-normalizer.js`, `event-dedup.js` — selama driver ONVIF
  menormalkan event ke bentuk yang sama.
- Timeline scrubber, overlay SVG, grid, sidebar — struktur visual tetap.

### 🔧 Yang perlu di-abstraksi jadi driver (Hikvision-specific sekarang)
1. **Cari URL RTSP live** — sekarang hardcode konvensi Hikvision; ONVIF: `GetStreamUri`.
2. **Discovery / scan channel** — sekarang `InputProxy/channels`; ONVIF: WS-Discovery + `GetProfiles`.
3. **Capabilities** — sekarang Hikvision Smart; ONVIF: `GetServices`/`GetCapabilities`.
4. **Events** — sekarang alertStream; ONVIF: PullPoint.
5. **Analytics config** (line/sensitivity) — sekarang Smart API; ONVIF: Analytics service ⚠️.
6. **Playback** — sekarang ContentMgmt/search; ONVIF: Profile G ⚠️.
7. **PTZ** — baru (ONVIF paling matang).
8. **Storage/HDD** ([storage-api.js](../../src/isapi/storage-api.js)) — **tidak ada padanan ONVIF
   yang baik** → fitur ini tetap Hikvision-only; di kamera ONVIF, sembunyikan.

---

## 3. Arsitektur driver yang diusulkan

```
                       ┌─────────────────────────────┐
   router.js  ────────▶│   device-driver (interface)  │
   server.js           └─────────────────────────────┘
                          ▲                       ▲
                 ┌────────┴─────────┐   ┌─────────┴──────────┐
                 │  isapi-driver    │   │   onvif-driver     │  (baru)
                 │ (bungkus modul   │   │ src/onvif/*        │
                 │  isapi/* yg ada) │   │  - ws-discovery    │
                 └──────────────────┘   │  - ws-security     │
                                        │  - soap-client     │
                                        │  - media/events/ptz│
                                        └────────────────────┘
                 keduanya mengembalikan: { rtspUrl, channels[], caps, events→SSE }
                          │
                          ▼
        go2rtc / FFmpeg / SSE / overlay  (TIDAK berubah — vendor-neutral)
```

### 3.1 Interface driver (kontrak)

```js
// src/drivers/device-driver.js  (kontrak; tiap protokol mengimplement)
//   getStreamUri(cam, quality)        → string RTSP url
//   discover()                        → [{ ip, port, name, model, protocol }]   (LAN scan)
//   listChannels(conn)                → [{ channelID, name, sourceIp }]          (onboarding)
//   getCapabilities(cam)              → { motion, line, field, face, ptz, playback, ... }
//   subscribeEvents(cam, onEvent)     → handle.close()                          (→ sse-broadcaster)
//   getDetectionConfig/setDetection.. → (opsional; null bila tak didukung)
//   ptz(cam, cmd)                     → (opsional)
//   searchRecordings/getReplayUri     → (opsional; Profile G)
```

### 3.2 Pemilihan driver
`getDriver(cam)` membaca `cam.protocol`. Default `'isapi'` (kompatibel mundur — semua kamera lama
tetap ISAPI). Modul `isapi/*` yang ada **tidak dihapus**, hanya dibungkus jadi `isapi-driver`.

---

## 4. Perubahan data model

`cameras.json` per-kamera dapat field baru (semua opsional, default ISAPI):

```jsonc
{
  "id": "cam-…",
  "protocol": "onvif",          // 'isapi' | 'onvif' | 'rtsp'  (default 'isapi')
  "onvif": {                     // hanya untuk protocol === 'onvif'
    "port": 80,                  // port service ONVIF (sering 80 / 8000 / 2020)
    "profileToken": "Profile_1", // dipilih saat onboarding (GetProfiles)
    "xaddr": "http://ip/onvif/device_service"
  },
  "hwCapabilities": { "ptz": true, "line": false, "playback": false }  // hasil GetCapabilities
}
```

- `camera-manager.js#add/update` ([camera-manager.js:154](../../src/camera-manager.js#L154)) menambah
  passthrough `protocol` + `onvif`.
- `getDeviceType()` tetap; ditambah pembaca `getProtocol(cam)`.
- `buildRtspUrl*()` untuk kamera ONVIF **tidak** menebak path — ia memakai URL hasil `GetStreamUri`
  yang disimpan/di-refresh, bukan menyusun `/Streaming/Channels/…`.

---

## 5. Perubahan layout frontend (`public/`)

Secara garis besar **sidebar & grid tidak berubah**; yang berubah: modal Add Camera, panel
Analytics jadi capability-driven, panel PTZ baru, dan adaptasi playback.

### 5.1 Add Camera modal ([index.html](../../public/index.html) + [app.js](../../public/js/app.js))
- **Dropdown "Protocol": ISAPI (Hikvision) / ONVIF / RTSP-only.**
- Saat **ONVIF** dipilih:
  - Tombol **"🔍 Discover (ONVIF)"** → panggil `/api/onvif/discover` → tampilkan **daftar kamera
    LAN** (IP, model, manufacturer) hasil WS-Discovery, klik untuk auto-isi. (Fitur yang tak pernah
    ada di alur ISAPI manual.)
  - Setelah isi kredensial → **"Get profiles"** (`GetProfiles`) → pilih profil (main/sub) dari
    dropdown alih-alih mengetik `rtspPath`.
  - Field `rtspPath` & `ISAPI port` disembunyikan (diganti `ONVIF port` + profile token).
- Saat **RTSP-only**: cukup tempel URL RTSP penuh (untuk kamera tanpa ONVIF/ISAPI).

### 5.2 Panel Analytics → capability-driven
- Sekarang panel mengasumsikan line-crossing/sensitivity/face Hikvision **selalu ada**. Untuk ONVIF
  banyak kamera **tak mengekspos** rule itu.
- Tombol/section di-gate oleh `cam.hwCapabilities`: bila `line=false` → section disembunyikan/disabled
  dengan teks "Tidak didukung perangkat ini (ONVIF)".
- **Badge protokol di tile**: tampilkan `ONVIF`/`ISAPI` (struktur badge sudah ada — lihat
  `updateProtocolBadge` di V-013).

### 5.3 Panel PTZ (baru)
- Untuk kamera dengan `caps.ptz=true`: overlay tombol pan/tilt/zoom di tile (atau di modal),
  memanggil `/api/onvif/ptz/:id`. Ini fitur baru yang ISAPI-path kita belum punya.

### 5.4 Playback
- Kamera ONVIF tanpa Profile G: sembunyikan timeline scrubber atau tampilkan banner
  "Playback tidak didukung perangkat ini". Kamera Hikvision tetap penuh.

---

## 6. Rencana implementasi BERTAHAP

> Prinsip: tiap fase berdiri sendiri, bisa di-merge & diuji terpisah. Urutan = nilai/effort.

### Fase 0 — Abstraksi driver (refactor, TANPA fitur baru) · risiko rendah · WAJIB duluan
- Buat `src/drivers/device-driver.js` (kontrak) + `src/drivers/isapi-driver.js` yang **membungkus**
  modul `isapi/*` yang sudah ada. Tambah `cam.protocol` (default `'isapi'`).
- Titik panggil di `router.js`/`server.js` diarahkan lewat `getDriver(cam)`.
- **Hasil:** perilaku 100% sama; cuma jalur kode yang siap menerima driver kedua.
- Verifikasi: `npm run check` + boot test, semua fitur Hikvision tetap jalan.

### Fase 1 — ONVIF live-only · nilai tertinggi, effort terendah
- `src/onvif/ws-discovery.js` (UDP multicast probe) + `src/onvif/ws-security.js` (UsernameToken) +
  `src/onvif/soap-client.js` + `getStreamUri`/`listChannels` (`GetProfiles`).
  - Opsi A (lebih cepat): pakai API ONVIF bawaan go2rtc untuk discovery + stream-URI.
- `onvif-driver.js` mengembalikan URL RTSP → masuk ke go2rtc **persis seperti sekarang**.
- Frontend: dropdown protokol + tombol Discover + pilih profil (§5.1).
- **Hasil:** kamera non-Hikvision **live di grid**. Endpoint baru: `POST /api/onvif/discover`,
  `POST /api/onvif/profiles`.

### Fase 2 — Events ONVIF (PullPoint)
- `src/onvif/events.js`: `CreatePullPointSubscription` → loop `PullMessages` → normalisasi ke bentuk
  event kita → `events/sse-broadcaster.js`. Toast/flash/overlay jalan tanpa ubah frontend event.

### Fase 3 — PTZ
- `src/onvif/ptz.js` + endpoint `/api/onvif/ptz/:id` + panel kontrol (§5.3).

### Fase 4 — Playback (Profile G)
- Hanya untuk perangkat yang mengiklankan Profile G (`FindRecordings` + `GetReplayUri`, RTSP `Range:`).
- Fallback "tidak didukung" untuk yang tidak punya.

### Fase 5 — Analytics config & capability-gating UI penuh
- Paling rapuh (dukungan vendor tak merata). Get/Set Analytics modules; UI gating menyeluruh (§5.2).

---

## 7. Risiko & catatan penting

- ⚠️ **Auth ONVIF ≠ Digest.** WS-Security UsernameToken (nonce+created+SHA1) wajib benar, kalau tidak
  semua call balas `401`. Sebagian kamera juga butuh waktu device tersinkron (`GetSystemDateAndTime`)
  untuk hitung nonce — ambil dulu sebelum call lain.
- ⚠️ **Profile G Hikvision sering tak lengkap** → jangan jadikan playback ONVIF sebagai default;
  untuk Hikvision tetap pakai jalur ISAPI yang sudah matang.
- ⚠️ **Analytics ONVIF tidak seragam** antar-merek → jangan janjikan line-crossing arah-panah di ONVIF
  seperti di ISAPI. Capability-gate UI-nya.
- ⚠️ **WS-Discovery butuh UDP multicast** → bisa diblokir firewall / tidak lewat antar-subnet/VLAN.
  Sediakan tetap jalur "isi IP manual" sebagai fallback.
- ⚠️ **Timezone playback**: konvensi offset kita sekarang berbasis `timezone.json` (V-012 L). Untuk
  Profile G nanti, pastikan konversi waktu konsisten dengan `getDisplayOffsetMin`.
- **Filosofi zero-dep dipertahankan**: hand-roll SOAP untuk panggilan yang sedikit & spesifik;
  hanya bila perlu, sandar ke go2rtc (sudah ada) — bukan menambah lib ONVIF besar.

---

## 8. Endpoint baru (rencana)

| Method | Path | Fase | Fungsi |
|---|---|---|---|
| POST | `/api/onvif/discover` | 1 | WS-Discovery → daftar kamera LAN |
| POST | `/api/onvif/profiles` | 1 | `GetProfiles` untuk IP+kredensial |
| (internal) | events PullPoint → `/api/events` | 2 | event ONVIF masuk SSE yang sudah ada |
| POST | `/api/onvif/ptz/:id` | 3 | kontrol PTZ |
| GET | `/api/onvif/playback/search` | 4 | Profile G (fallback bila tak didukung) |

---

## 9. Belum diputuskan (perlu konfirmasi sebelum koding)
- Pakai **go2rtc ONVIF bawaan** (Opsi A, cepat) atau **hand-roll SOAP penuh** (Opsi B, kontrol penuh)
  untuk discovery + stream-URI di Fase 1?
- Apakah PTZ (Fase 3) lebih prioritas dari Events (Fase 2) untuk use-case nyata di lapangan?
- Perangkat ONVIF nyata untuk uji (merek/model apa yang akan dipakai)?

> Setelah dokumen ini di-ACC, langkah pertama implementasi adalah **Fase 0** (refactor driver,
> tanpa perubahan perilaku) lalu **Fase 1** (ONVIF live-only).

---

## 10. Fase 0 — IMPLEMENTASI (2026-06-30) ✅

**Scope:** abstraksi driver multi-protokol + field `cam.protocol`. **Tanpa perubahan perilaku** —
semua kamera lama tetap ISAPI (default), dan jalur video (go2rtc/FFmpeg/MJPEG/SSE) tidak disentuh.

### File baru
- **`src/drivers/device-driver.js`** — kontrak driver + `getProtocol(cam)` (default `'isapi'`) +
  `getDriver(cam)` (resolver). Lazy-require agar tak ada circular dependency.
- **`src/drivers/isapi-driver.js`** — wrapper TIPIS atas modul `isapi/*` + `camera-manager` yang sudah
  ada: `getStreamUri` → `buildRtspUrlForQuality`; `listChannels` → `nvr-channel-map.scanChannels`;
  `getCapabilities` → `capabilities-probe.probeCamera`; `getDetectionConfig` → `line-crossing-api`.
  `discover()` mengembalikan `[]` (ISAPI tak punya WS-Discovery). Tanpa logika baru.
- **`scripts/rollback-v014.js`** — pemulih (lihat di bawah).

### File diubah
- **`src/camera-manager.js`** (backup: `src/camera-manager.js.bak.20260630-165540`):
  - `getProtocol(cam)` baru (default `'isapi'`), diekspor.
  - `add`/`update`/`list` passthrough field `protocol` + `onvif` (opsional; undefined = isapi).
  - `buildRtspUrlForQuality`: **cabang ONVIF ber-guard** — bila `cam.protocol==='onvif'` & ada
    `cam.onvif.streamUri`/`streamUriSub`, pakai URL itu langsung; selain itu **fall-through** ke
    pembangun Hikvision lama. **Dormant** sampai Fase 1 mengisi URI → kamera ISAPI 100% tak berubah.

### Verifikasi (terbukti)
- `npm run check` → **30 file JS lolos** `node --check`.
- Smoke test fungsi: kamera tanpa `protocol` → driver `isapi`, URL `…/Channels/101` (main) & `…/102`
  (sub); kamera `protocol:'onvif'` → pakai `streamUri`/`streamUriSub` tersimpan; kamera onvif tanpa URI
  → fallback channel 101 tanpa crash.
- **Boot test sungguhan** (`ISAPI_ENABLED=false NVR_AUTOSYNC=false node src/server.js`): server up,
  go2rtc ready, `/health` ok, `/api/cameras` menampilkan kamera lama dengan `"protocol":"isapi"` +
  `"onvif":null` (kompat mundur terbukti). Shutdown bersih, tidak ada go2rtc yatim.

### Cara ROLLBACK Fase 0
```bash
node scripts/rollback-v014.js --dry    # preview (tidak mengubah apa pun)
node scripts/rollback-v014.js          # pulihkan camera-manager.js dari backup + hapus src/drivers/*
npm run check                          # konfirmasi
```
Rollback memulihkan `src/camera-manager.js` dari `*.bak.<TS>` (TS dibaca dari
`Docs/.v014-backup-ts.txt`) dan menghapus dua file `src/drivers/*`. Tidak menghapus dirinya sendiri,
backup, maupun dokumen ini.

> **Langkah berikutnya:** Fase 1 (ONVIF live-only) — butuh keputusan §9 (go2rtc bawaan vs hand-roll
> SOAP) dan perangkat ONVIF nyata untuk uji.

---

## 11. Fase 1 — IMPLEMENTASI (2026-06-30) ✅ (validasi hardware pending)

**Keputusan §9:** dipilih **Opsi B — hand-roll SOAP** (zero-dep, konsisten dengan `isapi/*`).
**Scope:** ONVIF **live-only** — discovery LAN, resolve profil/stream-URI, onboarding di UI,
streaming lewat go2rtc memakai seam Fase 0. Events/PTZ/playback/analytics = fase berikutnya.

### File baru (backend)
- **`src/onvif/ws-security.js`** — WS-Security UsernameToken: `PasswordDigest = Base64(SHA1(nonce +
  created + password))`, native `crypto`.
- **`src/onvif/soap-client.js`** — klien SOAP 1.2 minimal: bungkus envelope + header Security, POST
  via `http`, **fallback HTTP Digest** bila device balas 401 (pakai `isapi/digest-auth.js`), deteksi
  SOAP Fault, cap body 2 MB.
- **`src/onvif/ws-discovery.js`** — WS-Discovery: Probe ke multicast `239.255.255.250:3702`, kumpul
  ProbeMatch (XAddr + scope name/hardware), `dgram` + `crypto.randomUUID`.
- **`src/onvif/media.js`** — Device+Media: `GetDeviceInformation`, cari Media XAddr via
  `GetCapabilities`, `GetProfiles`, `GetStreamUri`, dan `resolveStreamUris()` (onboarding 1-panggil:
  pilih profil res tertinggi = main, terendah = sub).
- **`src/drivers/onvif-driver.js`** — implementasi kontrak driver: `discover()`, `resolveStreamUris()`,
  `getStreamUri()` (delegasi ke camera-manager), `listChannels()`, `getCapabilities()` (Fase 1: hanya
  streaming `true`).
- **`scripts/test-onvif.js`** — 32 unit test logika murni (`npm run test:onvif`).

### File diubah (backend)
- **`src/drivers/device-driver.js`** — `_load('onvif')` mengaktifkan onvif-driver.
- **`src/camera-manager.js`** — helper `injectRtspCredentials()`; cabang ONVIF di
  `buildRtspUrlForQuality` kini **menyuntik `user:pass`** ke stream URI bebas-kredensial dari device.
- **`src/router.js`** (backup `*.bak.20260630-172305`) — endpoint baru:
  `POST /api/onvif/discover` (creds-free, balas `{devices}`) & `POST /api/onvif/profiles`
  (resolve profil+URI, di-guard token bila `CCTV_API_TOKEN` aktif).

### File diubah (frontend)
- **`public/index.html`** — opsi Brand **"ONVIF (generic)"** + blok `#onvif-block` (tombol Discover,
  Get profiles, daftar device, dropdown profil).
- **`public/js/app.js`** — `readFormFields` tambah `protocol`; `applyBrandMode()` (tampil/sembunyi blok
  ONVIF, sembunyikan "Test connection" ISAPI saat ONVIF); `onvifDiscover()`/`onvifGetProfiles()`;
  cabang **simpan ONVIF** (POST/PUT `protocol:'onvif'` + `onvif{port,xaddr,profileToken,streamUri,
  streamUriSub}`); `loadCamerasFromAPI` & `enterEditMode` round-trip `protocol`/`onvif`.

### Alur UI (operator)
Settings → Cameras → Add Camera → Brand **ONVIF** → **Discover ONVIF** (atau ketik IP) → isi
user/pass → **Get profiles** (pilih profil) → **Save camera**. Kamera live di grid lewat go2rtc
seperti kamera ISAPI.

**Perbaikan lapangan (2026-07-02):**
- **Discovery multi-interface** (`ws-discovery.js`): probe dikirim ke SEMUA interface IPv4 (bukan
  cuma NIC default) + dikirim ulang 1× per interface. Memperbaiki host multi-NIC (WiFi + LAN +
  adapter VM). ⚠️ Catatan: multicast lewat **WiFi tetap tidak andal** (AP/IGMP-snooping sering
  men-drop `239.255.255.250`) → fallback tetap **ketik IP manual + Get profiles**.
- **Guard password kosong (bug lockout Hikvision):** API meredaksi password → form Edit terbuka
  dengan password KOSONG. Dulu klik "Test connection" mengirim password kosong → 401; diklik
  berulang → **Hikvision mengunci akun ±30 menit** (password benar pun ditolak). Kini: Test menolak
  jika password kosong (minta ketik ulang), dan **Update tidak lagi mengirim password kosong** (tidak
  menimpa password tersimpan). File: `public/js/app.js` (`runConnectionTest`, cabang update ISAPI).

**Update UI discovery (2026-07-02):** hasil discovery kini **kartu (card) yang bisa di-scroll**
(`grid auto-fill`, max-height 300px) dengan **checkbox multi-select** + toolbar (Select all,
counter, **Add selected (N)**). Klik body kartu = pilih PRIMARY untuk alur Get-profiles tunggal;
centang beberapa kartu + **Add selected** = **bulk onboarding** (tiap device: resolve profiles dgn
kredensial bersama → tambah kamera; status per-kartu ok/err). File: `public/index.html` (blok
`#onvif-toolbar` + `.onvif-devices`), `public/css/style.css` (`.onvif-card*`, di-backup
`style.css.bak.<ts6>`), `public/js/app.js` (`onvifDiscover` render kartu, `onvifAddSelected`,
`updateOnvifSelCount`). Verifikasi: `npm run check` (41 file), CSS balanced (909/909), boot serve OK.

### Verifikasi (terbukti, tanpa hardware)
- `npm run check` → **36 file lolos**; `npm run test:onvif` → **32/32 pass** (digest vs vektor
  referensi, envelope/fault SOAP, parse ProbeMatch/Profiles, injeksi kredensial, regresi ISAPI).
- **Boot test:** `POST /api/onvif/discover` → `{devices:[]}` (graceful timeout), `POST
  /api/onvif/profiles` IP mati → `{error:"ONVIF request timeout"}` — **server tetap hidup**.
- **Round-trip:** POST kamera `protocol:onvif` → persist + GET menampilkan objek `onvif` utuh →
  DELETE bersih (cameras.json kembali ke 1 kamera awal).

### ⚠️ TODO validasi lapangan (butuh kamera ONVIF nyata)
- WS-Discovery menemukan device di LAN sungguhan (multicast bisa diblokir switch/VLAN).
- WS-Security UsernameToken diterima device (sebagian device minta HTTP Digest → fallback sudah ada).
- `GetStreamUri` → RTSP yang benar-benar diputar go2rtc; cek heuristik main/sub per merek.

### Rollback (Fase 0 + Fase 1 sekaligus)
```bash
node scripts/rollback-v014.js --dry    # preview
node scripts/rollback-v014.js          # restore camera-manager/router/index/app + hapus src/onvif & src/drivers
npm run check
```

> **Langkah berikutnya:** Fase 2 (events PullPoint) — normalisasi event ONVIF ke `sse-broadcaster`
> yang sudah ada. Idealnya dikerjakan setelah Fase 1 divalidasi di kamera ONVIF nyata.

---

## 12. Fase 2 — IMPLEMENTASI (2026-07-01) ✅ (validasi hardware pending)

**Scope:** event deteksi realtime untuk kamera ONVIF via **PullPoint subscription**, masuk ke
**pipeline SSE yang sama** dengan ISAPI (`normalize → dedup → sse-broadcaster`) → toast/flash/overlay
di frontend jalan **tanpa perubahan UI**.

### File baru
- **`src/onvif/events.js`** — Events service: `getEventsXAddr` (via GetCapabilities, fallback
  `/onvif/Events`), `createPullPoint` (CreatePullPointSubscription → alamat subscription),
  `pull` (PullMessages long-poll dgn header WS-Addressing), `unsubscribe`, dan parser toleran
  (`parseNotifications`, `extractSubscriptionAddress`, `isActive`).
- **`src/onvif/onvif-event-manager.js`** — satu loop long-poll per kamera ONVIF (pola resilien dari
  `alert-stream-manager`: flag `closing`, timer ter-track, backoff eksponensial dicap 120s). `init()`
  memulai loop utk semua kamera ONVIF + `onCameraChange` (add/remove/update runtime). `stop()`
  unsubscribe + bersihkan.

### File diubah
- **`src/onvif/soap-client.js`** — `buildEnvelope` tambah namespace `tev`/`wsnt`/`wsa`; `call()`
  terima `opts.headerXml`; helper `wsaHeaders(action,to)` (PullMessages butuh WS-Addressing).
- **`src/events/event-normalizer.js`** (backup `*.bak.20260701-114450`) — `normalizeOnvifEvent(note,
  cameraId)`: petakan topic ONVIF → detectorId (`motion`/`line`/`loitering`/`face`, match substring
  case-insensitive lintas-vendor), buang event inactive & topic sistem (tamper/audio).
- **`src/server.js`** (backup `*.bak.20260701-114450`) — init `onvif-event-manager` (kecuali
  `ONVIF_EVENTS=false`) + `stop()` di kedua handler shutdown.

### Verifikasi (terbukti, tanpa hardware)
- `npm run check` → **38 file lolos**; `npm run test:onvif` → **53/53 pass** (tambah: wsaHeaders,
  parse PullMessages/SubscriptionReference, isActive true/false, mapping topic→detector, inactive &
  system→null, ts dari UtcTime).
- **Boot test:** startup log `[onvif-events] no ONVIF cameras — idle` + `[onvif] Event listeners
  starting…`; tambah kamera ONVIF (IP mati) saat runtime → **server tetap hidup**, loop mencoba
  subscribe lalu di-short-circuit `closing` saat kamera dihapus; shutdown bersih, tanpa proses yatim.

### ⚠️ TODO validasi lapangan (butuh kamera ONVIF nyata)
- CreatePullPointSubscription + PullMessages diterima device (string `wsa:Action` & skema notifikasi
  bervariasi antar-merek — parser dibuat toleran, tapi perlu dicek nyata).
- Mapping topic → detektor cocok dgn topik asli perangkat (mis. `CellMotionDetector` vs `MotionAlarm`).

### Rollback (Fase 0 + 1 + 2 sekaligus)
```bash
node scripts/rollback-v014.js --dry    # preview
node scripts/rollback-v014.js          # restore camera-manager/router/index/app/server/event-normalizer + hapus src/onvif & src/drivers
npm run check
```

> **Langkah berikutnya:** Fase 3 (PTZ ONVIF) — service PTZ + panel kontrol di tile. Idealnya setelah
> Fase 1 & 2 divalidasi di kamera ONVIF nyata.

---

## 13. Fase 3 — IMPLEMENTASI (2026-07-01) ✅ (validasi hardware pending)

**Scope:** kontrol **PTZ** (pan/tilt/zoom) untuk kamera ONVIF — fitur yang jalur ISAPI kita belum
punya. Pad kontrol muncul di tile hanya untuk kamera ONVIF yang mengiklankan PTZ.

### File baru
- **`src/onvif/ptz.js`** — `getPtzXAddr`/`hasPtz` (via GetCapabilities PTZ), `continuousMove`
  (velocity ternormalisasi −1..1, di-clamp), `stop`, + builder murni `buildMoveBody`/`buildStopBody`
  (untuk unit test).

### File diubah
- **`src/onvif/soap-client.js`** — namespace `tptz` (ver20/ptz) di envelope.
- **`src/drivers/onvif-driver.js`** — `ptz(cam, {action,pan,tilt,zoom})`; `resolveStreamUris` kini
  mendeteksi PTZ (`r.ptz`) saat onboarding.
- **`src/router.js`** — endpoint `POST /api/onvif/ptz/:id` (move/stop, di-guard token).
- **`public/index.html`/`public/js/app.js`** — tombol **PTZ** di controls-bar tile (muncul bila
  `cam.onvif.ptz`), **pad 3×3** (tilt/pan/zoom + stop) tekan-tahan = move, lepas = stop
  (`onvifPtzStart`/`onvifPtzStop`); flag `ptz` disimpan saat onboarding, round-trip via list().

### Verifikasi (terbukti, tanpa hardware)
- `npm run check` → **39 file lolos**; `npm run test:onvif` → **61/61 pass** (clamp, move/stop body,
  driver expose ptz).
- **Boot test:** add kamera ONVIF+PTZ → `ptz:true` persist; `POST /api/onvif/ptz/:id` move & stop ke
  IP mati → `502 {"error":"ONVIF request timeout"}` (tanpa crash); cam tak ada → `404`; `/health`
  hidup; cleanup bersih.

### ⚠️ TODO validasi lapangan
- ContinuousMove/Stop diterima device; sebagian model butuh **speed space** node PTZ spesifik (di sini
  pakai generic normalized −1..1). GetCapabilities PTZ mengembalikan XAddr yang benar.

### Rollback (Fase 0 + 1 + 2 + 3)
```bash
node scripts/rollback-v014.js --dry
node scripts/rollback-v014.js
npm run check
```

> **Langkah berikutnya:** Fase 4 (playback Profile G) — `FindRecordings` + `GetReplayUri` (RTSP
> `Range:`), fallback "tidak didukung" untuk device tanpa Profile G. Idealnya setelah Fase 1–3
> divalidasi di kamera ONVIF nyata.

---

## 14. Fase 4 — IMPLEMENTASI (2026-07-01) ✅ (validasi hardware pending)

**Scope:** playback rekaman kamera ONVIF via **Profile G** (Recording Search + Replay), diputar lewat
go2rtc seperti playback ISAPI. Profile G **tak merata** antar-merek → digerbangi capability; device
tanpa Profile G tak menampilkan tombol playback. Kamera Hikvision tetap pakai jalur ISAPI yang matang.

### File baru
- **`src/onvif/replay.js`** — Search+Replay: `getSearchXAddr`/`getReplayXAddr`, `hasProfileG`,
  `getRecordingSummary` (dataFrom/dataUntil/count), `findRecordings` (FindRecordings +
  GetRecordingSearchResults → token), `getReplayUri` (RTSP replay, credential-free), parser toleran.

### File diubah
- **`src/webrtc/playback-stream.js`** (backup `*.bak.20260701-123040`) — `startPlaybackFromUrl(cameraId,
  rtspUrl)`: daftarkan RTSP replay yang sudah di-resolve ke go2rtc (reuse ffmpeg source + cleanup);
  stop via `/api/playback/stream/stop` yang sudah ada.
- **`src/drivers/onvif-driver.js`** — `searchRecordings(cam)` (summary+token), `getReplayUri(cam,token)`
  (inject kredensial); `resolveStreamUris` deteksi `profileG` saat onboarding.
- **`src/camera-manager.js`** — ekspor `injectRtspCredentials`.
- **`src/router.js`** — `GET /api/onvif/playback/summary?cam=ID` + `POST /api/onvif/playback/start
  {cam,token}` (guard token).
- **`public/js/app.js`** — tombol playback ONVIF di tile (bila `cam.onvif.profileG`) + **modal ONVIF
  playback minimal & terisolasi** (dibangun dinamis, WebRTC sendiri, tak menyentuh state playback
  ISAPI): summary → daftar recording → putar via go2rtc; flag `profileG` disimpan saat onboarding.

### Verifikasi (terbukti, tanpa hardware)
- `npm run check` → **40 file lolos**; `npm run test:onvif` → **68/68 pass** (parse recording token,
  driver export search/replay, playback-stream export).
- **Boot test:** kamera ONVIF+Profile G → `profileG:true` persist; `summary` & `start` ke IP mati →
  `502` graceful; `summary` pada kamera non-ONVIF → `400`; `/health` hidup; cleanup bersih.

### ⚠️ TODO validasi lapangan + batasan diketahui
- FindRecordings/GetReplayUri diterima device (skema & scope bervariasi; parser toleran).
- **Seek presisi belum ada:** go2rtc ffmpeg source tak set RTSP `Range` pada PLAY → Fase 4 memutar
  rekaman **dari awal**. Scrubber per-waktu ONVIF = follow-up (butuh hardware untuk pastikan semantik
  Range/ReplayUri per merek).

### Rollback (Fase 0–4)
```bash
node scripts/rollback-v014.js --dry
node scripts/rollback-v014.js
npm run check
```

> **Langkah berikutnya:** Fase 5 (analytics config) — GetAnalyticsModules + gating UI penuh. Paling
> rapuh (dukungan vendor tak merata). Idealnya SETELAH Fase 1–4 divalidasi di kamera ONVIF nyata.

---

## 15. Fase 5 — IMPLEMENTASI (2026-07-01) ✅ (deteksi kapabilitas tervalidasi nyata)

**Scope:** deteksi kapabilitas ONVIF **read-only** — panel Analytics menampilkan detektor yang
benar-benar didukung perangkat (bukan default motion-only), plus deteksi PTZ/Profile-G lebih andal
lewat **satu `GetServices`** (menggantikan multi-call `GetCapabilities` yang lambat/menggantung di DVR
— penyebab timeout onboarding yang ditemukan di lapangan).

### File baru
- **`src/onvif/capabilities.js`** — `getServices` (namespaces → ptz/profileG/analytics/events/media2),
  `getSupportedDetectors` (`GetEventProperties` → TopicSet → {motion,line,loitering,face}),
  `probeCapabilities(cam)` → objek berbentuk `hwCapabilities` yang dibaca panel Analytics frontend.

### File diubah
- **`src/drivers/onvif-driver.js`** — `getCapabilities(cam)` kini **nyata** (probe); `resolveStreamUris`
  memakai **`GetServices`** untuk ptz/profileG (1 call, lebih andal).
- **`src/router.js`** — `probeCameraCapabilities` protocol-aware: kamera ONVIF diprobe via driver →
  `setHwCapabilities` + SSE `capabilities-updated`.
- **`src/server.js`** — startup memprobe kapabilitas semua kamera ONVIF (async) + broadcast.

### Verifikasi
- `npm run check` → **41 file lolos**; `npm run test:onvif` → **74/74 pass** (topic→detector, driver
  getCapabilities).
- ✅ **Real hardware (192.168.1.185):** `getServices` → `{analytics:true, events:true, ptz:false,
  profileG:false}`; `GetEventProperties` → `{motion:true}`; hwCapabilities final `{motion:true, sisanya
  false}` — **akurat** (kamera fixed, hanya motion). Panel Analytics kini menampilkan ini, bukan default.
- ✅ **Events (Fase 2) tervalidasi:** subscribe PullPoint **berhasil** di .185.

### ⚠️ Temuan lapangan + TODO
- **Timeout onboarding DVR (.180:89):** `GetSystemDateAndTime` (tanpa auth) OK → service reachable;
  timeout ada di panggilan ber-auth. Diperbaiki dengan pindah ke `GetServices` (1 call). Perlu re-test
  di DVR nyata dengan kredensial ONVIF (Hikvision: ONVIF harus di-enable + user ONVIF khusus).
  **Update 2026-07-02:** kandidat akar masalah lain — jam device meleset menolak WS-Security
  UsernameToken; kini ditangani clock-offset otomatis (§16 fix 3). Re-test .180 setelah hardening.
- **Long-poll events `socket hang up`:** kamera menutup koneksi idle PullMessages → loop resubscribe
  15s (kehilangan event di sela). ✅ **FIXED di §16 fix 2** (retry pull di subscription yang sama +
  backoff awal 3s + Renew periodik) — tervalidasi di kamera .185.
- **person/vehicle/lpr:** bukan topic ONVIF standar → selalu false kecuali via metadata analytics
  (di luar scope Fase 5). Konfigurasi rule ONVIF (set line/field) = follow-up.

### Rollback (Fase 0–5)
```bash
node scripts/rollback-v014.js --dry
node scripts/rollback-v014.js
npm run check
```

> **ONVIF: Fase 0–5 lengkap.** Sisa pekerjaan = pengujian lapangan (DVR/PTZ/Profile-G) + tuning
> (keepalive events, konfigurasi rule analytics, seek presisi playback).

---

## 16. Hardening pasca-review (2026-07-02) ✅

**Scope:** perbaikan 6 temuan deep code review atas implementasi Fase 0–5 — tanpa fitur baru.
Backup semua file yang diubah: `*.bak.<ts>` dengan ts di `Docs/.v014-hardening-backup-ts.txt`
(revert parsial manual; rollback penuh tetap `scripts/rollback-v014.js`, tak perlu diubah karena
semua file yang disentuh memang bagian V-014).

### Koreksi pemahaman (penting)
Review awal melabeli "tidak ada `Renew` → subscription PullPoint mati setelah 60s" sebagai bug
kritis. **Itu tidak akurat**: per ONVIF Core Spec, tiap `PullMessages` otomatis memperpanjang
TerminationTime — terbukti kamera .185 hidup terus tanpa Renew. `Renew` tetap ditambahkan sebagai
**safety** untuk vendor yang tidak patuh spec (best-effort, gagal di-swallow).

### Fix 1 — Promise hang pada cap 2MB (`src/onvif/soap-client.js`)
`req.destroy()` tanpa argumen error tidak meng-emit `error`/`end` → promise `httpPost` tak pernah
settle → caller menggantung diam-diam. Kini `req.destroy(new Error('ONVIF response too large (>2MB)'))`.

### Fix 2 — Loop event: retry pull sebelum buang subscription (`src/onvif/onvif-event-manager.js`)
Dulu: SATU pull gagal (device menutup long-poll idle → "socket hang up") = subscription dibuang →
tunggu 15s → subscribe ulang; event di sela hilang. Kini: pull gagal di-retry **2× di subscription
yang sama** (jeda 1s) sebelum re-subscribe; backoff awal re-subscribe 15s → **3s** (cap 120s tetap).
Window kehilangan event menyusut dari ≥15s ke ~1s. ✅ Tervalidasi nyata di .185: log
`pull failed (1/2): socket hang up — retrying same subscription` lalu pulih tanpa re-subscribe.

### Fix 3 — Clock-offset dari GetSystemDateAndTime (`ws-security.js` + `soap-client.js`)
Gap desain §7 vs kode: `Created` WS-Security dihitung dari jam lokal server; device dengan jam
meleset menolak token → semua call ber-auth gagal (kandidat akar masalah DVR .180). Kini: bila call
ber-auth gagal dengan indikasi auth (401 / fault NotAuthorized), server fetch
`GetSystemDateAndTime` **tanpa auth**, hitung `offsetMs = jamDevice − jamLokal`, cache per host:port,
dan retry SEKALI dengan `Created` di jam device. Parser `parseSystemDateAndTime()` diekspor + di-test.

### Fix 4 — WS-Addressing MessageID/ReplyTo + Renew periodik (`soap-client.js`, `events.js`)
`wsaHeaders()` kini menyertakan `wsa:MessageID` (urn:uuid) + `wsa:ReplyTo` anonymous (device strict
bisa menolak tanpa ini). `events.renew()` baru — dipanggil best-effort tiap 30s dari loop event.

### Fix 5 — Warn skema notifikasi tak dikenal (`events.js`)
`isActive()` default `true` bila skema tak cocok pattern SimpleItem/PropertyOperation — kini
`console.warn` **sekali per topic unik** supaya vendor aneh terlihat saat onboarding, bukan
misklasifikasi diam-diam.

### Fix 6 — Minor
- `router.js` `/api/onvif/profiles`: validasi port 1–65535 (400 bila di luar range).
- `onvif-driver.js`: `subscribeEvents: null` (patuhi kontrak feature-detect; event dikelola global
  oleh onvif-event-manager, bukan per-kamera via driver).
- `ws-discovery.js`: socket yang error (bind/send gagal di NIC mati) di-close DAN dihapus dari pool.

### Fix 7 — Instance duplikat keluar bersih pada EADDRINUSE (`src/server.js`)
Temuan lapangan (2026-07-02, saat menjalankan `node src/server.js` kedua kalinya): error `listen`
di-emit async di object server → jatuh ke handler `uncaughtException` global yang sengaja TIDAK
exit → instance duplikat jalan **setengah-hidup** (ISAPI connect, PullPoint subscribe, go2rtc spawn
dgn bind error 1984/8554) tanpa pernah melayani HTTP. Kini: handler `server.on('error')` khusus —
pesan jelas ("Port 3000 is already in use — is another ENGINE-CCTV instance running?"), stop semua
manager (helper `stopAllManagers()`, dipakai juga oleh SIGINT/SIGTERM yang tadinya duplikat), exit 1.
✅ Terbukti: instance A jalan → instance B exit code 1 dgn pesan jelas, go2rtc milik B ikut mati,
proses & port A tak terganggu.

### Verifikasi (terbukti)
- `npm run check` → **41 file lolos**; `npm run test:onvif` → **88/88 pass** (74 lama + 14 baru:
  parseSystemDateAndTime, Created+clockOffset, MessageID/ReplyTo, Renew body, skema-aneh→active,
  subscribeEvents null, **integrasi lokal cap 2MB → reject bukan hang**).
- **Boot test + hardware nyata (.185):** `/health` OK, subscribe PullPoint OK, retry-pull terbukti
  menangani `socket hang up` DAN `Parse Error: Data after Connection: close` tanpa re-subscribe;
  validasi port 400 OK; duplikat-instance exit bersih (fix 7).
- ⚠️ Catatan jujur pengujian: boot test pertama sesi hardening sempat meninggalkan proses yatim —
  bukan bug shutdown app, melainkan `kill` Git Bash yang tidak mematikan node di Windows + cek
  orphan yang cacat. Pelajaran: verifikasi orphan pakai `Get-NetTCPConnection`/`taskkill //F //PID`,
  bukan `kill`/`ps` Git Bash.

### Fix 8–11 — Audit ulang (2026-07-02 sore)
Audit kedua (adversarial terhadap hardening + sapuan segar) menemukan 2 bug di fix baru + 1 gap lama:
- **Fix 8 — Re-learn clock-offset (`soap-client.js`)**: cache offset tadinya dipelajari SEKALI
  (`!clockOffsets.has(key)`) → device yang di-NTP-sync belakangan memakai offset basi → auth gagal
  permanen sampai restart. Kini: setiap auth failure re-fetch offset, update cache, retry bila beda
  >5s dari yang dipakai attempt tsb.
- **Fix 9 — Persempit `looksLikeAuthFailure` (`soap-client.js`)**: regex lama memuat `sender`/`auth`
  telanjang — `env:Sender` adalah kode SOAP 1.2 generik utk SEMUA error klien → fetch/retry palsu.
  Kini hanya `401 | not authorized | unauthorized`. Bonus: `extractFault` kini prioritas
  Reason → **Subcode** (ter:NotAuthorized) → Code (dulu Subcode tertutup Code luar).
- **Fix 10 — Dukungan HTTPS xaddr (`soap-client.js`)**: `httpPost` kini protocol-aware
  (http/https, default port 443 utk https, `rejectUnauthorized:false` — kamera CCTV self-signed,
  trust model LAN). Device Axis/Bosch modern yang HTTPS-only kini bisa onboard.
- **Fix 11 — Minor**: `media.deviceXAddr` bracket IPv6 per RFC 3986; `/api/onvif/discover` masuk
  guard `CCTV_API_TOKEN` (konsistensi; WS-Discovery-nya sendiri tetap tanpa kredensial device);
  `onvif-event-manager` menyimpan auth SAAT subscribe → unsubscribe pakai kredensial subscription
  itu dibuat (bukan kredensial baru pasca-edit kamera → subscription yatim di device).

Temuan audit yang **DITOLAK** setelah verifikasi manual (dicatat agar tak diangkat lagi):
"NVR sync menghapus field ONVIF" (replaceRecorderCameras hanya menyentuh kamera ber-`recorderId`
sama — kamera ONVIF standalone aman; kehilangan hanya bila channel recorder manual di-ONVIF-kan =
workflow tak lazim); "splice race ws-discovery" (JS single-threaded, handler tak bisa menyela for-of
sinkron); "test 2MB bisa hang" (Promise.race reject 8s → close tetap jalan); "ReDoS katastrofik"
(lazy quantifier + literal anchor = polinomial, bukan eksponensial).

Verifikasi fix 8–11: `npm run check` 41 file; `npm run test:onvif` **96/96 pass** (+8: matriks
looksLikeAuthFailure 401/NotAuthorized/Subcode/generic-Sender/200, deviceXAddr IPv4/IPv6/bracket);
boot test dgn kamera .185: subscribe OK, retry-pull OK, `/health` OK, shutdown bersih.

### Fix 12 — Abort onboarding di auth-reject pertama (`media.js`, uji lapangan 2026-07-02 sore)
Uji lapangan .180 membuktikan: satu onboarding dgn kredensial salah menembakkan 3+ call ber-auth
(masing2 + retry digest) → **DVR Hikvision langsung lock akun ±30 menit** ("entering wrong
username/password many times"). Kini `resolveStreamUris` berhenti di call PERTAMA yang ditolak
auth (401/NotAuthorized/locked) dgn error jelas, tidak lanjut menghantam device.

### 📋 Hasil uji lapangan DVR .180:89 (2026-07-02)
- Device hidup, HTTP port 89 open; `GetSystemDateAndTime` tanpa auth OK (kadang transient timeout —
  device lambat saat sibuk, timeout 8s bisa kurang).
- **Jam DVR SINKRON (-3s)** → hipotesis clock-skew utk .180 **GUGUR** (fix 3/8 tetap berguna utk
  device lain yang jamnya meleset).
- **Akar masalah sebenarnya: kredensial** — password admin bersama site TIDAK berlaku utk ONVIF
  DVR ini → `ONVIF 401 … device is locked … try after 30 minutes`. Kemungkinan besar DVR perlu
  **Integration Protocol/ONVIF di-enable + user ONVIF khusus** dibuat (Configuration → Network →
  Advanced → Integration Protocol) — perilaku standar Hikvision.
- Kesimpulan: "timeout di call ber-auth" yang lama kemungkinan besar adalah gejala auth/lockout
  ini sejak awal, bukan clock-skew.

### ⚠️ TODO lapangan setelah hardening
- Re-test onboarding DVR .180:89 **setelah** ONVIF di-enable + user ONVIF dibuat di DVR (tunggu
  lockout lepas ±30 menit; kredensial admin site terbukti ditolak).
- PTZ & Profile-G playback: WS-Discovery 0 hasil di jaringan ini (multicast tak lewat — isu WiFi
  terdokumentasi §11) → butuh IP + kredensial PTZ dome (DS-2DF8236IV) utk uji manual by-IP.
- Backlog non-ONVIF (audit fondasi): race tulis cameras.json (CRUD vs NVR sync), MJPEG FFmpeg
  SIGTERM tanpa fallback SIGKILL, kredensial plaintext di JSON.
</content>
</invoke>
