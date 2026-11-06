import type { Account } from "@sales-visit/contracts";

const section = (number: number, title: string, lines: string[]) =>
  [
    "━━━━━━━━━━━━━━━━━━━━",
    `${number}. ${title}`,
    "━━━━━━━━━━━━━━━━━━━━",
    ...lines,
  ].join("\n");

// Whole sections are packed together, not one message per command. No user data
// is interpolated into the guide; each static section is below Telegram's limit.
export function helpSections(account: Account | null): string[] {
  const role = account?.status === "active" ? account.role : null;
  const admin = role === "admin";
  const monitor = admin || role === "supervisor";
  return [
    [
      "╔══════════════════════════╗",
      "       SALES VISIT BOT",
      "       PANDUAN PENGGUNAAN",
      "╚══════════════════════════╝",
      "",
      "COMMAND: Perintah yang dikirim ke bot.",
      "DESKRIPSI: Fungsi dari perintah.",
      "Panduan sesuai role/status akun. Perintah terlindungi memerlukan akun aktif.",
    ].join("\n"),
    section(1, "USER COMMANDS", [
      "/start — Memulai bot dan menampilkan sambutan.",
      "/register — Mendaftarkan akun Telegram; menunggu persetujuan Admin.",
      "/me — Melihat profil, role, status, Telegram ID dan Sales Force ID.",
      "/help — Menampilkan panduan penggunaan bot.",
    ]),
    section(
      2,
      "SALES COMMANDS",
      role === "sales_force"
        ? [
            "/jadwal — Jadwal sendiri hari ini (WIB).",
            "/jadwal HARI — Filter hari; contoh: /jadwal senin.",
            "/jadwal semua — Semua hari; halaman berikut: /jadwal semua after=KURSOR.",
            "/salesvisit — Mulai/lanjut draf Visit (berlaku 24 jam).",
            "/konfirmasi — Simpan pratinjau atau cek hasil tersimpan; aman diulang.",
            "/batal — Batalkan draf yang belum tersimpan.",
          ]
        : [
            "Khusus Sales Force aktif dengan asosiasi SF terverifikasi. Admin/Supervisor tidak otomatis dapat mengirim Visit.",
          ]
    ),
    section(
      3,
      "ADMIN & SUPERVISOR COMMANDS",
      monitor
        ? [
            "/jadwalsales — Semua rencana kunjungan Sales Force.",
            "/jadwalsales hari=senin — Filter hari.",
            "/jadwalsales sf=sf-01 hari=jumat — Filter ID bisnis SF dan hari.",
            "/jadwalsales [hari=HARI] [sf=SALES_FORCE_ID] [after=KURSOR]",
            "Salin perintah Berikutnya untuk mempertahankan filter.",
            "/jadwalsales HARI atau /jadwalsales TELEGRAM_ID [HARI] — Filter posisi seperti bot asal.",
            "Contoh: /jadwalsales 123456789 JuMaT; lanjut: /jadwalsales 123456789 jumat after=KURSOR.",
            "Jangan campur filter posisi dengan hari=/sf=. Telegram ID wajib asosiasi SF aktif unik.",
          ]
        : ["Pemantauan jadwal tersedia untuk Admin dan Supervisor aktif."]
    ),
    section(
      4,
      "OUTLET COMMANDS",
      monitor
        ? [
            "/outlets [KURSOR] — Daftar Outlet dengan halaman berikutnya.",
            "/outlet BUSINESS_ID — Detail Outlet; contoh: /outlet 00123.",
            "/outletinternal INTERNAL_ID — Lookup eksplisit data lama, tanpa fallback bisnis.",
            "ID Outlet Bisnis dan No. RS disimpan sebagai teks, nol awal tetap; belum didata untuk data lama.",
          ]
        : [
            "Daftar/detail Outlet hanya untuk Admin dan Supervisor aktif. Sales Force memilih token Outlet dari jadwal sendiri atau operator.",
          ]
    ),
    section(
      5,
      "ADMIN COMMANDS",
      admin
        ? [
            "/pending [KURSOR] — Permintaan registrasi, 10 akun per halaman.",
            "/approve TELEGRAM_ID admin|supervisor — Setujui akun pending.",
            "/approve TELEGRAM_ID sales SALES_FORCE_ID — Setujui SF terverifikasi.",
            "Contoh: /approve 123456789 sales sf-01",
            "/reject TELEGRAM_ID — Tolak registrasi pending.",
            "/users [KURSOR] — Daftar pengguna, 10 akun per halaman.",
            "/setrole TELEGRAM_ID admin|supervisor — Ubah role akun active.",
            "/setrole TELEGRAM_ID sales SALES_FORCE_ID — Role SF, wajib ID bisnis.",
            "Contoh: /setrole 123456789 sales sf-01",
            "/disable TELEGRAM_ID — Active → disabled; akses langsung dicabut.",
            "/enable TELEGRAM_ID — Disabled → active, role/asosiasi tetap.",
            "Gunakan Telegram ID dari profil terverifikasi, bukan username/internal User ID.",
            "sales_force juga diterima sebagai alias sales. Verifikasi orang dan SF di luar bot.",
            "SF tidak boleh diklaim dari akun lain (termasuk disabled). Asosiasi yang ada tidak diganti; tetap dicadangkan saat role berubah.",
            "Admin aktif tidak boleh diturunkan/dinonaktifkan. Admin aktif terakhir selalu dilindungi. Pengulangan keadaan yang sama tidak menambah audit.",
          ]
        : [
            "Persetujuan, daftar pengguna dan perubahan role/status hanya untuk Admin aktif. Hubungi Admin untuk aktivasi; akun disabled tidak memiliki akses operasional.",
          ]
    ),
    section(
      6,
      "OUTLET ADMIN COMMANDS",
      admin
        ? [
            "/tambahoutlet BUSINESS_ID NO_RS NAMA_OUTLET — Ketiga bidang wajib.",
            "Contoh: /tambahoutlet 00123 00045 Toko Sintetis Jakarta",
            "/editoutlet BUSINESS_ID NO_RS_BARU NAMA_OUTLET_BARU — ID bisnis tetap.",
            "/hapusoutlet BUSINESS_ID KONFIRMASI — Hapus jika tidak dirujuk.",
            "/editoutletinternal INTERNAL_ID NO_RS_BARU NAMA_OUTLET_BARU — Data lama.",
            "/hapusoutletinternal INTERNAL_ID KONFIRMASI — Data lama, perlindungan sama.",
            "Sintaks tambah nama-saja lama dihentikan; bukan mode kompatibilitas. Jangan kirim nama lama sebagai tiga argumen.",
            "/tambahjadwal SALES_FORCE_ID OUTLET_ID HARI — Buat rencana mingguan.",
            "Contoh: /tambahjadwal sf-01 out-01 senin",
            "OUTLET_ID pada /tambahjadwal tetap internal, SALES_FORCE_ID adalah ID bisnis SF. Jadwal bukan Visit selesai.",
          ]
        : ["Pemeliharaan Outlet dan pembuatan jadwal hanya untuk Admin aktif."]
    ),
    section(7, "AVAILABLE ROLES", [
      "ADMIN (admin) — Mengelola akun, Outlet dan rencana kunjungan.",
      "SALES / SALES FORCE (sales_force) — Jadwal sendiri dan input Visit.",
      "SUPERVISOR (supervisor) — Memantau jadwal dan Outlet.",
      "Status: pending → active atau rejected; active ↔ disabled oleh Admin.",
      "Registrasi ulang tidak mengaktifkan akun rejected/disabled.",
    ]),
    section(8, "SALES VISIT INPUT FORMAT", [
      "Visit minimal untuk Sales Force aktif melalui /salesvisit:",
      "1. outlet TOKEN_OUTLET — Salin token persis dari jadwal/operator.",
      "2. waktu sekarang atau waktu DD-MM-YYYY HH:mm — Waktu kunjungan sebenarnya, WIB.",
      "   Contoh: waktu 08-06-2026 09:30 (bukan masa depan; maks. 366 hari lalu).",
      "3. catatan ISI atau catatan lewati — Opsional, maks. 1000 karakter.",
      "4. tindaklanjut ISI atau tindaklanjut lewati — Opsional, maks. 1000 karakter.",
      "5. Periksa pratinjau sebelum /konfirmasi; /batal untuk membuang draf.",
      "Berbeda dari bot asal: belum ada Periode 1–5, saldo DigiPOS, Stock/Selling/Sellout, aktivitas CVM/Voice/Digital, atau Total Belanja. Stock Report belum dikumpulkan oleh wizard.",
    ]),
    section(9, "IMPORTANT NOTES", [
      "- Gunakan chat pribadi; grup tidak dilayani.",
      "- Telegram ID dari /me, ID bisnis Sales Force, ID Outlet Bisnis dan internal ID/token Outlet berbeda. No. RS bukan nomor telepon dan tidak unik.",
      "- HARI: senin, selasa, rabu, kamis, jumat, sabtu, minggu.",
      "- Spasi memisahkan argumen; nama Outlet boleh memakai spasi, tanpa underscore wajib.",
      "- ID/kursor perencanaan: salin token persis, termasuk awalan ~ (base64url UTF-8 tanpa padding). Bukan kredensial.",
      "- Argumen SF untuk persetujuan/ubah role masih ID sederhana tanpa spasi, bukan token ~ perencanaan.",
      "- Jangan ulangi pembuatan Outlet setelah kegagalan sebelum memeriksa daftar. Notifikasi Telegram bukan bukti transaksi; cek profil/daftar.",
      "- Visit menyimpan waktu kunjungan, catatan dan tindak lanjut; tidak menghitung laporan keuangan atau otomatis menyelesaikan jadwal.",
      "SALES VISIT BOT • OUTLET VISIT MANAGEMENT SYSTEM",
    ]),
  ];
}
