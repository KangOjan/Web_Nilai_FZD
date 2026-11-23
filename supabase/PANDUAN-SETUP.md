# Panduan setup Supabase (langkah 1)

Kira-kira 10 menit. Cukup sekali.

## 1. Buat project
1. Buka https://supabase.com, daftar/masuk (bisa pakai akun GitHub).
2. **New project** → isi nama (misal `nilai-mahasiswa`), buat password database (simpan baik-baik), region **Southeast Asia (Singapore)**.
3. Tunggu sampai project siap (±2 menit).

## 2. Jalankan skema database
1. Menu kiri **SQL Editor** → **New query**.
2. Salin seluruh isi `schema.sql`, tempel, klik **Run**.
3. Harus muncul "Success. No rows returned".

## 3. Matikan pendaftaran bebas
**Authentication → Sign In / Providers**: matikan **Allow new users to sign up**.
Akun mahasiswa hanya dibuat oleh admin lewat impor Excel, jadi orang luar tidak bisa daftar sendiri.

## 4. Buat akun admin (Anda)
1. **Authentication → Users → Add user → Create new user**.
2. Isi email dan password Anda, centang **Auto Confirm User**.
3. Kembali ke **SQL Editor**, jalankan (ganti emailnya):

```sql
update public.profiles set role = 'admin', nama = 'Fauzan Ramadhan'
where id = (select id from auth.users where email = 'EMAIL-ANDA@contoh.com');
```

## 5. Kirim dua nilai ini ke Claude
**Project Settings → API** (atau **Data API**):
- **Project URL** (contoh `https://abcdxyz.supabase.co`)
- **anon / public key** (atau **Publishable key**)

Dua nilai ini memang aman ditaruh di website; keamanan data dijaga aturan RLS di database.
**Jangan** kirim `service_role` / secret key ke siapa pun.

## Catatan cara kerja
- Mahasiswa login dengan **NIM** dan password awal **4 digit terakhir NIM**, lalu wajib ganti password (minimal 6 karakter) saat login pertama.
- Lupa password? Admin bisa reset ke 4 digit terakhir NIM dari halaman admin.
- Nilai akhir = jumlah (nilai asesmen × bobot asesmen). Bobot diatur per kategori (misal tiap Kuis 5%) dan bisa diganti khusus untuk asesmen tertentu.
- Rentang indeks (sama untuk semua MK): A ≥ 80, AB ≥ 70, B ≥ 65, BC ≥ 60, C ≥ 50, D ≥ 40, E < 40. Bisa diubah nanti dari halaman admin.
