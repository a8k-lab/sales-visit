-- Synthetic LOCAL development only. Apply migrations and seeds/local.sql first.
-- Internal IDs refer to that synthetic fixture, not business codes/Telegram IDs.
-- No Users, permissions, Visits or Stock Reports are created or modified.
INSERT INTO visit_schedules (id, sales_force_id, outlet_id, weekday, created_at, updated_at) VALUES
  ('synthetic-schedule-01', 'sf-01', 'out-01', 1, 1793664000000, 1793664000000),
  ('synthetic-schedule-02', 'sf-01', 'out-02', 1, 1793664000000, 1793664000000),
  ('synthetic-schedule-03', 'sf-02', 'out-01', 1, 1793664000000, 1793664000000),
  ('synthetic-schedule-04', 'sf-01', 'out-01', 7, 1793664000000, 1793664000000)
ON CONFLICT (sales_force_id, outlet_id, weekday) DO NOTHING;
