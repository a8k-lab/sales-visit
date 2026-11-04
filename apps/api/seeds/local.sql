-- Synthetic subset of the Web mock fixtures; no frontend runtime dependency.
-- Stable IDs, explicit receipt times, and conflict-specific no-ops make reruns safe.
-- Existing records are never overwritten. Local development only.
INSERT INTO sales_force (id, name, created_at) VALUES
  ('sf-01', 'Rizky Pratama', 1793664000000),
  ('sf-02', 'Dewi Lestari', 1793664000000),
  ('sf-03', 'Fajar Ramadhan', 1793664000000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO outlets (id, name, created_at) VALUES
  ('out-01', 'Dago Cell', 1793664000000),
  ('out-02', 'Sukajadi Pulsa', 1793664000000),
  ('out-03', 'Cihampelas Cellular', 1793664000000),
  ('out-04', 'Pasteur Phone', 1793664000000),
  ('out-05', 'Cipaganti Cell', 1793664000000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO products (id, name, created_at) VALUES
  ('prd-01', 'Kartu Perdana Simpati', 1793664000000),
  ('prd-02', 'Kartu Perdana by.U', 1793664000000),
  ('prd-03', 'Voucher Internet 3 GB / 7 hari', 1793664000000),
  ('prd-04', 'Voucher Telepon 20 menit', 1793664000000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel, notes, follow_up, created_at) VALUES
  ('VST-0012', 'out-01', 'sf-01', unixepoch('2026-11-03T14:20:00+07:00') * 1000, 'web',
   'Meninjau ketersediaan kartu perdana bersama Pak Hendra. Memperbarui pajangan produk di dekat konter.',
   'Bawa brosur produk terbaru pada kunjungan berikutnya.', 1793690400000),
  ('VST-0011', 'out-02', 'sf-02', unixepoch('2026-11-03T13:45:00+07:00') * 1000, 'telegram',
   'Membahas pilihan voucher bersama Ibu Rina. Mencatat jumlah stok yang beliau laporkan.', NULL, 1793688300000),
  ('VST-0010', 'out-04', 'sf-03', unixepoch('2026-11-03T11:10:00+07:00') * 1000, 'web',
   'Bertemu penjaga konter. Pemilik sedang tidak di tempat sehingga jumlah stok tidak dicatat.',
   'Kembali pada hari Kamis saat Ibu Sari berada di Outlet.', 1793679000000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel, created_at) VALUES
  ('SR-0010', 'out-01', 'sf-01', 'VST-0012', unixepoch('2026-11-03T14:25:00+07:00') * 1000, 'web', 1793690700000),
  ('SR-0009', 'out-01', 'sf-01', 'VST-0012', unixepoch('2026-11-03T14:30:00+07:00') * 1000, 'web', 1793691000000),
  ('SR-0008', 'out-02', 'sf-02', 'VST-0011', unixepoch('2026-11-03T13:50:00+07:00') * 1000, 'telegram', 1793688600000),
  ('SR-0001', 'out-05', 'sf-01', NULL, unixepoch('2026-10-29T16:00:00+07:00') * 1000, 'web', 1793264400000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_report_items (stock_report_id, product_id, quantity) VALUES
  ('SR-0010', 'prd-01', 18),
  ('SR-0010', 'prd-02', 8),
  ('SR-0010', 'prd-03', 32),
  ('SR-0009', 'prd-04', 6),
  ('SR-0008', 'prd-03', 24),
  ('SR-0008', 'prd-04', 0),
  ('SR-0001', 'prd-01', 16)
ON CONFLICT (stock_report_id, product_id) DO NOTHING;
