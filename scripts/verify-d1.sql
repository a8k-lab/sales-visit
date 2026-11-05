-- Read-only, no personal identity values in output.
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;
SELECT id, name, applied_at FROM d1_migrations ORDER BY id;
PRAGMA foreign_key_check;
SELECT 'sales_force' AS resource, count(*) AS records FROM sales_force
UNION ALL SELECT 'outlets', count(*) FROM outlets
UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'visits', count(*) FROM visits
UNION ALL SELECT 'stock_reports', count(*) FROM stock_reports
UNION ALL SELECT 'stock_report_items', count(*) FROM stock_report_items
UNION ALL SELECT 'users', count(*) FROM users
UNION ALL SELECT 'telegram_identities', count(*) FROM telegram_identities
UNION ALL SELECT 'access_audit', count(*) FROM access_audit;
