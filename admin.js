// Halaman admin: kelas, asesmen & bobot, peserta, nilai, rentang indeks.
const S = {
  kelasList: [], kelasId: null,
  kategori: [], asesmen: [], peserta: [], nilai: {}, rentang: [],
  ubah: new Map(), // "asesmenId|mhsId" -> skor baru (null = kosongkan)
  impor: [],
};
const $ = (id) => document.getElementById(id);
const kunci = (a, m) => `${a}|${m}`;

// ---------- tab ----------
document.querySelectorAll(".tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    document.querySelectorAll("main > section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab));
  })
);

// ---------- kelas ----------
async function muatKelas(pilih) {
  S.kelasList = cek(await sb.from("kelas").select("*").order("semester", { ascending: false }).order("nama_mk").order("nama_kelas"));
  const sel = $("pilih-kelas");
  sel.replaceChildren(...S.kelasList.map((k) =>
    el("option", { value: k.id }, `${k.nama_mk} – ${k.nama_kelas}${k.semester ? " (" + k.semester + ")" : ""}`)));
  if (!S.kelasList.length) sel.append(el("option", { value: "" }, "Belum ada kelas, tambahkan di bawah"));
  S.kelasId = pilih || localStorage.getItem("kelasId") || S.kelasList[0]?.id || null;
  if (!S.kelasList.some((k) => k.id === S.kelasId)) S.kelasId = S.kelasList[0]?.id || null;
  sel.value = S.kelasId || "";
  await muatIsiKelas();
}

$("pilih-kelas").addEventListener("change", async (e) => {
  if (S.ubah.size && !confirm("Ada perubahan nilai yang belum disimpan. Buang?")) { e.target.value = S.kelasId; return; }
  S.kelasId = e.target.value;
  try { localStorage.setItem("kelasId", S.kelasId); } catch {}
  await muatIsiKelas();
});

$("form-kelas").addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  const row = cek(await sb.from("kelas").insert(f).select().single());
  e.target.reset(); toast("Kelas ditambahkan.");
  await muatKelas(row.id);
});

$("hapus-kelas").addEventListener("click", async () => {
  const k = S.kelasList.find((k) => k.id === S.kelasId);
  if (!k || !confirm(`Hapus kelas "${k.nama_mk} – ${k.nama_kelas}" beserta semua asesmen dan nilainya? Akun mahasiswa tetap ada.`)) return;
  cek(await sb.from("kelas").delete().eq("id", k.id));
  toast("Kelas dihapus.");
  await muatKelas();
});

async function muatIsiKelas() {
  S.ubah.clear();
  if (!S.kelasId) { S.kategori = S.asesmen = S.peserta = []; S.nilai = {}; return renderSemua(); }
  const id = S.kelasId;
  const [kat, ase, pes] = await Promise.all([
    sb.from("kategori").select("*").eq("kelas_id", id).order("urutan").order("nama"),
    sb.from("asesmen").select("*").eq("kelas_id", id).order("urutan").order("nama"),
    sb.from("peserta").select("mahasiswa_id, profiles(id, nim, nama)").eq("kelas_id", id),
  ]);
  S.kategori = cek(kat);
  S.asesmen = urutkanAsesmen(cek(ase));
  S.peserta = cek(pes).map((p) => p.profiles).filter(Boolean).sort((a, b) => a.nama.localeCompare(b.nama));
  S.nilai = {};
  if (S.asesmen.length) {
    // ambil per halaman 1000 baris
    for (let from = 0; ; from += 1000) {
      const rows = cek(await sb.from("nilai").select("asesmen_id, mahasiswa_id, skor")
        .in("asesmen_id", S.asesmen.map((a) => a.id)).range(from, from + 999));
      rows.forEach((n) => (S.nilai[kunci(n.asesmen_id, n.mahasiswa_id)] = n.skor));
      if (rows.length < 1000) break;
    }
  }
  renderSemua();
}

// Urutkan asesmen: per urutan kategori, lalu urutan asesmen, lalu nama (Kuis 2 < Kuis 10).
function urutkanAsesmen(list) {
  const posKat = Object.fromEntries(S.kategori.map((k, i) => [k.id, i]));
  return list.sort((a, b) => (posKat[a.kategori_id] - posKat[b.kategori_id]) || (a.urutan - b.urutan) ||
    a.nama.localeCompare(b.nama, "id", { numeric: true }));
}

function renderSemua() { renderNilai(); renderKategori(); renderAsesmen(); renderPeserta(); }
const katById = () => Object.fromEntries(S.kategori.map((k) => [k.id, k]));

// ---------- nilai ----------
function skorSekarang(a, m) {
  const k = kunci(a, m);
  return S.ubah.has(k) ? S.ubah.get(k) : S.nilai[k];
}
function nilaiAkhir(mId) {
  const kb = katById();
  return S.asesmen.reduce((t, a) => t + Number(skorSekarang(a.id, mId) || 0) * bobotAsesmen(a, kb) / 100, 0);
}

function renderNilai() {
  const t = $("tabel-nilai"), kb = katById();
  $("info-nilai").textContent = !S.kelasId ? "Pilih atau buat kelas dulu." :
    !S.asesmen.length ? "Belum ada asesmen. Tambahkan di tab Asesmen & bobot." :
    !S.peserta.length ? "Belum ada peserta. Impor di tab Peserta." :
    "Ubah angka lalu klik Simpan perubahan. Kosongkan sel untuk menghapus nilai.";
  if (!S.asesmen.length || !S.peserta.length) return t.replaceChildren();
  const q = $("cari").value.trim().toLowerCase();
  const head = el("tr", {}, el("th", { class: "sticky-col" }, "Mahasiswa"),
    S.asesmen.map((a) => el("th", { class: "num", title: `${kb[a.kategori_id]?.nama} · bobot ${fmt(bobotAsesmen(a, kb))}%` },
      a.nama, el("br"), el("span", { class: "muted" }, fmt(bobotAsesmen(a, kb)) + "%"))),
    el("th", { class: "num" }, "Nilai akhir"), el("th", {}, "Indeks"));
  const rows = S.peserta.filter((m) => !q || m.nama.toLowerCase().includes(q) || (m.nim || "").includes(q)).map((m) => {
    const akhir = el("td", { class: "num" }), idx = el("td");
    const hitung = () => { const v = nilaiAkhir(m.id); akhir.textContent = fmt(v); idx.textContent = indeksDari(v, S.rentang); };
    hitung();
    return el("tr", {},
      el("td", { class: "sticky-col" }, m.nama, el("br"), el("span", { class: "muted" }, m.nim)),
      S.asesmen.map((a) => {
        const k = kunci(a.id, m.id), v = skorSekarang(a.id, m.id);
        const inp = el("input", { class: "skor" + (S.ubah.has(k) ? " changed" : ""), type: "number", min: 0, max: 100, step: "0.01",
          value: v ?? "", "aria-label": `${a.nama} ${m.nama}` });
        inp.addEventListener("input", () => {
          const raw = inp.value.trim();
          const baru = raw === "" ? null : Number(raw);
          if (baru != null && (isNaN(baru) || baru < 0 || baru > 100)) { inp.setCustomValidity("0–100"); inp.reportValidity(); return; }
          inp.setCustomValidity("");
          const lama = S.nilai[k] ?? null;
          if (baru === (lama == null ? null : Number(lama))) S.ubah.delete(k); else S.ubah.set(k, baru);
          inp.classList.toggle("changed", S.ubah.has(k));
          $("simpan-nilai").disabled = !S.ubah.size;
          $("simpan-nilai").textContent = S.ubah.size ? `Simpan perubahan (${S.ubah.size})` : "Simpan perubahan";
          hitung();
        });
        return el("td", { class: "num" }, inp);
      }),
      akhir, idx);
  });
  t.replaceChildren(el("thead", {}, head), el("tbody", {}, rows));
  $("simpan-nilai").disabled = !S.ubah.size;
}
$("cari").addEventListener("input", renderNilai);

$("simpan-nilai").addEventListener("click", async () => {
  const btn = $("simpan-nilai"); btn.disabled = true;
  const isi = [], hapus = [];
  for (const [k, v] of S.ubah) {
    const [asesmen_id, mahasiswa_id] = k.split("|");
    if (v == null) hapus.push({ asesmen_id, mahasiswa_id });
    else isi.push({ asesmen_id, mahasiswa_id, skor: v, updated_at: new Date().toISOString() });
  }
  try {
    if (isi.length) cek(await sb.from("nilai").upsert(isi, { onConflict: "asesmen_id,mahasiswa_id" }));
    for (const h of hapus) cek(await sb.from("nilai").delete().match(h));
    for (const [k, v] of S.ubah) { if (v == null) delete S.nilai[k]; else S.nilai[k] = v; }
    S.ubah.clear();
    toast(`${isi.length + hapus.length} nilai tersimpan.`);
    btn.textContent = "Simpan perubahan";
    renderNilai();
  } catch { btn.disabled = false; }
});

window.addEventListener("beforeunload", (e) => { if (S.ubah.size) { e.preventDefault(); e.returnValue = ""; } });

// ---------- kategori & asesmen ----------
function renderKategori() {
  const kb = katById();
  const total = S.asesmen.reduce((t, a) => t + bobotAsesmen(a, kb), 0);
  const chip = $("total-bobot");
  chip.textContent = fmt(total) + "%";
  chip.style.color = Math.abs(total - 100) < 0.001 ? "var(--ok)" : "var(--err)";
  chip.title = Math.abs(total - 100) < 0.001 ? "Pas 100%" : "Belum 100%";
  const jml = (kid) => S.asesmen.filter((a) => a.kategori_id === kid).length;
  $("tabel-kategori").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", {}, "Kategori"), el("th", { class: "num" }, "Bobot per asesmen (%)"),
      el("th", { class: "num" }, "Jumlah asesmen"), el("th", {}, ""))),
    el("tbody", {}, S.kategori.map((k) => {
      const inp = el("input", { type: "number", step: "0.01", min: 0, max: 100, value: k.bobot, style: "width:90px;text-align:right" });
      return el("tr", {}, el("td", {}, k.nama), el("td", { class: "num" }, inp), el("td", { class: "num" }, jml(k.id)),
        el("td", {},
          el("button", { onclick: async () => {
            cek(await sb.from("kategori").update({ bobot: Number(inp.value) }).eq("id", k.id));
            toast("Bobot disimpan."); await muatIsiKelas();
          } }, "Simpan"), " ",
          el("button", { class: "danger", onclick: async () => {
            if (!confirm(`Hapus kategori ${k.nama} beserta ${jml(k.id)} asesmen dan nilainya?`)) return;
            cek(await sb.from("kategori").delete().eq("id", k.id)); await muatIsiKelas();
          } }, "Hapus")));
    })));
  $("sel-kategori").replaceChildren(...S.kategori.map((k) => el("option", { value: k.id }, k.nama)));
}

function renderAsesmen() {
  const kb = katById();
  $("tabel-asesmen").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", {}, "Asesmen"), el("th", {}, "Kategori"),
      el("th", { class: "num" }, "Bobot khusus (%)"), el("th", { class: "num" }, "Bobot dipakai"), el("th", {}, ""))),
    el("tbody", {}, S.asesmen.map((a) => {
      const nama = el("input", { value: a.nama, style: "min-width:120px" });
      const bobot = el("input", { type: "number", step: "0.01", min: 0, max: 100, value: a.bobot ?? "",
        placeholder: "ikut kategori", style: "width:110px;text-align:right" });
      return el("tr", {}, el("td", {}, nama), el("td", {}, kb[a.kategori_id]?.nama),
        el("td", { class: "num" }, bobot), el("td", { class: "num" }, fmt(bobotAsesmen(a, kb)) + "%"),
        el("td", {},
          el("button", { onclick: async () => {
            cek(await sb.from("asesmen").update({ nama: nama.value.trim(), bobot: bobot.value === "" ? null : Number(bobot.value) }).eq("id", a.id));
            toast("Asesmen disimpan."); await muatIsiKelas();
          } }, "Simpan"), " ",
          el("button", { class: "danger", onclick: async () => {
            if (!confirm(`Hapus ${a.nama} beserta nilainya?`)) return;
            cek(await sb.from("asesmen").delete().eq("id", a.id)); await muatIsiKelas();
          } }, "Hapus")));
    })));
}

$("form-kategori").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!S.kelasId) return toast("Pilih kelas dulu.", true);
  const f = Object.fromEntries(new FormData(e.target));
  cek(await sb.from("kategori").insert({ kelas_id: S.kelasId, nama: f.nama.trim(), bobot: Number(f.bobot), urutan: S.kategori.length }));
  e.target.reset(); await muatIsiKelas();
});

$("form-asesmen").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!S.kelasId) return toast("Pilih kelas dulu.", true);
  const f = Object.fromEntries(new FormData(e.target));
  const n = Math.max(1, Number(f.jumlah) || 1), dasar = f.nama.trim();
  const ada = S.asesmen.filter((a) => a.kategori_id === f.kategori_id).length;
  const rows = Array.from({ length: n }, (_, i) => ({
    kelas_id: S.kelasId, kategori_id: f.kategori_id, nama: n > 1 ? `${dasar} ${i + 1}` : dasar, urutan: ada + i,
  }));
  cek(await sb.from("asesmen").insert(rows));
  e.target.reset(); e.target.jumlah.value = 1; toast(`${n} asesmen ditambahkan.`); await muatIsiKelas();
});

// ---------- peserta & impor excel ----------
let workbook = null;
$("file-excel").addEventListener("change", async (e) => {
  const file = e.target.files[0]; if (!file) return;
  workbook = XLSX.read(await file.arrayBuffer());
  $("sheet").replaceChildren(...workbook.SheetNames.map((n) => el("option", { value: n }, n)));
  bacaSheet();
});
$("sheet").addEventListener("change", bacaSheet);

// Cari baris header yang berisi "NIM" dan "Nama", lalu ambil baris di bawahnya.
function bacaSheet() {
  S.impor = [];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[$("sheet").value], { header: 1, defval: null, raw: true });
  let h = -1, cNim = -1, cNama = -1;
  for (let i = 0; i < Math.min(rows.length, 20) && h < 0; i++) {
    const r = rows[i].map((c) => String(c ?? "").trim().toLowerCase());
    const a = r.findIndex((c) => c === "nim"), b = r.findIndex((c) => c.startsWith("nama"));
    if (a >= 0 && b >= 0) { h = i; cNim = a; cNama = b; }
  }
  if (h < 0) { $("pratinjau").textContent = "Kolom NIM dan Nama tidak ditemukan di sheet ini."; $("impor").disabled = true; return; }
  const lihat = new Set();
  for (const r of rows.slice(h + 1)) {
    const nim = String(r[cNim] ?? "").replace(/\.0+$/, "").replace(/\D/g, "");
    const nama = String(r[cNama] ?? "").trim();
    if (nim.length >= 4 && !lihat.has(nim)) { lihat.add(nim); S.impor.push({ nim, nama }); }
  }
  $("pratinjau").replaceChildren(
    `Ditemukan ${S.impor.length} mahasiswa. Contoh: `,
    S.impor.slice(0, 3).map((m) => `${m.nim} ${m.nama}`).join("; "), S.impor.length > 3 ? "; …" : "");
  $("impor").disabled = !S.impor.length;
}

$("impor").addEventListener("click", async () => {
  if (!S.kelasId) return toast("Pilih kelas dulu.", true);
  const btn = $("impor"); btn.disabled = true;
  try {
    for (let i = 0; i < S.impor.length; i += 25) {
      btn.textContent = `Mengimpor ${Math.min(i + 25, S.impor.length)}/${S.impor.length}…`;
      cek(await sb.rpc("admin_impor_peserta", { p_kelas: S.kelasId, p_rows: S.impor.slice(i, i + 25) }));
    }
    toast(`${S.impor.length} mahasiswa diimpor.`);
  } finally { btn.textContent = "Impor ke kelas ini"; btn.disabled = false; }
  await muatIsiKelas();
});

$("form-manual").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!S.kelasId) return toast("Pilih kelas dulu.", true);
  const nim = e.target.nim.value.replace(/\D/g, ""), nama = e.target.nama.value.trim();
  if (nim.length < 4) return toast("NIM tidak valid.", true);
  const btn = e.submitter; btn.disabled = true;
  try {
    cek(await sb.rpc("admin_impor_peserta", { p_kelas: S.kelasId, p_rows: [{ nim, nama }] }));
    toast(`${nama} ditambahkan. Password awal: ${nim.slice(-4)}`);
    e.target.reset();
  } finally { btn.disabled = false; }
  await muatIsiKelas();
});

function renderPeserta() {
  $("jml-peserta").textContent = S.peserta.length;
  $("tabel-peserta").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", {}, "NIM"), el("th", {}, "Nama"), el("th", {}, ""))),
    el("tbody", {}, S.peserta.map((m) => el("tr", {}, el("td", {}, m.nim), el("td", {}, m.nama), el("td", {},
      el("button", { onclick: async () => {
        if (!confirm(`Reset password ${m.nama} ke 4 digit terakhir NIM (${(m.nim || "").slice(-4)})?`)) return;
        cek(await sb.rpc("admin_reset_password", { p_mahasiswa: m.id })); toast("Password direset.");
      } }, "Reset password"), " ",
      el("button", { class: "danger", onclick: async () => {
        if (!confirm(`Keluarkan ${m.nama} dari kelas ini? Nilainya di kelas ini tidak lagi tampil.`)) return;
        cek(await sb.from("peserta").delete().match({ kelas_id: S.kelasId, mahasiswa_id: m.id })); await muatIsiKelas();
      } }, "Keluarkan"))))));
}

// ---------- rentang indeks ----------
async function muatRentang() {
  S.rentang = cek(await sb.from("indeks_rentang").select("*").order("batas_bawah", { ascending: false }));
  $("tabel-indeks").replaceChildren(
    el("thead", {}, el("tr", {}, el("th", {}, "Indeks"), el("th", { class: "num" }, "Batas bawah"))),
    el("tbody", {}, S.rentang.map((r) => el("tr", {}, el("td", {}, r.huruf),
      el("td", { class: "num" }, el("input", { type: "number", step: "0.01", min: 0, max: 100, value: r.batas_bawah,
        "data-huruf": r.huruf, style: "width:90px;text-align:right" }))))));
}
$("simpan-indeks").addEventListener("click", async () => {
  const rows = [...document.querySelectorAll("#tabel-indeks input")].map((i) => ({ huruf: i.dataset.huruf, batas_bawah: Number(i.value) }));
  if (new Set(rows.map((r) => r.batas_bawah)).size !== rows.length) return toast("Batas bawah tidak boleh sama.", true);
  // simpan lewat nilai sementara supaya tidak bentrok dengan aturan unik
  cek(await sb.from("indeks_rentang").upsert(rows.map((r, i) => ({ huruf: r.huruf, batas_bawah: -1 - i }))));
  cek(await sb.from("indeks_rentang").upsert(rows));
  toast("Rentang indeks disimpan."); await muatRentang(); renderNilai();
});

// ---------- mulai ----------
(async () => {
  const p = await wajibLogin("admin");
  $("nama-admin").textContent = p.nama;
  await muatRentang();
  await muatKelas();
})();
