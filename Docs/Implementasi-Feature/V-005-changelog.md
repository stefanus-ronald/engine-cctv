# V-005 Changelog — hwCapabilities Bug Fix + SSE Notification

**Tanggal:** 2026-06-17
**Scope:** Fix bug hwCapabilities tidak sampai ke frontend, tambah SSE notification saat probe selesai.

---

## Bug Description

Semua kamera menampilkan "SW only" untuk Line Crossing dan detector lainnya di deep dive panel, meskipun hardware mendukung dan probe ISAPI berhasil mendeteksi fitur.

### Trace Path

```
UI "SW only" label
  ← edgeOk = !!caps[d.id]  (app.js:2572)
  ← caps = cameraCapabilities[cameraId]
  ← buildCameraCapabilities() → cam.hwCapabilities === null
  ← loadCamerasFromAPI() → TIDAK mapping hwCapabilities dari API response
  ← GET /api/cameras → { hwCapabilities: {...} }  ← data ada di backend!
```

---

## Files Modified

### `public/js/app.js`

#### Fix 1: Mapping hwCapabilities (line ~507)

**Before:**
```javascript
cameras = apiCameras.map(c => ({
  id: c.id,
  name: c.name || 'Camera',
  // ... fields lain ...
  status: c.status || 'unknown',
  // hwCapabilities TIDAK di-mapping!
}));
```

**After:**
```javascript
cameras = apiCameras.map(c => ({
  id: c.id,
  name: c.name || 'Camera',
  // ... fields lain ...
  status: c.status || 'unknown',
  hwCapabilities: c.hwCapabilities || null,   // ← ADDED
}));
```

#### Fix 2: SSE handler untuk capabilities-updated (line ~6847)

**Added:**
```javascript
if (data.type === 'capabilities-updated') {
  // ISAPI probe finished — refresh capabilities from backend
  loadCamerasFromAPI().then(ok => {
    if (ok) { renderSidebar(); renderGrid(); }
  });
}
```

### `src/isapi/capabilities-probe.js`

#### Fix 3: SSE broadcast setelah probe (line 15 + line 193-195)

**Added import:**
```javascript
const sseBroadcaster = require('../events/sse-broadcaster');
```

**Added broadcast:**
```javascript
console.log('[isapi-probe] Hardware capabilities probe complete');
// Notify connected frontends so they refresh capabilities
sseBroadcaster.broadcast({ type: 'capabilities-updated' });
```

---

## Verification

1. Start server → probe berjalan async
2. Browser load → awalnya hwCapabilities null → "SW only"
3. Probe selesai → SSE `capabilities-updated` → browser re-fetch → "HW ✓" muncul
4. Browser load setelah probe → langsung tampil "HW ✓"

---

## Audit Report

| Severity | Issue | Fix |
|----------|-------|-----|
| Medium | hwCapabilities tidak di-mapping di frontend | Tambah field di loadCamerasFromAPI() |
| Medium | Race condition: browser load sebelum probe | SSE broadcast + handler |

Zero new npm dependencies.
