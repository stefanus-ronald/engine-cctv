# 08 - Analytics (Video Analytics MVP)

## Deskripsi

Fitur video analytics Phase 1 yang tersedia melalui tab **Analytics** di Settings modal. Menyediakan capability matrix untuk mengkonfigurasi detector per kamera, simulasi event detection, dan integrasi dengan Activity Log dan tile UI.

## Fitur

### 8.1 Capability Matrix

Tampilan tabel matrix interaktif:

- **Rows**: Daftar kamera
- **Columns**: Jenis detector
- **Cells**: Status konfigurasi detector per kamera

#### Detector Types

| Detector | Keterangan |
|----------|------------|
| Motion | Deteksi gerakan |
| Person | Deteksi orang |
| Vehicle | Deteksi kendaraan |
| Face | Deteksi wajah |
| LPR | License Plate Recognition (plat nomor) |
| Line Crossing | Deteksi penyeberangan garis virtual |
| Loitering | Deteksi berdiam/mondar-mandir |

#### Cell States

| State | Ikon | Keterangan |
|-------|------|------------|
| Edge | 🟢 | Berjalan di edge AI kamera |
| Server | 🔵 | Berjalan di server VMS |
| Off | ⚪ | Detector tidak aktif |
| Pending | ⚠ | Diaktifkan tapi source belum tersedia |
| Offline | ✗ | Kamera offline |
| Pin | 📌 | User manual pin ke source tertentu |

### 8.2 Cell Configuration Popover

Klik cell pada matrix untuk membuka popover konfigurasi:

| Elemen | Keterangan |
|--------|------------|
| Enable/Turn off toggle | Aktifkan atau matikan detector |
| Source selection | Auto, Edge, atau Server |
| "Now bound to" status | Menunjukkan source aktif saat ini |
| "Why this" explanation | Penjelasan mengapa source tersebut dipilih |
| Compare sources | Disclosure section untuk membandingkan Edge vs Server |
| Done button | Tutup popover |

**Phase 2+ fields (disabled/placeholder):**
- Schedule selector
- Min confidence slider
- Cooldown slider
- Test fire button

### 8.3 Global Server Detectors

- Toggle untuk mengaktifkan/menonaktifkan setiap detector type di level server
- Perubahan cascade ke semua cell yang set ke "Auto"
- Mempengaruhi state machine detector

### 8.4 GPU Budget Meter

- Simulasi meter penggunaan GPU server
- Menampilkan estimasi load berdasarkan jumlah detector aktif
- Visual indicator (progress bar)

### 8.5 Filter by Group

- Dropdown filter untuk menampilkan hanya kamera dari grup tertentu
- Menyederhanakan matrix saat jumlah kamera banyak
- Opsi: All, Perimeter, Interior, Parking, Warehouse, custom groups

### 8.6 Sort by Camera Name

- Toggle sort ascending/descending berdasarkan nama kamera
- Memudahkan pencarian kamera tertentu dalam matrix

### 8.7 Detector State Machine

```
Off → Pending → Armed → Triggered → Armed
                  ↓
              Errored (jika source menjadi invalid)
```

| State | Keterangan |
|-------|------------|
| Off | Detector dimatikan |
| Pending | Diaktifkan, menunggu source tersedia |
| Armed | Aktif dan siap mendeteksi |
| Triggered | Baru saja mendeteksi event |
| Errored | Source menjadi invalid/offline |
| Sleeping | Phase 2+ (schedule-based) |

### 8.8 Event Simulator

Simulasi detection events otomatis untuk testing UI:

- Random events pada cell yang status-nya Armed
- Interval berjitter: 8–25 detik
- Event data:
  - `cameraId`: ID kamera
  - `detectorId`: Jenis detector
  - `source`: Edge atau Server
  - `confidence`: 70–95%
  - `timestamp`: Waktu event
- Burst mode: Sekali per sesi, 3–5 events dalam 5 detik pada kamera+detector yang sama
- Skip firing untuk cell berstatus Pending atau Errored
- Skip jika kamera offline

### 8.9 Event Deduplication (Clustering)

- Events dengan kunci yang sama (camera, detector, class, zone) dalam 30 detik digabung jadi 1 cluster
- Cluster ditampilkan sebagai: "⊕ N events of same kind"
- Expandable untuk melihat detail individual event
- Toast notification di-suppress untuk event lanjutan dalam cluster

### 8.10 Tile Integration

Integrasi analytics ke tile grid:

- **Badge `[👁n]`**: Ditampilkan di tile, klik untuk quick popover
- **Quick popover**: List detector aktif, source type, toggle-off, link ke Settings
- **Border flash**: Tile flash 3 detik saat event terdeteksi, warna sesuai severity
- **Badge color change**: Abu-abu → kuning/merah saat event, revert setelah 30 detik

### 8.11 Per-Event Actions

Aksi yang tersedia per event di Activity Log:

| Aksi | Keterangan |
|------|------------|
| ✓ Confirm | Tandai event sebagai confirmed |
| ✗ False positive | Tandai event sebagai false positive |
| ⤓ Export clip | Phase 2+ |
| ↗ Share link | Phase 3+ |

## Status Mockup

| Item | Status |
|------|--------|
| Capability matrix | ✅ Implemented (statis) |
| Cell configuration popover | ✅ Implemented (statis) |
| Global server detectors | ✅ Implemented (statis) |
| GPU budget meter | ✅ Implemented (simulated) |
| Filter by group | ✅ Implemented (statis) |
| Event simulator | ✅ Implemented (simulated) |
| Event deduplication | ✅ Implemented (statis) |
| Tile integration | ✅ Implemented (statis) |
| Schedule selector | 🔲 Phase 2 |
| Min confidence / cooldown | 🔲 Phase 2 |
| Test fire | 🔲 Phase 2 |
| Zone/line editor | 🔲 Phase 2 |

## Persistence

- Disimpan di `localStorage` dengan key: `go2rtc-analytics`
- Data tersimpan: server detector enablement + per-cell config
- `cameraCapabilities` tidak di-persist (recalculated tiap page load)

## Hardware Capabilities

Sejak V-003, `cameraCapabilities` dibangun dari data real ISAPI probe (bukan simulasi). Sejak V-005, data probe di-broadcast via SSE sehingga browser yang load sebelum probe selesai tetap mendapat update.

Detail fitur native per model kamera: lihat [15-camera-hardware-features.md](15-camera-hardware-features.md)
