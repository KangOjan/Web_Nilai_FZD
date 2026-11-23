-- =====================================================================
-- Website Nilai Mahasiswa — skema database Supabase
-- Jalankan seluruh file ini sekali di Supabase > SQL Editor > New query.
-- Aman dijalankan ulang (idempotent) untuk tabel, fungsi, dan policy.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- Domain email "palsu" untuk akun mahasiswa. Mahasiswa login cukup dengan
-- NIM; halaman login menambahkan domain ini di belakang NIM secara otomatis.
create or replace function public.email_mahasiswa(p_nim text)
returns text language sql immutable as $$
  select p_nim || '@mahasiswa.example.com'
$$;

-- ---------------------------------------------------------------------
-- Tabel
-- ---------------------------------------------------------------------

-- Satu baris per akun (admin atau mahasiswa).
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  nim text unique,
  nama text not null default '',
  role text not null default 'mahasiswa' check (role in ('admin', 'mahasiswa')),
  wajib_ganti_password boolean not null default false,
  created_at timestamptz not null default now()
);

-- Kelas + mata kuliah (pembeda pembobotan dan jenis asesmen).
create table if not exists public.kelas (
  id uuid primary key default gen_random_uuid(),
  kode_mk text not null default '',
  nama_mk text not null,
  nama_kelas text not null,
  semester text not null default '',
  created_at timestamptz not null default now(),
  unique (nama_mk, nama_kelas, semester)
);

-- Mahasiswa yang terdaftar di sebuah kelas.
create table if not exists public.peserta (
  kelas_id uuid not null references public.kelas (id) on delete cascade,
  mahasiswa_id uuid not null references public.profiles (id) on delete cascade,
  primary key (kelas_id, mahasiswa_id)
);

-- Kategori asesmen per kelas, misalnya Kuis, Tugas, UTS, UAS.
-- bobot = bobot (dalam persen) untuk SETIAP asesmen di kategori ini.
-- Contoh: Kuis bobot 5 -> tiap kuis bernilai 5% dari nilai akhir.
create table if not exists public.kategori (
  id uuid primary key default gen_random_uuid(),
  kelas_id uuid not null references public.kelas (id) on delete cascade,
  nama text not null,
  bobot numeric(6,2) not null default 0 check (bobot >= 0 and bobot <= 100),
  urutan int not null default 0,
  unique (kelas_id, nama)
);

-- Asesmen konkret, misalnya "Kuis 1", "Kuis 2", "UTS".
-- bobot boleh dikosongkan -> memakai bobot kategorinya.
create table if not exists public.asesmen (
  id uuid primary key default gen_random_uuid(),
  kelas_id uuid not null references public.kelas (id) on delete cascade,
  kategori_id uuid not null references public.kategori (id) on delete cascade,
  nama text not null,
  bobot numeric(6,2) check (bobot is null or (bobot >= 0 and bobot <= 100)),
  urutan int not null default 0,
  unique (kelas_id, nama)
);

-- Nilai satu mahasiswa untuk satu asesmen (0–100).
create table if not exists public.nilai (
  asesmen_id uuid not null references public.asesmen (id) on delete cascade,
  mahasiswa_id uuid not null references public.profiles (id) on delete cascade,
  skor numeric(6,2) check (skor is null or (skor >= 0 and skor <= 100)),
  updated_at timestamptz not null default now(),
  primary key (asesmen_id, mahasiswa_id)
);

-- Rentang indeks, berlaku untuk semua MK.
create table if not exists public.indeks_rentang (
  huruf text primary key,
  batas_bawah numeric(6,2) not null unique
);

insert into public.indeks_rentang (huruf, batas_bawah) values
  ('A', 80), ('AB', 70), ('B', 65), ('BC', 60), ('C', 50), ('D', 40), ('E', 0)
on conflict (huruf) do nothing;

create index if not exists nilai_mahasiswa_idx on public.nilai (mahasiswa_id);
create index if not exists peserta_mahasiswa_idx on public.peserta (mahasiswa_id);
create index if not exists asesmen_kelas_idx on public.asesmen (kelas_id);

-- ---------------------------------------------------------------------
-- Fungsi bantu
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin')
$$;

create or replace function public.indeks_dari(p_nilai numeric)
returns text language sql stable set search_path = public as $$
  select huruf from public.indeks_rentang
  where p_nilai >= batas_bawah
  order by batas_bawah desc limit 1
$$;

-- Profil otomatis untuk akun yang dibuat lewat dashboard Supabase (mis. admin).
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nama) values (new.id, coalesce(new.email, ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Rekap: nilai akhir = jumlah (skor x bobot / 100) semua asesmen.
-- Skor yang belum diisi dihitung 0.
-- security_invoker -> hasilnya ikut aturan RLS si pembaca.
-- ---------------------------------------------------------------------

create or replace view public.rekap_nilai with (security_invoker = true) as
select
  p.kelas_id,
  p.mahasiswa_id,
  round(coalesce(sum(coalesce(n.skor, 0) * coalesce(a.bobot, k.bobot) / 100), 0), 2) as nilai_akhir,
  public.indeks_dari(round(coalesce(sum(coalesce(n.skor, 0) * coalesce(a.bobot, k.bobot) / 100), 0), 2)) as indeks
from public.peserta p
left join public.asesmen a on a.kelas_id = p.kelas_id
left join public.kategori k on k.id = a.kategori_id
left join public.nilai n on n.asesmen_id = a.id and n.mahasiswa_id = p.mahasiswa_id
group by p.kelas_id, p.mahasiswa_id;

-- Total bobot per kelas, untuk mengecek apakah sudah 100%.
create or replace view public.total_bobot_kelas with (security_invoker = true) as
select a.kelas_id, sum(coalesce(a.bobot, k.bobot)) as total_bobot
from public.asesmen a join public.kategori k on k.id = a.kategori_id
group by a.kelas_id;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.kelas enable row level security;
alter table public.peserta enable row level security;
alter table public.kategori enable row level security;
alter table public.asesmen enable row level security;
alter table public.nilai enable row level security;
alter table public.indeks_rentang enable row level security;

-- profiles: mahasiswa hanya lihat dirinya; admin semua.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- kelas / kategori / asesmen: mahasiswa lihat kelas yang diikutinya.
drop policy if exists kelas_select on public.kelas;
create policy kelas_select on public.kelas for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.peserta s where s.kelas_id = kelas.id and s.mahasiswa_id = auth.uid()));
drop policy if exists kelas_admin on public.kelas;
create policy kelas_admin on public.kelas for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists kategori_select on public.kategori;
create policy kategori_select on public.kategori for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.peserta s where s.kelas_id = kategori.kelas_id and s.mahasiswa_id = auth.uid()));
drop policy if exists kategori_admin on public.kategori;
create policy kategori_admin on public.kategori for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists asesmen_select on public.asesmen;
create policy asesmen_select on public.asesmen for select to authenticated
  using (public.is_admin() or exists (
    select 1 from public.peserta s where s.kelas_id = asesmen.kelas_id and s.mahasiswa_id = auth.uid()));
drop policy if exists asesmen_admin on public.asesmen;
create policy asesmen_admin on public.asesmen for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- peserta & nilai: mahasiswa hanya baris miliknya.
drop policy if exists peserta_select on public.peserta;
create policy peserta_select on public.peserta for select to authenticated
  using (mahasiswa_id = auth.uid() or public.is_admin());
drop policy if exists peserta_admin on public.peserta;
create policy peserta_admin on public.peserta for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists nilai_select on public.nilai;
create policy nilai_select on public.nilai for select to authenticated
  using (mahasiswa_id = auth.uid() or public.is_admin());
drop policy if exists nilai_admin on public.nilai;
create policy nilai_admin on public.nilai for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists indeks_select on public.indeks_rentang;
create policy indeks_select on public.indeks_rentang for select to authenticated using (true);
drop policy if exists indeks_admin on public.indeks_rentang;
create policy indeks_admin on public.indeks_rentang for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- Fungsi untuk admin (dipanggil dari halaman admin)
-- ---------------------------------------------------------------------

-- Buat akun mahasiswa (username NIM, password 4 digit terakhir NIM) bila
-- belum ada, perbarui namanya, lalu kembalikan id-nya.
create or replace function public.admin_buat_mahasiswa(p_nim text, p_nama text)
returns uuid language plpgsql security definer
set search_path = public, extensions as $$
declare
  v_id uuid;
  v_email text;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  p_nim := trim(p_nim);
  if p_nim !~ '^[0-9]{4,}$' then raise exception 'NIM tidak valid: %', p_nim; end if;

  select id into v_id from public.profiles where nim = p_nim;
  if v_id is not null then
    update public.profiles set nama = coalesce(nullif(trim(p_nama), ''), nama) where id = v_id;
    return v_id;
  end if;

  v_email := public.email_mahasiswa(p_nim);
  select id into v_id from auth.users where email = v_email;

  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current
    ) values (
      '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      v_email, crypt(right(p_nim, 4), gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('nim', p_nim, 'nama', p_nama), now(), now(),
      '', '', '', '', ''
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_id::text, v_id,
            jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  end if;

  insert into public.profiles (id, nim, nama, role, wajib_ganti_password)
  values (v_id, p_nim, coalesce(trim(p_nama), ''), 'mahasiswa', true)
  on conflict (id) do update set nim = excluded.nim, nama = excluded.nama,
    wajib_ganti_password = true;
  return v_id;
end $$;

-- Impor daftar mahasiswa ke sebuah kelas.
-- p_rows: [{"nim":"103022500013","nama":"Alexander"}, ...]
create or replace function public.admin_impor_peserta(p_kelas uuid, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
  v_id uuid;
  v_n int := 0;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_id := public.admin_buat_mahasiswa(r->>'nim', r->>'nama');
    insert into public.peserta (kelas_id, mahasiswa_id) values (p_kelas, v_id)
    on conflict do nothing;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Kembalikan password mahasiswa ke 4 digit terakhir NIM.
create or replace function public.admin_reset_password(p_mahasiswa uuid)
returns void language plpgsql security definer
set search_path = public, extensions as $$
declare v_nim text;
begin
  if not public.is_admin() then raise exception 'Hanya admin'; end if;
  select nim into v_nim from public.profiles where id = p_mahasiswa;
  if v_nim is null then raise exception 'Mahasiswa tidak ditemukan'; end if;
  update auth.users set encrypted_password = crypt(right(v_nim, 4), gen_salt('bf')),
    updated_at = now() where id = p_mahasiswa;
  update public.profiles set wajib_ganti_password = true where id = p_mahasiswa;
end $$;

-- Dipanggil mahasiswa setelah berhasil mengganti password.
create or replace function public.selesai_ganti_password()
returns void language sql security definer set search_path = public as $$
  update public.profiles set wajib_ganti_password = false where id = auth.uid()
$$;

-- Hak eksekusi: hanya pengguna yang sudah login.
revoke all on function public.admin_buat_mahasiswa(text, text) from public, anon;
revoke all on function public.admin_impor_peserta(uuid, jsonb) from public, anon;
revoke all on function public.admin_reset_password(uuid) from public, anon;
revoke all on function public.selesai_ganti_password() from public, anon;
grant execute on function public.admin_buat_mahasiswa(text, text) to authenticated;
grant execute on function public.admin_impor_peserta(uuid, jsonb) to authenticated;
grant execute on function public.admin_reset_password(uuid) to authenticated;
grant execute on function public.selesai_ganti_password() to authenticated;

grant select on public.rekap_nilai, public.total_bobot_kelas to authenticated;

-- Hak akses tabel untuk pengguna yang login (tetap dibatasi RLS di atas).
-- Diperlukan bila opsi "Grant API access to new tables automatically" mati.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.profiles, public.kelas, public.peserta, public.kategori,
  public.asesmen, public.nilai, public.indeks_rentang
  to authenticated;
