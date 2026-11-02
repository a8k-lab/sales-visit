import type {
  Outlet,
  Product,
  SalesForce,
  StockReport,
  Visit,
} from "@sales-visit/contracts";

// Synthetic Bandung-area fixtures. Extra contact fields are prototype display data,
// not additions to the shared business contracts.
export const salesForce = [
  {
    id: "sf-01",
    name: "Rizky Pratama",
    territory: "Coblong",
    phone: "+62 812-0000-0101",
  },
  {
    id: "sf-02",
    name: "Dewi Lestari",
    territory: "Sukajadi",
    phone: "+62 812-0000-0102",
  },
  {
    id: "sf-03",
    name: "Fajar Ramadhan",
    territory: "Cicendo",
    phone: "+62 812-0000-0103",
  },
] satisfies (SalesForce & { territory: string; phone: string })[];

export const outlets = [
  {
    id: "out-01",
    name: "Dago Cell",
    address: "Jl. Ir. H. Juanda No. 128, Coblong, Bandung",
    contact: "Bapak Hendra",
    phone: "+62 812-0000-0201",
  },
  {
    id: "out-02",
    name: "Sukajadi Pulsa",
    address: "Jl. Sukajadi No. 64, Sukajadi, Bandung",
    contact: "Ibu Rina",
    phone: "+62 812-0000-0202",
  },
  {
    id: "out-03",
    name: "Cihampelas Cellular",
    address: "Jl. Cihampelas No. 92, Coblong, Bandung",
    contact: "Bapak Agus",
    phone: "+62 812-0000-0203",
  },
  {
    id: "out-04",
    name: "Pasteur Phone",
    address: "Jl. Dr. Djunjunan No. 45, Cicendo, Bandung",
    contact: "Ibu Sari",
    phone: "+62 812-0000-0204",
  },
  {
    id: "out-05",
    name: "Cipaganti Cell",
    address: "Jl. Cipaganti No. 77, Coblong, Bandung",
    contact: "Bapak Deni",
    phone: "+62 812-0000-0205",
  },
] satisfies (Outlet & { address: string; contact: string; phone: string })[];

export const products = [
  {
    id: "prd-01",
    name: "Kartu Perdana Simpati",
    category: "Perdana SA",
    unit: "paket",
  },
  {
    id: "prd-02",
    name: "Kartu Perdana by.U",
    category: "Perdana SA",
    unit: "paket",
  },
  {
    id: "prd-03",
    name: "Voucher Internet 3 GB / 7 hari",
    category: "VF Data",
    unit: "voucher",
  },
  {
    id: "prd-04",
    name: "Voucher Telepon 20 menit",
    category: "VF Voice",
    unit: "voucher",
  },
] satisfies (Product & { category: string; unit: string })[];

export const visits: Visit[] = [
  {
    id: "VST-0012",
    outletId: "out-01",
    salesForceId: "sf-01",
    visitedAt: "2026-11-03T14:20:00+07:00",
    submissionChannel: "web",
    notes:
      "Meninjau ketersediaan kartu perdana bersama Pak Hendra. Memperbarui pajangan produk di dekat konter.",
    followUp: "Bawa brosur produk terbaru pada kunjungan berikutnya.",
  },
  {
    id: "VST-0011",
    outletId: "out-02",
    salesForceId: "sf-02",
    visitedAt: "2026-11-03T13:45:00+07:00",
    submissionChannel: "telegram",
    notes:
      "Membahas pilihan voucher bersama Ibu Rina. Mencatat jumlah stok yang beliau laporkan.",
  },
  {
    id: "VST-0010",
    outletId: "out-04",
    salesForceId: "sf-03",
    visitedAt: "2026-11-03T11:10:00+07:00",
    submissionChannel: "web",
    notes:
      "Bertemu penjaga konter. Pemilik sedang tidak di tempat sehingga jumlah stok tidak dicatat.",
    followUp: "Kembali pada hari Kamis saat Ibu Sari berada di Outlet.",
  },
  {
    id: "VST-0009",
    outletId: "out-03",
    salesForceId: "sf-01",
    visitedAt: "2026-11-03T09:30:00+07:00",
    submissionChannel: "telegram",
    notes: "Kunjungan rutin dan diskusi produk. Jumlah stok dicatat di konter.",
  },
  {
    id: "VST-0008",
    outletId: "out-05",
    salesForceId: "sf-01",
    visitedAt: "2026-11-02T15:00:00+07:00",
    submissionChannel: "web",
    notes:
      "Memperkenalkan pilihan kartu perdana by.U. Pak Deni meminta lembar informasi produk.",
    followUp: "Bagikan lembar informasi produk.",
  },
  {
    id: "VST-0007",
    outletId: "out-02",
    salesForceId: "sf-02",
    visitedAt: "2026-11-02T13:15:00+07:00",
    submissionChannel: "web",
    notes:
      "Meninjau pajangan voucher dan mencatat jumlah stok yang dilaporkan.",
  },
  {
    id: "VST-0006",
    outletId: "out-04",
    salesForceId: "sf-03",
    visitedAt: "2026-11-02T10:40:00+07:00",
    submissionChannel: "telegram",
    notes: "Bertemu Ibu Sari dan membahas pilihan kartu perdana.",
  },
  {
    id: "VST-0005",
    outletId: "out-01",
    salesForceId: "sf-01",
    visitedAt: "2026-11-02T09:00:00+07:00",
    submissionChannel: "telegram",
    notes: "Mencatat jumlah kartu perdana dan voucher yang dilaporkan.",
  },
  {
    id: "VST-0004",
    outletId: "out-03",
    salesForceId: "sf-01",
    visitedAt: "2026-10-31T14:00:00+07:00",
    submissionChannel: "web",
    notes:
      "Kunjungan untuk meninjau pajangan produk. Tidak ada laporan stok yang dikirim.",
  },
  {
    id: "VST-0003",
    outletId: "out-04",
    salesForceId: "sf-03",
    visitedAt: "2026-10-31T11:30:00+07:00",
    submissionChannel: "telegram",
    notes: "Mencatat jumlah stok yang dilaporkan pemilik Outlet.",
  },
  {
    id: "VST-0002",
    outletId: "out-05",
    salesForceId: "sf-01",
    visitedAt: "2026-10-30T13:00:00+07:00",
    submissionChannel: "telegram",
    notes: "Kunjungan rutin ke Outlet dan pengamatan stok.",
  },
  {
    id: "VST-0001",
    outletId: "out-02",
    salesForceId: "sf-02",
    visitedAt: "2026-10-30T09:15:00+07:00",
    submissionChannel: "web",
    notes:
      "Meninjau ketersediaan produk dan mencatat jumlah stok yang dilaporkan.",
  },
];

export const stockReports: StockReport[] = [
  {
    id: "SR-0010",
    outletId: "out-01",
    reporterSalesForceId: "sf-01",
    visitId: "VST-0012",
    reportedAt: "2026-11-03T14:25:00+07:00",
    submissionChannel: "web",
    items: [
      { productId: "prd-01", quantity: 18 },
      { productId: "prd-02", quantity: 8 },
      { productId: "prd-03", quantity: 32 },
    ],
  },
  {
    id: "SR-0009",
    outletId: "out-01",
    reporterSalesForceId: "sf-01",
    visitId: "VST-0012",
    reportedAt: "2026-11-03T14:30:00+07:00",
    submissionChannel: "web",
    items: [{ productId: "prd-04", quantity: 6 }],
  },
  {
    id: "SR-0008",
    outletId: "out-02",
    reporterSalesForceId: "sf-02",
    visitId: "VST-0011",
    reportedAt: "2026-11-03T13:50:00+07:00",
    submissionChannel: "telegram",
    items: [
      { productId: "prd-03", quantity: 24 },
      { productId: "prd-04", quantity: 0 },
    ],
  },
  {
    id: "SR-0007",
    outletId: "out-03",
    reporterSalesForceId: "sf-01",
    visitId: "VST-0009",
    reportedAt: "2026-11-03T09:35:00+07:00",
    submissionChannel: "telegram",
    items: [
      { productId: "prd-01", quantity: 12 },
      { productId: "prd-02", quantity: 5 },
    ],
  },
  {
    id: "SR-0006",
    outletId: "out-02",
    reporterSalesForceId: "sf-02",
    visitId: "VST-0007",
    reportedAt: "2026-11-02T13:20:00+07:00",
    submissionChannel: "web",
    items: [{ productId: "prd-03", quantity: 30 }],
  },
  {
    id: "SR-0005",
    outletId: "out-01",
    reporterSalesForceId: "sf-01",
    visitId: "VST-0005",
    reportedAt: "2026-11-02T09:05:00+07:00",
    submissionChannel: "telegram",
    items: [
      { productId: "prd-01", quantity: 20 },
      { productId: "prd-03", quantity: 36 },
    ],
  },
  {
    id: "SR-0004",
    outletId: "out-04",
    reporterSalesForceId: "sf-03",
    visitId: "VST-0003",
    reportedAt: "2026-10-31T11:35:00+07:00",
    submissionChannel: "telegram",
    items: [{ productId: "prd-02", quantity: 9 }],
  },
  {
    id: "SR-0003",
    outletId: "out-05",
    reporterSalesForceId: "sf-01",
    visitId: "VST-0002",
    reportedAt: "2026-10-30T13:05:00+07:00",
    submissionChannel: "telegram",
    items: [
      { productId: "prd-01", quantity: 15 },
      { productId: "prd-04", quantity: 10 },
    ],
  },
  {
    id: "SR-0002",
    outletId: "out-02",
    reporterSalesForceId: "sf-02",
    visitId: "VST-0001",
    reportedAt: "2026-10-30T09:20:00+07:00",
    submissionChannel: "web",
    items: [{ productId: "prd-03", quantity: 40 }],
  },
  // An independent snapshot submitted by Sales Force, not outlet self-reporting.
  {
    id: "SR-0001",
    outletId: "out-05",
    reporterSalesForceId: "sf-01",
    reportedAt: "2026-10-29T16:00:00+07:00",
    submissionChannel: "web",
    items: [{ productId: "prd-01", quantity: 16 }],
  },
];
