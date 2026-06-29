# 06 - Stream Settings

## Deskripsi

Pengaturan streaming yang tersedia melalui tab **Streams** di Settings modal. Mengontrol protokol streaming, kualitas default, batas concurrent stream, reconnect behavior, dan pengaturan audio.

## Fitur

### 6.1 Streaming Protocol

Pilihan protokol untuk menerima video feed:

| Protocol | Latency | Audio | Keterangan |
|----------|---------|-------|------------|
| **WebRTC** | < 500ms | ✅ Audio + Video | Low latency, memerlukan WebRTC support |
| **MJPEG** | ~1 detik | ❌ No audio | Universal compatibility, bandwidth lebih besar |

- Menggunakan segmented control (radio-group style)
- Perubahan protocol dicatat di Activity Log

### 6.2 Default Stream Quality

Kualitas stream default saat kamera pertama kali di-assign ke tile:

| Quality | Keterangan |
|---------|------------|
| **Sub** | Resolusi rendah, hemat bandwidth |
| **Main** | Resolusi tinggi, bandwidth lebih besar |

- Dapat di-override per-tile melalui Tile Controls
- Default: Sub

### 6.3 Max Concurrent Streams

- Slider untuk membatasi jumlah stream yang aktif bersamaan
- Range: 1 – 36
- Default: 36
- Terintegrasi dengan Stream Budget Indicator di top bar
- Saat limit tercapai, stream tambahan tidak akan dimulai

### 6.4 Reconnect Interval

- Slider untuk mengatur interval reconnect otomatis saat stream terputus
- Range: 1 – 30 detik
- Default: 5 detik
- Stream yang terputus akan otomatis coba reconnect setelah interval ini

### 6.5 Audio Enabled by Default

- Toggle switch untuk mengaktifkan/menonaktifkan audio secara default
- **Hanya visible jika protocol = WebRTC** (MJPEG tidak mendukung audio)
- Saat ON: audio aktif di semua tile baru
- Saat OFF: semua tile dimulai dalam keadaan muted
- Dapat di-override per-tile melalui Mute/Unmute button

## Status Mockup

| Item | Status |
|------|--------|
| Protocol selector | ✅ Implemented (statis) |
| Default stream quality | ✅ Implemented (statis) |
| Max concurrent streams | ✅ Implemented (statis) |
| Reconnect interval | ✅ Implemented (statis) |
| Audio enabled toggle | ✅ Implemented (statis) |

## Persistence

- Disimpan di `localStorage` dengan key: `go2rtc-settings`
- Perubahan setting langsung diterapkan
- Perubahan dicatat di Activity Log kategori "Config"
