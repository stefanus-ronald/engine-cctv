# V-011 — Responsif penuh, data bersih, timezone playback WIB

> Tanggal: 29 Jun 2026. Tiga perbaikan: UI responsif (PC/Tablet/Mobile),
> kosongkan data existing untuk input manual, dan kunci timezone playback ke
> **WIB (UTC+7)** agar tidak ada gap dengan jam HDD/OSD perangkat.

---

## 1. Responsif dashboard (Sidebar, Navbar/Topbar, Modal, Grid)

**File:** `public/css/style.css`, `public/index.html`, `public/js/app.js`

Breakpoint baru: `≤1024` (tablet/laptop kecil), `≤768` (tablet potret / HP besar),
`≤480` (HP), plus aturan `pointer:coarse` untuk target sentuh ≥40px.

- **Topbar (anti-overflow berjenjang):**
  - **≤1450:** `protocol-badge` & `stream-budget` disembunyikan.
  - **≤1200 (compact):** baris **grid-presets** runtuh jadi **dropdown** tunggal
    ("⊞ 3×3 ▾" → popover berisi semua preset + focus layout); tombol aksi jadi
    **ikon-saja** (`font-size:0`, SVG tetap). Ini memperbaiki kasus layar ~1050px
    (mis. DevTools terbuka) yang tadinya terpotong.
  - **Universal:** topbar `overflow-x:auto` + `flex-shrink:0` pada anak → kontrol
    **tidak pernah terpotong**; kalau masih sempit, ia scroll (scrollbar disembunyikan).
  - Trigger dropdown: `#grid-menu-btn`/`#grid-menu-label` di `index.html`, logika
    buka/tutup + sinkron label di `app.js` (`setGridSize`/`setFocusLayout`).
- **Sidebar:** off-canvas di ≤768 dengan **backdrop** baru (`#sidebar-backdrop`) —
  tap area gelap untuk menutup. Lebar `min(82vw,300px)`.
- **Mobile tap-to-assign:** karena drag-and-drop sulit di sentuh, **tap kamera**
  di sidebar menugaskan ke tile kosong pertama lalu menutup sidebar
  (`assignCamToFirstEmpty` dipakai bersama tombol Enter).
- **Modal Settings & Playback:** **full-screen** di ≤768; tab settings jadi bar
  **scroll horizontal** di atas (border-bottom aktif). `form-row` menumpuk
  vertikal, footer tombol full-width.
- **Tabel kamera:** kolom Group & IP disembunyikan di HP agar muat.
- **Backdrop aman di desktop:** `#sidebar-backdrop` `display:none` kecuali di
  media ≤768 — tidak pernah memblokir klik di layar besar.

## 2. Bersihkan data existing (input manual)

**File:** `cameras.json`, `nvrs.json` → keduanya jadi `[]`.

Backup dibuat sebelum dikosongkan: `cameras.json.bak.<ts>`, `nvrs.json.bak.<ts>`.
Server boot bersih (`Loaded 0 camera(s)`), siap diisi via **Settings → Cameras →
Add Camera** (IP camera atau NVR scan/import).

## 3. Timezone playback dikunci ke WIB (UTC+7) — fix gap HDD/OSD

**File:** `src/isapi/playback-search.js` (`getDisplayOffsetMin`).

**Masalah:** IP camera "device baru" yang mengembalikan waktu **TRUE UTC bertag
`Z`** ter-short-circuit ke offset 0 (kode lama: `if (!tzMin) return 0`), sehingga
timeline playback **tertinggal 7 jam** dari jam OSD/HDD-management → seek ke waktu
salah → terlihat "tidak ada rekaman" / playback bermasalah.

**Perbaikan:** offset display sekarang **fixed WIB +420 menit** (bukan baca tz
perangkat yang sering kosong/salah). Konvensi perangkat tetap dibedakan secara
deterministik lewat **probe rekaman terbaru**:
- numerals ≈ UTC-now  → perangkat UTC-convention → **+420** (UTC→WIB)
- numerals ≈ WIB-now   → perangkat local-convention (NVR) → **0** (sudah WIB)

Berlaku konsisten untuk **search, stream, dan download** (ketiganya memakai
`getDisplayOffsetMin`). NVR DS-7616NI tetap benar (offset 0); IP camera baru kini
sejajar dengan jam HDD-management. Kode `System/time` lama yang rapuh dihapus.

> Catatan verifikasi: butuh dicek di perangkat asli WIB. Asumsi lokasi = WIB; bila
> nanti ada perangkat di zona lain, konstanta `WIB_OFFSET_MIN` di
> `playback-search.js` adalah satu-satunya titik ubah.
