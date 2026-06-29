# 15 - Camera Hardware Features (Native VCA per Model)

## Deskripsi

Dokumentasi fitur native (bawaan firmware) setiap model kamera yang terdaftar di ENGINE-CCTV, dan status implementasinya di sistem kita. Pendekatan ENGINE-CCTV bersifat **model-agnostic** — sistem probe ISAPI endpoint secara dinamis, tidak bergantung pada database model kamera.

---

## Fitur Native per Model Kamera

### Legenda

- **HW** = Didukung secara native oleh firmware kamera
- **-** = Tidak didukung oleh model ini
- **(basic)** = Fitur ada tapi terbatas (non-AI/non-deep-learning)

### Matrix Lengkap

| Fitur | DS-2CD2042WD-I | DS-2CD2420F-I | DS-2CD2120F-I | DS-2DF8236IV-AEL |
|-------|:-:|:-:|:-:|:-:|
| | *Parkiran* | *Lantai 3* | *R. Kreatif* | *PTZ LT.1* |
| **Motion Detection** | HW | HW | HW | HW |
| **Line Crossing** | HW | HW | HW | HW |
| **Intrusion (Field Detection)** | HW | HW | HW | HW |
| **Face Detection** | HW (basic) | HW | - | HW |
| **Vehicle Detection** | - | - | - | - |
| **Audio Exception** | HW | HW | - | HW |
| **Tampering Alarm** | HW | HW | HW | HW |
| **Scene Change** | HW | HW | - | - |
| **Defocus Detection** | HW | HW | - | - |
| **Region Entrance** | - | HW | - | HW |
| **Region Exit** | - | HW | - | HW |
| **Unattended Baggage** | - | HW | - | HW |
| **Object Removal** | - | HW | - | HW |
| **Dynamic Analysis** | HW | HW | HW | HW |
| **Smart Tracking (PTZ)** | - | - | - | HW |
| **Heat Map** | - | HW | - | - |
| **Dual-VCA (NVR metadata)** | - | - | - | HW |

### Catatan per Model

**DS-2CD2042WD-I** (Parkiran)
- 4MP WDR Mini Bullet, Value Series
- Face detection bersifat basic (presence only, bukan recognition)
- VCA menggunakan algoritma tradisional (non-AI)
- Mendukung 1 line crossing rule

**DS-2CD2420F-I** (Lantai 3)
- 2MP Indoor Cube, EasyIP line
- Model paling kaya fitur VCA di antara kamera fixed kita
- Mendukung hingga 4 line crossing rules
- Punya PIR sensor hardware (untuk Basic Event, bukan Smart Event)
- Status: End-of-Life (EOL) dari Hikvision

**DS-2CD2120F-I** (R. Kreatif)
- 2MP Fixed Dome, entry-level
- Fitur VCA paling minimal — hanya Motion, Line, Intrusion, Tampering, Dynamic Analysis
- Tidak ada Face Detection native
- Status: End-of-Life (EOL) dari Hikvision

**DS-2DF8236IV-AEL** (PTZ LT.1)
- 2MP Ultra WDR Smart PTZ, 36x optical zoom
- Model paling advance — full smart tracking dengan 6 trigger mode
- Smart tracking bisa dipicu oleh: Manual, Panorama, Intrusion, Line Crossing, Region Entrance, Region Exit
- Mendukung 300 preset, 8 patrol route, 4 pattern scan
- Dual-VCA: embed metadata ke stream untuk NVR secondary search
- Status: End-of-Life, successor DS-2DF8236IX-AEL(W)

**Dahua via NVR** (Pintu Depan)
- Model Dahua di balik NVR Hikvision
- ISAPI Smart endpoint return 403 → fallback ke `detection.events` config
- Capability terbatas pada apa yang dikonfigurasi di cameras.json

---

## Kamera Model Baru (dari Datasheet)

Berikut adalah 9 model kamera dari datasheet yang diterima. Ini adalah generasi G2/G3 terbaru — kandidat pengganti atau penambahan untuk instalasi baru.

### Matrix Kamera Baru

| Fitur | DS-2CD1T47G3<br>-LIUF | DS-2CD23x7G3P<br>-LIS2UY *(4 model)* | DS-2CD3041G2E<br>-LIU | DS-2CD2546G2<br>-IWS-C | DS-2SE4C425MWG<br>-E/14 |
|-------|:-:|:-:|:-:|:-:|:-:|
| **Tipe** | *4MP ColorVu Bullet* | *8/12/16MP Panoramic* | *4MP DualLight Bullet* | *4MP AcuSense Dome* | *TandemVu 4+4MP PTZ* |
| **Motion Detection** | HW | HW | HW | HW | HW |
| **Line Crossing** | - | HW | HW | HW | HW |
| **Intrusion (Field)** | - | HW | HW | HW | HW |
| **Region Entrance** | - | HW | - | HW | HW |
| **Region Exit** | - | HW | - | HW | HW |
| **Scene Change** | - | HW (basic) | - | HW | - |
| **Audio Exception** | - | - | - | - | HW |
| **Tampering Alarm** | HW | HW | HW | HW | HW |
| **Face Capture (DL)** | - | HW | - | HW | HW |
| **Perimeter Protect (DL)** | - | HW | - | HW | - |
| **People Counting (DL)** | - | - | - | - | HW |
| **Smart Tracking** | - | - | - | - | HW |
| **API** | ONVIF S/G, ISAPI | ONVIF S/G/T, ISAPI, ISUP | ONVIF S/G, ISAPI | ONVIF S/G/T, ISAPI | ONVIF S/G/T, ISAPI, ISUP |
| **PoE** | 802.3at | 802.3at | 802.3af | WiFi | 802.3at+ |

> DS-2CD23x7G3P mencakup: DS-2CD23127G3P, DS-2CD23167G3P (Turret), DS-2CD2T127G3P, DS-2CD2T167G3P (Bullet) — semua punya spesifikasi VCA identik.

### Catatan Kamera Baru

**DS-2CD1T47G3-LIUF** (4MP ColorVu 3.0 Bullet)
- Tidak punya smart events — hanya basic events (motion, tampering)
- Motion detection mendukung human/vehicle via AI-ISP
- ENGINE-CCTV akan probe 404 untuk Line/Intrusion/Face → label SW only (benar)
- ONVIF Profile S/G, tanpa Profile T

**DS-2CD23x7G3P-LIS2UY** (Panoramic ColorVu, 4 varian)
- Kamera panoramic 180° dengan lensa tunggal 2.8mm
- Smart Events lengkap: line, intrusion, region entrance/exit
- Deep learning: Face Capture + Perimeter Protection (human/vehicle)
- Scene Change sebagai basic event (bukan smart event, endpoint berbeda)
- ISUP support — bisa connect ke Hikvision cloud/VMS
- Resolusi tinggi (8/12/16MP) — pertimbangkan sub-stream untuk real-time preview

**DS-2CD3041G2E-LIU** (4MP Dual Light Motion 2.0)
- Smart Events terbatas: hanya Line Crossing + Intrusion
- Motion Detection 2.0: human/vehicle classification
- Tidak ada Region Entrance/Exit, Face Capture
- Power: PoE 802.3af (bukan at) — max 15.4W
- ONVIF Profile S/G (tanpa T)

**DS-2CD2546G2-IWS-C** (4MP AcuSense WiFi Mini Dome)
- Smart Events terlengkap di kamera fixed: Line, Intrusion, Region Entrance, Region Exit, Scene Change
- Deep learning: Face Capture + Perimeter Protection
- WiFi variant (IWS = Indoor WiFi) + IP67+IK08
- Scene Change sebagai smart event (beda dari G3P yang basic event)
- ONVIF Profile S/G/T

**DS-2SE4C425MWG-E/14** (TandemVu 4+4MP 25x PTZ)
- Dual-channel: 4MP PTZ 25x zoom + 4MP wide-angle bullet dalam satu unit
- Smart Events: audio exception, region entrance/exit, intrusion, line crossing
- Deep learning: Face Capture + Regional People Counting
- Smart Linkage: PTZ auto-track target dari camera overview
- People Counting regional — berguna untuk occupancy monitoring
- ISUP support
- Membutuhkan PoE+ (802.3at+)

---

## NVR VPro Series (dari Datasheet)

### DS-7x0xNXI-K VPro — AcuSeek Series

| Model | Channel | PoE Port | SATA | Bandwidth In | AI Decoding |
|-------|---------|----------|------|-------------|-------------|
| DS-7604NXI-K1 | 4-ch | - | 1 | 40 Mbps | 12-ch@1080p |
| DS-7604NXI-K1/4P | 4-ch | 4 PoE | 1 | 40 Mbps | 12-ch@1080p |
| DS-7608NXI-K1/8P | 8-ch | 8 PoE | 1 | — | — |
| DS-7616NXI-K1 | 16-ch | - | 1 | — | — |
| DS-7608NXI-K2 | 8-ch | - | 2 | 80 Mbps | 12-ch@1080p |
| DS-7608NXI-K2/8P | 8-ch | 8 PoE | 2 | 80 Mbps | 12-ch@1080p |
| DS-7616NXI-K2 | 16-ch | - | 2 | 160 Mbps | 20-ch@1080p |
| DS-7616NXI-K2/16P | 16-ch | 16 PoE | 2 | 160 Mbps | 20-ch@1080p |
| DS-7632NXI-K2/16P | 32-ch | 16 PoE | 2 | 256 Mbps | 24-ch@1080p |
| DS-7716NXI-K4/16P | 16-ch | 16 PoE | 4 | — | — |
| DS-7732NXI-K4/16P | 32-ch | 16 PoE | 4 | — | — |

**Fitur AI (semua model):**
- AI by NVR: Perimeter Protection, Motion Detection 2.0, Face Recognition, AcuSearch
- AI by Camera: termasuk ANPR, VCA (jika kamera AcuSense)
- AcuSeek: deep search di rekaman (sampai 50.000 target/hari)
- Face library: hingga 16 library, 50.000 foto
- Protocol: ISUP, HTTPS, RTSP, SADP

**Catatan untuk ENGINE-CCTV:**
- Kamera yang terkoneksi ke NVR VPro: ISAPI proxy melalui NVR
- NVR akan forward ISAPI Smart endpoints jika kamera AcuSense
- Jika kamera di-proxy NVR: gunakan IP NVR dengan channel ID sesuai slot
- Kamera Dahua di channel NVR Hikvision: NVR return 403 untuk Smart (sudah dihandle V-003 dengan fallback)

---

## Status Implementasi di ENGINE-CCTV

### Fitur yang Sudah Diimplementasikan (5 fitur)

| Fitur | ISAPI Probe Endpoint | Frontend detectorId | Alert Stream Event |
|-------|---------------------|--------------------|--------------------|
| Motion Detection | `/ISAPI/System/Video/inputs/channels/{ch}/motionDetection` | `motion` | `VMD` |
| Line Crossing | `/ISAPI/Smart/LineDetection/{ch}` | `line` | `linedetection` |
| Intrusion/Loitering | `/ISAPI/Smart/FieldDetection/{ch}` | `loitering` | `fielddetection` |
| Face Detection | `/ISAPI/Smart/FaceDetect/{ch}` | `face` | `facedetection` |
| Vehicle Detection | `/ISAPI/Smart/VehicleDetection/{ch}` | `vehicle` | `vehicledetection` |

Implementasi mencakup:
- **Probe** — Deteksi apakah kamera mendukung fitur (HTTP 200 = yes)
- **Alert Stream** — Menerima event real-time dari kamera
- **Sensitivity** — GET/PUT sensitivity via ISAPI (motion, line, loitering)
- **UI** — Label "HW ✓" / "SW only", toast, tile flash, activity log

### Fitur yang Belum Diimplementasikan (11 fitur)

> Prioritas diupdate berdasarkan datasheet produk terbaru — Region Entrance/Exit kini **High** karena didukung oleh 5 dari 9 kamera baru.

| Fitur | ISAPI Endpoint (estimasi) | Prioritas | Kamera Baru yang Support |
|-------|--------------------------|-----------|--------------------------|
| Region Entrance | `/ISAPI/Smart/RegionEntrance/{ch}` | **High** | DS-2CD23x7G3P, DS-2CD2546G2, DS-2SE4C425MWG-E |
| Region Exit | `/ISAPI/Smart/RegionExiting/{ch}` | **High** | DS-2CD23x7G3P, DS-2CD2546G2, DS-2SE4C425MWG-E |
| Audio Exception | `/ISAPI/Smart/AudioDetection/{ch}` | Medium | DS-2SE4C425MWG-E |
| Tampering Alarm | `/ISAPI/System/Video/inputs/channels/{ch}/tamperDetection` | Medium | Semua model baru |
| Scene Change | `/ISAPI/Smart/SceneChangeDetection/{ch}` | Medium | DS-2CD23x7G3P (basic), DS-2CD2546G2 |
| Defocus Detection | `/ISAPI/Smart/DefocusDetection/{ch}` | Low | (tidak ada di kamera baru) |
| Unattended Baggage | `/ISAPI/Smart/UnattendedBaggage/{ch}` | Low | (tidak ada di kamera baru) |
| Object Removal | `/ISAPI/Smart/ObjectRemoval/{ch}` | Low | (tidak ada di kamera baru) |
| Dynamic Analysis | N/A (metadata in stream) | Low | NVR-side feature |
| Smart Tracking | `/ISAPI/PTZCtrl/channels/{ch}/presets` | Low | DS-2SE4C425MWG-E |
| Heat Map | `/ISAPI/Smart/HeatMap/{ch}` | Low | Visualization feature |

### Cara Menambah Fitur Baru

Pendekatan ENGINE-CCTV bersifat **model-agnostic**. Untuk menambah support fitur baru:

1. **Tambah probe endpoint** di `capabilities-probe.js`:
   ```javascript
   PROBE_ENDPOINTS.push({
     detectorId: 'tampering',
     path: '/ISAPI/System/Video/inputs/channels/{ch}/tamperDetection'
   });
   ```

2. **Tambah event mapping** di `event-normalizer.js`:
   ```javascript
   ISAPI_TO_DETECTOR['tamperdetection'] = 'tampering';
   ```

3. **Tambah sensitivity endpoint** (opsional) di `sensitivity-api.js`:
   ```javascript
   DETECTOR_ENDPOINTS['tampering'] = '/ISAPI/System/Video/inputs/channels/{ch}/tamperDetection';
   ```

4. **Frontend** otomatis mengikuti — `buildCameraCapabilities()` membaca `hwCapabilities` secara dinamis.

---

## Sumber Data

- Hikvision datasheets produk saat ini (V5.4.0) — 4 kamera installed
- Hikvision datasheets produk baru (2025-2026):
  - DS-2CD1T47G3-LIUF_LSLRB_Datasheet_20260312
  - DS-2CD23167/23127/2387/2T167/2T127G3P-LIS2UY Datasheet_20251209
  - DS-2CD3041G2E-LIU_Datasheet_20260409
  - DS-2CD2546G2-IWS-C_Datasheet_V5.5.115
  - DS-2SE4C425MWG-E_14_Datasheet_20250615
  - DS-7604/7608/7616/7632/7716/7732 NXI-K1/K2/K4 VPro Datasheet_2026
- ISAPI probe results dari ENGINE-CCTV
- cameras.json detection.events configuration
- Hikvision ISAPI documentation

*Terakhir diperbarui: 17 Juni 2026*
