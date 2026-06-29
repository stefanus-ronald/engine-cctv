# 13 - Focus Mode & Fullscreen

## Deskripsi

Dua mode tampilan khusus untuk melihat feed kamera secara lebih detail: Focus Mode (dalam konteks grid) dan Fullscreen Mode (menggunakan Browser Fullscreen API).

## Fitur

### 13.1 Focus Mode

Mode dimana satu tile diperbesar untuk mendominasi area grid, sementara tile lain tetap terlihat tapi mengecil.

**Cara Aktivasi:**
- Klik tombol Expand (↗) pada tile
- Keyboard shortcut `F` saat tile dipilih
- Klik event di Activity Log untuk focus ke kamera terkait

**Tampilan Focus Mode:**
- Tile yang di-focus membesar mengisi sebagian besar area grid
- Border highlight berwarna pada tile focus
- Tile lainnya mengecil dan fade ke background
- Kontrol tile tetap tersedia

**Fitur dalam Focus Mode:**
- Otomatis promote ke Main quality stream (dari Sub)
- Kualitas kembali ke Sub saat exit focus
- Semua tile controls tetap berfungsi
- Event details overlay tersedia (Phase 2+)

**Cara Keluar:**
- Tekan `ESC`
- Klik tombol exit focus
- Klik tile lain

### 13.2 Fullscreen Grid

Fullscreen untuk seluruh area grid (termasuk semua tile).

**Cara Aktivasi:**
- Tombol "Fullscreen Grid" di top bar

**Tampilan:**
- Seluruh grid mengisi layar penuh browser
- Sidebar dan top bar tersembunyi
- Semua tile tetap terlihat sesuai grid preset

**Cara Keluar:**
- Tekan `ESC`
- Browser native fullscreen exit

### 13.3 Fullscreen Per-Tile

Fullscreen untuk satu tile individual.

**Cara Aktivasi:**
- Tombol Fullscreen (⛶) pada tile
- Keyboard shortcut `F` pada tile yang dipilih (saat sudah dalam focus)

**Tampilan:**
- Tile tunggal mengisi seluruh layar browser
- Menggunakan Browser Fullscreen API
- Kontrol tile tersembunyi (muncul saat hover)

**Cara Keluar:**
- Tekan `ESC`
- Browser native fullscreen exit

## Perbedaan Focus vs Fullscreen

| Aspek | Focus Mode | Fullscreen |
|-------|-----------|------------|
| Scope | Dalam grid | Seluruh browser |
| Tile lain | Terlihat (mengecil) | Tidak terlihat |
| Browser chrome | Tetap ada | Tersembunyi |
| Quality auto-promote | Ya (Sub → Main) | Tidak otomatis |
| API | CSS-based | Browser Fullscreen API |

## Status Mockup

| Item | Status |
|------|--------|
| Focus mode | ✅ Implemented (statis) |
| Fullscreen grid | ✅ Implemented (statis) |
| Fullscreen per-tile | ✅ Implemented (statis) |
| Auto quality promote | ✅ Implemented (statis) |
| Event details overlay | 🔲 Phase 2 |
