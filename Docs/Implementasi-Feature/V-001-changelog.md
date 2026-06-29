# V-001 Changelog — Implementasi Fitur Dinamis

**Tanggal**: 2026-06-12
**Request**: V-001.md
**Status**: Implemented

---

## Summary

Implementasi 3 fitur utama dari request V-001:
1. **Protocol Badge dinamis** di top bar
2. **Analytics Deep Dive** dengan hardware support label & Edge disable
3. **Analytics Cell Popover** dengan logika source yang direvisi

---

## Perubahan File

### 1. `public/index.html`

**Tambahan**: Protocol Badge di top bar

- Menambahkan elemen `.protocol-badge` di antara grid presets dan stream budget
- Badge menampilkan protocol aktif (WebRTC/MJPEG) dan quality default (SUB/MAIN)
- Otomatis update saat user mengganti protocol atau quality di Settings

```html
<div class="protocol-badge" id="protocol-badge">
  <span class="protocol-badge-proto">WebRTC</span>
  <span class="protocol-badge-sep">|</span>
  <span class="protocol-badge-quality">SUB</span>
</div>
```

---

### 2. `public/css/style.css`

**Tambahan**: Styling untuk fitur baru

| CSS Class | Fungsi |
|-----------|--------|
| `.protocol-badge` | Container badge protocol di top bar |
| `.protocol-badge-proto` | Label protocol (biru = WebRTC, kuning = MJPEG) |
| `.protocol-badge-quality` | Label quality (hijau = SUB, orange = MAIN) |
| `.dd-hw-support-banner` | Banner hardware support di deep dive |
| `.hw-supported` / `.hw-unsupported` | Variant banner (hijau/merah) |
| `.disabled-source` | Style untuk tombol Edge yang di-disable |
| `.dd-det-hw-label` | Label HW/SW per detector di tabel deep dive |

---

### 3. `public/js/app.js`

#### A. Fungsi baru: `updateProtocolBadge()`

- Dipanggil dari `applySettings()` setiap kali settings berubah
- Update teks dan warna badge sesuai `settings.streamProtocol` dan `settings.defaultQuality`
- Class toggle: `.protocol-mjpeg` dan `.quality-main`

#### B. Perubahan pada `renderCameraDeepDive()`

1. **Hardware support banner** ditambahkan di atas section capabilities:
   - Hijau: "Hardware (Edge AI) supported — N detectors available on device"
   - Merah: "Hardware (Edge AI) not supported — all detectors will use Server (Software)"

2. **Per-detector hardware label** di tabel detector:
   - `HW ✓` (hijau) = Hardware (Edge) supported untuk detector ini
   - `SW only` (biru) = Hardware tidak support, akan pakai Server (Software)

3. **Edge option di-disable** pada dropdown Camera Default jika hardware tidak support:
   - Option `Edge` diberi attribute `disabled`
   - Hint text berubah: "Edge disabled — hardware does not support Edge AI"

#### C. Perubahan pada `_renderAnalyticsPopoverBody()`

1. **Edge button di-disable** pada segmented control jika hardware tidak support detector tsb:
   - Attribute `disabled` + class `disabled-source`
   - Tooltip CSS: "Not supported by hardware"
   - Click handler di-skip untuk button yang disabled

2. **Hardware warning banner** ditambahkan di atas segmented control:
   - Muncul hanya jika Edge tidak support untuk detector ini
   - Teks: "Hardware (Edge) tidak tersedia untuk [Detector] — gunakan Auto atau Server"

3. **Source hint** ditambahkan di bawah segmented control:
   - "Auto = Hardware jika didukung, jika tidak → Software | Edge = Hardware | Server = Software"

#### D. Perubahan pada `resolveSource()`

Reason messages diperbarui untuk menggunakan terminologi Hardware/Software:

| Source | Sebelum | Sesudah |
|--------|---------|---------|
| Auto → Edge | "Camera supports edge motion; Auto prefers edge." | "Hardware supports motion; Auto → Edge (Hardware)." |
| Auto → Server | "Camera lacks edge motion; falling back to server." | "Hardware does not support motion; Auto → Server (Software)." |
| Edge pinned | "Pinned to Edge by user." | "Pinned to Edge (Hardware) by user." |
| Edge no support | "Camera doesn't report edge motion detection." | "Hardware does not support motion — Edge not available on this device." |
| Server pinned | "Pinned to Server by user." | "Pinned to Server (Software) by user." |
| No source | "No source available — enable server..." | "No source available — hardware does not support..." |

---

## Logika Source (Revisi)

```
┌──────────┬────────────────────────────────────────────────────┐
│ Source    │ Perilaku                                           │
├──────────┼────────────────────────────────────────────────────┤
│ Auto     │ Cek hardware support device:                       │
│          │   → Jika support  → Edge (Hardware)                │
│          │   → Jika tidak    → Server (Software)              │
│          │   → Jika keduanya tidak ada → Pending              │
├──────────┼────────────────────────────────────────────────────┤
│ Edge     │ Paksa Hardware kamera                              │
│          │   → Jika hardware tidak support → button disabled  │
│          │   → Ditampilkan label "Not supported by hardware"  │
├──────────┼────────────────────────────────────────────────────┤
│ Server   │ Paksa Software server                              │
│          │   → Selalu tersedia jika server detector enabled   │
└──────────┴────────────────────────────────────────────────────┘
```

---

## UI Changes Visual Summary

### Top Bar — Protocol Badge
```
[ENGINE CCTV] [1×1] [2×2] ... | [WEBRTC | SUB] | [Active: 2/36] | [Mute All] ...
                                  ↑ NEW BADGE
```

### Analytics Deep Dive — Hardware Banner
```
◀ Back to matrix
Parkiran · Analytics

┌─────────────────────────────────────────────────┐
│ ✓ Hardware (Edge AI) supported — 3 detectors    │  ← NEW BANNER
└─────────────────────────────────────────────────┘

Reported capabilities (read-only)
Edge supports: Motion, Person, Face
...

Camera defaults
Default source: [Auto ▼]  ← Edge disabled jika HW tidak support

Detectors
┌──────────────┬────────┬──────────┬─────┬──┐
│ Detector     │ Source │ Schedule │Zone │🧪│
├──────────────┼────────┼──────────┼─────┼──┤
│ ☑ Motion HW✓ │ Auto  │ 24/7     │ —   │🧪│
│ ☑ Vehicle SW │ Auto  │ 24/7     │ —   │🧪│  ← "SW only" label
└──────────────┴────────┴──────────┴─────┴──┘
```

### Cell Popover — Edge Disabled
```
┌──────────────────────────────────────┐
│ Parkiran · Motion                    │
│ ● Active        [Turn off]          │
│                                      │
│ Source                               │
│ ┌──────────────────────────────────┐ │
│ │ ✗ HW (Edge) tidak tersedia...   │ │  ← NEW WARNING
│ └──────────────────────────────────┘ │
│ [Auto] [Edge ⚠] [Server]           │  ← Edge DISABLED
│       ↑ greyed out, unclickable     │
│                                      │
│ Auto = HW jika didukung...          │  ← NEW HINT
│                                      │
│ Now bound to: 🟢 Edge              │
│ Why: Hardware supports motion...    │
└──────────────────────────────────────┘
```
