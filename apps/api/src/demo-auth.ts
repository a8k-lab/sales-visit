export const demoAccountQuery = `SELECT u.id, trim(u.display_name) AS name,
  u.role, u.sales_force_id AS salesForceId FROM users u`;

export const demoEnabled = (env: {
  DEMO_AUTH_ENABLED?: string;
  APP_ENV?: string;
}) =>
  env.DEMO_AUTH_ENABLED === "true" &&
  ["local", "staging"].includes(env.APP_ENV ?? "");

export const demoEligibility = `u.status = 'active'
  AND u.role IN ('admin','supervisor','sales_force')
  AND length(trim(u.display_name)) BETWEEN 1 AND 256
  AND instr(u.display_name, char(0)) = 0
  AND u.display_name NOT GLOB ('*[' || char(1) || '-' || char(31) || char(127) || ']*')
  AND (u.role <> 'sales_force' OR EXISTS (SELECT 1 FROM sales_force sf WHERE sf.id = u.sales_force_id
    AND (SELECT count(*) FROM users WHERE sales_force_id = sf.id) = 1))
  AND NOT EXISTS (SELECT 1 FROM telegram_identities WHERE user_id = u.id)`;
