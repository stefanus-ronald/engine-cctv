# Perbandingan Platform NVR: Shinobi · Frigate · LightNVR · ENGINE-CCTV (kita)

> Dibuat: 29 Juni 2026 · Fakta Frigate & Shinobi diverifikasi via sumber resmi (lihat [Sumber](#sumber)).
> Dokumen pendamping: [LightNVR-Ringkasan.md](LightNVR-Ringkasan.md) (bedah kode sumber LightNVR).

---

## 0. TL;DR — Jawaban cepat: "Bukannya engine kita sudah pakai itu?"

**Tidak — engine kita BUKAN Shinobi/Frigate/LightNVR.** ENGINE-CCTV adalah NVR **buatan sendiri** (Node.js). Yang sama dengan mereka hanyalah **komponen infrastruktur di bawahnya**, bukan platformnya:

| Komponen | Kita pakai? | Siapa lagi yang pakai |
|----------|-------------|----------------------|
| **go2rtc** (engine WebRTC/RTSP) | ✅ Ya | Frigate (bundling), LightNVR. Shinobi **tidak**. |
| **FFmpeg** (decode/transcode) | ✅ Ya | Frigate, Shinobi, LightNVR — semua pakai |
| **Node.js** runtime | ✅ Ya | Shinobi juga Node.js. Frigate=Python, LightNVR=C |
| Platform NVR jadi (Shinobi/Frigate/LightNVR) | ❌ **Tidak** | — |

Jadi: kita **berbagi fondasi** (go2rtc + FFmpeg) dengan Frigate & LightNVR, tapi **logika NVR, UI, ISAPI Hikvision, playback NVR, dan manajemen kamera kita tulis sendiri**. Analoginya: kita & Frigate sama-sama pakai "mesin" go2rtc, tapi "mobil"-nya beda.

> **Catatan lapisan AI:** Research di `E:\PROJECT\CCTV\RESEARCH` (InsightFace, DeepFace, PPE-YOLO, custom ONNX) adalah **lapisan deteksi AI** — setara dengan apa yang Frigate lakukan *di dalam* dirinya. Rencana kita: deteksi AI jadi **service Python terpisah** (via `vca-proxy.js`), bukan dibenamkan ke core seperti Frigate.

---

## 1. Perbandingan Stack / Infrastruktur

| Aspek | 🟢 ENGINE-CCTV (kita) | 🔴 Frigate | 🟡 Shinobi | 🔵 LightNVR |
|-------|----------------------|-----------|-----------|-------------|
| **Bahasa backend** | Node.js (zero-framework) | Python (FastAPI/Uvicorn) | Node.js (Express) | C |
| **Frontend** | Vanilla JS SPA | React + TypeScript | Dashboard web + jsmpeg | Preact + Tailwind + Vite |
| **Database** | File JSON (`cameras.json`, `nvrs.json`) | SQLite (Peewee ORM) | MariaDB/MySQL atau SQLite | SQLite (42 migrasi) |
| **Realtime ke browser** | SSE + WebRTC/MJPEG | WebSocket + go2rtc | Socket.io | libuv + go2rtc |
| **Streaming engine** | **go2rtc** + FFmpeg | FFmpeg + **go2rtc (bundling v1.9.10)** | **FFmpeg** (per kamera) | FFmpeg + **go2rtc** |
| **Web server** | Node `http` murni | nginx + FastAPI | Express | libuv + llhttp |
| **Target kamera** | **Hikvision (ISAPI mendalam)** | Generic RTSP/ONVIF | Generic RTSP/ONVIF | Generic RTSP/ONVIF |
| **Lisensi** | **MIT** | **MIT** | ⚠️ Pro=EULA komersial / CE=GPLv3 | GPLv3 |
| **Deploy** | npm + binary go2rtc | Docker / HA Add-on | Docker / script | Docker / systemd |

**Catatan penting stack:**
- **Frigate membungkus go2rtc di dalam container-nya** (sama persis fondasi dengan kita), ditambah FFmpeg untuk decode. go2rtc opsional di Frigate tapi direkomendasikan untuk MSE/WebRTC.
- **Shinobi tidak berpusat pada go2rtc** — ia spawn **1 proses FFmpeg per monitor/kamera**, jadi resource naik linear dengan jumlah kamera.
- **LightNVR & kita** sama-sama jadikan go2rtc backbone, bedanya bahasa (C vs Node.js) dan kita fokus Hikvision.

---

## 2. Perbandingan Fitur

| Fitur | 🟢 ENGINE-CCTV | 🔴 Frigate | 🟡 Shinobi | 🔵 LightNVR |
|-------|---------------|-----------|-----------|-------------|
| **Live WebRTC** | ✅ (go2rtc) | ✅ (go2rtc) | ⚠️ terbatas (tipe "Streamer") | ✅ (go2rtc) |
| **Fallback** | MJPEG | jsmpeg / MSE | MJPEG / MSE / HLS / FLV | HLS |
| **Deteksi motion** | Hardware kamera (ISAPI) | ✅ Built-in (low-overhead) | ✅ Built-in (pixel/pam-diff) | ✅ Built-in + ONVIF |
| **Deteksi objek AI (on-frame)** | ❌ (rencana: service Python) | ✅✅ **Inti produk** | ⚠️ Via plugin eksternal | ✅ (SOD/TFLite/API) |
| **Akselerator AI** | — (rencana ONNX/GPU) | Coral, OpenVINO, TensorRT, ROCm, Hailo | TF, Coral, DeepStack/CodeProject.AI | SOD, TFLite/XNNPACK |
| **Zona deteksi** | ❌ belum | ✅ Poligon (bottom-center bbox) | ✅ Region | ✅ Poligon (ray-casting) |
| **Recording sendiri** | ❌ (andalkan NVR) | ✅ MP4 (tanpa re-encode) | ✅ + multi-storage + cloud | ✅ MP4/HLS |
| **Playback rekaman** | ✅ **dari NVR (ISAPI)** | ✅ dari rekaman sendiri | ✅ timeline + timelapse | ✅ timeline |
| **Retention policy** | (di NVR) | per-kamera, alerts/detections | age/size auto-purge | **4-tier + protected** |
| **PTZ** | (via ISAPI) | ✅ (ONVIF) | ✅ | ✅ (ONVIF) |
| **MQTT** | ❌ belum | ✅ (opsional) | ✅ | ✅ |
| **Home Assistant** | ❌ | ✅✅ (HACS, erat) | ⚠️ komunitas | ✅ (MQTT discovery) |
| **NVR auto-sync channel** | ✅✅ **(impor semua channel)** | ❌ | ❌ | ❌ |
| **Face recognition / LPR** | (rencana, research) | ✅ (bawaan 0.16) | ✅ (plugin) | ❌ |
| **Auth / MFA** | Token opsional | ✅ (auth + roles) | ✅ (LDAP/OAuth) | ✅ TOTP + RBAC |

**Sorotan:**
- **Frigate = juara deteksi AI.** Pipeline 2-tahap: motion murah dulu → object detection (mahal) hanya di area bergerak. Mendukung face recognition + LPR sejak 0.16. Integrasi Home Assistant paling erat.
- **Shinobi = paling fleksibel/serba-bisa** tapi deteksi objek harus via plugin eksternal, dan motion-nya pixel-based klasik.
- **LightNVR = paling ringan** + retention paling canggih (4-tier).
- **Kita = paling dalam untuk Hikvision** (ISAPI line-crossing arah panah, sensitivity, NVR auto-sync, playback langsung dari NVR) — sesuatu yang **tak satupun** dari tiga platform lain punya.

---

## 3. Perbandingan Performa

| Aspek | 🟢 ENGINE-CCTV | 🔴 Frigate | 🟡 Shinobi | 🔵 LightNVR |
|-------|---------------|-----------|-----------|-------------|
| **Beban CPU** | Sedang (go2rtc copy + FFmpeg MJPEG saat fallback) | **Tinggi** tanpa akselerator (butuh AVX+AVX2, GPU decode disarankan) | **Naik linear** per kamera (1 FFmpeg/monitor) | **Sangat rendah** (target 256MB) |
| **RAM** | Sedang | Tinggi (Semantic Search butuh ≥8GB; `/dev/shm` per kamera) | Sedang–tinggi | **256MB minimum** |
| **Butuh akselerator AI?** | Tidak (deteksi AI di service terpisah) | **Sangat disarankan** (CPU "hanya untuk testing") | Untuk plugin AI: ya | Opsional (XNNPACK) |
| **GPU untuk decode** | go2rtc copy → tak perlu decode untuk live | **Sangat disarankan** (QSV/VAAPI/NVDEC) | Opsional (hwaccel RPi/Rockchip) | Opsional |
| **Skala kamera** | Banyak (go2rtc 1 koneksi/kamera, live = copy) | Dibatasi kemampuan detektor & decode | Dibatasi jumlah proses FFmpeg | Banyak (hemat memori) |
| **Latensi live** | Rendah (WebRTC go2rtc) | Rendah (MSE/WebRTC); fallback jsmpeg | Rendah (MSE/Poseidon) | Rendah (WebRTC) |
| **Raspberry Pi** | Bisa (tergantung jumlah) | Pi 4/5 didukung (perlu detektor) | Pi 3/4 (dalam batas CPU) | **Ideal** (dibuat untuk SBC) |

**Insight performa kunci:**
- **Frigate berat** karena melakukan AI inference + decode video. Tanpa Coral/OpenVINO/GPU, CPU cepat jenuh. Update penting: **Coral TPU sudah BUKAN rekomendasi utama** lagi (kecuali untuk konsumsi daya rendah); Hailo-8/Intel Arc/GPU modern lebih cepat. **Coral tidak membantu decode video** — itu beban terpisah.
- **Decode vs detect stream:** Frigate (dan praktik terbaik umum) pakai **substream low-res (720p, 5fps)** untuk deteksi, **mainstream high-res** untuk rekam. Pola ini layak kita tiru kalau menambah AI.
- **Shinobi linear scaling** — tiap kamera = proses FFmpeg sendiri. Pakai substream untuk motion agar hemat.
- **Engine kita unggul untuk live** karena go2rtc me-*relay* stream (copy, tanpa re-encode) → live view murah. Beban baru muncul kalau kita tambah AI detection (decode + inference), itupun bisa di-offload ke service Python/GPU terpisah.

---

## 4. Perbandingan Lisensi (PENTING untuk komersial)

| Platform | Lisensi | Boleh komersial-tertutup? |
|----------|---------|---------------------------|
| **ENGINE-CCTV (kita)** | **MIT** | ✅ Bebas |
| **Frigate** | **MIT** (core). Frigate+ = SaaS berbayar opsional | ✅ Bebas (core) |
| **LightNVR** | **GPLv3** (+ commercial license berbayar) | ❌ Tidak tanpa beli lisensi |
| **Shinobi Pro** | ⚠️ **Custom EULA** — gratis hanya non-komersial; komersial wajib langganan | ❌ Wajib bayar langganan |
| **Shinobi CE** | GPLv3 + AGPLv3 | ⚠️ Boleh, tapi wajib pertahankan logo/notis + fitur terbatas |
| **go2rtc** | **MIT** | ✅ Bebas (aman jadi backbone) |
| **FFmpeg** | LGPL/GPL (tergantung build) | ✅ (pakai build LGPL) |

**Kesimpulan lisensi:** Untuk produk komersial-tertutup, **engine kita (MIT) + go2rtc (MIT) adalah kombinasi paling aman.** Hindari menyalin kode LightNVR (GPLv3) dan Shinobi Pro (EULA). Frigate MIT — aman untuk **belajar/meniru pola**, bahkan memakai komponennya.

---

## 5. Posisi ENGINE-CCTV kita

```
                 Ringan ◄───────────────────────► Kaya fitur AI
   LightNVR ●            ● ENGINE-CCTV               ● Frigate
  (embedded)         (Hikvision/ISAPI,            (AI-first,
                      NVR-centric)                 HA-centric)
                                  ● Shinobi
                              (serba-bisa, plugin)
```

**Diferensiasi kita yang TIDAK dimiliki yang lain:**
1. **Integrasi Hikvision ISAPI mendalam** — line-crossing dengan arah panah, sensitivity API, capabilities probe, baca status HDD/SD/NAS.
2. **NVR/DVR auto-sync** — impor semua channel otomatis dari recorder, kelompok per-NVR.
3. **Playback langsung dari NVR** — tidak perlu rekam ulang → hemat storage masif (NVR sudah punya HDD-nya sendiri).
4. **MIT + Node.js + zero-build** — mudah dikembangkan, diaudit, dan bebas dipakai komersial.

**Yang bisa kita serap (urut prioritas):**
1. **AI object detection on-frame** (pola Frigate/LightNVR: JPEG snapshot go2rtc → service AI) — fondasi kita sudah lengkap (`vca-proxy.js` + SSE + overlay).
2. **Zona deteksi poligon** (pola ray-casting) — kurangi false positive.
3. **Substream untuk deteksi** (pola Frigate) — hemat CPU saat AI ditambahkan.
4. **MQTT → Home Assistant** — buka pasar integrasi smart-home.
5. **(Opsional) recording sendiri + retention 4-tier** (pola LightNVR) — hanya jika lepas dari NVR.

> Roadmap implementasi detail: lihat [LightNVR-Ringkasan.md §7b](LightNVR-Ringkasan.md).

---

## 6. Rekomendasi strategis

| Kebutuhan | Pilihan terbaik |
|-----------|----------------|
| Produk komersial Hikvision, kontrol penuh, playback dari NVR | ✅ **Lanjutkan ENGINE-CCTV kita** |
| Butuh deteksi AI canggih + Home Assistant, tidak masalah berat | Frigate (atau tiru polanya ke engine kita) |
| Perangkat super-hemat (SBC/embedded) | LightNVR (tapi GPLv3) |
| NVR serba-bisa cepat, banyak plugin | Shinobi (hati-hati lisensi Pro) |

**Kesimpulan:** Tidak perlu pindah platform. **Pertahankan ENGINE-CCTV** (keunggulan ISAPI + NVR-centric + MIT), lalu **serap pola AI detection dari Frigate/LightNVR** sebagai service terpisah memakai fondasi go2rtc + vca-proxy yang sudah kita miliki.

---

## Sumber

**Frigate** (diverifikasi): github.com/blakeblackshear/frigate (LICENSE = MIT), docs.frigate.video (object_detectors, zones, live, record, hardware, integrations/mqtt, integrations/home-assistant), frigate.video/plus.
**Shinobi** (diverifikasi): gitlab.com/Shinobi-Systems/Shinobi (LICENSE = custom EULA v1, 2018), gitlab.com/Shinobi-Systems/ShinobiCE (GPLv3+AGPLv3), docs.shinobi.video (installation, detect, detect/object, detect/motion), shinobi.video/features.
**LightNVR** (bedah kode sumber): github.com/opensensor/lightNVR — lihat [LightNVR-Ringkasan.md](LightNVR-Ringkasan.md).
**ENGINE-CCTV**: kode & docs internal (`src/`, `Docs/00-MASTER-SUMMARY.md`, `Docs/TECH-STACK.md`).

> ⚠️ Catatan akurasi: klaim "WebRTC sub-detik" Frigate adalah klaim komunitas, **tidak** tertulis di docs resmi. Versi/skema config Frigate mengacu generasi 0.16+. Lisensi Shinobi pernah berubah — verifikasi ulang file LICENSE live bila dipakai untuk keputusan hukum.
