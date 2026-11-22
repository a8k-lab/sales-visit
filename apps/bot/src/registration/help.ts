import type { Account, BotDemoResult } from "@sales-visit/contracts";

const section = (title: string, lines: string[]) =>
  [title, ...lines].join("\n");
const days = "senin, selasa, rabu, kamis, jumat, sabtu, minggu";

// Usage mirrors the command parsers. No invented flags or privileges: the
// server's live demo status determines both effective role and read-only scope.
export function helpSections(
  account: Account | null,
  demo: BotDemoResult = { ok: false, code: "disabled" }
): string[] {
  const demoEnabled = demo.ok || demo.code !== "disabled";
  const readOnly = demoEnabled && (!demo.ok || demo.data !== null);
  const role = readOnly
    ? demo.ok
      ? demo.data?.account.role
      : null
    : account?.status === "active"
      ? account.role
      : null;
  const sections = [
    "Sales Visit Bot — lihat jadwal dan Outlet, kelola akses, serta catat kunjungan sesuai role. Gunakan chat pribadi.",
    section("Umum", [
      "/start — Mulai bot.",
      "/help — Panduan perintah sesuai akses.",
      "/me — Profil dan status akun.",
      ...(!account && !readOnly
        ? ["/register — Daftar; tunggu persetujuan Admin."]
        : []),
    ]),
  ];
  if (role === "admin" || role === "supervisor")
    sections.push(
      section("Monitoring", [
        "/outlets [kursor] — Daftar Outlet; default: halaman pertama.",
        "/outlet outlet_id — Detail berdasarkan ID bisnis Outlet.",
        "/outletinternal internal_id — Detail berdasarkan ID internal Outlet.",
        "/jadwalsales [hari=hari] [sf=sales_force_id] [after=kursor] — Jadwal sesuai akses; default: semua hari/SF, halaman pertama.",
        `hari: ${days}. Jangan campur filter bernama dan posisi.`,
        readOnly
          ? "Alternatif: /jadwalsales hari [after=kursor]."
          : "Alternatif: /jadwalsales hari [after=kursor] atau /jadwalsales telegram_id [hari] [after=kursor]. Telegram ID wajib terkait SF aktif unik.",
      ])
    );
  if (role === "admin" && !readOnly) {
    sections.push(
      section("Pengelolaan Pengguna", [
        "/pending [kursor] — Registrasi menunggu persetujuan; default: halaman pertama.",
        "/users [kursor] — Daftar pengguna; default: halaman pertama.",
        "/approve telegram_id role [sales_force_id] — Setujui registrasi.",
        "/reject telegram_id — Tolak registrasi.",
        "/setrole telegram_id role [sales_force_id] — Ubah role pengguna aktif.",
        "role: admin, supervisor, sales (alias: sales_force). sales_force_id wajib untuk sales/sales_force; dilarang untuk role lain.",
        "/disable telegram_id — Nonaktifkan pengguna non-Admin.",
        "/enable telegram_id — Aktifkan kembali pengguna disabled.",
      ])
    );
    sections.push(
      section("Pengelolaan Outlet", [
        "/tambahoutlet outlet_id no_rs nama_outlet... — Tambah Outlet; outlet_id adalah ID bisnis.",
        "/editoutlet outlet_id no_rs nama_outlet... — Ubah No. RS/nama berdasarkan ID bisnis.",
        "/hapusoutlet outlet_id KONFIRMASI — Hapus berdasarkan ID bisnis jika belum dirujuk.",
        "/editoutletinternal internal_id no_rs nama_outlet... — Ubah berdasarkan ID internal.",
        "/hapusoutletinternal internal_id KONFIRMASI — Hapus berdasarkan ID internal jika belum dirujuk.",
        "/tambahjadwal sales_force_id internal_id hari — Tambah jadwal; internal_id adalah Outlet, hari sama seperti Monitoring.",
        "KONFIRMASI adalah teks wajib persis; nama_outlet... memuat seluruh kata nama.",
      ])
    );
  }
  if (role === "sales_force") {
    sections.push(
      section("Jadwal", [
        "/jadwal [hari] [after=kursor] — Jadwal sendiri; default: hari ini (WIB), halaman pertama.",
        `hari: ${days}, semua. after= harus didahului hari.`,
      ])
    );
    if (!readOnly)
      sections.push(
        section("Sales Visit", [
          "/salesvisit — Mulai/lanjut draf Visit (24 jam); ikuti petunjuk jawaban bot.",
          "/konfirmasi — Simpan pratinjau Visit atau cek hasil tersimpan.",
          "/batal — Batalkan draf yang belum tersimpan.",
        ])
      );
  }
  if (demoEnabled)
    sections.push(
      section("Demo Mode", [
        ...(readOnly
          ? ["Hanya baca data demo; perubahan data dinonaktifkan."]
          : []),
        "/demo — Daftar akun demo yang tersedia.",
        "/demo_login account_id — Pilih/ganti akun demo; sesi 60 menit, hanya baca.",
        "/demo_status — Akun demo aktif dan sisa sesi.",
        "/demo_logout — Keluar demo; pulihkan autentikasi Telegram.",
      ])
    );
  sections.push(
    "Notasi: arg_name = wajib satu; [arg_name] = opsional satu; arg_name... = wajib beberapa; [arg_name...] = opsional beberapa. Tanda []/... bukan untuk diketik.\nDetail: kirim perintah yang memerlukan argumen tanpa argumen untuk format lengkap; ikuti petunjuk draf Visit. Salin ID/kursor persis dari balasan bot (termasuk token ~)."
  );
  return sections;
}
