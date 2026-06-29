# 05 - Camera Management

## Deskripsi

Sistem manajemen kamera lengkap yang tersedia melalui tab **Cameras** di Settings modal. Memungkinkan pengguna menambah, mengedit, menghapus, serta import/export daftar kamera. Mendukung konfigurasi IP Camera individual maupun NVR/Recorder multi-channel.

## Fitur

### 5.1 Camera List View (Tabel)

Tampilan tabel dengan kolom:

| Kolom | Keterangan |
|-------|------------|
| Name | Nama kamera |
| Group | Grup kamera (Perimeter, Interior, dll) |
| IP Address | Alamat IP kamera |
| Status | Online / Offline / Error |
| Actions | Tombol Edit (✏) dan Delete (🗑) |

- Label jumlah kamera total
- Search box untuk filter berdasarkan nama/grup
- Tombol "Add Camera" di bagian atas

### 5.2 Add Camera

Form penambahan kamera baru dengan field:

**Device Type:**
- IP Camera (kamera individual)
- NVR/Recorder (perekam multi-channel)

**Basic Fields:**

| Field | Required | Default | Keterangan |
|-------|----------|---------|------------|
| Brand | Ya | - | Dropdown (Hikvision) |
| IP Address | Ya | - | Alamat IP perangkat |
| RTSP Port | Ya | 554 | Port RTSP |
| Username | Ya | - | Username autentikasi |
| Password | Ya | - | Password autentikasi |
| Camera Name | Ya | - | Nama display kamera |
| Camera Group | Ya | - | Grup kamera |

**Advanced Settings (collapsible):**

| Field | Keterangan |
|-------|------------|
| RTSP Stream Path | Path stream (auto-generated dari brand) |
| Web Port | Port web interface kamera |
| Thumbnail URL | URL thumbnail/snapshot |
| RTSP URL Preview | Preview URL lengkap (password di-mask) |

### 5.3 Password Visibility Toggle

- Tombol ikon mata (👁) di samping field password
- Klik untuk toggle antara hidden (●●●●) dan visible
- Default: hidden

### 5.4 Test Connection (real sejak V-010)

- Tombol "Test Connection" pada form add/edit.
- **IP Camera:** kini benar-benar memeriksa perangkat via **HDD/Storage management** (`POST /api/storage/check`) — bukan lagi mock:
  - ✅ Terhubung → tampilkan ringkasan penyimpanan (mis. "NAS 9.9 GB, 2 GB kosong, ok" atau "tanpa penyimpanan").
  - ❌ Auth gagal (`401`) / tidak terjangkau.
- **NVR/Recorder:** tombol berubah jadi "Scan for channels" (lihat 5.7).

### 5.4b Storage / HDD Management (V-010)

- `GET /api/cameras/:id/storage` membaca `ISAPI/ContentMgmt/Storage` → daftar media (microSD/HDD/NAS): kapasitas, sisa, status, RW.
- Ditampilkan di **modal playback** (chip 💾) saat dibuka, dan dipakai untuk menjelaskan ketersediaan playback dari perangkat. Detail: `RESEARCH/NVR-DVR_Playback/10_STORAGE_HDD_MANAGEMENT.md`.

### 5.5 Edit Camera

- Klik ikon ✏ pada baris kamera di tabel
- Membuka form yang sama dengan Add Camera
- Field terisi dengan data kamera yang ada
- Tombol Save untuk menyimpan perubahan

### 5.6 Delete Camera

- Klik ikon 🗑 pada baris kamera di tabel
- Konfirmasi sebelum penghapusan
- Kamera dihapus dari daftar dan dari tile grid jika sedang di-assign

### 5.7 NVR/Recorder Support

Ketika device type = NVR/Recorder:

- Input IP dan credential NVR
- Tombol "Scan Channels" untuk deteksi channel
- Daftar channel yang terdeteksi dengan checkbox
- "Select All" checkbox untuk memilih semua channel
- Tampilan jumlah channel yang dipilih
- Setiap channel menjadi kamera individual setelah disimpan

### 5.7b NVR Auto-Sync saat Startup (V-009)

Selain onboarding manual di atas, recorder yang didaftarkan di **`nvrs.json`** akan **di-scan otomatis setiap server start**:

- Server membaca daftar channel NVR (`InputProxy/channels`) + nama device (`deviceInfo`).
- Tiap channel jadi kamera, **dikelompokkan di bawah nama NVR asli** (mis. "Kantor JMP-NVR").
- Kamera IP standalone di `cameras.json` **tidak diutak-atik** — tetap tampil sebagai fallback untuk lokasi tanpa NVR.
- `host` recorder bisa **IP LAN, IP publik, atau DDNS** (akses WAN: port-forward port ISAPI + RTSP).
- NVR tak terjangkau → channel terakhir yang tersimpan dipertahankan. Nonaktifkan dengan `NVR_AUTOSYNC=false`.

Format `nvrs.json`:
```json
[
  { "id": "nvr-main", "name": "", "group": "",
    "host": "192.168.1.181", "rtspPort": 5541, "isapiPort": 81,
    "username": "admin", "password": "******" }
]
```

### 5.8 Import Cameras (JSON)

- Tombol import untuk menambah kamera dari file JSON
- Validasi format file
- Kamera yang di-import ditambahkan ke daftar existing

### 5.9 Export Cameras (JSON)

- Tombol export untuk menyimpan semua kamera ke file JSON
- Format yang kompatibel dengan fitur import
- Berguna untuk backup dan migrasi

### 5.10 Form Validation

- Validasi field required (nama, IP, port, credential)
- Pesan error ditampilkan di bawah field yang bermasalah
- Tombol Save disabled jika form tidak valid
- Validasi format IP address

## Data Model

```
Camera {
  id: string               // Unique identifier
  name: string             // Display name
  group: string            // Camera group
  ip: string               // IP address
  rtspPort: number         // RTSP port (default: 554)
  username: string         // Auth username
  password: string         // Auth password
  brand: string            // Camera brand
  deviceType: "camera" | "nvr"
  streamPath: string       // RTSP stream path
  webPort: number          // Web interface port
  thumbnailUrl: string     // Thumbnail/snapshot URL
  status: "online" | "offline" | "error"
}
```

## Kamera Pre-populated (Mockup)

36 kamera simulasi sudah tersedia:
- IP range: 192.168.1.x
- Brand: Hikvision
- Tersebar di 4 grup default

## Status Mockup

| Item | Status |
|------|--------|
| Camera list table | ✅ Implemented (statis) |
| Add camera form | ✅ Implemented (statis) |
| Edit camera | ✅ Implemented (statis) |
| Delete camera | ✅ Implemented (statis) |
| NVR support | ✅ Implemented (statis) |
| Test connection | ✅ Implemented (simulated) |
| Import/Export JSON | ✅ Implemented (statis) |
| Password toggle | ✅ Implemented (statis) |
| Form validation | ✅ Implemented (statis) |
