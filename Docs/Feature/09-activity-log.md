# 09 - Activity Log

## Deskripsi

Drawer panel di sisi kanan yang mencatat semua aktivitas dan event dalam aplikasi. Berfungsi sebagai audit trail dan monitoring real-time untuk event kamera, stream, konfigurasi, layout, sistem, dan analytics.

## Fitur

### 9.1 Activity Log Drawer

- Panel slide-in dari sisi kanan
- Toggle buka/tutup via tombol Activity Log di top bar
- Keyboard shortcut: `L`
- Tidak menutupi grid sepenuhnya (overlay sebagian)

### 9.2 Search

- Input pencarian di bagian atas drawer
- Filter entri log berdasarkan keyword
- Pencarian real-time saat mengetik

### 9.3 Filter by Severity

| Severity | Keterangan |
|----------|------------|
| All | Tampilkan semua |
| Info | Event informasional |
| Warning | Peringatan |
| Critical | Event kritis yang memerlukan perhatian |

### 9.4 Filter by Category

| Category | Keterangan |
|----------|------------|
| All | Semua kategori |
| Camera | Event online/offline, hasil koneksi |
| Stream | Reconnect, mute, budget warnings |
| Config | Perubahan protokol, settings |
| Layout | Save, load layout |
| System | Session start, dll |
| Analytics | Detection events, perubahan config detector |

### 9.5 Filter by Time Range

| Range | Keterangan |
|-------|------------|
| Any time | Tanpa filter waktu |
| Last hour | 1 jam terakhir |
| Last 24h | 24 jam terakhir |
| Last 7 days | 7 hari terakhir |

- Filter state hanya berlaku per sesi (tidak di-persist)

### 9.6 Activity Feed

Setiap entri log menampilkan:
- Timestamp
- Pesan/deskripsi event
- Ikon kategori
- Severity indicator (warna)

### 9.7 Event Clustering / Deduplication

- Events dengan kunci sama (camera, detector, class, zone) dalam 30 detik di-cluster
- Tampilan: "⊕ N events of same kind"
- Klik untuk expand dan lihat detail individual
- Mengurangi noise pada Activity Log

### 9.8 Per-Event Actions

| Aksi | Keterangan |
|------|------------|
| ✓ Confirm | Konfirmasi event sebagai valid |
| ✗ False positive | Tandai sebagai false positive |
| ⤓ Export clip | Export clip video (Phase 2+) |
| ↗ Share link | Share link event (Phase 3+) |

### 9.9 Bulk Actions

| Aksi | Keterangan |
|------|------------|
| Mark all as read | Tandai semua event sebagai sudah dibaca |
| Export all as JSON | Export seluruh log ke file JSON |
| Clear all | Hapus semua entri log |

### 9.10 Unread Badge Counter

- Badge angka pada tombol Activity Log di top bar
- Menampilkan jumlah event yang belum dibaca
- Reset saat drawer dibuka atau "Mark all as read"

### 9.11 Buffer Limit

- Maksimum 500 entri (ring buffer)
- Entri terlama dihapus otomatis saat limit tercapai
- Memastikan performa tetap baik

### 9.12 Empty State

- Pesan informatif saat tidak ada entri log
- Ditampilkan saat log kosong atau semua entry ter-filter

## Logged Events

### Camera Events
- Kamera online
- Kamera offline
- Hasil test connection

### Stream Events
- Stream reconnect
- Audio mute/unmute
- Stream budget warning

### Config Events
- Perubahan protocol
- Perubahan display settings
- Perubahan stream settings

### Layout Events
- Layout saved
- Layout loaded

### System Events
- Session start

### Analytics Events
- Detection events (motion, person, vehicle, dll)
- Detector configuration changes
- Detector state changes

## Status Mockup

| Item | Status |
|------|--------|
| Activity log drawer | ✅ Implemented (statis) |
| Search | ✅ Implemented (statis) |
| Filter severity | ✅ Implemented (statis) |
| Filter category | ✅ Implemented (statis) |
| Filter time range | ✅ Implemented (statis) |
| Event clustering | ✅ Implemented (statis) |
| Per-event actions | ✅ Implemented (statis) |
| Bulk actions | ✅ Implemented (statis) |
| Unread badge | ✅ Implemented (statis) |
| Export clip | 🔲 Phase 2 |
| Share link | 🔲 Phase 3 |

## Persistence

- Disimpan di `localStorage` dengan key: `go2rtc-activity-log`
- Maks 500 entri
- Filter state **tidak** di-persist (reset tiap sesi)
