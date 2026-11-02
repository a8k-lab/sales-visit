import { outlets, products, salesForce } from "@/data/mock-data";

export type StockRow = { id: string; productId: string; quantity: string };
export type VisitEntry = {
  outletId: string;
  salesForceId: string;
  visitedAt: string;
  notes: string;
  followUp: string;
  includeStock: boolean;
  rows: StockRow[];
};
export type EntryErrors = Record<string, string>;

export function currentWibDateTime() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

export function visitTimestamp(value: string) {
  return `${value}:00+07:00`;
}

export function validateEntry(value: VisitEntry): EntryErrors {
  const errors: EntryErrors = {};
  if (!outlets.some((item) => item.id === value.outletId))
    errors.outletId = "Pilih Outlet yang dikunjungi.";
  if (!salesForce.some((item) => item.id === value.salesForceId))
    errors.salesForceId = "Pilih Sales Force yang melakukan kunjungan.";
  const timestamp = visitTimestamp(value.visitedAt);
  const date = new Date(timestamp);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value.visitedAt) ||
    Number.isNaN(date.getTime()) ||
    new Date(date.getTime() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16) !==
      value.visitedAt
  ) {
    errors.visitedAt = "Isi tanggal dan waktu kunjungan yang valid (WIB).";
  }
  if (value.includeStock) {
    if (!value.rows.length)
      errors.rows = "Tambahkan minimal satu produk untuk laporan stok.";
    const seen = new Set<string>();
    for (const row of value.rows) {
      if (!products.some((item) => item.id === row.productId))
        errors[`${row.id}.product`] = "Pilih produk yang dilaporkan.";
      else if (seen.has(row.productId))
        errors[`${row.id}.product`] =
          "Produk ini sudah dipilih. Gunakan satu baris per produk.";
      seen.add(row.productId);
      if (
        !/^\d+$/.test(row.quantity) ||
        !Number.isSafeInteger(Number(row.quantity))
      ) {
        errors[`${row.id}.quantity`] =
          "Isi jumlah berupa bilangan bulat nol atau lebih.";
      }
    }
  }
  return errors;
}
