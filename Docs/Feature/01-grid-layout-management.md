# 01 - Grid & Layout Management

## Deskripsi

Sistem grid fleksibel untuk menampilkan feed kamera secara multi-view. Mendukung berbagai preset layout dari single view hingga 36 kamera sekaligus, serta focus layout untuk monitoring prioritas.

## Fitur

### 1.1 Uniform Grid Presets

Preset grid seragam yang membagi layar menjadi tile berukuran sama.

| Preset | Jumlah Tile | Keterangan |
|--------|-------------|------------|
| 1×1    | 1           | Single view |
| 2×2    | 4           | Quad view |
| 3×3    | 9           | 9 kamera |
| 4×4    | 16          | 16 kamera |
| 5×5    | 25          | 25 kamera |
| 6×6    | 36          | Maksimum view |

- Tombol preset terletak di **top bar**
- Shortcut keyboard: tombol `1` sampai `6`
- Mengubah preset akan mempertahankan kamera yang sudah di-assign ke tile

### 1.2 Focus Layout

Layout khusus dengan satu atau dua tile utama berukuran besar, dikelilingi tile kecil.

| Layout | Keterangan |
|--------|------------|
| 1+5    | 1 tile besar + 5 tile kecil |
| 1+12   | 1 tile besar + 12 tile kecil |
| 2+4    | 2 tile besar + 4 tile kecil |
| 2+12   | 2 tile besar + 12 tile kecil |

- Tile besar menggunakan CSS Grid spanning
- Cocok untuk monitoring prioritas dengan kamera utama yang lebih menonjol

### 1.3 Dynamic Grid Rendering

- Grid di-render secara dinamis berdasarkan preset yang dipilih
- Menggunakan CSS Grid layout
- Tile kosong menampilkan pesan empty state
- Grid gap (jarak antar tile) dapat dikonfigurasi: 0–12px

### 1.4 Tile Drag & Drop Reorder

- Tile dapat dipindahkan posisinya via drag and drop
- Drag handle tersedia di setiap tile
- Posisi tile diperbarui secara real-time saat di-drop

### 1.5 Stream Budget Indicator

- Menampilkan jumlah stream aktif vs maksimum: `Active: N / 36`
- Terletak di top bar
- Terintegrasi dengan pengaturan Max Concurrent Streams

## Status Mockup

| Item | Status |
|------|--------|
| Uniform grid presets | ✅ Implemented (statis) |
| Focus layout | ✅ Implemented (statis) |
| Grid gap configurable | ✅ Implemented (statis) |
| Drag & drop reorder | ✅ Implemented (statis) |
| Stream budget indicator | ✅ Implemented (statis) |

## Catatan Implementasi

- Grid menggunakan CSS Grid (`display: grid`) dengan `grid-template-columns` dinamis
- Focus layout menggunakan `grid-column` dan `grid-row` spanning
- Semua state grid tersimpan sebagai bagian dari layout configuration
