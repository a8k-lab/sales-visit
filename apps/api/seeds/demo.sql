-- Synthetic T1 data. Run ONLY against an explicitly verified non-Production DB.
-- Reserved demo-* namespace; conflicts never overwrite business fields.
-- Recover pre-0012 provenance ONLY for exact deterministic seed fingerprints
-- (IDs, timestamps and all business fields), never by prefix alone. Edited or
-- ambiguous legacy records stay unmarked pending explicit operator review.
WITH personas(id,name) AS (VALUES
 ('demo-sf-01','Rizky Pratama'), ('demo-sf-02','Dewi Lestari'),
 ('demo-sf-03','Fajar Ramadhan'), ('demo-sf-04','Siti Nurhaliza'),
 ('demo-sf-05','Ahmad Fauzi'), ('demo-sf-06','Putri Maharani'),
 ('demo-sf-07','Bagas Saputra'), ('demo-sf-08','Nadia Permatasari'),
 ('demo-sf-09','Dimas Kurniawan'), ('demo-sf-10','Ratna Wulandari'),
 ('demo-sf-11','Ilham Maulana'), ('demo-sf-12','Ayu Puspita'),
 ('demo-sf-13','Yoga Firmansyah'), ('demo-sf-14','Intan Kartika'))
INSERT INTO sales_force (id, name, created_at, demo_only)
SELECT id, name, 1793664000000, 1 FROM personas WHERE true
ON CONFLICT (id) DO UPDATE SET demo_only = 1
WHERE sales_force.demo_only = 0
  AND sales_force.name = excluded.name AND sales_force.created_at = excluded.created_at
  AND NOT EXISTS (SELECT 1 FROM users owner WHERE owner.sales_force_id = sales_force.id
    AND (owner.id <> sales_force.id OR owner.created_at <> 1793664000000
      OR EXISTS (SELECT 1 FROM telegram_identities WHERE user_id = owner.id)));

WITH personas(id,name,status,role) AS (VALUES
 ('demo-admin-01','Budi Santoso','active','admin'),
 ('demo-admin-02','Rina Handayani','active','admin'),
 ('demo-supervisor-01','Agus Setiawan','active','supervisor'),
 ('demo-supervisor-02','Maya Sari','active','supervisor'),
 ('demo-supervisor-03','Hendra Wijaya','active','supervisor'),
 ('demo-supervisor-04','Lina Marlina','active','supervisor'))
INSERT INTO users (id, display_name, status, role, created_at, updated_at)
SELECT id, name, status, role, 1793664000000, 1793664000000 FROM personas WHERE true
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, display_name, status, role, sales_force_id, created_at, updated_at)
SELECT sf.id, sf.name, 'active', 'sales_force', sf.id, 1793664000000, 1793664000000 FROM sales_force sf
WHERE sf.id IN ('demo-sf-01','demo-sf-02','demo-sf-03','demo-sf-04','demo-sf-05','demo-sf-06','demo-sf-07','demo-sf-08','demo-sf-09','demo-sf-10','demo-sf-11','demo-sf-12','demo-sf-13','demo-sf-14')
AND sf.demo_only = 1
AND NOT EXISTS (SELECT 1 FROM users WHERE sales_force_id = sf.id)
ON CONFLICT (id) DO NOTHING;

INSERT INTO sales_force_supervisors (sales_force_id, supervisor_user_id, created_at, updated_at)
SELECT sales_force_id, CASE WHEN substr(id,-2) <= '04' THEN 'demo-supervisor-01'
 WHEN substr(id,-2) <= '09' THEN 'demo-supervisor-02' ELSE 'demo-supervisor-03' END,
 1793664000000, 1793664000000
FROM users WHERE id LIKE 'demo-sf-%' AND status = 'active' AND role = 'sales_force'
 AND sales_force_id IS NOT NULL
 AND EXISTS (SELECT 1 FROM sales_force sf WHERE sf.id = users.sales_force_id AND sf.demo_only = 1)
 AND NOT EXISTS (SELECT 1 FROM telegram_identities WHERE user_id = users.id)
ON CONFLICT (sales_force_id) DO NOTHING;

WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<35)
INSERT INTO outlets (id, name, business_id, no_rs, created_at, updated_at, demo_only)
SELECT printf('demo-out-%02d',i), printf('Konter Nusantara %02d',i), printf('DEMO-OUT-%02d',i), printf('DEMO-RS-%02d',i), 1793664000000, 1793664000000, 1 FROM n WHERE true
ON CONFLICT (id) DO UPDATE SET demo_only = 1
WHERE outlets.demo_only = 0 AND outlets.name = excluded.name
  AND outlets.business_id = excluded.business_id AND outlets.no_rs = excluded.no_rs
  AND outlets.created_at = excluded.created_at AND outlets.updated_at = excluded.updated_at;

WITH catalog(id,name) AS (VALUES
 ('demo-prd-01','Perdana Simpati'), ('demo-prd-02','Perdana by.U'),
 ('demo-prd-03','Voucher Internet 5 GB'), ('demo-prd-04','Voucher Telepon 30 menit'))
INSERT INTO products (id, name, created_at)
SELECT id, name, 1793664000000 FROM catalog WHERE true
ON CONFLICT (id) DO NOTHING;

-- 156 Visits, twelve SF with varying activity; SF 13 and 14 have no Visits.
WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<24)
INSERT INTO visits (id, outlet_id, sales_force_id, visited_at, submission_channel, notes, follow_up, created_at)
SELECT printf('demo-visit-%02d-%02d',cast(substr(sf.id,-2) AS INTEGER),i),
 printf('demo-out-%02d',1+((i+cast(substr(sf.id,-2) AS INTEGER))%35)), sf.id,
 1793664000000 + (i-1)*86400000 + cast(substr(sf.id,-2) AS INTEGER)*600000,
 'web', 'Meninjau pajangan dan ketersediaan produk.',
 CASE WHEN i%3=0 THEN 'Tinjau kembali kebutuhan voucher pekan depan.' END,
 1793664000000 + (i-1)*86400000 + cast(substr(sf.id,-2) AS INTEGER)*600000
FROM sales_force sf CROSS JOIN n
WHERE sf.id >= 'demo-sf-01' AND sf.id <= 'demo-sf-12' AND i <= cast(substr(sf.id,-2) AS INTEGER)*2
AND sf.demo_only = 1
AND EXISTS (SELECT 1 FROM outlets o WHERE o.id = printf('demo-out-%02d',1+((i+cast(substr(sf.id,-2) AS INTEGER))%35)) AND o.demo_only = 1)
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_reports (id, outlet_id, reporter_sales_force_id, visit_id, reported_at, submission_channel, created_at)
SELECT 'demo-stock-' || substr(id,12), outlet_id, sales_force_id, id, visited_at+300000, 'web', created_at+300000
FROM visits WHERE id LIKE 'demo-visit-%' AND cast(substr(id,-2) AS INTEGER)%2=0
ON CONFLICT (id) DO NOTHING;

INSERT INTO stock_report_items (stock_report_id, product_id, quantity)
SELECT r.id, p.id, (cast(substr(r.id,-2) AS INTEGER)*7+cast(substr(p.id,-2) AS INTEGER)*3)%45
FROM stock_reports r CROSS JOIN products p WHERE r.id LIKE 'demo-stock-%' AND p.id LIKE 'demo-prd-%'
ON CONFLICT (stock_report_id, product_id) DO NOTHING;

WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<7)
INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday, created_at, updated_at, demo_only)
SELECT printf('demo-schedule-%s-%d',sf.id,i), sf.id,
 printf('demo-out-%02d',1+((cast(substr(sf.id,-2) AS INTEGER)*2+i)%35)), i, 1793664000000, 1793664000000, 1
FROM sales_force sf CROSS JOIN n WHERE sf.id >= 'demo-sf-01' AND sf.id <= 'demo-sf-14'
AND sf.demo_only = 1
AND EXISTS (SELECT 1 FROM outlets o WHERE o.id = printf('demo-out-%02d',1+((cast(substr(sf.id,-2) AS INTEGER)*2+i)%35)) AND o.demo_only = 1)
ON CONFLICT (id) DO UPDATE SET demo_only = 1
WHERE visit_schedules.demo_only = 0
  AND visit_schedules.sales_force_id = excluded.sales_force_id
  AND visit_schedules.outlet_id = excluded.outlet_id AND visit_schedules.weekday = excluded.weekday
  AND visit_schedules.created_at = excluded.created_at AND visit_schedules.updated_at = excluded.updated_at
  AND EXISTS (SELECT 1 FROM sales_force WHERE id = excluded.sales_force_id AND demo_only = 1)
  AND EXISTS (SELECT 1 FROM outlets WHERE id = excluded.outlet_id AND demo_only = 1)
ON CONFLICT (sales_force_id, outlet_id, weekday) DO NOTHING;
