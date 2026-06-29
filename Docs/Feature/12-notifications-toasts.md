# 12 - Notifications & Toast Messages

## Deskripsi

Sistem notifikasi toast non-intrusive yang menampilkan feedback singkat untuk berbagai event dan perubahan dalam aplikasi. Toast muncul di pojok kanan atas dan hilang otomatis.

## Fitur

### 12.1 Toast Notification

- Muncul di pojok kanan atas layar (top-right)
- Auto-dismiss setelah durasi tertentu
- Non-blocking: tidak mengganggu interaksi pengguna
- Stackable: beberapa toast bisa muncul bersamaan

### 12.2 Toast Variants

| Variant | Durasi | Keterangan |
|---------|--------|------------|
| Info | 2.5 detik | Informasi umum (perubahan settings, dll) |
| Warning | 2.5 detik | Peringatan (stream limit, dll) |
| Analytics | 6 detik | Detection events (durasi lebih lama) |

### 12.3 Toast Triggers

Event yang memunculkan toast notification:

#### Configuration Changes
- Perubahan streaming protocol
- Perubahan display settings
- Perubahan stream settings

#### Layout Events
- Layout berhasil disimpan
- Layout berhasil dimuat
- Layout di-import/export

#### Stream Events
- Stream reconnecting
- Audio muted/unmuted
- Stream budget warning (mendekati limit)

#### Camera Events
- Kamera menjadi online
- Kamera menjadi offline
- Hasil test connection (sukses/gagal)

#### Analytics Events
- Detection event terdeteksi
- Detector configuration berubah
- Toast di-suppress untuk event lanjutan dalam cluster (dedup)

#### System Events
- Session dimulai

### 12.4 Toast Suppression (Analytics)

- Saat event analytics di-cluster (dedup dalam 30 detik), hanya event pertama yang menampilkan toast
- Event lanjutan dalam cluster yang sama tidak memunculkan toast baru
- Mengurangi noise notifikasi saat banyak event berurutan

## Status Mockup

| Item | Status |
|------|--------|
| Toast notification | ✅ Implemented (statis) |
| Auto-dismiss | ✅ Implemented (statis) |
| Multiple variants | ✅ Implemented (statis) |
| Toast suppression | ✅ Implemented (statis) |
| Stackable toasts | ✅ Implemented (statis) |
