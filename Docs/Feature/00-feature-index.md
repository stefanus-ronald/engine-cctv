# Feature Index - go2rtc LiveView

Dokumentasi fitur aplikasi go2rtc LiveView berdasarkan analisis mockup di `rtsp-mockup`.

> **Source mockup**: `E:\PROJECT\CCTV\rtsp-mockup`
> **Tech stack mockup**: Vanilla JS (single HTML + CSS + JS, tanpa framework)
> **Total kamera simulasi**: 36 kamera di 4 grup

---

## Daftar Dokumen Fitur

| No | Dokumen | Deskripsi |
|----|---------|-----------|
| 01 | [Grid & Layout Management](01-grid-layout-management.md) | Grid presets (1×1–6×6), focus layout, drag reorder, stream budget |
| 02 | [Sidebar & Camera List](02-sidebar-camera-list.md) | Sidebar kamera, search, grouped list, drag-to-grid, status indicator |
| 03 | [Tile Controls](03-tile-controls.md) | Per-tile controls: Sub/Main, mute, expand, fullscreen, analytics badge |
| 04 | [Layout Save & Load](04-layout-save-load.md) | Save/load layout, import/export JSON, reset |
| 05 | [Camera Management](05-camera-management.md) | CRUD kamera, NVR support, test connection, import/export |
| 06 | [Stream Settings](06-stream-settings.md) | Protocol (WebRTC/MJPEG), quality, max streams, reconnect, audio |
| 07 | [Display Settings](07-display-settings.md) | Grid gap, camera names, LIVE badge, aspect ratio, animation speed |
| 08 | [Analytics (Video Analytics MVP)](08-analytics.md) | Capability matrix, 7 detector types, event simulator, tile integration |
| 09 | [Activity Log](09-activity-log.md) | Event log drawer, search, filter, clustering, per-event actions |
| 10 | [Keyboard Shortcuts](10-keyboard-shortcuts.md) | Grid (1-6), navigation (arrows), controls (M, B, L, F, ESC) |
| 11 | [Custom Camera Groups](11-custom-groups.md) | Create/delete custom groups, color picker |
| 12 | [Notifications & Toasts](12-notifications-toasts.md) | Toast messages, variants, triggers, suppression |
| 13 | [Focus Mode & Fullscreen](13-focus-fullscreen-mode.md) | Focus mode, fullscreen grid, fullscreen per-tile |
| 14 | [Data Persistence](14-data-persistence.md) | localStorage keys, data structure, batasan |
| 15 | [Camera Hardware Features](15-camera-hardware-features.md) | Fitur native VCA per model kamera, status implementasi ENGINE-CCTV |
| 16 | [Hardware Catalog](16-hardware-catalog.md) | Datasheet referensi: 9 kamera baru G2/G3 + 11 NVR VPro series |

---

## Ringkasan Fitur per Area

### UI Utama
- Top bar dengan grid presets, layout controls, global actions
- Sidebar dengan camera list, search, drag-and-drop
- Grid area dengan dynamic tile rendering
- Activity Log drawer

### Settings Modal (5 Tab)
1. **Cameras** — Manajemen kamera (CRUD, NVR, import/export)
2. **Streams** — Protocol, quality, limits, audio
3. **Display** — Tampilan visual grid dan tile
4. **Analytics** — Capability matrix dan detector config
5. **Shortcuts** — Referensi keyboard shortcuts

### Jumlah Fitur

| Area | Jumlah Fitur |
|------|-------------|
| Grid & Layout | 5 |
| Sidebar | 6 |
| Tile Controls | 10 |
| Layout Save/Load | 5 |
| Camera Management | 10 |
| Stream Settings | 5 |
| Display Settings | 5 |
| Analytics | 11 |
| Activity Log | 12 |
| Keyboard Shortcuts | 12 |
| Custom Groups | 6 |
| Notifications | 4 |
| Focus/Fullscreen | 3 |
| Data Persistence | 5 |
| Camera Hardware Features | 1 |
| **Total** | **~100 fitur** |

---

## Phase Roadmap

### Phase 1 (MVP) — Implemented di Mockup ✅
- Semua fitur di atas (statis/simulated)
- Analytics capability matrix
- Event simulator
- Activity Log dengan dedup

### Phase 2 — Planned
- Setup wizard (5-step)
- Zone / line / mask editor (canvas drawing)
- Schedule configuration (24/7, after-hours, custom)
- Per-camera deep dive panel
- Bulk operations pada matrix
- Test-fire button
- Bbox overlay pada tile
- Export clip dari Activity Log

### Phase 3 — Planned
- Face Recognition (detection + recognition)
- Face Galleries & enrollment
- Edge/server gallery sync
- LPR plate list management
- Global rules engine (cross-camera)
- Cross-camera tracking & identity timeline
- Heatmaps & occupancy analytics
- Saved searches di Activity Log
- Multi-tenant permissions
