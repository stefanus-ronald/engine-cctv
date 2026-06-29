# 03 - Tile Controls

## Deskripsi

Setiap tile pada grid memiliki seperangkat kontrol overlay yang muncul saat hover atau saat tile dipilih. Kontrol ini memungkinkan pengguna berinteraksi langsung dengan feed kamera individual.

## Fitur

### 3.1 Video Placeholder

- Menampilkan feed video kamera (di mockup menggunakan gambar dari picsum.photos)
- Aspect ratio mengikuti pengaturan Display Settings (16:9, 4:3, atau Auto)
- Placeholder dengan background gelap saat tidak ada kamera yang di-assign

### 3.2 Camera Name Overlay

- Nama kamera ditampilkan di bagian bawah tile
- Dapat di-toggle on/off via Display Settings
- Semi-transparan agar tidak menghalangi view
- Muncul/hilang berdasarkan pengaturan "Show Camera Names"

### 3.3 LIVE Badge

- Badge hijau bertuliskan "LIVE" di pojok tile
- Indikator bahwa stream sedang aktif
- Dapat di-toggle on/off via Display Settings
- Muncul/hilang berdasarkan pengaturan "Show LIVE Badge"

### 3.4 Stream Quality Toggle (Sub/Main)

- Tombol toggle untuk beralih antara Sub stream dan Main stream
- **Sub stream**: Resolusi rendah, bandwidth kecil
- **Main stream**: Resolusi tinggi, bandwidth besar
- Default mengikuti pengaturan di Stream Settings

### 3.5 Audio Mute/Unmute

- Tombol mute/unmute per-tile untuk kontrol audio individual
- Ikon speaker dengan indicator muted/unmuted
- Hanya tersedia jika protocol WebRTC dipilih (MJPEG tidak mendukung audio)
- Bisa di-mute semua sekaligus via tombol "Mute All" di top bar

### 3.6 Expand Button (Focus Mode)

- Tombol untuk memperbesar tile ke focus mode
- Tile yang di-expand mengisi sebagian besar area grid
- Tile lain tetap visible tapi mengecil
- Border highlight pada tile yang sedang focus
- Keluar focus mode dengan `ESC`

### 3.7 Fullscreen Button

- Tombol fullscreen per-tile individual
- Menggunakan Browser Fullscreen API
- Tile mengisi seluruh layar
- Keluar fullscreen dengan `ESC` atau keyboard shortcut `F`

### 3.8 Drag Handle

- Handle untuk drag & drop repositioning tile
- Muncul di bagian atas tile saat hover
- Memungkinkan reorder posisi tile dalam grid

### 3.9 Analytics Badge `[👁n]`

- Badge kecil menampilkan jumlah detector aktif pada kamera tersebut
- Format: `[👁n]` dimana `n` = jumlah detector
- Berubah warna saat detection event terjadi:
  - Default: Abu-abu
  - Warning: Kuning
  - Critical: Merah
  - Kembali ke default setelah 30 detik

### 3.10 Tile Border Flash

- Border tile berkedip/flash saat detection event terjadi
- Warna berdasarkan severity:
  - Info: Biru
  - Warning: Kuning
  - Critical: Merah
- Durasi flash: 3 detik
- Otomatis berhenti setelah durasi habis

## Status Mockup

| Item | Status |
|------|--------|
| Video placeholder | ✅ Implemented (statis) |
| Camera name overlay | ✅ Implemented (statis) |
| LIVE badge | ✅ Implemented (statis) |
| Sub/Main toggle | ✅ Implemented (statis) |
| Mute/Unmute audio | ✅ Implemented (statis) |
| Expand (focus mode) | ✅ Implemented (statis) |
| Fullscreen per-tile | ✅ Implemented (statis) |
| Drag handle | ✅ Implemented (statis) |
| Analytics badge | ✅ Implemented (statis, Phase 1) |
| Tile border flash | ✅ Implemented (statis, Phase 1) |

## Interaksi

```
Hover tile → Tampilkan kontrol overlay
Klik Sub/Main → Toggle kualitas stream
Klik Mute → Toggle audio
Klik Expand → Masuk focus mode
Klik Fullscreen → Masuk fullscreen browser
Drag handle → Mulai drag & drop
Klik badge [👁n] → Buka analytics popover
```
