# 02 - Sidebar & Camera List

## Deskripsi

Panel sidebar di sisi kiri yang menampilkan daftar semua kamera yang tersedia, dikelompokkan berdasarkan grup. Berfungsi sebagai sumber drag-and-drop untuk meng-assign kamera ke tile grid.

## Fitur

### 2.1 Camera Search

- Input pencarian di bagian atas sidebar
- Filter kamera berdasarkan nama secara real-time
- Tombol clear (×) untuk menghapus pencarian
- Highlight pada hasil pencarian yang cocok

### 2.2 Grouped Camera List

Kamera dikelompokkan dalam 4 grup default:

| Grup | Jumlah Kamera |
|------|---------------|
| Perimeter | 8 |
| Interior | 10 |
| Parking | 8 |
| Warehouse | 10 |
| **Total** | **36** |

- Setiap grup memiliki header yang bisa di-collapse/expand
- Klik header grup untuk toggle collapse
- Mendukung custom group (lihat [11-custom-groups.md](11-custom-groups.md))

### 2.3 Camera Status Indicator

Setiap kamera menampilkan status koneksi:

| Status | Indikator | Keterangan |
|--------|-----------|------------|
| Online | 🟢 Hijau | Kamera aktif dan terhubung |
| Offline | 🔴 Merah | Kamera tidak dapat dijangkau |
| Error | 🟡 Kuning | Kamera error/masalah koneksi |

### 2.4 Drag & Drop ke Grid

- Drag kamera dari sidebar ke tile grid untuk assign
- Visual feedback saat drag (highlight target tile)
- Tip text: "Drag a camera onto the grid or press Enter to auto-assign"
- Mendukung auto-assign (tekan Enter pada kamera yang dipilih)

### 2.5 Sidebar Collapse/Expand

- Tombol toggle untuk collapse/expand sidebar
- Keyboard shortcut: `B`
- Saat collapsed, sidebar menyempit dan hanya menampilkan ikon
- Grid area otomatis melebar saat sidebar collapsed

### 2.6 Analytics Indicator (Phase 2)

- Dot indicator (●) pada setiap kamera yang memiliki detector aktif
- Menunjukkan kamera mana yang sedang dalam mode analytics

### 2.7 Pengelompokan NVR & Badge Tipe (V-009)

- Channel hasil **auto-sync NVR** tampil dalam grup bernama **nama NVR asli** (mis. "Kantor JMP-NVR"); kamera IP standalone tetap di grupnya masing-masing.
- Tiap item kamera punya **badge tipe**: `NVR` / `DVR` (channel recorder) atau `IP` (kamera langsung). Sebelumnya badge selalu "IP" karena bug `deviceType` di frontend — sudah diperbaiki di V-009.

### 2.8 Alert Hanya untuk Kamera di Grid (V-009)

- Notifikasi/alert deteksi **hanya muncul** untuk kamera yang sudah di-drag ke tile grid.
- Deteksi kamera yang belum di-assign tetap tercatat di activity log, tapi **tanpa toast/flash** — supaya tidak ramai sebelum kamera benar-benar ditampilkan.

## Status Mockup

| Item | Status |
|------|--------|
| Camera search | ✅ Implemented (statis) |
| Grouped camera list | ✅ Implemented (statis) |
| Status indicator | ✅ Implemented (statis) |
| Drag & drop | ✅ Implemented (statis) |
| Sidebar toggle | ✅ Implemented (statis) |
| Analytics indicator | 🔲 Phase 2 |

## Data Model

```
Camera {
  id: string
  name: string
  group: string
  ip: string
  status: "online" | "offline" | "error"
  rtspPort: number
  username: string
  password: string
  brand: string
  streamPath: string
  webPort: number
  thumbnailUrl: string
}
```
