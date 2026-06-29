# 14 - Data Persistence

## Deskripsi

Sistem penyimpanan data menggunakan browser `localStorage` untuk mempertahankan state aplikasi antar sesi. Setiap domain data memiliki key tersendiri di localStorage.

## localStorage Keys

### 14.1 `go2rtc-settings`

Menyimpan pengaturan display, stream, dan protocol.

```json
{
  "protocol": "webrtc",
  "defaultQuality": "sub",
  "maxConcurrentStreams": 36,
  "reconnectInterval": 5,
  "audioEnabled": true,
  "gridGap": 4,
  "showCameraNames": true,
  "showLiveBadge": true,
  "aspectRatio": "16:9",
  "animationSpeed": "normal"
}
```

**Terkait fitur:**
- [06-stream-settings.md](06-stream-settings.md)
- [07-display-settings.md](07-display-settings.md)

### 14.2 `go2rtc-layouts`

Menyimpan named layouts yang disimpan pengguna.

```json
{
  "Layout Name": {
    "gridSize": "3x3",
    "focusLayout": null,
    "tiles": [
      { "position": 0, "cameraId": "cam-01" },
      { "position": 1, "cameraId": "cam-05" }
    ]
  }
}
```

**Terkait fitur:** [04-layout-save-load.md](04-layout-save-load.md)

### 14.3 `go2rtc-custom-groups`

Menyimpan grup kamera kustom yang dibuat pengguna.

```json
[
  { "name": "VIP Area", "color": "#e74c3c" },
  { "name": "Lobby", "color": "#3498db" }
]
```

**Terkait fitur:** [11-custom-groups.md](11-custom-groups.md)

### 14.4 `go2rtc-analytics`

Menyimpan konfigurasi analytics: server detector enablement dan per-cell config.

```json
{
  "serverDetectors": {
    "motion": true,
    "person": true,
    "vehicle": false,
    "face": false,
    "lpr": false,
    "lineCrossing": false,
    "loitering": false
  },
  "cellConfig": {
    "cam-01:motion": { "enabled": true, "source": "auto" },
    "cam-01:person": { "enabled": true, "source": "edge" }
  }
}
```

**Terkait fitur:** [08-analytics.md](08-analytics.md)

### 14.5 `go2rtc-activity-log`

Menyimpan entri Activity Log.

```json
[
  {
    "id": "evt-001",
    "timestamp": "2025-01-15T10:30:00Z",
    "message": "Camera Perimeter-01 went online",
    "category": "camera",
    "severity": "info",
    "read": false
  }
]
```

- Maksimum 500 entri (ring buffer)
- Entri terlama dihapus otomatis

**Terkait fitur:** [09-activity-log.md](09-activity-log.md)

## Data yang TIDAK Di-persist

| Data | Alasan |
|------|--------|
| `cameraCapabilities` | Recalculated setiap page load |
| Activity Log filter state | Reset tiap sesi (by design) |
| Expanded/collapsed cluster state | UI state sementara |
| Camera list | Tidak di-persist di versi mockup ini |

## Batasan localStorage

- Limit browser: ~5MB per domain
- Data disimpan sebagai string (JSON.stringify)
- Sinkron (blocking) - tidak ada async operation
- Tidak ada enkripsi (password tersimpan plain text di mockup)
- Tidak shared antar tab secara real-time (kecuali via storage event)

## Status Mockup

| Item | Status |
|------|--------|
| Settings persistence | ✅ Implemented |
| Layouts persistence | ✅ Implemented |
| Custom groups persistence | ✅ Implemented |
| Analytics persistence | ✅ Implemented |
| Activity log persistence | ✅ Implemented |
| Camera list persistence | ❌ Tidak di-persist |

## Catatan Implementasi

- Di production, data sebaiknya menggunakan backend database
- Password harus di-hash/encrypt, bukan plain text
- Pertimbangkan IndexedDB untuk data besar (activity log)
- Sinkronisasi antar tab perlu menggunakan BroadcastChannel atau storage event
