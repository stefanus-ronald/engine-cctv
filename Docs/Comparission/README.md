# 📊 Comparission — Perbandingan Platform NVR/CCTV

> Folder ini berisi riset perbandingan platform NVR open-source (Shinobi, Frigate, LightNVR) terhadap **ENGINE-CCTV** kita, plus rangkuman mendalam LightNVR.
> Dibuat: 29 Juni 2026 · **Diperbarui: 2 Juli 2026** (V-014 ONVIF terimplementasi penuh + hardening/audit — lihat NVR-Comparison.md §5b).

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

- **ENGINE-CCTV (kita)** = NVR custom Node.js, fokus **Hikvision ISAPI** + **ONVIF generik (V-014: discovery, live, events PullPoint, PTZ, playback Profile-G — live & events tervalidasi hardware nyata)**, pakai **go2rtc + FFmpeg**, playback dari NVR. Hardening 2 Jul: retry-pull events, clock-offset auth, HTTPS xaddr, 96 unit test. Lisensi MIT.
- **Frigate** = NVR **AI-first** (Python). Deteksi objek on-frame (Coral/OpenVINO/dll), bundling go2rtc, integrasi Home Assistant erat. MIT.
- **Shinobi** = NVR serba-bisa (Node.js). Deteksi motion pixel + plugin AI. **Lisensi rumit** (Pro = EULA komersial berbayar, CE = GPLv3).
- **LightNVR** = NVR ultra-ringan (C, 256MB RAM), pakai go2rtc. GPLv3.

**Kunci:** kita **tidak memakai** salah satu platform itu — kita berbagi **komponen** (go2rtc, FFmpeg) dengan Frigate & LightNVR. Detail di [NVR-Comparison.md](NVR-Comparison.md).
