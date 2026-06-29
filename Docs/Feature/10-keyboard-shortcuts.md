# 10 - Keyboard Shortcuts

## Deskripsi

Daftar keyboard shortcuts yang tersedia untuk navigasi cepat dan kontrol aplikasi tanpa mouse. Referensi shortcut dapat dilihat di tab **Shortcuts** pada Settings modal.

## Daftar Shortcuts

### Grid Navigation

| Shortcut | Fungsi | Keterangan |
|----------|--------|------------|
| `1` | Grid 1×1 | Switch ke single view |
| `2` | Grid 2×2 | Switch ke quad view |
| `3` | Grid 3×3 | Switch ke 9 kamera |
| `4` | Grid 4×4 | Switch ke 16 kamera |
| `5` | Grid 5×5 | Switch ke 25 kamera |
| `6` | Grid 6×6 | Switch ke 36 kamera |

### Tile Navigation & Control

| Shortcut | Fungsi | Keterangan |
|----------|--------|------------|
| `←` `↑` `→` `↓` | Navigate tiles | Pindah antar tile menggunakan arrow keys |
| `F` | Fullscreen tile | Fullscreen tile yang sedang dipilih/focused |
| `Del` | Remove camera | Hapus kamera dari tile yang dipilih |
| `Space` | Toggle audio | Mute/unmute audio tile yang dipilih |

### Global Controls

| Shortcut | Fungsi | Keterangan |
|----------|--------|------------|
| `M` | Mute/Unmute all | Toggle mute semua stream sekaligus |
| `B` | Toggle sidebar | Collapse/expand sidebar kamera |
| `L` | Toggle Activity Log | Buka/tutup Activity Log drawer |
| `ESC` | Exit/Close | Exit focus mode, tutup modal, tutup drawer |

## Prioritas ESC

Tombol `ESC` memiliki prioritas handling:

1. Tutup modal Settings (jika terbuka)
2. Tutup Activity Log drawer (jika terbuka)
3. Exit focus mode (jika tile sedang dalam focus)
4. Exit fullscreen browser (jika fullscreen aktif)

## Settings → Shortcuts Tab

- Tabel referensi semua shortcut yang tersedia
- Dua kolom: Shortcut key dan deskripsi
- Hanya untuk referensi (shortcuts tidak dapat dikustomisasi di mockup ini)

## Status Mockup

| Item | Status |
|------|--------|
| Grid preset shortcuts (1-6) | ✅ Implemented (statis) |
| Arrow key navigation | ✅ Implemented (statis) |
| Fullscreen shortcut (F) | ✅ Implemented (statis) |
| Delete tile (Del) | ✅ Implemented (statis) |
| Toggle audio (Space) | ✅ Implemented (statis) |
| Mute all (M) | ✅ Implemented (statis) |
| Toggle sidebar (B) | ✅ Implemented (statis) |
| Toggle Activity Log (L) | ✅ Implemented (statis) |
| ESC handling | ✅ Implemented (statis) |
| Shortcuts reference tab | ✅ Implemented (statis) |
