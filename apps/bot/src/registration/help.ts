import type { Account, BotDemoResult } from "@sales-visit/contracts";

const section = (title: string, lines: string[]) =>
  [title, ...lines].join("\n");

export function helpSections(
  account: Account | null,
  demo: BotDemoResult = { ok: false, code: "disabled" }
): string[] {
  const demoEnabled = demo.ok || demo.code !== "disabled";
  // An ineligible, unexpired demo session must not expose real-account commands.
  const readOnly = demoEnabled && (!demo.ok || demo.data !== null);
  const role = readOnly
    ? demo.ok
      ? demo.data?.account.role
      : null
    : account?.status === "active"
      ? account.role
      : null;
  const sections = [
    section("👤 Umum", [
      "/start — Mulai bot.",
      "/help — Lihat perintah yang tersedia.",
      "/me — Lihat profil dan status akun.",
      ...(!account && !readOnly
        ? ["/register — Daftar dan tunggu persetujuan Admin."]
        : []),
    ]),
  ];
  if (role === "admin" || role === "supervisor")
    sections.push(
      section("📅 Monitoring", [
        "/jadwalsales — Lihat jadwal Sales Force sesuai akses.",
        "/outlets — Daftar Outlet.",
        "/outlet — Lihat detail Outlet.",
        "/outletinternal — Cari Outlet berdasarkan ID internal.",
      ])
    );
  if (role === "admin" && !readOnly) {
    sections.push(
      section("👥 Pengguna", [
        "/pending — Lihat permintaan registrasi.",
        "/users — Daftar pengguna.",
        "/approve — Setujui registrasi.",
        "/reject — Tolak registrasi.",
        "/setrole — Ubah role pengguna aktif.",
        "/disable — Nonaktifkan pengguna.",
        "/enable — Aktifkan kembali pengguna.",
      ])
    );
    sections.push(
      section("🏪 Outlet & Jadwal", [
        "/tambahoutlet — Tambah Outlet.",
        "/editoutlet — Ubah Outlet.",
        "/hapusoutlet — Hapus Outlet yang belum dirujuk.",
        "/editoutletinternal — Ubah Outlet berdasarkan ID internal.",
        "/hapusoutletinternal — Hapus Outlet berdasarkan ID internal.",
        "/tambahjadwal — Tambah rencana kunjungan.",
      ])
    );
  }
  if (role === "sales_force") {
    sections.push(
      section("📅 Monitoring", [
        "/jadwal — Lihat jadwal dan detail Outlet kunjungan sendiri.",
      ])
    );
    if (!readOnly)
      sections.push(
        section("📋 Kunjungan", [
          "/salesvisit — Mulai atau lanjutkan draf Visit.",
          "/konfirmasi — Simpan Visit atau cek hasilnya.",
          "/batal — Batalkan draf Visit.",
        ])
      );
  }
  if (demoEnabled)
    sections.push(
      section("🧪 Demo Mode", [
        "/demo — Daftar akun demo.",
        "/demo_login account_id — Pilih atau ganti akun demo (hanya baca).",
        "/demo_status — Lihat akun demo dan sisa sesi.",
        "/demo_logout — Keluar demo dan pulihkan akses Telegram.",
      ])
    );
  return sections;
}
