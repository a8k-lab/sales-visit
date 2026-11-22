import type { Account, BotDemoResult } from "@sales-visit/contracts";

const section = (title: string, lines: string[]) =>
  [title, ...lines].join("\n");

// Only advertise commands permitted by the current role and demo restrictions.
// Detailed argument grammar belongs in each command's usage/error response.
export function helpSections(
  account: Account | null,
  demo: BotDemoResult = { ok: false, code: "disabled" }
): string[] {
  const demoEnabled = demo.ok || demo.code !== "disabled";
  // An ineligible but unexpired demo credential also fails closed in the API.
  const readOnly = demoEnabled && (!demo.ok || demo.data !== null);
  const role = readOnly
    ? demo.ok
      ? demo.data?.account.role
      : null
    : account?.status === "active"
      ? account.role
      : null;
  const sections = [
    section("Umum", [
      "/start — Mulai bot.",
      "/help — Lihat perintah yang tersedia.",
      "/me — Lihat profil dan status akun.",
      ...(!account && !readOnly
        ? ["/register — Daftar dan tunggu persetujuan Admin."]
        : []),
    ]),
  ];
  if (role === "admin" || role === "supervisor") {
    sections.push(
      section("Monitoring", [
        "/jadwalsales — Lihat jadwal Sales Force sesuai akses.",
        "/outlets — Daftar Outlet.",
        "/outlet — Detail Outlet berdasarkan ID bisnis.",
        "/outletinternal — Detail Outlet berdasarkan ID internal.",
      ])
    );
  }
  if (role === "admin" && !readOnly) {
    sections.push(
      section("Pengelolaan Pengguna", [
        "/pending — Lihat permintaan registrasi.",
        "/users — Daftar pengguna.",
        "/approve — Setujui registrasi dan tetapkan role.",
        "/reject — Tolak registrasi.",
        "/setrole — Ubah role pengguna aktif.",
        "/disable — Nonaktifkan pengguna.",
        "/enable — Aktifkan kembali pengguna.",
      ])
    );
    sections.push(
      section("Pengelolaan Outlet", [
        "/tambahoutlet — Tambah Outlet.",
        "/editoutlet — Ubah Outlet berdasarkan ID bisnis.",
        "/hapusoutlet — Hapus Outlet yang belum dirujuk.",
        "/editoutletinternal — Ubah Outlet berdasarkan ID internal.",
        "/hapusoutletinternal — Hapus Outlet berdasarkan ID internal.",
        "/tambahjadwal — Tambah rencana kunjungan mingguan.",
      ])
    );
  }
  if (role === "sales_force") {
    sections.push(section("Jadwal", ["/jadwal — Lihat jadwal sendiri (WIB)."]));
    if (!readOnly)
      sections.push(
        section("Sales Visit", [
          "/salesvisit — Mulai atau lanjutkan draf Visit.",
          "/konfirmasi — Simpan Visit atau cek hasilnya.",
          "/batal — Batalkan draf Visit.",
        ])
      );
  }
  if (demoEnabled)
    sections.push(
      section("Demo Mode", [
        ...(readOnly
          ? ["Hanya baca data demo; perubahan data dinonaktifkan."]
          : []),
        "/demo — Pilih atau ganti akun demo (1 jam).",
        "/demo_status — Lihat akun demo dan sisa sesi.",
        "/demo_logout — Keluar demo dan pulihkan akses Telegram.",
      ])
    );
  return sections;
}
