# 16 - Hardware Catalog (Datasheet Reference)

## Deskripsi

Referensi lengkap spesifikasi hardware dari datasheet produk Hikvision yang diterima. Digunakan sebagai acuan saat memilih kamera baru, merencanakan instalasi, atau menambahkan support fitur di ENGINE-CCTV.

**Semua produk berikut mendukung ISAPI** — ENGINE-CCTV dapat probe capabilities-nya secara otomatis.

---

## IP Cameras

### DS-2CD1T47G3-LIU(F)/LS(L)(RB)

| Atribut | Nilai |
|---------|-------|
| **Tipe** | 4MP ColorVu 3.0 Fixed Bullet |
| **Sensor** | 1/3" Progressive Scan CMOS |
| **Resolusi** | 2560×1440 (max) |
| **Iluminasi min** | 0.0005 Lux (warna), 0 Lux dengan lampu |
| **Supplement Light** | IR + White Light (hybrid), up to 50m |
| **Form Factor** | Outdoor Bullet |
| **Smart Events** | **TIDAK ADA** |
| **Basic Events** | Motion detection (human/vehicle), video tampering, exception |
| **Deep Learning** | No |
| **API** | ONVIF Profile S/G, ISAPI, SDK |
| **Power** | PoE IEEE 802.3at (max 14.5W) / 12VDC |
| **Storage** | microSD up to 512GB (model -F) |
| **IP Rating** | IP67 |
| **Audio** | Built-in mic + speaker (-LSL/-LSRB) |
| **Catatan** | G3 generation, AI-ISP untuk noise reduction. Tidak ada Smart Events — ENGINE-CCTV akan label SW only (behavior benar). |

---

### DS-2CD23127/23167G3P-LIS2UY & DS-2CD2T127/2T167G3P-LIS2UY

> 4 model ini identik dalam spesifikasi VCA, berbeda hanya resolusi dan form factor (Turret vs Bullet).

| Atribut | DS-2CD23127G3P | DS-2CD23167G3P | DS-2CD2T127G3P | DS-2CD2T167G3P |
|---------|:-:|:-:|:-:|:-:|
| **Tipe** | Panoramic Turret | Panoramic Turret | Panoramic Bullet | Panoramic Bullet |
| **Resolusi** | 12MP | 16MP | 12MP | 16MP |
| **FOV** | 180° (2.8mm) | 180° (2.8mm) | 180° (2.8mm) | 180° (2.8mm) |

**Spesifikasi VCA (berlaku untuk semua 4 model):**

| Atribut | Nilai |
|---------|-------|
| **Sensor** | 1/1.8" Progressive Scan CMOS |
| **Iluminasi min** | 0.0008 Lux (warna), 0 Lux dengan lampu |
| **Supplement Light** | White Light + IR (hybrid), up to 30m |
| **Smart Events** | Line crossing, intrusion, region entrance, region exiting |
| **Basic Events** | Motion detection (human/vehicle), scene change detection, video tampering, exception |
| **Deep Learning** | Face Capture, Perimeter Protection (human/vehicle classifier) |
| **API** | ONVIF Profile S/G/T, ISAPI, SDK, ISUP |
| **Power** | PoE IEEE 802.3at (max 24W) / 12VDC |
| **Storage** | microSD up to 512GB |
| **WDR** | 130 dB |
| **IP Rating** | IP67, NEMA 4X (anti-corrosion) |
| **Audio** | Built-in mic + speaker, alarm I/O |
| **Scene Change** | Basic event (endpoint: `/ISAPI/Smart/SceneChangeDetection/{ch}`) |
| **Catatan** | Panoramic 180° — satu kamera = satu FOV lebar. High bandwidth due to resolution. |

---

### DS-2CD3041G2E-LIU

| Atribut | Nilai |
|---------|-------|
| **Tipe** | 4MP Dual Light Motion 2.0 Fixed Bullet |
| **Sensor** | (4MP) |
| **Form Factor** | Outdoor Bullet |
| **Smart Events** | Line crossing, intrusion detection |
| **Basic Events** | Motion detection (human/vehicle — Motion 2.0), video tampering, exception |
| **Deep Learning** | No |
| **API** | ONVIF Profile S/G, ISAPI, SDK |
| **Power** | PoE IEEE 802.3af (max 15.4W) — **bukan at** |
| **Storage** | — |
| **Catatan** | Smart events terbatas (Line + Intrusion saja). Motion 2.0 = human/vehicle via AI. PoE 802.3af — switch PoE standard cukup. |

---

### DS-2CD2546G2-IWS-C

| Atribut | Nilai |
|---------|-------|
| **Tipe** | 4MP AcuSense Mini Dome (WiFi) |
| **Form Factor** | Indoor/Outdoor Dome |
| **Smart Events** | Line crossing, intrusion, region entrance, region exit, scene change |
| **Basic Events** | Motion detection (human/vehicle), video tampering, exception |
| **Deep Learning** | Face Capture, Perimeter Protection |
| **API** | ONVIF Profile S/G/T, ISAPI, SDK |
| **Network** | WiFi (IWS = Indoor WiFi) + optional wired |
| **Power** | via WiFi / PoE (model -C = PoE variant?) |
| **IP Rating** | IP67, IK08 |
| **Scene Change** | Smart event (endpoint smart, bukan basic) |
| **Catatan** | Smart events terlengkap di kamera fixed. IWS = WiFi. IP67+IK08 = outdoor ok. |

---

### DS-2SE4C425MWG-E/14

| Atribut | Nilai |
|---------|-------|
| **Tipe** | TandemVu 4+4MP 25X PTZ Network Camera |
| **Form Factor** | Dual-channel: PTZ (25x) + Wide-angle Bullet |
| **Resolusi** | 4MP PTZ + 4MP overview |
| **Zoom** | 25x optical |
| **Smart Events** | Line crossing, intrusion, region entrance, region exit, audio exception |
| **Basic Events** | Motion detection, video tampering, exception |
| **Deep Learning** | Face Capture, Regional People Counting |
| **Smart Linkage** | PTZ auto-track target dari overview camera |
| **API** | ONVIF Profile S/G/T, ISAPI, SDK, ISUP |
| **Power** | PoE+ IEEE 802.3at (class PoE+) |
| **Catatan** | TandemVu = wide angle + PTZ dalam satu unit. Auto-tracking built-in. People counting untuk occupancy. Butuh PoE+ (budget switch). |

---

## NVR — VPro AcuSeek Series

Semua NVR di bawah ini termasuk seri **DS-7x0xNXI-K VPro** — NVR dengan AI built-in (AcuSense).

### Fitur AI (Berlaku Semua Model)

| Fitur | Keterangan |
|-------|-----------|
| **AI by NVR** | Perimeter Protection, Motion Detection 2.0, AcuSearch, AcuSeek |
| **AI by Camera** | Termasuk ANPR, VCA (butuh kamera AcuSense) |
| **Face Recognition** | Face picture comparison, search, up to 50.000 foto |
| **AcuSeek** | Deep search di rekaman berdasarkan appearance (50.000 target/hari) |
| **Motion Detection 2.0** | Human/vehicle recognition untuk filter false alarm |
| **Perimeter Protection** | Line crossing + intrusion by NVR (tanpa smart kamera) |
| **Protocol** | TCP/IP, DHCP, RTSP, SADP, SMTP, ISUP, UPnP, HTTP/HTTPS |
| **Decoding** | H.265+/H.265/H.264+/H.264 |

### Tabel Model NVR

| Model | Channel | PoE Port | SATA | Bandwidth In | Decoding AI On | Alarm I/O |
|-------|:-------:|:--------:|:----:|:----------:|:--------------:|:---------:|
| DS-7604NXI-K1 | 4 | - | 1 | 40 Mbps | 12-ch@1080p | 4/1 |
| DS-7604NXI-K1/4P | 4 | 4 | 1 | 40 Mbps | 12-ch@1080p | 4/1 |
| DS-7608NXI-K1/8P | 8 | 8 | 1 | — | — | — |
| DS-7616NXI-K1 | 16 | - | 1 | — | — | — |
| DS-7608NXI-K2 | 8 | - | 2 | 80 Mbps | 12-ch@1080p | 4/1 |
| DS-7608NXI-K2/8P | 8 | 8 | 2 | 80 Mbps | 12-ch@1080p | 4/1 |
| DS-7616NXI-K2 | 16 | - | 2 | 160 Mbps | 20-ch@1080p | 4/1 |
| DS-7616NXI-K2/16P | 16 | 16 | 2 | 160 Mbps | 20-ch@1080p | 4/1 |
| DS-7632NXI-K2/16P | 32 | 16 | 2 | 256 Mbps | 24-ch@1080p | 4/1 |
| DS-7716NXI-K4/16P | 16 | 16 | 4 | — | — | — |
| DS-7732NXI-K4/16P | 32 | 16 | 4 | — | — | — |

**Catatan tier:**
- **K1** — Entry level, 1 HDD, cocok untuk instalasi kecil (4-16 kamera)
- **K2** — Mid range, 2 HDD, decoding lebih kuat, cocok hingga 32 kamera
- **K4** — High end, 4 HDD + 16P PoE built-in, cocok untuk instalasi besar

---

## Rekonsiliasi dengan ENGINE-CCTV

### Kompatibilitas ISAPI

Semua kamera baru (G2/G3) mendukung ISAPI. ENGINE-CCTV yang bersifat model-agnostic akan:
- Probe ISAPI Smart endpoints saat startup
- Deteksi capabilities secara otomatis
- Tidak perlu konfigurasi manual per model

### Fitur Baru yang Perlu Ditambahkan

Berdasarkan datasheet kamera baru, fitur berikut belum di-probe ENGINE-CCTV tapi didukung banyak kamera:

| Fitur | ISAPI Endpoint | Didukung oleh |
|-------|---------------|---------------|
| **Region Entrance** | `/ISAPI/Smart/RegionEntrance/{ch}` | DS-2CD23x7G3P (4 model), DS-2CD2546G2, DS-2SE4C425MWG-E |
| **Region Exit** | `/ISAPI/Smart/RegionExiting/{ch}` | DS-2CD23x7G3P (4 model), DS-2CD2546G2, DS-2SE4C425MWG-E |
| **Scene Change** | `/ISAPI/Smart/SceneChangeDetection/{ch}` | DS-2CD2546G2 (smart), DS-2CD23x7G3P (basic) |
| **Audio Exception** | `/ISAPI/Smart/AudioDetection/{ch}` | DS-2SE4C425MWG-E |

Untuk implementasi, lihat panduan di [15-camera-hardware-features.md](15-camera-hardware-features.md#cara-menambah-fitur-baru).

### Kamera yang Tidak Punya Smart Events

**DS-2CD1T47G3-LIUF** tidak memiliki Smart Events. Saat di-probe:
- `/ISAPI/Smart/LineDetection/{ch}` → 404
- `/ISAPI/Smart/FieldDetection/{ch}` → 404
- ENGINE-CCTV: semua detector = SW only → behavior benar, tidak perlu workaround.

### NVR sebagai Proxy ISAPI

Jika kamera terhubung ke NVR VPro dan ENGINE-CCTV mengakses via IP NVR:
- NVR forward ISAPI ke kamera AcuSense → Smart events tersedia
- Kamera non-AcuSense via NVR → mungkin 403 (seperti Dahua saat ini)
- Gunakan `channelID` di `cameras.json` sesuai slot NVR

---

## Ringkasan Perbandingan Smart Events

| Fitur | Kamera Lama<br>(installed) | DS-2CD1T47G3 | DS-2CD23x7G3P | DS-2CD3041G2E | DS-2CD2546G2 | DS-2SE4C425MWG-E |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| Motion | HW | HW | HW | HW | HW | HW |
| Line Crossing | HW | - | HW | HW | HW | HW |
| Intrusion | HW | - | HW | HW | HW | HW |
| Region Entrance | *(hanya beberapa)* | - | **HW** | - | **HW** | **HW** |
| Region Exit | *(hanya beberapa)* | - | **HW** | - | **HW** | **HW** |
| Scene Change | *(beberapa)* | - | HW (basic) | - | **HW** | - |
| Audio Exception | *(beberapa)* | - | - | - | - | **HW** |
| Face Capture (DL) | - | - | **HW** | - | **HW** | **HW** |
| Perimeter Protect (DL) | - | - | **HW** | - | **HW** | - |
| People Counting (DL) | - | - | - | - | - | **HW** |

---

*Terakhir diperbarui: 17 Juni 2026*
*Sumber: Datasheet Hikvision 2025-2026 dari folder DataseetProduk*
