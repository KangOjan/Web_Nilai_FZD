# Web Nilai FZD

Website untuk menampilkan nilai mahasiswa. Mahasiswa login dengan NIM, admin (dosen) login dengan email.

- **Tampilan**: HTML + JavaScript statis, di-hosting di GitHub Pages (bisa dipindah ke Hostinger/hosting statis lain dengan mengunggah file yang sama).
- **Data & login**: Supabase (database Postgres + Auth). Aturan Row Level Security memastikan mahasiswa hanya bisa membaca nilainya sendiri.

## Halaman
- `index.html` – login (NIM untuk mahasiswa, email untuk admin) dan ganti password saat login pertama.
- `admin.html` – kelas & MK, impor peserta dari Excel, kategori/asesmen/bobot, edit nilai, rentang indeks.
- `mahasiswa.html` – nilai per asesmen, nilai akhir, dan indeks.

## Konfigurasi
`config.js` berisi Project URL dan publishable key Supabase. Keduanya memang publik.
**Jangan** pernah menaruh `service_role` / secret key di repo ini.

## Database
`supabase/schema.sql` dijalankan sekali di Supabase SQL Editor. Panduan lengkap: `supabase/PANDUAN-SETUP.md`.

## Perhitungan
- Nilai akhir = Σ (nilai asesmen × bobot asesmen / 100). Nilai kosong dihitung 0.
- Bobot diatur per kategori (berlaku untuk tiap asesmen di dalamnya) dan bisa diganti per asesmen.
- Indeks (semua MK): A ≥ 80, AB ≥ 70, B ≥ 65, BC ≥ 60, C ≥ 50, D ≥ 40, E < 40 (bisa diubah di halaman admin).
