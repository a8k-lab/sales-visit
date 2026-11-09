import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  unique,
} from "drizzle-orm/sqlite-core";

// IDs are supplied by the caller (for example crypto.randomUUID()).
const id = () => text("id").primaryKey().notNull();
const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const salesForce = sqliteTable(
  "sales_force",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("sales_force_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check("sales_force_name_nonblank", sql`length(trim(${table.name})) > 0`),
  ]
);

export const users = sqliteTable(
  "users",
  {
    id: id().default(sql`(lower(hex(randomblob(16))))`),
    status: text("status", {
      enum: ["pending", "active", "rejected", "disabled"],
    })
      .notNull()
      .default("pending"),
    role: text("role", { enum: ["admin", "supervisor", "sales_force"] }),
    salesForceId: text("sales_force_id").references(() => salesForce.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("users_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check(
      "users_status_valid",
      sql`${table.status} in ('pending', 'active', 'rejected', 'disabled')`
    ),
    check(
      "users_role_valid",
      sql`${table.role} is null or ${table.role} in ('admin', 'supervisor', 'sales_force')`
    ),
    check(
      "users_approved_role_required",
      sql`${table.status} not in ('active', 'disabled') or ${table.role} is not null`
    ),
    check(
      "users_timestamps_integer",
      sql`typeof(${table.createdAt}) = 'integer' and typeof(${table.updatedAt}) = 'integer'`
    ),
    index("users_sales_force_idx").on(table.salesForceId),
  ]
);

// Current monitoring responsibility, not a group or an identity association.
export const salesForceSupervisors = sqliteTable(
  "sales_force_supervisors",
  {
    salesForceId: text("sales_force_id")
      .primaryKey()
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    supervisorUserId: text("supervisor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    index("sales_force_supervisors_user_idx").on(table.supervisorUserId),
  ]
);

export const supervisorAssignmentAudit = sqliteTable(
  "supervisor_assignment_audit",
  {
    id: id(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    salesForceId: text("sales_force_id")
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    previousSupervisorUserId: text("previous_supervisor_user_id").references(
      () => users.id,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    newSupervisorUserId: text("new_supervisor_user_id").references(
      () => users.id,
      { onDelete: "restrict", onUpdate: "restrict" }
    ),
    action: text("action", {
      enum: ["assign", "reassign", "unassign"],
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("supervisor_assignment_audit_sf_idx").on(table.salesForceId),
    check(
      "supervisor_assignment_audit_transition",
      sql`(${table.action} = 'assign' and ${table.previousSupervisorUserId} is null and ${table.newSupervisorUserId} is not null) or (${table.action} = 'reassign' and ${table.previousSupervisorUserId} is not null and ${table.newSupervisorUserId} is not null and ${table.previousSupervisorUserId} <> ${table.newSupervisorUserId}) or (${table.action} = 'unassign' and ${table.previousSupervisorUserId} is not null and ${table.newSupervisorUserId} is null)`
    ),
  ]
);

export const salesForceSupervisorsRelations = relations(
  salesForceSupervisors,
  ({ one }) => ({
    salesForce: one(salesForce, {
      fields: [salesForceSupervisors.salesForceId],
      references: [salesForce.id],
    }),
    supervisor: one(users, {
      fields: [salesForceSupervisors.supervisorUserId],
      references: [users.id],
    }),
  })
);

export const supervisorAssignmentAuditRelations = relations(
  supervisorAssignmentAudit,
  ({ one }) => ({
    actor: one(users, {
      fields: [supervisorAssignmentAudit.actorUserId],
      references: [users.id],
      relationName: "assignmentActor",
    }),
    salesForce: one(salesForce, {
      fields: [supervisorAssignmentAudit.salesForceId],
      references: [salesForce.id],
    }),
    previousSupervisor: one(users, {
      fields: [supervisorAssignmentAudit.previousSupervisorUserId],
      references: [users.id],
      relationName: "previousSupervisor",
    }),
    newSupervisor: one(users, {
      fields: [supervisorAssignmentAudit.newSupervisorUserId],
      references: [users.id],
      relationName: "newSupervisor",
    }),
  })
);

export const telegramIdentities = sqliteTable(
  "telegram_identities",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    telegramUserId: text("telegram_user_id").notNull(),
    username: text("username"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    unique("telegram_identities_telegram_user_unique").on(table.telegramUserId),
    check(
      "telegram_identities_id_canonical",
      sql`typeof(${table.telegramUserId}) = 'text' and ${table.telegramUserId} glob '[1-9]*' and ${table.telegramUserId} not glob '*[^0-9]*' and instr(${table.telegramUserId}, char(0)) = 0`
    ),
    check(
      "telegram_identities_timestamps_integer",
      sql`typeof(${table.createdAt}) = 'integer' and typeof(${table.updatedAt}) = 'integer'`
    ),
  ]
);

// Web credentials are opaque; only session token hashes are persisted.
export const webLoginChallenges = sqliteTable(
  "web_login_challenges",
  {
    id: id(),
    nonce: text("nonce").notNull().unique(),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    consumedAt: integer("consumed_at"),
  },
  (table) => [
    check("web_challenge_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
    index("web_challenge_expiry_idx").on(table.expiresAt),
  ]
);

export const webSessions = sqliteTable(
  "web_sessions",
  {
    tokenHash: text("token_hash").primaryKey().notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    createdAt: integer("created_at").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
  },
  (table) => [
    check(
      "web_session_hash",
      sql`length(${table.tokenHash}) = 64 and ${table.tokenHash} not glob '*[^0-9a-f]*'`
    ),
    check("web_session_expiry", sql`${table.expiresAt} > ${table.createdAt}`),
    index("web_session_user_idx").on(table.userId),
    index("web_session_expiry_idx").on(table.expiresAt),
  ]
);

// Restricted access-management history; never included in public business reads.
export const accessAudit = sqliteTable(
  "access_audit",
  {
    id: id(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    targetUserId: text("target_user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    action: text("action", {
      enum: ["register", "approve", "reject", "setrole", "disable", "enable"],
    }).notNull(),
    before: text("before_state").notNull(),
    after: text("after_state").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      "access_audit_action_valid",
      sql`${table.action} in ('register', 'approve', 'reject', 'setrole', 'disable', 'enable')`
    ),
    check(
      "access_audit_states_json",
      sql`json_valid(${table.before}) and json_valid(${table.after})`
    ),
    check(
      "access_audit_time_integer",
      sql`typeof(${table.createdAt}) = 'integer'`
    ),
    index("access_audit_target_idx").on(table.targetUserId),
  ]
);

export const usersRelations = relations(users, ({ one, many }) => ({
  supervisedSalesForce: many(salesForceSupervisors),
  assignmentActions: many(supervisorAssignmentAudit, {
    relationName: "assignmentActor",
  }),
  previousAssignments: many(supervisorAssignmentAudit, {
    relationName: "previousSupervisor",
  }),
  newAssignments: many(supervisorAssignmentAudit, {
    relationName: "newSupervisor",
  }),
  salesForce: one(salesForce, {
    fields: [users.salesForceId],
    references: [salesForce.id],
  }),
  telegramIdentity: one(telegramIdentities),
}));

export const telegramIdentitiesRelations = relations(
  telegramIdentities,
  ({ one }) => ({
    user: one(users, {
      fields: [telegramIdentities.userId],
      references: [users.id],
    }),
  })
);

export const outlets = sqliteTable(
  "outlets",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: createdAt(),
    businessId: text("business_id"),
    noRs: text("no_rs"),
    // Null for legacy rows whose last modification time is unknown.
    updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    unique("outlets_business_id_unique").on(table.businessId),
    check("outlets_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check("outlets_name_nonblank", sql`length(trim(${table.name})) > 0`),
  ]
);

// ISO weekday: Monday=1 (senin), Sunday=7 (minggu). A plan, never a Visit.
export const visitSchedules = sqliteTable(
  "visit_schedules",
  {
    id: id(),
    salesForceId: text("sales_force_id")
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    weekday: integer("weekday").notNull(),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    check("visit_schedules_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check(
      "visit_schedules_weekday_valid",
      sql`typeof(${table.weekday}) = 'integer' and ${table.weekday} between 1 and 7`
    ),
    check(
      "visit_schedules_timestamps_integer",
      sql`typeof(${table.createdAt}) = 'integer' and typeof(${table.updatedAt}) = 'integer'`
    ),
    unique("visit_schedules_assignment_unique").on(
      table.salesForceId,
      table.outletId,
      table.weekday
    ),
    index("visit_schedules_outlet_idx").on(table.outletId),
    index("visit_schedules_weekday_idx").on(table.weekday),
  ]
);

export const visitSchedulesRelations = relations(visitSchedules, ({ one }) => ({
  salesForce: one(salesForce, {
    fields: [visitSchedules.salesForceId],
    references: [salesForce.id],
  }),
  outlet: one(outlets, {
    fields: [visitSchedules.outletId],
    references: [outlets.id],
  }),
}));

export const products = sqliteTable(
  "products",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("products_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check("products_name_nonblank", sql`length(trim(${table.name})) > 0`),
  ]
);

export const visits = sqliteTable(
  "visits",
  {
    id: id(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    salesForceId: text("sales_force_id")
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    visitedAt: integer("visited_at", { mode: "timestamp_ms" }).notNull(),
    submissionChannel: text("submission_channel", {
      enum: ["web", "telegram"],
    }).notNull(),
    notes: text("notes"),
    followUp: text("follow_up"),
    createdAt: createdAt(),
  },
  (table) => [
    check("visits_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check(
      "visits_channel_valid",
      sql`${table.submissionChannel} in ('web', 'telegram')`
    ),
    check("visits_time_integer", sql`typeof(${table.visitedAt}) = 'integer'`),
    unique("visits_id_outlet_unique").on(table.id, table.outletId),
    index("visits_outlet_time_idx").on(table.outletId, table.visitedAt),
    index("visits_sales_force_time_idx").on(
      table.salesForceId,
      table.visitedAt
    ),
  ]
);

// One latest workflow/receipt per registered User. Submitting payloads are frozen.
export const telegramVisitDrafts = sqliteTable(
  "telegram_visit_drafts",
  {
    userId: text("user_id")
      .primaryKey()
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    key: text("submission_key").notNull(),
    salesForceId: text("sales_force_id")
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    step: text("step", {
      enum: [
        "outlet",
        "time",
        "notes",
        "followUp",
        "review",
        "submitting",
        "submitted",
        "cancelled",
        "expired",
      ],
    }).notNull(),
    payload: text("payload").notNull().default("{}"),
    revision: integer("revision").notNull().default(0),
    lastMessage: integer("last_message").notNull(),
    expiresAt: integer("expires_at").notNull(),
    visitId: text("visit_id").references(() => visits.id, {
      onDelete: "restrict",
      onUpdate: "restrict",
    }),
  },
  (table) => [
    unique("telegram_visit_drafts_key_unique").on(table.key),
    check(
      "telegram_visit_drafts_step_valid",
      sql`${table.step} in ('outlet','time','notes','followUp','review','submitting','submitted','cancelled','expired')`
    ),
    check(
      "telegram_visit_drafts_payload_json",
      sql`json_valid(${table.payload})`
    ),
    check(
      "telegram_visit_drafts_revision_valid",
      sql`typeof(${table.revision}) = 'integer' and ${table.revision} >= 0`
    ),
    check(
      "telegram_visit_drafts_message_valid",
      sql`typeof(${table.lastMessage}) = 'integer' and ${table.lastMessage} > 0`
    ),
    check(
      "telegram_visit_drafts_expiry_valid",
      sql`typeof(${table.expiresAt}) = 'integer'`
    ),
  ]
);

export const stockReports = sqliteTable(
  "stock_reports",
  {
    id: id(),
    outletId: text("outlet_id")
      .notNull()
      .references(() => outlets.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    reporterSalesForceId: text("reporter_sales_force_id")
      .notNull()
      .references(() => salesForce.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    visitId: text("visit_id"),
    reportedAt: integer("reported_at", { mode: "timestamp_ms" }).notNull(),
    submissionChannel: text("submission_channel", {
      enum: ["web", "telegram"],
    }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("stock_reports_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check(
      "stock_reports_channel_valid",
      sql`${table.submissionChannel} in ('web', 'telegram')`
    ),
    check(
      "stock_reports_time_integer",
      sql`typeof(${table.reportedAt}) = 'integer'`
    ),
    // A linked Visit must be for this Outlet. Reporter need not equal visitor.
    foreignKey({
      name: "stock_reports_visit_outlet_fk",
      columns: [table.visitId, table.outletId],
      foreignColumns: [visits.id, visits.outletId],
    })
      .onDelete("restrict")
      .onUpdate("restrict"),
    index("stock_reports_outlet_time_idx").on(table.outletId, table.reportedAt),
    index("stock_reports_reporter_time_idx").on(
      table.reporterSalesForceId,
      table.reportedAt
    ),
    index("stock_reports_visit_outlet_idx").on(table.visitId, table.outletId),
  ]
);

export const stockReportItems = sqliteTable(
  "stock_report_items",
  {
    stockReportId: text("stock_report_id")
      .notNull()
      .references(() => stockReports.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    quantity: integer("quantity").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.stockReportId, table.productId] }),
    check(
      "stock_report_items_quantity_valid",
      sql`typeof(${table.quantity}) = 'integer' and ${table.quantity} >= 0 and ${table.quantity} <= 9007199254740991`
    ),
    index("stock_report_items_product_idx").on(table.productId),
  ]
);

export const salesForceRelations = relations(salesForce, ({ one, many }) => ({
  supervisorAssignment: one(salesForceSupervisors),
  assignmentHistory: many(supervisorAssignmentAudit),
  users: many(users),
  visitSchedules: many(visitSchedules),
  visits: many(visits),
  stockReports: many(stockReports),
}));

export const outletsRelations = relations(outlets, ({ many }) => ({
  visitSchedules: many(visitSchedules),
  visits: many(visits),
  stockReports: many(stockReports),
}));

export const productsRelations = relations(products, ({ many }) => ({
  stockReportItems: many(stockReportItems),
}));

export const visitsRelations = relations(visits, ({ one, many }) => ({
  outlet: one(outlets, { fields: [visits.outletId], references: [outlets.id] }),
  salesForce: one(salesForce, {
    fields: [visits.salesForceId],
    references: [salesForce.id],
  }),
  stockReports: many(stockReports),
}));

export const stockReportsRelations = relations(
  stockReports,
  ({ one, many }) => ({
    outlet: one(outlets, {
      fields: [stockReports.outletId],
      references: [outlets.id],
    }),
    reporterSalesForce: one(salesForce, {
      fields: [stockReports.reporterSalesForceId],
      references: [salesForce.id],
    }),
    visit: one(visits, {
      fields: [stockReports.visitId, stockReports.outletId],
      references: [visits.id, visits.outletId],
    }),
    items: many(stockReportItems),
  })
);

export const stockReportItemsRelations = relations(
  stockReportItems,
  ({ one }) => ({
    stockReport: one(stockReports, {
      fields: [stockReportItems.stockReportId],
      references: [stockReports.id],
    }),
    product: one(products, {
      fields: [stockReportItems.productId],
      references: [products.id],
    }),
  })
);
