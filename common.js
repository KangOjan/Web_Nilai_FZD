// Fungsi bersama untuk semua halaman.
const CFG = window.NILAI_CONFIG;
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "class") e.className = v;
    else if (v === true) e.setAttribute(k, "");
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

function toast(msg, isErr = false) {
  let t = document.getElementById("toast");
  if (!t) { t = el("div", { id: "toast" }); document.body.append(t); }
  t.textContent = msg; t.className = isErr ? "err" : ""; t.style.display = "block";
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.style.display = "none"), isErr ? 6000 : 3000);
}

// Lempar error Supabase sebagai pesan yang terbaca.
function cek({ data, error }) {
  if (error) { toast(error.message, true); throw error; }
  return data;
}

function fmt(n) {
  if (n == null || n === "") return "–";
  return Number(n).toLocaleString("id-ID", { maximumFractionDigits: 2 });
}

function loginKeEmail(u) {
  u = u.trim();
  return /^\d+$/.test(u) ? `${u}@${CFG.EMAIL_DOMAIN}` : u;
}

async function profilSaya() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", session.user.id).single();
  return data;
}

// Pastikan sudah login dengan peran tertentu; kalau tidak, kembali ke halaman login.
async function wajibLogin(role) {
  const p = await profilSaya();
  if (!p || p.wajib_ganti_password || (role && p.role !== role)) { location.href = "index.html"; throw new Error("redirect"); }
  return p;
}

async function keluar() { await sb.auth.signOut(); location.href = "index.html"; }

// Hitung nilai akhir dan indeks di sisi browser (sama dengan view rekap_nilai).
function bobotAsesmen(a, kategoriById) {
  return a.bobot != null ? Number(a.bobot) : Number(kategoriById[a.kategori_id]?.bobot || 0);
}
function indeksDari(nilai, rentang) {
  const r = [...rentang].sort((a, b) => b.batas_bawah - a.batas_bawah).find((r) => nilai >= r.batas_bawah);
  return r ? r.huruf : "–";
}
