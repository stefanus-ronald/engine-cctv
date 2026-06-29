# V-002 Summary — Real Detection Integration

**Tanggal**: 2026-06-12

---

## Request

Implementasikan real detection dari hardware kamera Hikvision (menggantikan simulated events), dengan referensi dari MASTER_SUMMARY_SAMPLEPROJECT.

---

## Apa yang Sudah Dikerjakan

### 1. ISAPI Alert Stream (Hardware VCA)

| Item | Status |
|------|--------|
| Digest Authentication (RFC 2617) | Done |
| XML event parser (regex-based) | Done |
| Persistent HTTP connection per kamera | Done |
| Multipart/mixed boundary parsing | Done |
| Event type mapping (VMD→motion, linedetection→line, dll) | Done |
| Exponential backoff reconnection | Done |
| Account lock detection | Done |
| NVR dedup (satu koneksi per IP:port) | Done |
| Stale connection detection (5 min) | Done |
| Runtime camera change handling | Done |

### 2. Event Pipeline (Backend)

| Item | Status |
|------|--------|
| Event normalizer (ISAPI → unified format) | Done |
| Event normalizer (VCA → unified format) | Done |
| Server-side deduplication (10s window) | Done |
| SSE broadcast `type:'detection'` | Done |

### 3. Python VCA Proxy (Optional)

| Item | Status |
|------|--------|
| Timer-based snapshot capture | Done |
| POST to Python VCA service | Done |
| Confidence threshold filtering | Done |
| YOLO class filtering | Done |
| Default disabled (`VCA_ENABLED=false`) | Done |

### 4. API Endpoints

| Item | Status |
|------|--------|
| `GET /api/detection/status` | Done |
| `POST /api/detection/reconnect/:id` | Done |

### 5. Frontend Integration

| Item | Status |
|------|--------|
| SSE handler untuk `type:'detection'` → `fireAnalyticsEvent()` | Done |
| ISAPI status tracking (`_isapi_connected`/`_isapi_disconnected`) | Done |
| Simulator guard: skip ISAPI-connected cameras | Done |

### 6. Configuration

| Item | Status |
|------|--------|
| `cameras.json` extended dengan `isapiPort` + `detection` | Done |
| `.env` extended dengan detection variables | Done |
| `config.js` extended dengan detection config | Done |

---

## File yang Dimodifikasi

| File | Jenis Perubahan |
|------|----------------|
| `src/isapi/digest-auth.js` | **BARU** — Digest Auth |
| `src/isapi/xml-parser.js` | **BARU** — XML event parser |
| `src/isapi/alert-stream-manager.js` | **BARU** — Core alert stream manager |
| `src/events/event-normalizer.js` | **BARU** — Event normalizer |
| `src/events/event-dedup.js` | **BARU** — Server-side dedup |
| `src/vca/vca-proxy.js` | **BARU** — Python VCA proxy (optional) |
| `cameras.json` | Tambah `isapiPort`, `detection` per kamera |
| `src/config.js` | Tambah detection config fields |
| `.env` | Tambah ISAPI + VCA environment variables |
| `src/server.js` | Initialize detection services + graceful shutdown |
| `src/router.js` | Tambah 2 route detection API |
| `src/camera-manager.js` | Expose new fields + `findByIpAndChannel()` |
| `public/js/app.js` | SSE handler + simulator guard |

---

## Status Lanjutan

| Item | Status | Versi |
|------|--------|-------|
| Ruang Dev 1 isapiPort dikonfigurasi (8080) | Selesai | V-003 |
| cameras.json events disesuaikan per model kamera | Selesai | V-003 |
| Real hardware capabilities probe | Selesai | V-003 |
| Detection events muncul di activity log | Selesai | V-004 |
| Python VCA service (YOLOv8) | Belum | - |
| ISAPI connection status indicator di sidebar | Belum | - |
| Real-time GPU monitoring | Belum | - |
