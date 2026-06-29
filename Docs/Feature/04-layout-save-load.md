# 04 - Layout Save & Load

## Deskripsi

Sistem penyimpanan dan pemuatan layout yang memungkinkan pengguna menyimpan konfigurasi grid (preset, kamera yang di-assign, posisi tile) dan memuatnya kembali kapan saja. Mendukung import/export untuk backup dan sharing.

## Fitur

### 4.1 Save Layout

- Tombol "Save Layout" di top bar
- Klik tombol memunculkan popover dengan input nama layout
- Nama layout wajib diisi
- Data yang disimpan:
  - Grid size / preset yang aktif
  - Focus layout type (jika aktif)
  - Tile assignments (kamera mana di tile mana)
  - Posisi dan urutan tile

### 4.2 Load Layout

- Tombol "Load Layout" di top bar
- Klik tombol memunculkan dropdown berisi daftar layout tersimpan
- Pilih layout untuk langsung memuat konfigurasi
- Grid dan tile assignments diperbarui secara instan

### 4.3 Import Layout (JSON)

- Import layout dari file JSON eksternal
- Format file sesuai dengan struktur data layout internal
- Validasi format sebelum import
- Layout yang di-import ditambahkan ke daftar layout tersimpan

### 4.4 Export Layout (JSON)

- Export semua layout tersimpan ke file JSON
- File dapat digunakan untuk backup atau sharing antar pengguna
- Format JSON yang human-readable

### 4.5 Reset All Layouts

- Opsi untuk menghapus semua layout tersimpan sekaligus
- Konfirmasi sebelum eksekusi
- Mengembalikan ke state kosong (tanpa layout tersimpan)

## Data Structure

```json
{
  "layouts": {
    "Layout Name": {
      "gridSize": "3x3",
      "focusLayout": null,
      "tiles": [
        { "position": 0, "cameraId": "cam-01" },
        { "position": 1, "cameraId": "cam-05" },
        { "position": 2, "cameraId": null }
      ]
    }
  }
}
```

## Persistence

- Disimpan di `localStorage` dengan key: `go2rtc-layouts`
- Persisten antar sesi browser
- Tidak ada batas jumlah layout yang bisa disimpan (selain limit localStorage ~5MB)

## Status Mockup

| Item | Status |
|------|--------|
| Save layout | ✅ Implemented (statis) |
| Load layout | ✅ Implemented (statis) |
| Import JSON | ✅ Implemented (statis) |
| Export JSON | ✅ Implemented (statis) |
| Reset all | ✅ Implemented (statis) |

## Interaksi

```
Klik Save → Popover input nama → Isi nama → Klik Save → Layout tersimpan
Klik Load → Dropdown muncul → Pilih layout → Grid diperbarui
Import → Pilih file JSON → Layout ditambahkan
Export → Download file JSON
Reset → Konfirmasi → Semua layout dihapus
```
