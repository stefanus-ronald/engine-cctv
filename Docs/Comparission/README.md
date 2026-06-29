# 📊 Comparission — Perbandingan Platform NVR/CCTV

> Folder ini berisi riset perbandingan platform NVR open-source (Shinobi, Frigate, LightNVR) terhadap **ENGINE-CCTV** kita, plus rangkuman mendalam LightNVR.
> Dibuat: 29 Juni 2026.

---

## Isi folder

| File | Isi |
|------|-----|
| [**NVR-Comparison.md**](NVR-Comparison.md) | ⭐ **Dokumen utama** — perbandingan Shinobi vs Frigate vs LightNVR vs ENGINE-CCTV (stack, fitur, performa, lisensi) + jawaban "bukannya engine kita sudah pakai itu?" |
| [index.html](index.html) | Visualisasi perbandingan (buka di browser) |
| [LightNVR-Ringkasan.md](LightNVR-Ringkasan.md) | Rangkuman teknis mendalam LightNVR (hasil bedah kode sumber) |
| [lightnvr-visual.html](lightnvr-visual.html) | Presentasi visual LightNVR + screenshot UI |
| [images/](images/) | Screenshot & diagram arsitektur (dari repo LightNVR) |

---

## Ringkasan 30 detik

- **ENGINE-CCTV (kita)** = NVR custom Node.js, fokus **Hikvision ISAPI**, pakai **go2rtc + FFmpeg**, deteksi via hardware kamera, playback dari NVR. Lisensi MIT.
- **Frigate** = NVR **AI-first** (Python). Deteksi objek on-frame (Coral/OpenVINO/dll), bundling go2rtc, integrasi Home Assistant erat. MIT.
- **Shinobi** = NVR serba-bisa (Node.js). Deteksi motion pixel + plugin AI. **Lisensi rumit** (Pro = EULA komersial berbayar, CE = GPLv3).
- **LightNVR** = NVR ultra-ringan (C, 256MB RAM), pakai go2rtc. GPLv3.

**Kunci:** kita **tidak memakai** salah satu platform itu — kita berbagi **komponen** (go2rtc, FFmpeg) dengan Frigate & LightNVR. Detail di [NVR-Comparison.md](NVR-Comparison.md).
