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

export const outlets = sqliteTable(
  "outlets",
  {
    id: id(),
    name: text("name").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    check("outlets_id_nonblank", sql`length(trim(${table.id})) > 0`),
    check("outlets_name_nonblank", sql`length(trim(${table.name})) > 0`),
  ]
);

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

export const salesForceRelations = relations(salesForce, ({ many }) => ({
  visits: many(visits),
  stockReports: many(stockReports),
}));

export const outletsRelations = relations(outlets, ({ many }) => ({
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
