CREATE TABLE `outlets` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "outlets_id_nonblank" CHECK(length(trim("outlets"."id")) > 0),
	CONSTRAINT "outlets_name_nonblank" CHECK(length(trim("outlets"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "products_id_nonblank" CHECK(length(trim("products"."id")) > 0),
	CONSTRAINT "products_name_nonblank" CHECK(length(trim("products"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `sales_force` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	CONSTRAINT "sales_force_id_nonblank" CHECK(length(trim("sales_force"."id")) > 0),
	CONSTRAINT "sales_force_name_nonblank" CHECK(length(trim("sales_force"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `stock_report_items` (
	`stock_report_id` text NOT NULL,
	`product_id` text NOT NULL,
	`quantity` integer NOT NULL,
	PRIMARY KEY(`stock_report_id`, `product_id`),
	FOREIGN KEY (`stock_report_id`) REFERENCES `stock_reports`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "stock_report_items_quantity_valid" CHECK(typeof("stock_report_items"."quantity") = 'integer' and "stock_report_items"."quantity" >= 0 and "stock_report_items"."quantity" <= 9007199254740991)
);
--> statement-breakpoint
CREATE INDEX `stock_report_items_product_idx` ON `stock_report_items` (`product_id`);--> statement-breakpoint
CREATE TABLE `stock_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`reporter_sales_force_id` text NOT NULL,
	`visit_id` text,
	`reported_at` integer NOT NULL,
	`submission_channel` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`reporter_sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`visit_id`,`outlet_id`) REFERENCES `visits`(`id`,`outlet_id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "stock_reports_id_nonblank" CHECK(length(trim("stock_reports"."id")) > 0),
	CONSTRAINT "stock_reports_channel_valid" CHECK("stock_reports"."submission_channel" in ('web', 'telegram')),
	CONSTRAINT "stock_reports_time_integer" CHECK(typeof("stock_reports"."reported_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `stock_reports_outlet_time_idx` ON `stock_reports` (`outlet_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `stock_reports_reporter_time_idx` ON `stock_reports` (`reporter_sales_force_id`,`reported_at`);--> statement-breakpoint
CREATE INDEX `stock_reports_visit_outlet_idx` ON `stock_reports` (`visit_id`,`outlet_id`);--> statement-breakpoint
CREATE TABLE `visits` (
	`id` text PRIMARY KEY NOT NULL,
	`outlet_id` text NOT NULL,
	`sales_force_id` text NOT NULL,
	`visited_at` integer NOT NULL,
	`submission_channel` text NOT NULL,
	`notes` text,
	`follow_up` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "visits_id_nonblank" CHECK(length(trim("visits"."id")) > 0),
	CONSTRAINT "visits_channel_valid" CHECK("visits"."submission_channel" in ('web', 'telegram')),
	CONSTRAINT "visits_time_integer" CHECK(typeof("visits"."visited_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `visits_outlet_time_idx` ON `visits` (`outlet_id`,`visited_at`);--> statement-breakpoint
CREATE INDEX `visits_sales_force_time_idx` ON `visits` (`sales_force_id`,`visited_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `visits_id_outlet_unique` ON `visits` (`id`,`outlet_id`);