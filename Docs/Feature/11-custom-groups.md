# 11 - Custom Camera Groups

## Deskripsi

Fitur untuk membuat dan mengelola grup kamera kustom di luar grup default yang sudah tersedia. Memungkinkan pengguna mengorganisir kamera sesuai kebutuhan dengan nama dan warna custom.

## Fitur

### 11.1 Default Groups

Grup bawaan yang sudah tersedia:

| Grup | Keterangan |
|------|------------|
| Perimeter | Kamera area luar/perimeter |
| Interior | Kamera area dalam |
| Parking | Kamera area parkir |
| Warehouse | Kamera area gudang |

### 11.2 Create Custom Group

- Input nama grup baru
- Validasi nama unik (tidak boleh duplikat)
- Wajib pilih warna untuk grup

### 11.3 Color Picker

- Palette warna yang tersedia untuk dipilih
- Setiap grup memiliki warna unik sebagai identifier visual
- Warna ditampilkan pada:
  - Header grup di sidebar
  - Badge di camera list
  - Filter dropdown

### 11.4 Delete Custom Group

- Opsi hapus grup kustom
- Kamera dalam grup yang dihapus perlu di-reassign ke grup lain
- Grup default tidak dapat dihapus

### 11.5 Assign Camera to Group

- Saat add/edit kamera, pilih grup dari dropdown
- Dropdown menampilkan semua grup (default + custom)
- Custom group muncul dengan warna indicator

### 11.6 Group Integration

Custom groups terintegrasi dengan:
- **Sidebar**: Ditampilkan sebagai section terpisah dengan header
- **Camera Management**: Tersedia di dropdown group selector
- **Analytics Matrix**: Filter by group mendukung custom groups
- **Activity Log**: Category filter menampilkan custom groups

## Status Mockup

| Item | Status |
|------|--------|
| Default groups | ✅ Implemented (statis) |
| Create custom group | ✅ Implemented (statis) |
| Color picker | ✅ Implemented (statis) |
| Delete custom group | ✅ Implemented (statis) |
| Assign camera to group | ✅ Implemented (statis) |
| Inline group creation | 🔲 Phase 1+ |

## Persistence

- Disimpan di `localStorage` dengan key: `go2rtc-custom-groups`
- Format data: array of `{ name: string, color: string }`
- Persisten antar sesi browser
