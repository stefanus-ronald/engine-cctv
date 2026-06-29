# V-004 Summary — Dynamic VMD Sensitivity Control + Activity Log

## Apa yang berubah?

1. **Sensitivity slider di deep dive panel** — User bisa mengatur sensitivity VMD, Line Crossing, dan Loitering langsung dari UI tanpa membuka web UI kamera satu-satu.

2. **Detection events di activity log** — Semua detection events dari ISAPI (motion, line crossing, dll) sekarang muncul di activity log, membuktikan pipeline detection bekerja.

## Cara kerja — Sensitivity

1. User buka deep dive panel (Analytics tab → klik nama kamera)
2. Section "Hardware Sensitivity" menampilkan slider per detector
3. Data sensitivity di-fetch dari kamera via `GET /api/detection/sensitivity/:id`
4. User geser slider → `PUT /api/detection/sensitivity/:id` → ISAPI GET-Modify-PUT → kamera ter-update
5. Verifikasi: buka web UI kamera → sensitivity sudah berubah sesuai slider

## Cara kerja — Activity Log

1. ISAPI alert stream mengirim event ke backend → SSE broadcast ke frontend
2. Frontend SSE handler memanggil `fireAnalyticsEvent()` → dedupe → toast → flash → `logEvent()`
3. Event muncul di activity log (drawer kiri bawah) dengan kategori "Analytics"
4. Sebelumnya: event hanya muncul jika analytics wizard sudah di-setup
5. Sekarang: event selalu muncul, membuktikan detection berfungsi

## Hasil Test (Real)

| Kamera | Motion Sensitivity | Line Sensitivity | Loitering Sensitivity |
|--------|-------------------|-----------------|----------------------|
| Parkiran | 40 (diturunkan dari 60) | 50 | 50 |
| Lantai 3 | 60 | 50 | 50 |
| R. Kreatif | 60 | 50 | 50 |
| PTZ LT.1 | 60 | 50 | 50 |
| Pintu Depan | N/A (NVR) | N/A (NVR) | - |
| Ruang Dev 1 | 60 | 50 | 50 |

## Files

| File | Aksi |
|------|------|
| `src/isapi/sensitivity-api.js` | CREATE |
| `src/router.js` | MODIFY |
| `public/js/app.js` | MODIFY |
| `public/css/style.css` | MODIFY |
