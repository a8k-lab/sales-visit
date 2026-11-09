import {
  sql,
  type salesForce,
  type visits,
  type stockReports,
} from "@sales-visit/db";

// Resolve current roles and assignments in the data query, not a session snapshot.
// The column must be the operational owner/reporter, never a caller filter.
export function operationalScope(
  userId: string,
  owner:
    | typeof salesForce.id
    | typeof visits.salesForceId
    | typeof stockReports.reporterSalesForceId
) {
  return sql`exists (select 1 from users scope_user
    where scope_user.id = ${userId} and scope_user.status = 'active' and (
      scope_user.role = 'admin'
      or (scope_user.role = 'supervisor' and exists (
        select 1 from sales_force_supervisors scope_assignment
        where scope_assignment.supervisor_user_id = scope_user.id
          and scope_assignment.sales_force_id = ${owner}))
      or (scope_user.role = 'sales_force' and scope_user.sales_force_id = ${owner}
        and (select count(*) from users claimant where claimant.sales_force_id = scope_user.sales_force_id) = 1)
    ))`;
}
