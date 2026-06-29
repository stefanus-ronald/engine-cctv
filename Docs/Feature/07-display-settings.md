# 07 - Display Settings

## Deskripsi

Pengaturan tampilan visual yang tersedia melalui tab **Display** di Settings modal. Mengontrol aspek visual grid dan tile seperti gap, overlay, badge, aspect ratio, dan kecepatan animasi.

## Fitur

### 7.1 Grid Gap Size

- Slider untuk mengatur jarak (gap) antar tile dalam grid
- Range: 0 – 12 piksel
- Default: 4px
- Preview langsung saat slider digeser
- Menampilkan nilai piksel yang dipilih

### 7.2 Show Camera Names

- Toggle switch on/off
- Default: ON
- Saat ON: nama kamera ditampilkan sebagai overlay di bagian bawah setiap tile
- Saat OFF: nama kamera disembunyikan dari semua tile
- Berlaku global untuk semua tile

### 7.3 Show LIVE Badge

- Toggle switch on/off
- Default: ON
- Saat ON: badge hijau "LIVE" ditampilkan di pojok setiap tile aktif
- Saat OFF: badge LIVE disembunyikan dari semua tile
- Berlaku global untuk semua tile

### 7.4 Tile Aspect Ratio

Pilihan rasio aspek untuk setiap tile:

| Opsi | Keterangan |
|------|------------|
| **16:9** | Widescreen, standar HD (default) |
| **4:3** | Rasio tradisional |
| **Auto** | Mengikuti rasio video asli kamera |

- Menggunakan segmented control selector
- Perubahan langsung diterapkan ke semua tile

### 7.5 Animation Speed

Kecepatan animasi transisi UI:

| Opsi | Durasi | Keterangan |
|------|--------|------------|
| **Fast** | 0.15s | Animasi cepat |
| **Normal** | 0.25s | Animasi standar (default) |
| **Slow** | 0.5s | Animasi lambat |
| **Off** | 0s | Tanpa animasi |

- Berlaku untuk semua transisi UI (tile switch, focus mode, dll)
- Menggunakan dropdown selector

## Status Mockup

| Item | Status |
|------|--------|
| Grid gap size | ✅ Implemented (statis) |
| Show camera names | ✅ Implemented (statis) |
| Show LIVE badge | ✅ Implemented (statis) |
| Tile aspect ratio | ✅ Implemented (statis) |
| Animation speed | ✅ Implemented (statis) |

## Persistence

- Semua pengaturan disimpan di `localStorage` dengan key: `go2rtc-settings`
- Perubahan langsung diterapkan ke UI
- Perubahan dicatat di Activity Log kategori "Config"
